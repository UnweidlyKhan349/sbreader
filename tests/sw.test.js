// The service worker (sw.js), run in a sandbox with stand-ins for the
// browser's caches and network: a cache that can't be written or opened
// never turns a good download into a failed request.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./helpers');

const SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const ORIGIN = 'https://sb.example';

// caches: { open() } stand-in. Returns the worker's fetch handler.
function loadWorker(caches) {
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope: ORIGIN + '/' },
    location: { origin: ORIGIN },
    skipWaiting() {}, clients: { claim() {} },
  };
  // A same-origin response, as the browser types it (the worker only keeps
  // "basic" and "cors" ones).
  const fetch = async () => {
    const res = new Response('body', { status: 200 });
    Object.defineProperty(res, 'type', { value: 'basic' });
    res.clone = () => { const c = new Response('body', { status: 200 }); Object.defineProperty(c, 'type', { value: 'basic' }); return c; };
    return res;
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch, URL, Response, console, setTimeout, clearTimeout });
  return listeners.fetch;
}
function quotaError() { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e; }
const fullCache = () => ({
  match: async () => undefined,
  put: async () => { throw quotaError(); },
  keys: async () => [],
  delete: async () => true,
});

// Runs one GET through the worker, and waits for what it finishes in the
// background too: { response }.
async function request(onFetch, url) {
  let responded = null;
  const waited = [];
  const event = {
    request: { method: 'GET', url, mode: 'cors' },
    respondWith: (p) => { responded = p; },
    waitUntil: (p) => { waited.push(p); },
  };
  onFetch(event);
  assert.ok(responded, 'the worker answers the request');
  const response = await responded;
  await Promise.all(waited);
  return { response };
}

test('a stamped file and a page still load when the cache is full', async () => {
  const onFetch = loadWorker({ open: async () => fullCache() });
  const { response } = await request(onFetch, ORIGIN + '/js/solo.js?v=abc');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(await response.text(), 'body');
  assert.strictEqual((await request(onFetch, ORIGIN + '/solo.html')).response.status, 200);
});

test('files still load when the cache cannot be opened or read', async () => {
  for (const caches of [
    { open: async () => { throw new Error('SecurityError'); } },
    { open: async () => ({ ...fullCache(), match: async () => { throw new Error('broken'); } }) },
  ]) {
    const onFetch = loadWorker(caches);
    for (const url of [ORIGIN + '/data/bank/x.json?v=1', ORIGIN + '/index.html']) {
      const { response } = await request(onFetch, url);
      assert.strictEqual(response.status, 200, url);
    }
  }
});

/* ---------------- Offline ---------------- */

