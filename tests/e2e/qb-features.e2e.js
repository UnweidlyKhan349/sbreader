// Features from QB Reader (November 2026): the Database's search controls
// and year boxes, its cards (title linking the source, Stats | Report on the
// answer line, no footer), community question stats (the Supabase functions
// answered here), self-graded Play ("Type to answer" off) and the year range,
// the set and packet pages' source links, the plainer frequency lists, and a
// room's year range in Multiplayer.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, openPage, joinRoom } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

// A context whose Supabase answers only the question stats functions: plays
// are kept in `plays`, and question_stats answers with `stats`.
async function statsContext(stats) {
  const ctx = await newContext(browser, { liveSupabase: true });
  const plays = [];
  await ctx.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    if (/\/rpc\/question_play$/.test(url)) { plays.push(route.request().postDataJSON()); return route.fulfill({ status: 204, body: '' }); }
    if (/\/rpc\/question_stats$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([stats]) });
    return route.abort();
  });
  return { ctx, plays };
}
const results = (page) => page.locator('#resultCount').innerText().then((t) => parseInt(t.replace(/^Showing \d+ of /, ''), 10));

test('Database: all text / question / answer, ignore word order (on by default), year boxes', async () => {
  const ctx = await newContext(browser);
  const page = await openPage(ctx, server.url + 'catalog');
  await page.waitForFunction(() => /Showing/.test(document.getElementById('resultCount').textContent), null, { timeout: 60000 });
  assert.strictEqual(await page.locator('#ignoreWordOrder').isChecked(), true);
  assert.strictEqual(await page.locator('#searchType').inputValue(), 'all');
  // The tournament picker says how many there are, with none or all picked.
  const tLabel = () => page.locator('#tournamentFilterCell .dropdown-checklist-label').innerText();
  const total = await page.evaluate(() => document.getElementById('tournamentSelect').options.length);
  assert.strictEqual(await tLabel(), `All tournaments (${total})`);
  await page.evaluate(() => { const sel = document.getElementById('tournamentSelect'); sel.setMultiValues([...sel.options].map((o) => o.value)); });
  assert.strictEqual(await tLabel(), `All tournaments (${total})`);
  await page.evaluate(() => document.getElementById('tournamentSelect').setMultiValues([]));
  await page.fill('#searchBox', 'CHLORIDE sodium');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const anyOrder = await results(page);
  await page.locator('#ignoreWordOrder').uncheck();
  await page.waitForTimeout(400);
  assert.strictEqual(await results(page), 0, 'as a phrase, "chloride sodium" is nowhere');
  await page.fill('#searchBox', 'Sodium CHLORIDE');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const phrase = await results(page);
  assert.ok(phrase > 0 && phrase <= anyOrder, `${phrase} as a phrase, ${anyOrder} in any order`);
  await page.selectOption('#searchType', 'answer');
  await page.waitForTimeout(400);
  const inAnswers = await results(page);
  assert.ok(inAnswers > 0 && inAnswers < phrase);
  // Only the answer lines are marked.
  assert.strictEqual(await page.locator('#results .q-text mark').count(), 0);
  assert.ok(await page.locator('#results .a-text mark').count() > 0);
  await page.fill('#minYear', '2025');
  await page.fill('#maxYear', '2026');
  await page.waitForTimeout(600);
  assert.ok(await results(page) < inAnswers, 'the years narrow it');
  await page.locator('#clearFilters').click();
  assert.strictEqual(await page.locator('#ignoreWordOrder').isChecked(), true);
  assert.strictEqual(await page.locator('#minYear').inputValue(), '');
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Database cards: the title (with round and question) links the source; Stats | Report beside the answer; no footer; stats from everyone', async () => {
  const { ctx } = await statsContext({ heard: 10, correct: 6, incorrect: 1, negs: 2, unanswered: 1, cel_sum: 3, cel_n: 6 });
  const page = await openPage(ctx, server.url + 'catalog');
  await page.waitForFunction(() => document.querySelector('#results .q-card'), null, { timeout: 60000 });
  const card = page.locator('#results .q-card').first();
  const title = card.locator('.q-card-title a.q-card-title-text');
  assert.match(await title.innerText(), / \| (?:[^|]+ \/ )?Question \d+$/);
  assert.doesNotMatch(await title.innerText(), /Packet/);
  assert.match(await title.getAttribute('href'), /^https?:\/\//);
  assert.strictEqual(await card.locator('.card-footer').count(), 0, 'no footer');
  assert.deepStrictEqual(await card.locator('.q-card-answer-row .q-card-links a').allInnerTexts(), ['Stats', 'Report']);
  await card.locator('.stats-link').click();
  await page.waitForFunction(() => document.querySelector('.q-stats-table'), null, { timeout: 10000 });
  const rows = await page.$$eval('.q-stats-table tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
  const get = (k) => (rows.find((r) => r[0] === k) || [])[1];
  assert.ok(get('Toss-ups heard') === '10' || get('Bonuses heard') === '10');
  assert.strictEqual(get('Interrupts (−4)'), '2');
  assert.strictEqual(get('Average celerity'), '0.500');
  assert.strictEqual(get('Total points'), '16');
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Play: with Type to answer off, Buzz becomes Reveal, the answer counts as right, and I was wrong flips it; the play is counted for the question\'s stats', async () => {
  const { ctx, plays } = await statsContext({ heard: 0 });
  const page = await openPage(ctx, server.url + 'solo');
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  await page.locator('#toggleTypeToAnswer').uncheck();
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(600);
  await page.locator('#buzzBtn').click();
  assert.strictEqual(await page.locator('#buzzBtn').innerText(), 'Reveal');
  assert.strictEqual(await page.locator('#answerRow').isVisible(), false, 'nothing to type');
  await page.locator('#buzzBtn').click();
  await page.waitForTimeout(300);
  assert.match(await page.locator('#revealBox').innerText(), /Correct/);
  assert.match(await page.locator('#statline').innerText(), /^1\/0/);
  assert.strictEqual(await page.locator('#buzzBtn').innerText(), 'Buzz');
  await page.locator('#overrideBtn').click();
  assert.match(await page.locator('#statline').innerText(), /^0\/1/);
  // The next question sends this one's play, as it finally stood.
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(800);
  assert.strictEqual(plays.length, 1);
  assert.ok(['incorrect', 'neg'].includes(plays[0].p_result), plays[0].p_result);
  assert.strictEqual(plays[0].p_mode, 'solo');
  assert.strictEqual(await page.locator('#toggleShowHistory').count(), 0, 'Show question history is gone');
  assert.strictEqual(await page.locator('#toggleShowSetName').count(), 0, 'Show set name is gone');
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Play: the year range narrows the questions', async () => {
  const ctx = await newContext(browser);
  const page = await openPage(ctx, server.url + 'solo');
  await page.waitForFunction(() => /match your settings/.test(document.getElementById('matchCount').textContent), null, { timeout: 60000 });
  const count = () => page.locator('#matchCount').innerText().then((t) => parseInt(t.replace(/,/g, ''), 10));
  const all = await count();
  assert.match(await page.locator('#yearRangeLabel').innerText(), /^Year range: \d{4} - \d{4}$/);
  await page.evaluate(() => { const el = document.getElementById('yearMin'); el.value = 2025; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(300);
  assert.ok(await count() < all);
  assert.match(await page.locator('#yearRangeLabel').innerText(), /^Year range: 2025 - /);
  await page.locator('#clearFilters').click();
  await page.waitForTimeout(300);
  assert.strictEqual(await count(), all);
  await ctx.close();
});

test('Multiplayer: a year range set by one player reaches the room, which hears it once', async () => {
  const ctx = await newContext(browser);
  const r = 'e2e' + Math.random().toString(36).slice(2, 8);
  const a = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  await b.evaluate(() => {
    const el = document.getElementById('mpSettingsYearMin');
    el.value = 2024;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await a.waitForFunction(() => /^Year range: 2024 - /.test(document.getElementById('mpSettingsYearRangeLabel').textContent), null, { timeout: 10000 });
  await a.waitForFunction(() => /changed the years to 2024-/.test(document.getElementById('mpHistory').textContent), null, { timeout: 10000 });
  assert.strictEqual(await a.locator('#mpToggleShowHistory').count(), 0);
  assert.deepStrictEqual([...a.errors, ...b.errors], []);
  await ctx.close();
});

test('Set and packet pages link their sources; packet questions have no tag line; frequency lists have no downloads or pickers', async () => {
  const ctx = await newContext(browser);
  const set = await openPage(ctx, server.url + 'set?set=ncb-fall-2026');
  await set.waitForSelector('.set-source', { timeout: 30000 });
  assert.strictEqual(await set.locator('.set-source a').getAttribute('href'), 'https://isobowl.com/premier/tournaments/national-chemistry-bowl');
  const packet = await openPage(ctx, server.url + 'packet?set=lost-3-hs&packet=1');
  await packet.waitForSelector('.packet-question', { timeout: 30000 });
  assert.strictEqual(await packet.locator('.set-source a').innerText(), 'Source packet');
  assert.match(await packet.locator('.set-source a').getAttribute('href'), /^https:\/\/drive\.google\.com\//);
  const text = await packet.locator('#setPage').innerText();
  assert.doesNotMatch(text, /Download packet|<Physics|Report/);
  const freq = await openPage(ctx, server.url + 'frequency-list?subject=bio');
  await freq.waitForSelector('#frequency-list tr', { timeout: 30000 });
  assert.strictEqual(await freq.locator('select').count(), 0);
  assert.doesNotMatch(await freq.locator('#freqPage').innerText(), /Download this page|Choose a/);
  assert.strictEqual(await freq.locator('#frequency-list tr').count(), 50);
  assert.deepStrictEqual([...set.errors, ...packet.errors, ...freq.errors], []);
  await ctx.close();
});
