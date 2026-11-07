// Play in a real browser: reading, buzzing, grading and the override, the
// history cards (k, t, quick double clicks), Space buzzing without opening a
// focused card, and Clear all filters.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, openPage } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

async function freshPlay() {
  const ctx = await newContext(browser);
  const page = await openPage(ctx, server.url + 'solo');
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  return { ctx, page };
}

test('a question can be buzzed, graded and overridden', async () => {
  const { ctx, page } = await freshPlay();
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('#qDisplay').innerText(), /TOSS-UP|BONUS/);
  await page.keyboard.press(' ');
  assert.ok(await page.locator('#answerRow').isVisible(), 'the answer box opens on Space');
  await page.keyboard.type('definitely not the answer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  assert.match(await page.locator('#revealBox').innerText(), /ANSWER:[\s\S]*Incorrect/);
  await page.locator('#overrideBtn').click();
  assert.match(await page.locator('#revealBox').innerText(), /Correct/);
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('history cards: k opens the latest, two quick clicks leave it closed, t stars it', async () => {
  const { ctx, page } = await freshPlay();
  for (const k of ['n', 's', 'n']) { await page.keyboard.press(k); await page.waitForTimeout(400); }
  const card = page.locator('#questionLog .history-card').first();
  const open = () => card.locator('.card-container').evaluate((x) => x.classList.contains('show'));
  await page.keyboard.press('k'); await page.waitForTimeout(500);
  assert.strictEqual(await open(), true);
  await page.keyboard.press('k'); await page.waitForTimeout(500);
  const header = card.locator('.card-header-clickable');
  await header.click({ delay: 5 }); await header.click({ delay: 5 }); await page.waitForTimeout(600);
  assert.strictEqual(await open(), false, 'two quick clicks open then close it');
  await page.keyboard.press('t');
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sb_bookmarks_v1') || '[]').length), 1);
  await ctx.close();
});

test('Space buzzes without toggling a card that was clicked earlier', async () => {
  const { ctx, page } = await freshPlay();
  for (const k of ['n', 's', 'n']) { await page.keyboard.press(k); await page.waitForTimeout(400); }
  const card = page.locator('#questionLog .history-card').first();
  await card.locator('.card-header-clickable').click(); await page.waitForTimeout(500);
  await card.locator('.star-question').click();
  await page.keyboard.press(' '); await page.waitForTimeout(400);
  assert.ok(await page.locator('#answerRow').isVisible(), 'Space buzzed');
  assert.ok(await card.locator('.card-container').evaluate((x) => x.classList.contains('show')), 'the card stayed open');
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sb_bookmarks_v1') || '[]').length), 1, 'the star stayed on');
  await ctx.close();
});

test('Clear all filters puts tournaments, rounds and subjects back', async () => {
  const { ctx, page } = await freshPlay();
  const all = await page.locator('#matchCount').innerText();
  await page.locator('#subjectButtons .btn-subject[data-subject="bio"]').click();
  await page.locator('#toggleUnlabeled').click({ force: true });
  assert.notStrictEqual(await page.locator('#matchCount').innerText(), all);
  await page.locator('#clearFilters').click();
  assert.strictEqual(await page.locator('#matchCount').innerText(), all);
  await ctx.close();
});

test('history cards: the footer reads "Set / RR 3 / Question / Subject / Type", links "Source packet | Report", one choice or item per line', async () => {
  const { ctx, page } = await freshPlay();
  const r = await page.evaluate(async () => {
    await SBData.load();
    const mc = SBData.questions.find((q) => q.choices && q.choices.W && q.num && SBData.roundLabelFor(q) && /^https?:/.test(q.sourceUrl || ''));
    const list = SBData.questions.find((q) => /: 1\. \S.* 2\. \S/.test(q.question || ''));
    const card = SBPlay.historyCard(mc);
    const listCard = SBPlay.historyCard(list);
    return {
      left: card.querySelector('.card-footer .text-muted').textContent,
      right: card.querySelector('.card-footer .float-end').textContent,
      expected: `${mc.tournament} / ${SBData.roundLabelFor(mc)} / Question ${mc.num} / ${SBData.subjectLabel(mc.subject)} / ${SBData.qtypeLabel(mc)}`,
      rr: (() => { const q = Object.assign({}, mc, { roundLabel: 'Round Robin 3', tournament: 'MIT 2020' }); return SBPlay.historyCard(q).querySelector('.card-footer .text-muted').textContent; })(),
      choiceBreaks: card.querySelectorAll('.card-body br').length,
      listText: listCard.querySelector('.q-text, .card-body').innerText,
    };
  });
  assert.strictEqual(r.left, r.expected);
  assert.match(r.rr, /^MIT 2020 \/ RR 3 \/ Question /);
  assert.match(r.right, /^Source packet \| Report/);
  assert.ok(r.choiceBreaks >= 3, 'W, X, Y, Z on their own lines');
  assert.match(r.listText, /\n1\. .*\n2\. /);
  await ctx.close();
});
