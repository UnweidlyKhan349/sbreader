// Multiplayer with two simulated players (tests/e2e/fake-peer.js): joining,
// settings in sync (also with network lag, where a stale echo used to undo
// quick clicks), overrides, the live chat line, the rounds message on
// letting go of the slider, the relay when direct links are blocked, a
// newcomer reading on mid-question, and the coordinator leaving. Room owners
// and the room's flow are in multiplayer-rooms.e2e.js (run alongside).
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, joinRoom } = require('./helpers');

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
  await a.locator('#mpNextBtn').click(); await a.waitForTimeout(1200);
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

test('the room hears about a round change once, when the slider is let go', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const events = () => a.$$eval('#mpHistory li i', (xs) => xs.map((x) => x.textContent.trim()).filter((t) => /changed the rounds/.test(t)));
  const box = await g.locator('#mpSettingsRoundSlider').boundingBox();
  const y = box.y + box.height / 2;
  await g.mouse.move(box.x + box.width - 8, y); await g.mouse.down();
  for (let i = 1; i <= 8; i++) { await g.mouse.move(box.x + box.width - 8 - i * (box.width / 25), y); await g.waitForTimeout(60); }
  await g.waitForTimeout(400);
  assert.deepStrictEqual(await events(), [], 'nothing while dragging');
  await g.mouse.up(); await g.waitForTimeout(800);
  assert.strictEqual((await events()).length, 1);
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
