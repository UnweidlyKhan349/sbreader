// Every page loads without errors or failed requests, and doesn't scroll
// sideways on a phone.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext } = require('./helpers');

const PAGES = ['', 'about', 'tips', 'solo', 'multiplayer', 'database', 'database?answer=mitochondria', 'set-list', 'set?set=lost-3-hs', 'packet?set=lost-3-ms&packet=10', 'frequency-list', 'frequency-list?subject=bio', 'login', 'signup', 'forgot-password', 'account', 'stats', 'graphs', 'stars', 'edit-profile', 'edit-password', 'offline'];

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
  await page.goto(server.url + 'database', { waitUntil: 'load' });
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

test('copied math pastes as x^2, x_1 and CO2, not x2 and x1', async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto(server.url + 'tips', { waitUntil: 'networkidle' });
  await page.addScriptTag({ url: server.url + 'js/data.js' });
  const copy = (html, white) => page.evaluate(([h, w]) => {
    const p = document.createElement('p');
    p.innerHTML = h;
    if (w) p.style.whiteSpace = w;
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const data = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    p.remove();
    return { text: data.getData('text/plain'), html: data.getData('text/html') };
  }, [html, white]);
  const render = (s) => page.evaluate((t) => SBData.renderMathHTML(t), s);
  for (const s of ['x^2 + y^2', 'x_1 + x_2', 'K_c', 'e^(i*pi)', 'S_(n-1)', 'x^3y', '2^(2^2)', 'H^+', 'Fe^(2+)', '10^-3', 'n^α', 'e^(2x)']) {
    assert.strictEqual((await copy(await render(s))).text, s, s);
  }
  assert.strictEqual((await copy(await render('2H2O and CO2'))).text, '2H2O and CO2');
  const out = await copy(await render('Name: 1) x^2; 2) y_1'), 'pre-line');
  assert.strictEqual(out.text, 'Name: 1) x^2; 2) y_1');
  assert.match(out.html, /<sup>2<\/sup>/);
  // A word exponent running into the next letter keeps its parentheses.
  assert.strictEqual((await copy('x<sup>ab</sup>c')).text, 'x^(ab)c');
  await ctx.close();
});

test('phone layouts: the Set List fits, the frequency list heading and Play statline get the full width, the lobby checkbox stays on one line', async () => {
  const ctx = await newContext(browser, { viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(server.url + 'set-list', { waitUntil: 'networkidle' });
  await page.waitForSelector('#set-metadata-list tr');
  assert.strictEqual(await page.evaluate(() => { const t = document.querySelector('.table-responsive'); return t.scrollWidth <= t.clientWidth; }), true, 'the Set List has no sideways scroll at 360 px');
  await page.goto(server.url + 'frequency-list?subject=bio', { waitUntil: 'networkidle' });
  await page.waitForSelector('#frequency-list tr', { timeout: 30000 });
  assert.ok(await page.evaluate(() => document.getElementById('freqTitle').getBoundingClientRect().width > 0.8 * document.getElementById('freqPage').clientWidth), 'the heading is not squeezed beside the back link');
  await page.goto(server.url + 'multiplayer', { waitUntil: 'networkidle' });
  const label = await page.evaluate(() => { const l = document.querySelector('label[for="emptyRoomCheckbox"]'); return l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight); });
  assert.ok(label < 1.5, 'Show empty rooms is on one line');
  await page.goto(server.url + 'solo', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /match your settings(?! so far)/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  await page.locator('#nextBtn').click();
  await page.waitForFunction(() => document.getElementById('questionInfo').textContent.trim());
  assert.ok(await page.evaluate(() => document.getElementById('questionMetadata').getBoundingClientRect().top >= document.getElementById('statline').getBoundingClientRect().bottom - 1), 'the source is under the statline');
  await ctx.close();
});
