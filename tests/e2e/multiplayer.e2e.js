// Multiplayer with two simulated players (tests/e2e/fake-peer.js): joining,
// settings in sync (also with network lag, where a stale echo used to undo
// quick clicks), overrides, the live chat line, the rounds message that
// follows the slider live, the relay when direct links are blocked, a
// newcomer reading on mid-question, and the coordinator leaving. Room owners
// and the room's flow are in multiplayer-rooms.e2e.js (run alongside).
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, joinRoom, untilReading } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

const subjectOn = (page, key) => page.evaluate((k) => document.querySelector(`#mpSubjectButtons .btn-subject[data-subject="${k}"]`).classList.contains('active'), key);
const room = () => 'e2e' + Math.random().toString(36).slice(2, 8);

test('a second player joins and both see the same settings', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await g.waitForFunction(() => document.querySelectorAll('.mp-player-row').length >= 2, null, { timeout: 20000 });
  assert.match(await g.locator('#mpUsername').inputValue(), / 2$/, 'the second player with the same name is renamed, and sees it');
  await g.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  await a.waitForTimeout(800);
  assert.strictEqual(await subjectOn(a, 'chem'), false);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('quick clicks with network lag end in the right state', async () => {
  const ctx = await newContext(browser, { lagMs: 150 });
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  for (const [key, clicks, gap] of [['math', 3, 250], ['phys', 4, 120]]) {
    const before = await subjectOn(g, key);
    for (let i = 0; i < clicks; i++) { await g.locator(`#mpSubjectButtons .btn-subject[data-subject="${key}"]`).click(); await g.waitForTimeout(gap); }
    await g.waitForTimeout(1200);
    const want = clicks % 2 ? !before : before;
    assert.strictEqual(await subjectOn(g, key), want, `${key} x${clicks} (guest)`);
    assert.strictEqual(await subjectOn(a, key), want, `${key} x${clicks} (host)`);
  }
  await ctx.close();
});

test('a wrong answer can be overridden, and taken back, on the buzz line', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await a.locator('#mpNextBtn').click(); await untilReading(a, g); await a.waitForTimeout(800);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' '); await g.waitForTimeout(400);
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(600);
  await a.keyboard.press('s'); await a.waitForTimeout(1200);
  const badges = (p) => p.$$eval('#mpHistory li[data-buzz-player] .badge', (bs) => bs.map((x) => (x.classList.contains('bg-success') ? 'green' : 'red')).join(' '));
  assert.strictEqual(await badges(a), 'red red');
  await g.locator('#mpHistory .mp-inline-override').click(); await g.waitForTimeout(1000);
  assert.strictEqual(await badges(a), 'green green');
  // The counters follow the override too, on the other player's screen.
  const statsOf = async (p, name) => {
    await p.locator('.mp-player-row:visible', { hasText: name }).first().locator('span', { hasText: name }).first().click();
    await p.waitForTimeout(400);
    return p.$$eval('.popover-body li', (lis) => Object.fromEntries(lis.map((li) => [li.children[0].textContent, li.children[1].textContent])));
  };
  const gName = await g.evaluate(() => document.getElementById('mpUsername').value);
  const st = await statsOf(a, gName);
  assert.deepStrictEqual([st.Correct, st.Negs, st.Incorrect], ['1', '0', '0']);
  await a.keyboard.press('Escape');
  assert.strictEqual(await g.locator('#mpHistory .mp-inline-override').innerText(), 'I was wrong');
  await g.locator('#mpHistory .mp-inline-override').click(); await g.waitForTimeout(1000);
  assert.strictEqual(await badges(a), 'red red');
  await ctx.close();
});

