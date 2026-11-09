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
  vm.runInNewContext(SOURCE, { self, caches, fetch, URL, Response, console });
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

test('a stamped file still loads when the cache is full', async () => {
  const onFetch = loadWorker({ open: async () => fullCache() });
  const { response } = await request(onFetch, ORIGIN + '/js/solo.js?v=abc');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(await response.text(), 'body');
});

test('a page still loads when the cache is full', async () => {
  const onFetch = loadWorker({ open: async () => fullCache() });
  const { response } = await request(onFetch, ORIGIN + '/solo.html');
  assert.strictEqual(response.status, 200);
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