// A same-origin (or CDN) response as the browser types it.
function typed(body, { status = 200, type = 'basic' } = {}) {
  const make = () => { const r = new Response(body, { status }); Object.defineProperty(r, 'type', { value: type }); r.clone = make; return r; };
  return make();
}
// A cache held in memory, matching as the browser's does (ignoreSearch too).
function memoryCache() {
  const store = new Map();
  const href = (r) => (typeof r === 'string' ? r : r.url);
  return {
    store,
    match: async (r, opts) => {
      const h = href(r);
      if (store.has(h)) return typed(store.get(h));
      if (opts && opts.ignoreSearch) for (const [k, v] of store) if (k.split('?')[0] === h.split('?')[0]) return typed(v);
      return undefined;
    },
    put: async (r, res) => { store.set(href(r), await res.text()); },
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (r) => store.delete(href(r)),
  };
}
// The worker with a network that answers from `site` ({ href: body }), or
// fails every request when `offline` is set, or never answers when `hang`.
function offlineWorker(site = {}) {
  const listeners = {};
  const cache = memoryCache();
  const net = { offline: false, hang: false, asked: [] };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope: ORIGIN + '/' },
    location: { origin: ORIGIN },
    skipWaiting() {}, clients: { claim() {} },
  };
  const fetch = async (req) => {
    const url = typeof req === 'string' ? req : req.url;
    net.asked.push(url);
    if (net.hang) return new Promise(() => {});
    if (net.offline) throw new TypeError('Failed to fetch');
    if (!(url in site)) return typed('missing', { status: 404 });
    return typed(site[url], { type: url.startsWith(ORIGIN) ? 'basic' : 'cors' });
  };
  // Timers fire at once: "5 seconds without an answer" is now.
  const setTimeout = (fn, ms, ...args) => { Promise.resolve().then(() => fn(...args)); return 1; };
  vm.runInNewContext(SOURCE, { self, caches: { open: async () => cache, keys: async () => [], delete: async () => true }, fetch, URL, Response, console, setTimeout, clearTimeout: () => {} });
  const get = async (url, mode = 'cors') => {
    let responded = null;
    const waited = [];
    listeners.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => { responded = p; }, waitUntil: (p) => { waited.push(p); } });
    assert.ok(responded, `the worker answers ${url}`);
    try { const res = await responded; return { status: res.status, body: await res.text() }; } catch (err) { return { error: err.message }; } finally {
      // What it finishes in the background (a download that never ends
      // doesn't hold the test up).
      await Promise.race([Promise.allSettled(waited), new Promise((r) => global.setTimeout(r, 50))]);
    }
  };
  const save = async (fresh) => {
    const waited = [];
    listeners.message({ data: { type: 'sb-save-offline', fresh }, waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
  };
  return { cache, net, get, save };
}

test('the worker saves every page listed in PAGES, and PAGES lists every page', () => {
  const listed = JSON.parse(SOURCE.match(/const PAGES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== '404.html' && !/^google[0-9a-f]+\.html$/.test(f))
    .map((f) => (f === 'index.html' ? './' : f.replace(/\.html$/, ''))).sort();
  assert.deepStrictEqual([...listed].sort(), pages);
});

test('offline, a saved page opens under any query and as .html; an unsaved one opens the offline page', async () => {
  const w = offlineWorker({ [ORIGIN + '/database']: 'database page', [ORIGIN + '/offline']: 'offline page' });
  assert.strictEqual((await w.get(ORIGIN + '/database', 'navigate')).body, 'database page');
  assert.strictEqual((await w.get(ORIGIN + '/offline', 'navigate')).body, 'offline page');
  assert.deepStrictEqual([...w.cache.store.keys()].sort(), [ORIGIN + '/database', ORIGIN + '/offline'], 'pages are kept without their query');
  w.net.offline = true;
  assert.strictEqual((await w.get(ORIGIN + '/database?answer=mitochondria', 'navigate')).body, 'database page');
  assert.strictEqual((await w.get(ORIGIN + '/database.html', 'navigate')).body, 'database page');
  assert.strictEqual((await w.get(ORIGIN + '/sets/aves-2025/3', 'navigate')).body, 'offline page');
  // Not a page: no stand-in, the request fails as it would without a worker.
  assert.ok((await w.get(ORIGIN + '/data/img/x.png')).error);
});

test('a connection that never answers gets the saved copy', async () => {
  const w = offlineWorker({ [ORIGIN + '/solo']: 'play page', [ORIGIN + '/data/meta.json']: '{}' });
  await w.get(ORIGIN + '/solo', 'navigate');
  await w.get(ORIGIN + '/data/meta.json');
  w.net.hang = true;
  assert.strictEqual((await w.get(ORIGIN + '/solo', 'navigate')).body, 'play page');
  assert.strictEqual((await w.get(ORIGIN + '/data/meta.json')).body, '{}');
});

test('offline, a bank file whose new stamp was never fetched is served from its older copy', async () => {
  const w = offlineWorker({ [ORIGIN + '/data/bank/aves.json?v=old']: '[old]' });
  await w.get(ORIGIN + '/data/bank/aves.json?v=old');
  w.net.offline = true;
  assert.strictEqual((await w.get(ORIGIN + '/data/bank/aves.json?v=new')).body, '[old]');
  assert.ok((await w.get(ORIGIN + '/data/bank/other.json?v=new')).error, 'a file never saved still fails');
});

test('one visit saves every page, the files they load and the bank; a deploy replaces what changed', async () => {
  const listed = JSON.parse(SOURCE.match(/const PAGES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const deploy = (version, jsStamp, bankStamp) => {
    const site = { [ORIGIN + '/version.json']: JSON.stringify({ version }) };
    const page = `<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" /><script src="js/site.js?v=${jsStamp}"></script><link href="favicon.ico" /><link rel="preload" href="data/meta.json" /><a href="solo">Play</a>`;
    for (const p of listed) site[new URL(p, ORIGIN + '/').href] = page;
    site[ORIGIN + '/js/site.js?v=' + jsStamp] = "const lib = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js';";
    site['https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css'] = 'css';
    site['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js'] = 'lib';
    site[ORIGIN + '/favicon.ico'] = 'icon';
    site[ORIGIN + '/data/meta.json'] = JSON.stringify({ bankIndex: 'i' + bankStamp, tournaments: [{ slug: 'aves', v: bankStamp }, { slug: 'lost', v: 'same' }] });
    site[`${ORIGIN}/data/bank/aves.json?v=${bankStamp}`] = '[aves]';
    site[ORIGIN + '/data/bank/lost.json?v=same'] = '[lost]';
    site[`${ORIGIN}/data/bank/index.json?v=i${bankStamp}`] = '{}';
    return site;
  };
  const site = deploy('one', 'a1', 'b1');
  const w = offlineWorker(site);
  await w.save();
  const saved = () => [...w.cache.store.keys()].filter((k) => !k.includes('__sb')).map((k) => k.replace(ORIGIN, '')).sort();
  for (const want of ['/', '/solo', '/offline', '/js/site.js?v=a1', '/favicon.ico', '/data/meta.json', '/data/bank/aves.json?v=b1', '/data/bank/lost.json?v=same', '/data/bank/index.json?v=ib1',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js']) {
    assert.ok(saved().includes(want), `${want} is saved`);
  }
  // Asked again with the same version: nothing is fetched but version.json.
  w.net.asked.length = 0;
  await w.save();
  // (The worker asks at most once a minute; the same version isn't saved again either way.)
  assert.ok(w.net.asked.every((u) => u.endsWith('/version.json')), w.net.asked.join(', '));

  // A deploy: a new script, and one tournament's file changed. The worker
  // is asked by a page that has just seen the new version (fresh).
  Object.assign(site, deploy('two', 'a2', 'b2'));
  await w.save(true);
  assert.ok(saved().includes('/js/site.js?v=a2') && !saved().includes('/js/site.js?v=a1'), 'the old script goes once every page is saved again');
  assert.ok(saved().includes('/data/bank/aves.json?v=b2') && !saved().includes('/data/bank/aves.json?v=b1'));
  assert.ok(saved().includes('/data/bank/lost.json?v=same'));
  assert.ok(saved().includes('/data/bank/index.json?v=ib2') && !saved().includes('/data/bank/index.json?v=ib1'));

  // Offline after that: every page and the bank still answer.
  w.net.offline = true;
  assert.strictEqual((await w.get(ORIGIN + '/about', 'navigate')).status, 200);
  assert.strictEqual((await w.get(ORIGIN + '/data/bank/aves.json?v=b2')).body, '[aves]');
});

test('a save cut short by the connection keeps what it had and deletes nothing', async () => {
  const w = offlineWorker({ [ORIGIN + '/version.json']: '{"version":"one"}', [ORIGIN + '/js/old.js?v=1']: 'old' });
  await w.get(ORIGIN + '/js/old.js?v=1');
  await w.save(); // every page is missing (404): not complete
  assert.ok(w.cache.store.has(ORIGIN + '/js/old.js?v=1'));
  assert.ok(![...w.cache.store.keys()].some((k) => k.includes('__sb')), 'not marked as saved, so the next page load tries again');
});
