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

test('a newcomer whose direct links are blocked gets a status, not a frozen page', async () => {
  // The relay needs Supabase, which this test blocks, so the newcomer can't
  // get in; this checks the attempt shows its progress and fails cleanly.
  // (The next test runs the relay against the real project.)
  const ctx = await newContext(browser, { noDirect: true });
  const r = room();
  await joinRoom(ctx, server.url, r);
  const g = await ctx.newPage(); g.on('dialog', (d) => d.dismiss());
  await g.goto(`${server.url}multiplayer?room=${r}`, { waitUntil: 'networkidle' });
  // "Connecting to …" shows in the room itself at once; a failure goes back
  // to the lobby, saying why.
  await g.waitForFunction(() => /Couldn't open|Connecting|Still connecting/.test(['joinStatus', 'mpQDisplay'].map((id) => (document.getElementById(id) || {}).textContent || '').join(' ')), null, { timeout: 20000 });
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

// Another person in the same room: tabs of one browser share its storage,
// and with it the room owner's key and the player ID, so this tab keeps its
// own copies of those two, in the page (the others' stay as they are).
// `pid` gives a player ID to use, as the same person coming back.
async function stranger(ctx, base, r, pid) {
  const p = await ctx.newPage();
  await p.addInitScript((id) => {
    const own = { sb_mp_pid: id || 'pid' + Math.random().toString(36).slice(2, 12), sb_mp_owner_key: null };
    const S = Storage.prototype;
    const [get, set, del] = [S.getItem, S.setItem, S.removeItem];
    const mine = (store, k) => store === window.localStorage && Object.prototype.hasOwnProperty.call(own, k);
    S.getItem = function (k) { return mine(this, k) ? own[k] : get.call(this, k); };
    S.setItem = function (k, v) { if (mine(this, k)) own[k] = String(v); else set.call(this, k, v); };
    S.removeItem = function (k) { if (mine(this, k)) own[k] = null; else del.call(this, k); };
  }, pid || null);
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(`${base}multiplayer?room=${r}`, { waitUntil: 'networkidle' });
  return p;
}
async function strangerIn(ctx, base, r, pid) {
  const p = await stranger(ctx, base, r, pid);
  await p.waitForSelector('#mpSubjectButtons .btn-subject', { state: 'attached', timeout: 40000 });
  await p.waitForFunction(() => document.querySelectorAll('.mp-player-row:not(.offline)').length >= 2, null, { timeout: 20000 });
  await p.waitForTimeout(600);
  return p;
}
const crowned = (p) => p.$$eval('.mp-player-row:not(.offline)', (xs) => xs.filter((x) => x.querySelector('.mp-crown')).map((x) => x.querySelector('span').textContent.replace(/[^\w\s-]/gu, '').trim()));
const myName = (p) => p.evaluate(() => document.getElementById('mpUsername').value);
async function ownerMenu(owner, name, action) {
  const row = owner.locator('.mp-player-row', { hasText: name }).first();
  await row.locator('[data-sb-dropdown]').click();
  await row.locator(`[data-${action}]`).click();
}

test('the room\'s creator has a crown; a controlled room\'s settings are theirs alone', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  const aName = await myName(a);
  assert.deepStrictEqual(await crowned(g), [aName], 'only the creator is crowned, on everyone\'s list');
  assert.strictEqual(await g.locator('#mpToggleControlled').isDisabled(), true, 'only the owner has the controlled switch');
  await a.locator('#mpToggleControlled').check();
  await g.waitForFunction(() => document.getElementById('mpRoomSettings').disabled, null, { timeout: 10000 });
  assert.ok(await g.locator('#mpControlledNote').isVisible());
  // A change sent anyway (the controls forced back on) is refused and undone.
  const before = await subjectOn(a, 'chem');
  await g.evaluate(() => { document.getElementById('mpRoomSettings').disabled = false; });
  await g.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  await g.waitForTimeout(1000);
  assert.strictEqual(await subjectOn(a, 'chem'), before);
  assert.strictEqual(await subjectOn(g, 'chem'), before, 'the refused change is undone on the sender\'s screen');
  // The owner still changes them.
  await a.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  await g.waitForFunction((was) => document.querySelector('#mpSubjectButtons .btn-subject[data-subject="chem"]').classList.contains('active') !== was, before, { timeout: 10000 });
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('with Allow skips off, only the owner can skip', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  await a.locator('#mpToggleSkip').uncheck();
  await g.waitForFunction(() => !document.getElementById('mpToggleSkip').checked, null, { timeout: 10000 });
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Skip', null, { timeout: 15000 });
  assert.strictEqual(await g.locator('#mpNextBtn').isDisabled(), true, 'others can\'t skip');
  assert.strictEqual(await a.locator('#mpNextBtn').isDisabled(), false, 'the owner can');
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press('s');
  await g.waitForTimeout(600);
  assert.notStrictEqual(await a.evaluate(() => document.getElementById('mpNextBtn').textContent), 'Next', 's did nothing for the other player');
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Next', null, { timeout: 10000 });
  await ctx.close();
});

test('the owner can mute and ban; a banned player stays out', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  const gPid = await g.evaluate(() => localStorage.getItem('sb_mp_pid'));
  assert.ok(!(await g.locator('.mp-player-row', { hasText: await myName(a) }).first().locator('[data-ban]').count()), 'only the owner has Ban');
  await ownerMenu(a, gName, 'mute');
  await g.waitForFunction(() => document.querySelector('.mp-muted'), null, { timeout: 10000 });
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press('Enter'); await g.keyboard.type('hello there'); await g.keyboard.press('Enter');
  await a.waitForTimeout(800);
  assert.ok(!/hello there/.test(await a.locator('#mpHistory').innerText()), 'a muted player\'s chat doesn\'t reach the room');
  assert.match(await g.locator('#mpHistory').innerText(), /are muted in this room/);
  await a.evaluate(() => { window.confirm = () => true; });
  await ownerMenu(a, gName, 'ban');
  await g.waitForFunction(() => /banned from that room/.test(document.getElementById('joinStatus').textContent), null, { timeout: 15000 });
  await a.waitForFunction((n) => ![...document.querySelectorAll('.mp-player-row')].some((x) => x.textContent.includes(n)), gName, { timeout: 10000 });
  // Back with the same player ID: turned away.
  const again = await stranger(ctx, server.url, r, gPid);
  await again.waitForFunction(() => /banned from that room/.test(document.getElementById('joinStatus').textContent), null, { timeout: 20000 });
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('the owner gets the crown back on returning, from whoever runs the room by then', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const aName = await myName(a);
  const g = await strangerIn(ctx, server.url, r);
  await a.close(); // g carries the room on
  await g.waitForFunction(() => document.querySelectorAll('.mp-player-row:not(.offline)').length === 1, null, { timeout: 20000 });
  const back = await ctx.newPage(); // the owner's browser (its key is still stored)
  await back.goto(`${server.url}multiplayer?room=${r}`, { waitUntil: 'networkidle' });
  await g.waitForFunction(() => document.querySelector('.mp-player-row:not(.offline) .mp-crown'), null, { timeout: 20000 });
  assert.deepStrictEqual(await crowned(g), [aName]);
  await ctx.close();
});

test('a room link shows the room at once; a room picked in the lobby opens without reloading', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const page = await ctx.newPage();
  await page.goto(`${server.url}multiplayer?room=${r}`, { waitUntil: 'domcontentloaded' });
  assert.strictEqual(await page.locator('#lobbyScreen').isVisible(), false, 'no lobby first');
  await page.waitForSelector('#mpSubjectButtons .btn-subject', { state: 'attached', timeout: 40000 });
  const lobby = await ctx.newPage();
  await lobby.goto(`${server.url}multiplayer`, { waitUntil: 'networkidle' });
  await lobby.evaluate(() => { window.__samePage = true; });
  await lobby.fill('#newRoomName', r);
  await lobby.click('#roomForm button[type=submit]');
  await lobby.waitForFunction(() => document.querySelectorAll('.mp-player-row:not(.offline)').length >= 2, null, { timeout: 20000 });
  assert.strictEqual(await lobby.evaluate(() => window.__samePage), true, 'the page wasn\'t reloaded');
  assert.match(lobby.url(), new RegExp(`room=${r}`));
  await ctx.close();
});

test('hiding the settings widens the question, as on QB Reader', async () => {
  const ctx = await newContext(browser);
  const a = await joinRoom(ctx, server.url, room());
  const width = () => a.evaluate(() => document.getElementById('content').getBoundingClientRect().width);
  const before = await width();
  await a.locator('#mpSettingsBtn').click();
  const after = await width();
  assert.ok(after > before * 1.25, `${before} -> ${after}`);
  await a.locator('#mpSettingsBtn').click();
  assert.ok(Math.abs(await width() - before) < 2);
  await ctx.close();
});
