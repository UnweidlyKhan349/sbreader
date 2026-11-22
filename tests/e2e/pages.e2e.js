// Every page loads without errors or failed requests, and doesn't scroll
// sideways on a phone.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext } = require('./helpers');

const PAGES = ['', 'about', 'tips', 'solo', 'multiplayer', 'catalog', 'catalog?answer=mitochondria', 'set-list', 'set?set=lost-3-hs', 'packet?set=lost-3-ms&packet=10', 'frequency-list', 'frequency-list?subject=bio', 'login', 'signup', 'forgot-password', 'account', 'stats', 'graphs', 'stars', 'edit-profile', 'edit-password'];

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

// Both widths, every page, four pages at a time.
for (const width of [1300, 390]) {
  test(`every page loads cleanly at ${width} px`, async () => {
    const ctx = await newContext(browser, { viewport: { width, height: 800 } });
    const check = async (path) => {
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
    };
    const queue = PAGES.slice();
    await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await check(queue.shift()); }));
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

test('a page older than the deployed version shows no alert and is not reloaded; a refresh gets the new one', async () => {
  // As a deploy leaves it: the page says it's "old" (tools/stamp-version.js)
  // while version.json already says "new".
  const ctx = await newContext(browser);
  let served = 'old';
  await ctx.route(/\/about$/, async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n<meta name="sb-version" content="${served}" />`);
    await r.fulfill({ response: res, body });
  });
  let checks = 0;
  await ctx.route(/\/version\.json/, (r) => { checks++; r.fulfill({ contentType: 'application/json', body: '{"version":"new"}' }); });
  const page = await ctx.newPage();
  let loads = 0;
  const dialogs = [];
  page.on('load', () => { loads++; });
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
  await page.goto(server.url + 'about', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  assert.ok(checks >= 1, 'the page asked which version is deployed');
  assert.strictEqual(loads, 1, 'not reloaded');
  assert.deepStrictEqual(dialogs, []);
  // Refreshing is what brings the new version.
  served = 'new';
  await page.reload({ waitUntil: 'networkidle' });
  assert.strictEqual(await page.getAttribute('meta[name="sb-version"]', 'content'), 'new');
  assert.deepStrictEqual(dialogs, []);
  await ctx.close();
});

test('the Database filters work from the keyboard and say whether they are on', async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto(server.url + 'catalog', { waitUntil: 'load' });
  await page.waitForSelector('#subjectChips button.chip', { timeout: 60000 });
  const chip = page.locator('#subjectChips button.chip').first();
  assert.strictEqual(await chip.getAttribute('aria-pressed'), 'false');
  await chip.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#subjectChips button.chip').getAttribute('aria-pressed') === 'true');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#subjectChips button.chip').getAttribute('aria-pressed') === 'false');
  await ctx.close();
});
