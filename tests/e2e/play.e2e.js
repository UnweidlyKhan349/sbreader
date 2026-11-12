// Play in a real browser: reading, buzzing, grading and the override, the
// history cards (k, t, quick double clicks), Space buzzing without opening a
// focused card, Clear all filters, and Clear stats.
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

test('Clear stats starts the counts again; overriding the answer already shown leaves them at zero', async () => {
  const { ctx, page } = await freshPlay();
  const stats = () => page.locator('#statline').innerText();
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(600);
  await page.keyboard.press(' ');
  await page.keyboard.type('definitely not the answer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  assert.match(await stats(), /^0\/1 with 1 question seen/);
  await page.locator('#clearStats').click();
  assert.strictEqual(await stats(), '0/0 with 0 questions seen (0 pts, celerity: 0.000)');
  await page.locator('#overrideBtn').click();
  assert.match(await page.locator('#revealBox').innerText(), /Correct/);
  assert.strictEqual(await stats(), '0/0 with 0 questions seen (0 pts, celerity: 0.000)');
  assert.deepStrictEqual(page.errors, []);
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

test('q is listed among the shortcuts, and flips I was wrong / I was right in Play', async () => {
  const ctx = await newContext(browser);
  const page = await openPage(ctx, server.url + 'solo');
  assert.match(await page.locator('body').innerText(), /q = I was wrong \/ I was right/);
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  await page.keyboard.press('n');
  await page.waitForTimeout(600);
  await page.keyboard.press('Space');
  await page.waitForSelector('#answerInput:visible');
  await page.keyboard.type('zzzz not the answer');
  await page.keyboard.press('Enter');
  const stat = () => page.locator('#statline').innerText();
  await page.waitForFunction(() => /^0\/1 /.test(document.getElementById('statline').innerText));
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('q');
  await page.waitForFunction(() => /^1\/0 /.test(document.getElementById('statline').innerText));
  await page.keyboard.press('q');
  await page.waitForFunction(() => /^0\/1 /.test(document.getElementById('statline').innerText));
  assert.match(await stat(), /^0\/1 with 1 question seen/);
  await ctx.close();
});

test('n starts and goes on but never skips; s only skips', async () => {
  const { ctx, page } = await freshPlay();
  const mode = () => page.evaluate(() => document.getElementById('nextBtn').dataset.mode);
  const press = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(400); };
  await press('s');
  assert.strictEqual(await mode(), 'start', 's does not start a session');
  await press('n');
  assert.strictEqual(await mode(), 'skip', 'n starts');
  const first = await page.locator('#questionInfo').innerText();
  await press('n');
  assert.strictEqual(await mode(), 'skip', 'n does not skip a question being read');
  assert.strictEqual(await page.locator('#revealBox').isVisible(), false);
  await press('s');
  assert.strictEqual(await mode(), 'next', 's skips');
  assert.match(await page.locator('#revealBox').innerText(), /ANSWER:/);
  await press('s');
  assert.strictEqual(await mode(), 'next', 's does not start the next question');
  assert.strictEqual(await page.locator('#questionInfo').innerText(), first);
  assert.strictEqual(await page.locator('#questionLog .history-card').count(), 0);
  await press('n');
  assert.strictEqual(await mode(), 'skip', 'n goes on once the question is over');
  assert.strictEqual(await page.locator('#questionLog .history-card').count(), 1);
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('with rebuzzes on, the timer is back at 0 after a wrong interrupt', async () => {
  const { ctx, page } = await freshPlay();
  await page.locator('#toggleRebuzz').check({ force: true });
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(500);
  await page.keyboard.press(' ');
  await page.waitForSelector('#answerInput:visible');
  await page.waitForTimeout(700);
  const timer = () => page.evaluate(() => document.getElementById('timerFace').textContent + document.getElementById('timerFraction').textContent);
  assert.match(await timer(), /^[89]\.\d$/, 'the answer clock is running');
  await page.keyboard.type('zzzz not the answer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => document.getElementById('nextBtn').dataset.mode), 'skip', 'the question reads on');
  assert.strictEqual(await timer(), '0.0');
  await ctx.close();
});

test('Starred Questions: a near miss just says Close; with every star gone, n alerts and the question stays', async () => {
  const { ctx, page } = await freshPlay();
  // One starred question with a one-word key, so "key + more" is a near miss.
  const q = await page.evaluate(() => {
    const one = SBData.questions.find((x) => x.format === 'SA' && /^[A-Z]{6,12}$/.test(x.answer.text) && !x.answer.accept.length && !x.answer.reject.length && !x.visual);
    localStorage.setItem('sb_bookmarks_v1', JSON.stringify([one.id]));
    return { id: one.id, key: one.answer.text };
  });
  const alerts = [];
  page.on('dialog', (d) => alerts.push(d.message()));
  await page.goto(server.url + 'solo?mode=starred', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('nextBtn').dataset.mode === 'skip', null, { timeout: 60000 });
  await page.keyboard.press(' ');
  await page.waitForSelector('#answerInput:visible');
  await page.keyboard.type(q.key.toLowerCase() + ' zzzz');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.strictEqual(await page.locator('#revealBox .close-hint').innerText(), 'Close');
  // The last star goes (as from the card's star, or the Starred Questions page).
  await page.evaluate((id) => SBData.bookmarks.remove(id), q.id);
  const shown = await page.locator('#qDisplay').innerText();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('n');
  await page.waitForTimeout(500);
  assert.deepStrictEqual(alerts, ['No starred questions.']);
  assert.ok(shown.length > 20 && await page.locator('#qDisplay').innerText() === shown, 'the question stays on screen');
  assert.match(await page.locator('#revealBox').innerText(), /ANSWER:/);
  // Starred again, n reads it once more.
  await page.evaluate((id) => SBData.bookmarks.add(id), q.id);
  await page.keyboard.press('n');
  await page.waitForTimeout(500);
  assert.strictEqual(await page.evaluate(() => document.getElementById('nextBtn').dataset.mode), 'skip');
  assert.deepStrictEqual(alerts, ['No starred questions.']);
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});
