/* SB Reader's service worker: keeps the question bank and the site's files
   in the browser, so a repeat visit doesn't download 29 MB again, and the
   site works offline.

   - A file whose address carries a content stamp (?v=...: the scripts and
     stylesheets, from tools/stamp-assets.js, and each tournament's bank
     file, from meta.json `v`) can't change at that address, so it's served
     from the cache and only fetched the first time. A tournament's older
     copy is deleted when its new stamp arrives; older scripts and
     stylesheets are deleted once every page has been saved again (below).
     Offline, a file whose new stamp was never fetched is served from its
     older copy, so Play still opens with the bank it last saw.
   - Everything else of ours (pages, data/meta.json, figures, version.json)
     is fetched from the network first, revalidated with the server, so it's
     always current. The cached copy is used when the network fails
     (offline), or when it hasn't answered in 5 seconds (a connection that
     is up but not getting through). A page that was never saved opens
     offline.html instead of the browser's error page.
   - The whole site is saved for offline use: every page, the scripts,
     stylesheets and libraries they load, and the question bank. That's
     done the first time the site is opened and again after each deploy
     (version.json changes): js/site.js asks for it on every page load, and
     this worker does it only when the version is new. So every page, and
     Play with the whole bank, works offline once the site has been
     visited at all. (The first visit's own downloads happen before this
     worker is running, so they can't be kept as they arrive.) The bank is
     left out when the browser has been asked to save data, as the home
     page's prefetch does; then Play saves it when it's opened.
   - The libraries from the jsDelivr CDN (Bootstrap, PeerJS, supabase-js,
     Chart.js) have their exact version in the address, so they're cached
     the same way as stamped files.
   - Other sites (Supabase, the PeerJS broker) aren't touched.

   To switch it off for everyone, replace this file with one that calls
   self.registration.unregister() and clears the caches. */
const CACHE = 'sbreader-v1';

// The pages saved for offline use, relative to the worker's folder, as the
// site links them (GitHub Pages serves "solo" from solo.html).
// tests/sw.test.js checks this against the pages in the repository.
const PAGES = ['./', 'solo', 'multiplayer', 'database', 'set-list', 'set', 'packet', 'frequency-list',
  'stars', 'stats', 'graphs', 'tips', 'about', 'account', 'login', 'signup', 'forgot-password',
  'edit-password', 'edit-profile', 'offline'];
// Waited for before a cached copy stands in for a slow network.
const SLOW_MS = 5000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

function stamped(url) { return url.searchParams.has('v'); }
function isBank(url) { return url.pathname.includes('/data/bank/'); }
// A library at a fixed version on the CDN: /npm/<name>@1.2.3/...
const CDN = 'https://cdn.jsdelivr.net';
function pinnedCdn(url) { return url.origin === CDN && /^\/npm\/(@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+\//.test(url.pathname); }
function scopeUrl() { return new URL(self.registration.scope); }
function ours(url) { return url.origin === self.location.origin && url.pathname.startsWith(scopeUrl().pathname); }

// Drops the cached copies of this file under other stamps.
function unversioned(u) { return u.origin + u.pathname; }
async function dropOlder(cache, url) {
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    if (unversioned(u) === unversioned(url) && u.href !== url.href) await cache.delete(req);
  }
}

// The cache is a convenience: when it can't be opened, read or written (the
// storage is full, or the browser won't keep anything), the file is still
// fetched and handed back as if there were no worker.
async function openCache() {
  try { return await caches.open(CACHE); } catch (err) { return null; }
}
async function cached(cache, request, opts) {
  if (!cache) return null;
  try { return (await cache.match(request, opts)) || null; } catch (err) { return null; }
}
// Keeps a copy without holding up the response; the worker stays alive
// until it's written (or has failed, which is ignored).
function keep(event, cache, request, res, then) {
  if (!cache) return;
  const done = cache.put(request, res).then(then).catch(() => {});
  if (event) event.waitUntil(done);
}

async function cacheFirst(event, request, url) {
  const cache = await openCache();
  const hit = await cached(cache, request);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(request);
  } catch (err) {
    // Offline, and this stamp was never fetched: an older copy of the same
    // file (meta.json, saved later, can name a newer bank file than the one
    // kept).
    const older = stamped(url) ? await cached(cache, request, { ignoreSearch: true }) : null;
    if (older) return older;
    throw err;
  }
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    keep(event, cache, request, res.clone(), isBank(url) ? () => dropOlder(cache, url) : null);
  }
  return res;
}

