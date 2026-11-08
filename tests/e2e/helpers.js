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

// opts: { lagMs, noDirect, viewport, liveSupabase }. liveSupabase leaves the
// real Supabase project reachable (the relay test), everything else blocks it.
async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 900 }, serviceWorkers: 'block' });
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
  await page.waitForTimeout(1200);
  return page;
}

module.exports = { chromium, startServer, newContext, openPage, joinRoom, ROOT };
