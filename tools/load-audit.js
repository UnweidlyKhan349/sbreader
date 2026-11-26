#!/usr/bin/env node
/* Measures how long each page takes to load on a first visit, the way
   docs/audit/load-time-2026-11.md was measured.

     node tools/load-audit.js [siteDir] [--profile mobile|desktop] [--runs N] [--pages "solo,database"] [--json out.json]

   It serves siteDir (the repository by default; to include the built set
   and packet pages, run node tools/build-pages.js on a copy first) as
   GitHub Pages does: gzip, Cache-Control max-age=600, ETags. Each page is
   opened in a fresh Chromium context (nothing cached, the service worker
   off) with the network and CPU slowed to the profile:
     mobile   Lighthouse's phone: 150 ms round trips, 1.6 Mbps down, CPU 4x slower
     desktop  40 ms round trips, 10 Mbps down
   Bootstrap, supabase-js and the Google tag come from the real CDNs (set
   HTTPS_PROXY if the machine reaches the internet through a proxy);
   Supabase's API is blocked, so every page loads as a logged-out visitor.

   For each page it prints the median of the runs: first contentful paint,
   largest contentful paint, the load event, "ready" (when the page's
   question bank, or meta.json, has arrived, for the pages that load them),
   the time the network went quiet, the KB downloaded and the number of
   requests. Needs Playwright (npm install --no-save playwright). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PAGES = ['', 'solo', 'multiplayer', 'database', 'set-list', 'set?set=lost-3-hs', 'packet?set=lost-3-ms&packet=10',
  'frequency-list', 'frequency-list?subject=bio', 'about', 'tips', 'login', 'signup', 'forgot-password', 'account',
  'stats', 'graphs', 'stars', 'edit-profile', 'edit-password', 'offline', 'no-such-page'];
const PROFILES = {
  mobile: { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4 },
  desktop: { latency: 40, down: 10e6 / 8, up: 5e6 / 8, cpu: 1 },
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.webp': 'image/webp' };
const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.xml', '.ico']);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

// GitHub Pages' behaviour, near enough: /solo serves solo.html, folders
// their index.html, anything else 404.html; text is gzipped.
function server(root) {
  const zipped = new Map();
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    let status = 200;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(root, '404.html'); status = 404; }
    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag };
    if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      if (!zipped.has(file)) zipped.set(file, zlib.gzipSync(body, { level: 6 }));
      body = zipped.get(file);
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    res.end(body);
  });
}

async function measure(browser, url, prof) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 823 } });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: prof.latency, downloadThroughput: prof.down, uploadThroughput: prof.up });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, start: e.timestamp }));
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) r.end = e.timestamp; });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  const ready = await page.evaluate(async () => {
    const S = window.SBData;
    try {
      if (S && S._readyPromise) await S._readyPromise;
      else if (S && S._metaPromise) await S._metaPromise;
      else return null;
    } catch (e) { /* timed all the same */ }
    return performance.now();
  });
  // The network is quiet once nothing has finished for 3 seconds (2 minutes at most).
  let last = Date.now(); let seen = 0;
  for (const stop = Date.now() + 120000; Date.now() < stop;) {
    await page.waitForTimeout(500);
    const done = [...reqs.values()].filter((r) => r.end).length;
    if (done !== seen) { seen = done; last = Date.now(); }
    if (done === reqs.size && Date.now() - last > 3000) break;
  }
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { fcp: fcp ? fcp.startTime : null, lcp: window.__lcp, load: n.loadEventEnd };
  });
  const list = [...reqs.values()].filter((r) => !r.url.startsWith('data:'));
  const t0 = Math.min(...list.map((r) => r.start));
  await ctx.close();
  return { ...nav, ready, quiet: (Math.max(...list.filter((r) => r.end).map((r) => r.end)) - t0) * 1000, bytes: list.reduce((s, r) => s + (r.bytes || 0), 0), requests: list.length };
}

async function main() {
  const { chromium } = require('playwright');
  const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..'));
  const prof = PROFILES[arg('--profile', 'mobile')];
  if (!prof) throw new Error('--profile is mobile or desktop');
  const runs = +arg('--runs', 3);
  const pages = arg('--pages') != null ? arg('--pages').split(',') : PAGES;
  const srv = server(root);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1' } } : {});
  const rows = [];
  const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null; };
  console.log(['page', 'FCP ms', 'LCP ms', 'load ms', 'ready ms', 'quiet ms', 'KB', 'requests'].join('\t'));
  for (const p of pages) {
    const got = [];
    for (let i = 0; i < runs; i++) got.push(await measure(browser, base + p, prof));
    const row = { page: '/' + p };
    for (const k of ['fcp', 'lcp', 'load', 'ready', 'quiet', 'bytes', 'requests']) row[k] = median(got.map((g) => g[k]));
    rows.push(row);
    console.log([row.page, row.fcp, row.lcp, row.load, row.ready ?? '', row.quiet, Math.round(row.bytes / 1024), row.requests].join('\t'));
  }
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(rows, null, 1) + '\n');
  await browser.close();
  srv.close();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