// A page is kept under its address without the query (database?answer=x
// and database are the same page), so one copy serves them all.
function pageKey(url) { return url.origin + url.pathname; }
// Where else the same page may be kept: solo.html is saved as solo, and
// index.html as the folder.
function pageAliases(url) {
  const out = [pageKey(url)];
  if (url.pathname.endsWith('/index.html')) out.push(url.origin + url.pathname.slice(0, -'index.html'.length));
  else if (url.pathname.endsWith('.html')) out.push(url.origin + url.pathname.slice(0, -'.html'.length));
  return out;
}
async function cachedPage(cache, url) {
  for (const key of pageAliases(url)) {
    const hit = await cached(cache, key);
    if (hit) return hit;
  }
  // Saved by an older copy of this worker, query and all.
  return cached(cache, url.href, { ignoreSearch: true });
}

async function networkFirst(event, request, url) {
  const cache = await openCache();
  const page = request.mode === 'navigate';
  const fromCache = () => (page ? cachedPage(cache, url) : cached(cache, request));
  // no-cache: ask the server every time (a cheap 304 when unchanged), so
  // the browser's own 10-minute cache can't hand back a page from before
  // a deploy.
  const net = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok && res.type === 'basic' && !res.redirected) keep(event, cache, page ? pageKey(url) : request, res.clone());
    return res;
  });
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, SLOW_MS, 'slow'); });
  try {
    const first = await Promise.race([net, slow]);
    if (first !== 'slow') return first;
    // Still waiting: the cached copy, if there is one, while the download
    // carries on and is saved for next time.
    const hit = await fromCache();
    if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
    return await net;
  } catch (err) {
    const hit = await fromCache();
    if (hit) return hit;
    if (page) {
      const offline = await cached(cache, new URL('offline', scopeUrl()).href);
      if (offline) return offline;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (pinnedCdn(url)) { event.respondWith(cacheFirst(event, request, url)); return; }
  if (!ours(url)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith(stamped(url) ? cacheFirst(event, request, url) : networkFirst(event, request, url));
});

/* ================= Saving the site for offline use ================= */

// The files a page loads: its scripts, stylesheets, icons and meta.json
// (not links to other pages, which are in PAGES, nor the bank).
const FILE_RE = /\.(?:js|css|json|png|svg|ico|webmanifest|webp)$/;
function wantedFile(u) {
  if (pinnedCdn(u)) return true;
  if (u.pathname.endsWith('/sw.js')) return false;
  return ours(u) && FILE_RE.test(u.pathname) && !isBank(u);
}
function filesIn(html, base) {
  const out = [];
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch (err) { continue; }
    u.hash = '';
    if (wantedFile(u)) out.push(u.href);
  }
  return out;
}
// Libraries a script loads itself (js/account.js loads supabase-js).
function librariesIn(js) {
  const out = [];
  for (const m of js.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^'"`\s]+/g)) {
    try { const u = new URL(m[0]); if (pinnedCdn(u)) out.push(u.href); } catch (err) { /* not an address */ }
  }
  return out;
}
// Each tournament's bank file as the pages ask for it (SBData's bankUrl),
// and the bank's index (10 KB, for the Stars and Stats pages, which load
// only the tournaments holding their questions).
function bankFiles(meta, scope) {
  const out = (meta.tournaments || []).map((t) => new URL('data/bank/' + t.slug + '.json' + (t.v ? '?v=' + t.v : ''), scope).href);
  if (meta.bankIndex) out.push(new URL('data/bank/index.json?v=' + meta.bankIndex, scope).href);
  return out;
}

