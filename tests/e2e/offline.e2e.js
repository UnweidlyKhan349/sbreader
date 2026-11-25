// Offline, with the service worker on (sw.js; every other browser test
// blocks it): one visit to the home page saves the whole site, and then,
// with the network cut, every page opens, Play plays from the whole bank,
// the Database searches, the Multiplayer lobby says it needs a connection,
// and an address never saved gets the offline page instead of the
// browser's error. A bank only partly saved still plays, and says what's
// missing.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, routeCdn } = require('./helpers');

let server; let browser; let base;
test.before(async () => {
  server = await startServer();
  // Service workers need a secure context; js/site.js registers on localhost.
  base = server.url.replace('127.0.0.1', 'localhost');
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); await server.close(); });

async function workerContext(block) {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  await routeCdn(ctx);
  // Nothing reaches Supabase or the PeerJS broker.
  await ctx.route(/supabase\.co|peerjs\.com/, (r) => r.abort());
  if (block) await ctx.route(block, (r) => r.abort());
  return ctx;
}

// Waits until the worker has saved every page and the given share of the
// bank's files.
async function visitAndSave(ctx, bankShare) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base, { waitUntil: 'load' });
  const saved = (share) => page.evaluate(async (want) => {
    if (!window.SBData || !SBData.meta) return false;
    const c = await caches.open('sbreader-v1');
    const keys = new Set((await c.keys()).map((r) => r.url));
    const pages = ['', 'solo', 'database', 'multiplayer', 'offline'].map((p) => location.origin + '/' + p);
    const bank = SBData.bankUrls(SBData.meta).map((u) => new URL(u, location.href).href);
    return pages.every((p) => keys.has(p)) && bank.filter((u) => keys.has(u)).length >= Math.floor(bank.length * want);
  }, share);
  const until = Date.now() + 120000;
  while (!(await saved(bankShare))) {
    assert.ok(Date.now() < until, 'the site was saved for offline use');
    await page.waitForTimeout(500);
  }
  return page;
}

test('after one visit, the whole site works offline', async () => {
  const ctx = await workerContext();
  const page = await visitAndSave(ctx, 1);
  await ctx.setOffline(true);

  // Every page opens.
  for (const p of ['', 'about', 'tips', 'set-list', 'frequency-list', 'stars', 'login', 'set?set=lost-3-hs']) {
    const res = await page.goto(base + p, { waitUntil: 'load' });
    assert.strictEqual(res.status(), 200, p);
    assert.match(await page.title(), /^SBReader - /, p);
  }

  // Play: the whole bank, a question read, buzzed and graded.
  await page.goto(base + 'solo', { waitUntil: 'load' });
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  assert.doesNotMatch(await page.locator('#matchCount').innerText(), /saved/);
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('#qDisplay').innerText(), /TOSS-UP|BONUS/);
  await page.keyboard.press(' ');
  await page.keyboard.type('not the answer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  assert.match(await page.locator('#revealBox').innerText(), /ANSWER:/);

  // The Database searches.
  await page.goto(base + 'database?answer=mitochondria', { waitUntil: 'load' });
  await page.waitForFunction(() => /^Showing \d+ of \d+ results/.test(document.getElementById('resultCount').textContent), null, { timeout: 60000 });

  // The Multiplayer lobby says it needs a connection.
  await page.goto(base + 'multiplayer', { waitUntil: 'load' });
  await page.waitForFunction(() => /offline/.test(document.getElementById('activeSummary').textContent), null, { timeout: 20000 });
  assert.strictEqual(await page.locator('#activeSummary').evaluate((el) => getComputedStyle(el).display), 'block', 'on its own line');

  // An address never saved (a built set page, or anything else).
  await page.goto(base + 'sets/lost-3-hs/2', { waitUntil: 'load' });
  assert.match(await page.title(), /Offline/);
  assert.match(await page.locator('h1').innerText(), /You're offline/);

  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('offline with part of the bank saved, Play plays what is saved and says what is missing', async () => {
  // The tournaments from a to m never arrive.
  const ctx = await workerContext(/\/data\/bank\/[a-m][^/]*\.json/);
  const page = await visitAndSave(ctx, 1 / 3);
  await ctx.setOffline(true);
  await page.goto(base + 'solo', { waitUntil: 'load' });
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  assert.match(await page.locator('#matchCount').innerText(), /\d+ tournaments aren't saved on this device/);
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('#qDisplay').innerText(), /TOSS-UP|BONUS/);
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});
