/* SB Reader's service worker: keeps the question bank and the site's files
   in the browser, so a repeat visit doesn't download 29 MB again and Play
   works offline once it has loaded.

   - A file whose address carries a content stamp (?v=...: the scripts and
     stylesheets, from tools/stamp-assets.js, and each tournament's bank
     file, from meta.json `v`) can't change at that address, so it's served
     from the cache and only fetched the first time. When a new stamp
     arrives, the older copies of that file are deleted.
   - Everything else of ours (pages, data/meta.json, figures, version.json)
     is fetched from the network first, revalidated with the server, so it's
     always current, and the cached copy is used only when the network fails
     (offline).
   - The libraries from the jsDelivr CDN (Bootstrap, PeerJS, supabase-js)
     have their exact version in the address, so they're cached the same
     way, and Play still works offline.
   - Other sites (Supabase, the PeerJS broker) aren't touched.

   To switch it off for everyone, replace this file with one that calls
   self.registration.unregister() and clears the caches. */
const CACHE = 'sbreader-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

function stamped(url) { return url.searchParams.has('v'); }
// A library at a fixed version on the CDN: /npm/<name>@1.2.3/...
const CDN = 'https://cdn.jsdelivr.net';
function pinnedCdn(url) { return url.origin === CDN && /^\/npm\/(@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+\//.test(url.pathname); }

// Drops the cached copies of this file under other stamps.
// (For a CDN library, the same file at another version.)
function unversioned(u) { return u.origin + (u.origin === CDN ? u.pathname.replace(/@\d+\.\d+\.\d+\//, '/') : u.pathname); }
async function dropOlder(cache, url) {
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    if (unversioned(u) === unversioned(url) && u.href !== url.href) await cache.delete(req);
  }
}

async function cacheFirst(request, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    await cache.put(request, res.clone());
    dropOlder(cache, url);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: ask the server every time (a cheap 304 when unchanged), so
    // the browser's own 10-minute cache can't hand back a page from before
    // a deploy.
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (pinnedCdn(url)) { event.respondWith(cacheFirst(request, url)); return; }
  if (url.origin !== self.location.origin) return;
  // Only this site's own files (the worker's folder and below).
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith(stamped(url) ? cacheFirst(request, url) : networkFirst(request));
});