// Runs fn over the items, at most n at a time.
async function eachLimited(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// A file that can't change at its address: kept if it's already saved,
// else fetched (from the browser's own cache when it has it: the page
// asking has usually just downloaded it). Returns the response, or null.
async function saveFixed(cache, href) {
  const hit = await cached(cache, href);
  if (hit) return hit;
  const res = await fetch(href);
  if (!res.ok || (res.type !== 'basic' && res.type !== 'cors')) return null;
  await cache.put(href, res.clone());
  const u = new URL(href);
  if (isBank(u)) await dropOlder(cache, u);
  return res;
}

// The question bank is saved too (29 MB, about 7 MB as downloaded), as the
// home page already fetches it, and on the same terms: not when the
// browser has been asked to save data or the connection is very slow.
function bankWelcome() {
  const conn = self.navigator && self.navigator.connection;
  return !(conn && (conn.saveData || /2g/.test(conn.effectiveType || '')));
}

// Saves every page, the files they load and the question bank. Returns
// true when all of it was saved.
async function saveSite(cache) {
  const scope = scopeUrl();
  const files = new Set();
  let complete = true;
  let meta = null;
  await Promise.all(PAGES.map(async (p) => {
    const url = new URL(p, scope);
    try {
      const res = await fetch(url.href, { cache: 'no-cache' });
      if (!res.ok || res.type !== 'basic' || res.redirected) { complete = false; return; }
      const html = await res.clone().text();
      await cache.put(pageKey(url), res);
      for (const f of filesIn(html, url)) files.add(f);
    } catch (err) { complete = false; }
  }));
  // A script's own libraries are found as it's saved, so this goes round
  // until nothing new turns up.
  const done = new Set();
  while (files.size > done.size) {
    await Promise.all([...files].filter((f) => !done.has(f)).map(async (f) => {
      done.add(f);
      const u = new URL(f);
      try {
        let res;
        if (stamped(u) || pinnedCdn(u)) {
          res = await saveFixed(cache, f);
        } else {
          res = await fetch(f, { cache: 'no-cache' });
          if (res.ok && res.type === 'basic') await cache.put(f, res.clone()); else res = null;
        }
        if (!res) { complete = false; return; }
        if (ours(u) && u.pathname.endsWith('.js')) for (const lib of librariesIn(await res.text())) files.add(lib);
        if (ours(u) && u.pathname.endsWith('/data/meta.json')) meta = await res.json();
      } catch (err) { complete = false; }
    }));
  }
  if (!meta) return false;
  const bank = bankFiles(meta, scope);
  // Six at a time, so the page being read isn't kept waiting.
  const wanted = bankWelcome() ? bank : bank.slice(-1);
  await eachLimited(wanted, 6, async (f) => {
    try { if (!(await saveFixed(cache, f))) complete = false; } catch (err) { complete = false; }
  });
  if (!complete) return false;
  // Everything is current: the scripts, stylesheets and libraries no page
  // loads any more, and the bank files of tournaments no longer in
  // meta.json, are from before this deploy, and go. So do pages kept with
  // their query by an older copy of this worker.
  const bankNow = new Set(bank.map((f) => unversioned(new URL(f))));
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    const oldFile = ((ours(u) && stamped(u) && !isBank(u)) || pinnedCdn(u)) && !files.has(u.href);
    const oldBank = ours(u) && isBank(u) && !bankNow.has(unversioned(u));
    const oldPage = ours(u) && !stamped(u) && u.search && !/\.[a-z]+$/i.test(u.pathname);
    if (oldFile || oldBank || oldPage) await cache.delete(req);
  }
  return true;
}

const MARKER = () => new URL('__sb-offline-saved', scopeUrl()).href;
let saving = null;
let lastAsked = 0;
let lastSavedUnversioned = 0;

async function deployedVersion() {
  try {
    const res = await fetch(new URL('version.json', scopeUrl()).href, { cache: 'no-store' });
    if (!res.ok) return '';
    return String((await res.json()).version || '');
  } catch (err) { return null; }
}

async function saveForOffline(fresh) {
  // Asked on every page load: the version is checked at most once a minute,
  // unless the page has just seen a new one.
  if (!fresh && Date.now() - lastAsked < 60 * 1000) return;
  lastAsked = Date.now();
  const cache = await openCache();
  if (!cache) return;
  const version = await deployedVersion();
  if (version === null) return; // offline
  if (version) {
    const saved = await cached(cache, MARKER());
    if (saved && (await saved.text()) === version) return;
  } else if (Date.now() - lastSavedUnversioned < 10 * 60 * 1000) {
    // A copy without version.json (a local server): every ten minutes.
    return;
  }
  try {
    if (await saveSite(cache)) {
      if (version) await cache.put(MARKER(), new Response(version));
      else lastSavedUnversioned = Date.now();
    }
  } catch (err) { /* tried again on a later page load */ }
}

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sb-save-offline') return;
  if (!saving) saving = saveForOffline(!!event.data.fresh).finally(() => { saving = null; });
  if (event.waitUntil) event.waitUntil(saving);
});