test('"I was right" after someone else was marked correct takes the question from them, and gives it back when undone', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await a.locator('#mpNextBtn').click(); await untilReading(a, g); await a.waitForTimeout(800);
  // The guest interrupts and is wrong; the question reads on.
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' '); await g.waitForTimeout(400);
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(600);
  // The other player buzzes and gives the key.
  // (Once enough of it has been read to tell its key: every question it
  // could still be has the same one. The bank keeps questions printed
  // twice, so the text alone may never single one out, and a short
  // question never reaches a fixed length.)
  const reading = () => {
    const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };
    const shown = document.getElementById('mpQDisplay').textContent.replace(/\s+/g, ' ').trim();
    const found = shown.length < 15 ? [] : SBData.questions.filter((q) => plain(SBData.readoutHTML(q)).startsWith(shown));
    const keys = new Set(found.map((q) => q.answer.letter || q.answer.text));
    return keys.size === 1 ? [...keys][0] : null;
  };
  await a.waitForFunction(reading, null, { timeout: 20000, polling: 250 });
  await a.locator('body').click({ position: { x: 400, y: 300 } });
  await a.keyboard.press(' '); await a.waitForTimeout(400);
  const answer = await a.evaluate(reading);
  assert.ok(answer, 'the question being read was found');
  await a.keyboard.type(answer); await a.keyboard.press('Enter'); await a.waitForTimeout(1000);
  const badges = (p) => p.$$eval('#mpHistory li[data-buzz-player]', (lis) => lis.map((li) => (li.querySelector('.badge').classList.contains('bg-success') ? 'green' : 'red')).join(' '));
  const scores = (p) => p.$$eval('.mp-player-row:visible', (rows) => rows.map((x) => x.textContent.replace(/Votekick/g, ' ').replace(/\s+/g, ' ').trim()).sort().join(' | '));
  assert.strictEqual(await badges(g), 'green red', 'newest first: the key, then the wrong interrupt');
  // The guest says they were right: their line turns green, the other's red.
  assert.strictEqual(await g.locator('#mpHistory .mp-inline-override').innerText(), 'I was right');
  await g.locator('#mpHistory .mp-inline-override').click(); await g.waitForTimeout(1000);
  for (const p of [a, g]) assert.strictEqual(await badges(p), 'red green');
  assert.doesNotMatch(await a.locator('#mpHistory').innerText(), /was marked/, 'no line for it');
  assert.strictEqual(await scores(a), await scores(g));
  assert.match(await scores(a), / 0 \| .* 4$/, 'the guest has the 4 points, the other player none');
  // The other player can still say they were right (no lock); here the
  // guest takes it back instead, which restores both.
  assert.strictEqual(await a.locator('#mpHistory .mp-inline-override').innerText(), 'I was right');
  await g.locator('#mpHistory .mp-inline-override').click(); await g.waitForTimeout(1000);
  for (const p of [a, g]) assert.strictEqual(await badges(p), 'green red');
  // The guest flipped twice: one line, rewritten.
  for (const p of [a, g]) {
    const ls = await p.$$eval('#mpHistory li i', (xs) => xs.map((x) => x.textContent.trim()).filter((t) => /changed their answer to/.test(t)));
    assert.strictEqual(ls.length, 1, 'one line, edited');
    assert.match(ls[0], /to incorrect$/);
  }
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('chat shows the line as soon as the box opens, then the text as it is typed', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press('Enter'); await g.waitForTimeout(500);
  assert.strictEqual(await a.locator('#mpHistory li.chat-live').count(), 1, 'the empty line shows');
  await g.keyboard.type('hello'); await g.waitForTimeout(500);
  assert.match(await a.locator('#mpHistory li.chat-live').innerText(), /hello$/);
  await g.keyboard.press('Enter'); await g.waitForTimeout(500);
  assert.strictEqual(await a.locator('#mpHistory li.chat-live').count(), 0);
  assert.match(await a.locator('#mpHistory li.chat-message').first().innerText(), /hello$/);
  await ctx.close();
});

test('what you are typing as an answer stays put when someone pauses or changes a setting', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  await a.locator('#mpNextBtn').click();
  await b.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled, null, { timeout: 10000 });
  await b.locator('#mpBuzzBtn').click();
  await b.waitForFunction(() => !document.getElementById('mpAnswerRow').classList.contains('d-none'), null, { timeout: 10000 });
  await b.keyboard.type('photosynth');
  await a.locator('#mpPauseBtn').click(); await a.waitForTimeout(400);
  await a.locator('#mpPauseBtn').click(); await a.waitForTimeout(400);
  await a.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click(); await a.waitForTimeout(600);
  assert.strictEqual(await b.locator('#mpAnswerInput').inputValue(), 'photosynth');
  assert.strictEqual(await b.evaluate(() => document.activeElement && document.activeElement.id), 'mpAnswerInput');
  assert.deepStrictEqual([...a.errors, ...b.errors], []);
  await ctx.close();
});

