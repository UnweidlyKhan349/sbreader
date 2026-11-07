// Every page loads without errors or failed requests, and doesn't scroll
// sideways on a phone.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext } = require('./helpers');

const PAGES = ['', 'about', 'solo', 'multiplayer', 'catalog', 'catalog?answer=mitochondria', 'set-list', 'set?set=lost-3-hs', 'packet?set=lost-3-ms&packet=10', 'frequency-list', 'frequency-list?subject=bio', 'login', 'signup', 'forgot-password', 'account', 'stats'];

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

for (const width of [1300, 390]) {
  test(`every page loads cleanly at ${width} px`, async () => {
    const ctx = await newContext(browser, { viewport: { width, height: 800 } });
    for (const path of PAGES) {
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400 && !/supabase/.test(r.url())) problems.push(`${r.status()} ${r.url()}`); });
      page.on('dialog', (d) => d.dismiss());
      const res = await page.goto(server.url + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      assert.strictEqual(res.status(), 200, path);
      assert.deepStrictEqual(problems, [], path);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${path} scrolls sideways`);
      await page.close();
    }
    await ctx.close();
  });
}

test('an unknown address gets the 404 page', async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const res = await page.goto(server.url + 'no-such-page');
  assert.strictEqual(res.status(), 404);
  assert.match(await page.title(), /Page Not Found/);
  await ctx.close();
});

test('a page older than the deployed version reloads once, then offers a Reload bar', async () => {
  // As a deploy leaves it: the page says it's "old" (tools/stamp-version.js)
  // while version.json already says "new".
  const ctx = await newContext(browser);
  await ctx.route(/\/about$/, async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n<meta name="sb-version" content="old" />');
    await r.fulfill({ response: res, body });
  });
  await ctx.route(/\/version\.json/, (r) => r.fulfill({ contentType: 'application/json', body: '{"version":"new"}' }));
  const page = await ctx.newPage();
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto(server.url + 'about', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sb-update-bar', { timeout: 15000 });
  assert.strictEqual(loads, 2, 'reloaded exactly once');
  assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('sb_reloaded_for')), 'new');
  await ctx.close();
});
