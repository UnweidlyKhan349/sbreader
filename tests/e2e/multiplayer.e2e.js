// Multiplayer with two simulated players (tests/e2e/fake-peer.js): joining,
// settings in sync (also with network lag, where a stale echo used to undo
// quick clicks), overrides, the live chat line, the rounds message on
// letting go of the slider, the relay when direct links are blocked, and
// General's default subjects.
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

test('a newcomer whose direct links are blocked gets a status, not a frozen page', async () => {
  // The relay needs Supabase, which this test blocks, so the newcomer can't
  // get in; this checks the attempt shows its progress and fails cleanly.
  // (The next test runs the relay against the real project.)
  const ctx = await newContext(browser, { noDirect: true });
  const r = room();
  await joinRoom(ctx, server.url, r);
  const g = await ctx.newPage(); g.on('dialog', (d) => d.dismiss());
  await g.goto(`${server.url}multiplayer?room=${r}`, { waitUntil: 'networkidle' });
  await g.waitForFunction(() => /Couldn't open|Connecting|Still connecting/.test((document.getElementById('joinStatus') || {}).textContent || ''), null, { timeout: 20000 });
  await ctx.close();
});

test('players whose direct links are blocked meet through the Supabase relay', { skip: process.env.SB_E2E_OFFLINE ? 'SB_E2E_OFFLINE is set' : false }, async () => {
  // Real Supabase Realtime (a broadcast channel; no table rows for a
  // private room code). Set SB_E2E_OFFLINE=1 to skip without a network.
  const ctx = await newContext(browser, { noDirect: true, liveSupabase: true });
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

test('General starts with every subject but Energy; a subject room is locked', async () => {
  const ctx = await newContext(browser);
  const page = await (async () => { const p = await ctx.newPage(); await p.goto(server.url + 'multiplayer?lobby=general', { waitUntil: 'networkidle' }); await p.waitForSelector('#mpSubjectButtons .btn-subject', { state: 'attached', timeout: 40000 }); return p; })();
  assert.strictEqual(await subjectOn(page, 'energy'), false);
  assert.strictEqual(await subjectOn(page, 'bio'), true);
  const bio = await ctx.newPage(); await bio.goto(server.url + 'multiplayer?lobby=bio', { waitUntil: 'networkidle' });
  await bio.waitForSelector('#mpSubjectButtons .btn-subject', { state: 'attached', timeout: 40000 });
  assert.ok(await bio.locator('#mpSubjectButtons .btn-subject[data-subject="math"]').isDisabled());
  assert.strictEqual(await subjectOn(bio, 'bio'), true);
  await ctx.close();
});