test('clearing the filters puts every player\'s round slider back to every round', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const box = await g.locator('#mpSettingsRoundSlider').boundingBox();
  const y = box.y + box.height / 2;
  await g.mouse.move(box.x + box.width - 8, y); await g.mouse.down();
  await g.mouse.move(box.x + box.width / 2, y, { steps: 5 }); await g.mouse.up();
  await g.waitForTimeout(800);
  const range = (p) => p.evaluate(() => [document.getElementById('mpSettingsRoundMin').value, document.getElementById('mpSettingsRoundMax').value, document.getElementById('mpSettingsRoundMax').max]);
  const [, hi, max] = await range(g);
  assert.ok(Number(hi) < Number(max), 'the slider was narrowed');
  await a.locator('#mpClearFilters').click(); await g.waitForTimeout(1000);
  const [lo2, hi2, max2] = await range(g);
  assert.deepStrictEqual([lo2, hi2], ['1', max2], 'back to every round on the other player\'s screen too');
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('reaching the end of the questions says so in a dialog on the page, not a browser alert that would freeze the room', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const native = [];
  a.on('dialog', (d) => { native.push(d.message()); d.dismiss(); });
  // The smallest set (13 questions), every subject.
  await a.evaluate(() => { const s = document.getElementById('mpSettingsTournamentSelect'); s.setMultiValues(['dast-2']); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await a.waitForTimeout(500);
  for (let i = 0; i < 60; i++) {
    if (await a.evaluate(() => document.getElementById('alert-modal') && document.getElementById('alert-modal').classList.contains('show'))) break;
    await a.locator('body').click({ position: { x: 5, y: 300 } });
    await a.keyboard.press('s'); await a.waitForTimeout(120);
    await a.keyboard.press('n'); await a.waitForTimeout(220);
  }
  assert.match(await a.locator('#alert-modal-text').innerText(), /reached the end of the questions/);
  assert.deepStrictEqual(native, []);
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('a round change reaches the room as the slider moves, on one line that follows it; another player\'s change gets its own line', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const events = () => a.$$eval('#mpHistory li i', (xs) => xs.map((x) => x.textContent.trim()).filter((t) => /changed the rounds/.test(t)));
  const box = await g.locator('#mpSettingsRoundSlider').boundingBox();
  const y = box.y + box.height / 2;
  await g.mouse.move(box.x + box.width - 8, y); await g.mouse.down();
  for (let i = 1; i <= 8; i++) { await g.mouse.move(box.x + box.width - 8 - i * (box.width / 25), y); await g.waitForTimeout(60); }
  await g.waitForTimeout(600);
  const during = await events();
  assert.strictEqual(during.length, 1, 'one line while dragging');
  assert.match(during[0], /changed the rounds to 1-\d+$/, 'live, as the slider moves');
  await g.mouse.up(); await g.waitForTimeout(800);
  assert.strictEqual((await events()).length, 1);
  assert.strictEqual(await a.locator('#mpSettingsRoundRangeLabel').innerText(), await g.locator('#mpSettingsRoundRangeLabel').innerText(), 'everyone\'s slider follows');
  // Another player's change to the rounds gets its own line; the same
  // player's next one edits theirs.
  const release = async (p, steps) => {
    const b = await p.locator('#mpSettingsRoundSlider').boundingBox();
    const yy = b.y + b.height / 2;
    await p.mouse.move(b.x + 8, yy); await p.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.mouse.move(b.x + 8 + i * (b.width / 25), yy); await p.waitForTimeout(60); }
    await p.mouse.up(); await p.waitForTimeout(800);
  };
  await release(a, 3);
  await a.waitForFunction(() => [...document.querySelectorAll('#mpHistory li i')].filter((x) => /changed the rounds/.test(x.textContent)).length === 2, null, { timeout: 5000 });
  await release(a, 5);
  assert.strictEqual((await events()).length, 2, 'the same player\'s next change edits their own line');
  assert.strictEqual((await g.$$eval('#mpHistory li i', (xs) => xs.filter((x) => /changed the rounds/.test(x.textContent)).length)), 2, 'everyone sees both');
  await ctx.close();
});

test('the reading speed reaches the room as its slider moves, on one line', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const lines = () => a.$$eval('#mpHistory li i', (xs) => xs.map((x) => x.textContent.trim()).filter((t) => /changed the reading speed/.test(t)));
  for (const v of [55, 60, 65, 70]) {
    await g.evaluate((x) => { const el = document.getElementById('mpSettingsRateSlider'); el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await g.waitForTimeout(150);
  }
  await a.waitForFunction(() => document.getElementById('mpSettingsRateValue').textContent === '70', null, { timeout: 10000 });
  await a.waitForTimeout(500);
  assert.deepStrictEqual((await lines()).map((t) => t.replace(/^.*changed/, 'changed')), ['changed the reading speed to 70'], 'one line, before the slider is let go');
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('players whose direct links are blocked meet through the Supabase relay', { skip: process.env.SB_E2E_OFFLINE ? 'SB_E2E_OFFLINE is set' : false }, async () => {
  // Real Supabase Realtime (a broadcast channel). Set SB_E2E_OFFLINE=1 to
  // skip without a network.
  const ctx = await newContext(browser, { noDirect: true, liveSupabase: true });
  // Only the Realtime relay is real: the database calls (the room list's
  // heartbeats) are blocked, so the test leaves no rooms or players behind.
  await ctx.route(/supabase\.co\/(rest|functions)\//, (r) => r.abort());
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  const names = (p) => p.$$eval('.mp-player-row:not(.offline)', (xs) => xs.length);
  await a.waitForFunction(() => document.querySelectorAll('.mp-player-row:not(.offline)').length >= 2, null, { timeout: 30000 });
  assert.ok(await names(b) >= 2, 'the newcomer sees both players');
  // A settings change crosses the relay.
  const before = await subjectOn(b, 'math');
  await a.click('#mpSubjectButtons .btn-subject[data-subject="math"]');
  await b.waitForFunction((was) => document.querySelector('#mpSubjectButtons .btn-subject[data-subject="math"]').classList.contains('active') !== was, before, { timeout: 15000 });
  await ctx.close();
});

test('a player who joins mid-question reads on from where the room is, not the whole question', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  // Slowest reading, so the question is still being read when B arrives.
  await a.evaluate(() => { const el = document.getElementById('mpSettingsRateSlider'); if (el) { el.value = el.min || 0; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });
  await a.waitForTimeout(500);
  await a.locator('#mpNextBtn').click();
  await a.waitForTimeout(2000);
  const b = await joinRoom(ctx, server.url, r);
  const shown = (p) => p.evaluate(() => document.getElementById('mpQDisplay').textContent.length);
  const [la, lb] = [await shown(a), await shown(b)];
  assert.ok(lb > 0, 'the newcomer sees what has been read');
  assert.ok(Math.abs(la - lb) < 60, `both read the same part (${la} vs ${lb})`);
  await b.waitForTimeout(1500);
  // While the room is still reading, the newcomer's text grows too, so it
  // wasn't shown whole on arrival. (On a slow machine the reading can end
  // first; then both show it all.)
  const [la2, lb2] = [await shown(a), await shown(b)];
  if (la2 > la) assert.ok(lb2 > lb, 'and the reading goes on');
  else assert.strictEqual(lb2, la2);
  await ctx.close();
});

test('pausing and resuming while someone answers doesn\'t read on for anyone', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  await a.evaluate(() => { const el = document.getElementById('mpSettingsRateSlider'); if (el) { el.value = el.min || 0; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });
  await a.waitForTimeout(500);
  await a.locator('#mpNextBtn').click();
  await b.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled && document.getElementById('mpQDisplay').textContent.length > 0, null, { timeout: 10000 });
  await b.waitForTimeout(800);
  await b.locator('#mpBuzzBtn').click();
  await b.waitForFunction(() => !document.getElementById('mpAnswerRow').classList.contains('d-none'), null, { timeout: 10000 });
  await a.waitForTimeout(500);
  const shown = (p) => p.evaluate(() => document.getElementById('mpQDisplay').textContent.length);
  const before = [await shown(a), await shown(b)];
  // Each player pauses and resumes once, so both the coordinator's and the
  // other player's handling of the pause are exercised.
  for (const p of [a, b]) {
    await p.locator('#mpPauseBtn').click(); await p.waitForTimeout(300);
    await p.locator('#mpPauseBtn').click(); await p.waitForTimeout(300);
  }
  await a.waitForTimeout(1500);
  const after = [await shown(a), await shown(b)];
  assert.deepStrictEqual(after, before, 'the question stays where the buzz stopped it');
  assert.deepStrictEqual(a.errors, []); assert.deepStrictEqual(b.errors, []);
  await ctx.close();
});

test('when the coordinator leaves, the others agree on a new one and play on', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  const c = await joinRoom(ctx, server.url, r);
  await a.close(); // the first player, who opened the room, coordinates
  await b.waitForTimeout(4000);
  await b.locator('#mpNextBtn').click();
  const q = (p) => p.evaluate(() => document.getElementById('mpQDisplay').textContent.length);
  await b.waitForTimeout(2500);
  assert.ok(await q(b) > 0, 'the new coordinator started a question');
  assert.ok(await q(c) > 0, 'and the other player follows it');
  await ctx.close();
});

test('losing the connection shows "Disconnected from server" in a dialog on the page, not a browser alert', async () => {
  const ctx = await newContext(browser);
  const page = await joinRoom(ctx, server.url, room());
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#alert-modal.show');
  assert.strictEqual(await page.textContent('#alert-modal-text'), 'Disconnected from server');
  // Only OK closes it: not Esc, not a click outside.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  assert.strictEqual(await page.isVisible('#alert-modal'), true);
  await page.click('#alert-modal-close');
  await page.waitForSelector('#alert-modal', { state: 'hidden' });
  assert.deepStrictEqual(dialogs, []);
  await ctx.close();
});

test('the "Disconnected from server" dialog goes away by itself once the connection is back', async () => {
  const ctx = await newContext(browser);
  const page = await joinRoom(ctx, server.url, room());
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#alert-modal.show');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#alert-modal', { state: 'hidden' });
  // A later loss is told again.
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#alert-modal.show');
  await ctx.close();
});

test('n starts and goes on but never skips; s only skips; the timer is at 0 after a wrong interrupt; cards carry no "answered" line', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const label = (p) => p.evaluate(() => document.getElementById('mpNextBtn').textContent);
  const press = async (p, k) => { await p.locator('body').click({ position: { x: 400, y: 300 } }); await p.keyboard.press(k); await p.waitForTimeout(700); };
  const timer = (p) => p.evaluate(() => document.getElementById('mpTimerFace').textContent + document.getElementById('mpTimerFraction').textContent);
  await press(a, 's');
  assert.strictEqual(await label(a), 'Start', 's does not start the game');
  await press(a, 'n');
  assert.strictEqual(await label(a), 'Skip', 'n starts');
  await press(g, 'n');
  assert.strictEqual(await label(a), 'Skip', 'n does not skip a question being read');
  assert.ok(!/skipped the question/.test(await a.locator('#mpHistory').innerText()));
  // A wrong interrupt: the question reads on for the other player, timer at 0.
  await press(g, ' ');
  await g.waitForSelector('#mpAnswerInput:visible');
  await g.waitForTimeout(600);
  for (const p of [a, g]) assert.match(await timer(p), /^[89]\.\d$/, 'the answer clock is running');
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter');
  await a.waitForTimeout(700);
  assert.strictEqual(await label(a), 'Skip', 'the question reads on');
  for (const p of [a, g]) assert.strictEqual(await timer(p), '0.0');
  await press(a, 's');
  assert.strictEqual(await label(a), 'Next', 's skips');
  const info = await a.locator('#mpQuestionInfo').innerText();
  await press(a, 's');
  assert.strictEqual(await a.locator('#mpQuestionInfo').innerText(), info, 's does not start the next question');
  assert.strictEqual(await a.locator('#mpHistory .history-card').count(), 0);
  await press(a, 'n');
  assert.strictEqual(await label(a), 'Skip', 'n goes on once the question is over');
  // The finished question's card: the buzz line above it says who answered what.
  for (const p of [a, g]) {
    await p.waitForSelector('#mpHistory .history-card', { state: 'attached', timeout: 10000 });
    assert.ok(!/answered:/.test(await p.locator('#mpHistory .history-card').first().evaluate((c) => c.textContent)));
    assert.match(await p.locator('#mpHistory').innerText(), /zzzz/);
  }
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('a wrong answer in the last second of the buzz window leaves the others at least 5 seconds', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const seconds = (p) => p.evaluate(() => parseFloat(document.getElementById('mpTimerFace').textContent + document.getElementById('mpTimerFraction').textContent));
  await a.locator('#mpSettingsRateSlider').evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await a.locator('#mpNextBtn').click();
  // Read through: the buzz window is counting down.
  await a.waitForFunction(() => { const t = parseFloat(document.getElementById('mpTimerFace').textContent + document.getElementById('mpTimerFraction').textContent); return t > 0 && t < 3; }, null, { timeout: 60000, polling: 100 });
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' ');
  await g.waitForSelector('#mpAnswerInput:visible');
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter');
  await a.waitForTimeout(400);
  for (const p of [a, g]) { const t = await seconds(p); assert.ok(t > 4 && t <= 5, `${t} seconds left`); }
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('the player popover moves with scrolling as QB Reader\'s (Popper) does: kept on screen below the navbar while its row shows, arrow on the row', async () => {
  const ctx = await newContext(browser, { viewport: { width: 1300, height: 700 } });
  const a = await joinRoom(ctx, server.url, room());
  // Room to scroll.
  await a.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.getElementById('mpHistory').after(d); });
  await a.locator('.mp-player-row.user-score').click();
  await a.waitForSelector('.custom-popover.show');
  const geo = () => a.evaluate(() => {
    const p = document.querySelector('.custom-popover').getBoundingClientRect();
    const r = document.querySelector('.mp-player-row.user-score').getBoundingClientRect();
    const arrow = document.querySelector('.custom-popover .popover-arrow').getBoundingClientRect();
    const nav = document.getElementById('navbar').getBoundingClientRect().bottom;
    return { pTop: p.top, pBottom: p.bottom, pRight: p.right, rTop: r.top, rBottom: r.bottom, rLeft: r.left, arrowMid: arrow.top + arrow.height / 2, nav };
  });
  const g0 = await geo();
  assert.ok(g0.pRight <= g0.rLeft, 'to the left of the row');
  // Scroll until the row is just under the navbar.
  await a.evaluate((dy) => window.scrollBy(0, dy), g0.rTop - g0.nav - 10);
  await a.waitForTimeout(150);
  const g1 = await geo();
  assert.ok(g1.pTop >= g1.nav, `kept below the navbar (${g1.pTop} vs ${g1.nav})`);
  assert.ok(g1.arrowMid >= g1.rTop && g1.arrowMid <= g1.rBottom, 'the arrow still points at the row');
  // Scrolled well past: it goes off with the row.
  await a.evaluate(() => window.scrollBy(0, 600));
  await a.waitForTimeout(150);
  const g2 = await geo();
  assert.ok(g2.pTop < g2.nav && g2.arrowMid <= g2.rBottom, 'tethered: it goes up with the row, arrow still on it');
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('typing in the chat box is never a shortcut, also when a question starts mid-message: Space types a space, no buzz', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press('Enter'); await g.waitForTimeout(300);
  await g.keyboard.type('hello');
  // The other player starts a question while the guest is still typing.
  await a.locator('#mpNextBtn').click(); await untilReading(a, g); await a.waitForTimeout(800);
  await g.keyboard.type(' there n s p k t q e');
  await g.waitForTimeout(400);
  assert.strictEqual(await g.evaluate(() => document.activeElement && document.activeElement.id), 'mpChatInput', 'the chat box kept the keyboard');
  assert.strictEqual(await g.locator('#mpChatInput').inputValue(), 'hello there n s p k t q e');
  assert.strictEqual(await g.locator('#mpAnswerRow').isVisible(), false, 'Space did not buzz');
  assert.ok(!/buzz/i.test(await a.locator('#mpHistory li[data-buzz-player], #mpHistory #live-buzz').allInnerTexts().then((x) => x.join(' '))), 'nobody buzzed');
  // Enter sends it; then the shortcuts work again.
  await g.keyboard.press('Enter'); await g.waitForTimeout(500);
  assert.match(await a.locator('#mpHistory').innerText(), /hello there n s p k t q e/);
  await g.keyboard.press(' '); await g.waitForTimeout(500);
  assert.strictEqual(await g.locator('#mpAnswerRow').isVisible(), true, 'now Space buzzes');
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});
