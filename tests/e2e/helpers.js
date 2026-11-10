// Shared pieces for the browser tests (npm run test:e2e): a static server
// that resolves addresses as GitHub Pages does, and browser contexts with
// PeerJS replaced by tests/e2e/fake-peer.js, Supabase blocked unless a test
// asks for it (nothing is written to the real project) and the service worker off.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.webp': 'image/webp' };

function startServer(root = ROOT) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      fs.createReadStream(path.join(root, '404.html')).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) });
  }));
}

const FAKE_PEER = fs.readFileSync(path.join(__dirname, 'fake-peer.js'), 'utf8');

// The libraries the pages load from the jsDelivr CDN (Bootstrap, PeerJS,
// supabase-js) are fetched once per test run, with retries, and handed to
// every page from memory, so a slow or briefly unreachable CDN can't time a
// test out. The bytes are the CDN's own, so the pages' integrity checks pass.
const cdnFiles = new Map();
async function fetchCdn(url) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'text/plain' };
      lastErr = new Error(`${url}: HTTP ${res.status}`);
    } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastErr;
}
async function routeCdn(ctx) {
  // The Google tag is left out of test runs: nothing is sent to Analytics.
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort());
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\//, async (route) => {
    const url = route.request().url();
    if (!cdnFiles.has(url)) cdnFiles.set(url, fetchCdn(url).catch((err) => { cdnFiles.delete(url); throw err; }));
    try {
      const { body, contentType } = await cdnFiles.get(url);
      await route.fulfill({ status: 200, body, contentType, headers: { 'access-control-allow-origin': '*' } });
    } catch (err) { await route.abort(); }
  });
}

// opts: { lagMs, noDirect, viewport, liveSupabase }. liveSupabase leaves the
// real Supabase project reachable (the relay test), everything else blocks it.
async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 900 }, serviceWorkers: 'block' });
  await routeCdn(ctx);
  if (!opts.liveSupabase) await ctx.route(/supabase\.co/, (r) => r.abort());
  // The real PeerJS comes from the CDN with an integrity hash, so another
  // file can't stand in for it: the fake is put in place before the page's
  // scripts run, and the real one isn't loaded.
  await ctx.addInitScript(FAKE_PEER);
  await ctx.route(/peerjs\.min\.js/, (r) => r.abort());
  if (opts.lagMs || opts.noDirect) {
    await ctx.addInitScript(({ lag, noDirect }) => { window.__LAG_MS = lag || 0; window.__NO_DIRECT = !!noDirect; }, { lag: opts.lagMs, noDirect: opts.noDirect });
  }
  return ctx;
}

// A page that records uncaught errors in page.errors.
async function openPage(ctx, url) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}

// A player in a Multiplayer room, once its sidebar is up.
async function joinRoom(ctx, base, room) {
  const page = await openPage(ctx, `${base}multiplayer?room=${room}`);
  await page.waitForSelector('#mpSubjectButtons .btn-subject', { state: 'attached', timeout: 40000 });
  // In: this player is on the leaderboard and the room has said so.
  await page.waitForFunction(() => document.querySelector('.mp-player-row.user-score') && /joined the game/.test(document.getElementById('mpHistory').textContent), null, { timeout: 40000 });
  await page.waitForTimeout(200);
  return page;
}

module.exports = { chromium, startServer, newContext, openPage, joinRoom, routeCdn, ROOT };
