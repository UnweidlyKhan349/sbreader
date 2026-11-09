// Multiplayer, rooms (tests/e2e/fake-peer.js, as in multiplayer.e2e.js):
// room owners (crown, mute, ban, controlled rooms), Allow skips, room links
// and joining from the lobby, join messages, and the end of a set.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, joinRoom } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

const subjectOn = (page, key) => page.evaluate((k) => document.querySelector(`#mpSubjectButtons .btn-subject[data-subject="${k}"]`).classList.contains('active'), key);
const room = () => 'e2e' + Math.random().toString(36).slice(2, 8);

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

// Owners count only in private rooms, as on QB Reader.
const privateRoom = (r) => `${r}&private=true`;

test('the room\'s creator has a crown; a controlled room\'s settings are theirs alone', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  const aName = await myName(a);
  assert.deepStrictEqual(await crowned(g), [aName], 'only the creator is crowned, on everyone\'s list');
  assert.strictEqual(await g.locator('#mpToggleControlled').isDisabled(), true, 'only the owner has the controlled switch');
  await a.locator('#mpToggleControlled').check();
  await g.waitForFunction(() => document.getElementById('mpRoomSettings').disabled, null, { timeout: 10000 });
  assert.strictEqual(await a.locator('#mpTogglePublic').isDisabled(), true, 'a controlled room stays private');
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

test('with Allow skips off, nobody can skip, the owner included', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  await a.locator('#mpToggleSkip').uncheck();
  await g.waitForFunction(() => !document.getElementById('mpToggleSkip').checked, null, { timeout: 10000 });
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Skip', null, { timeout: 15000 });
  await a.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Skip', null, { timeout: 15000 });
  assert.strictEqual(await g.locator('#mpNextBtn').isDisabled(), true, 'others can\'t skip');
  assert.strictEqual(await a.locator('#mpNextBtn').isDisabled(), true, 'nor can the owner');
  for (const p of [g, a]) {
    await p.locator('body').click({ position: { x: 400, y: 300 } });
    await p.keyboard.press('s');
  }
  await g.waitForTimeout(600);
  for (const p of [a, g]) assert.strictEqual(await p.evaluate(() => document.getElementById('mpNextBtn').textContent), 'Skip', 's did nothing');
  assert.ok(!/skipped the question/.test(await g.locator('#mpHistory').innerText()), 'nothing was skipped');
  assert.ok(!/can.t skip/.test(await g.locator('#mpHistory').innerText()), 'no message about it');
  await ctx.close();
});

test('with rebuzzes off, a wrong answer locks the owner out too', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  assert.strictEqual(await a.locator('#mpToggleRebuzz').isChecked(), false, 'rebuzzes are off by default');
  await a.locator('#mpNextBtn').click();
  await a.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled, null, { timeout: 15000 });
  await a.locator('#mpBuzzBtn').click();
  await a.waitForFunction(() => !document.getElementById('mpAnswerRow').classList.contains('d-none'), null, { timeout: 10000 });
  await a.locator('#mpAnswerInput').fill('zzzz not it');
  await a.keyboard.press('Enter');
  await g.waitForFunction(() => /Incorrect/.test(document.getElementById('mpHistory').textContent), null, { timeout: 10000 });
  await a.waitForTimeout(400);
  assert.strictEqual(await a.locator('#mpBuzzBtn').isDisabled(), true, 'the owner can\'t buzz again');
  await a.locator('body').click({ position: { x: 400, y: 300 } });
  await a.keyboard.press(' ');
  await a.waitForTimeout(600);
  assert.ok(await a.locator('#mpAnswerRow').evaluate((x) => x.classList.contains('d-none')), 'space didn\'t buzz either');
  assert.strictEqual(await g.locator('#mpBuzzBtn').isDisabled(), false, 'the other player still can');
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('a room record that failed to save is saved again, until it goes through', async () => {
  // The room list answers its first save with a server error, then saves.
  // Everything else bound for Supabase is turned away, as in the other tests.
  const ctx = await newContext(browser, { liveSupabase: true });
  const saves = [];
  await ctx.route(/supabase\.co/, (route) => {
    if (!/\/rpc\/mp_set_room/.test(route.request().url())) return route.abort();
    saves.push(route.request().postDataJSON());
    if (saves.length === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
  });
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  await a.waitForFunction(() => document.getElementById('mpControlledRow') && !document.getElementById('mpControlledRow').classList.contains('d-none'), null, { timeout: 15000 });
  const deadline = Date.now() + 15000;
  while (saves.length < 2 && Date.now() < deadline) await a.waitForTimeout(250);
  assert.ok(saves.length >= 2, `the failed save was tried again (${saves.length} saves)`);
  assert.deepStrictEqual(saves[1], saves[0], 'with the same record');
  // Once it's saved, an unchanged record isn't sent again.
  const settled = saves.length;
  await a.locator('body').click({ position: { x: 400, y: 300 } });
  await a.waitForTimeout(5000);
  assert.strictEqual(saves.length, settled);
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('the owner can mute and ban; a banned player stays out', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
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
  await g.waitForFunction(() => /banned from that room/.test((document.getElementById('joinStatus') || {}).textContent || ''), null, { timeout: 15000 });
  await a.waitForFunction((n) => ![...document.querySelectorAll('.mp-player-row')].some((x) => x.textContent.includes(n)), gName, { timeout: 10000 });
  // Back with the same player ID: turned away.
  const again = await stranger(ctx, server.url, r, gPid);
  await again.waitForFunction(() => /banned from that room/.test((document.getElementById('joinStatus') || {}).textContent || ''), null, { timeout: 20000 });
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('the owner gets the crown back on returning, from whoever runs the room by then', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
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

test('a public room has no owner: no crown, owner tools or controlled switch', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  assert.deepStrictEqual(await crowned(g), []);
  assert.deepStrictEqual(await crowned(a), []);
  const row = a.locator('.mp-player-row', { hasText: gName }).first();
  await row.locator('[data-sb-dropdown]').click();
  assert.strictEqual(await row.locator('[data-ban], [data-mute]').count(), 0, 'no Mute or Ban');
  assert.strictEqual(await row.locator('[data-votekick]').count(), 1, 'Votekick is still there');
  assert.strictEqual(await a.locator('#mpToggleControlled').isDisabled(), true, 'a public room can\'t be controlled');
  // Made private, the creator is the owner again.
  await a.locator('label[for=mpTogglePublic]').click();
  await g.waitForFunction(() => document.querySelector('.mp-player-row:not(.offline) .mp-crown'), null, { timeout: 10000 });
  assert.deepStrictEqual(await crowned(g), [await myName(a)]);
  assert.strictEqual(await a.locator('#mpToggleControlled').isDisabled(), false);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('with the timer off, a question that has been read waits for Next, which isn\'t a skip; the timer on starts the countdown', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  await a.evaluate(() => { const s = document.getElementById('mpSettingsRateSlider'); s.value = 100; s.dispatchEvent(new Event('change')); });
  await a.locator('label[for=mpToggleTimer]').click();
  await g.waitForFunction(() => !document.getElementById('mpToggleTimer').checked, null, { timeout: 10000 });
  await a.locator('#mpNextBtn').click();
  // Read in full: the button says Next, and nothing ends the question.
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Next' && !document.getElementById('mpRevealBox').offsetParent, null, { timeout: 60000 });
  await g.waitForTimeout(1500);
  assert.strictEqual(await g.locator('#mpRevealBox').isVisible(), false, 'still open for buzzing');
  // The timer back on: the buzz countdown runs, and the answer shows when it ends.
  await g.locator('label[for=mpToggleTimer]').click();
  await a.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Skip', null, { timeout: 10000 });
  await a.waitForFunction(() => document.getElementById('mpRevealBox').offsetParent, null, { timeout: 30000 });
  // Off again for the next question, which Next ends without "skipped".
  await g.locator('label[for=mpToggleTimer]').click();
  await a.waitForFunction(() => !document.getElementById('mpToggleTimer').checked, null, { timeout: 10000 });
  await a.locator('#mpNextBtn').click();
  await a.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Next' && !document.getElementById('mpRevealBox').offsetParent, null, { timeout: 60000 });
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => document.getElementById('mpRevealBox').offsetParent, null, { timeout: 10000 });
  assert.ok(!/skipped the question/.test(await g.locator('#mpHistory').innerText()), 'not logged as a skip');
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
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

test('whoever opens a room, and whoever joins it, sees their own "joined the game"', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const aName = await myName(a);
  await a.waitForFunction((n) => document.getElementById('mpHistory').innerText.includes(`${n} joined the game`), aName, { timeout: 10000 });
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  await g.waitForFunction((n) => document.getElementById('mpHistory').innerText.includes(`${n} joined the game`), gName, { timeout: 10000 });
  await a.waitForFunction((n) => document.getElementById('mpHistory').innerText.includes(`${n} joined the game`), gName, { timeout: 10000 });
  await ctx.close();
});

test('at the end of a set everyone is told so and stays in the room; Start plays it again', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  const alerts = { a: [], g: [] };
  a.on('dialog', (d) => alerts.a.push(d.message()));
  g.on('dialog', (d) => alerts.g.push(d.message()));
  // A two-question packet.
  const packet = await a.evaluate(() => SBPlay.packetsOf('bums-2026').findIndex((p) => p.questions.length === 2) + 1);
  assert.ok(packet > 0);
  await a.selectOption('#mpSetMode', 'set');
  await a.fill('#mpSetName', 'BUMS 2026');
  await a.locator('#mpSetName').dispatchEvent('change');
  await a.waitForTimeout(500);
  await a.evaluate((n) => { const s = document.getElementById('mpPacketSelect'); s.setMultiValues([String(n)]); s.dispatchEvent(new Event('change')); }, packet);
  await g.waitForFunction(() => /^2 questions/.test(document.getElementById('mpSettingsMatchCount').textContent), null, { timeout: 10000 });
  const press = async (key) => { await a.locator('body').click({ position: { x: 400, y: 300 } }); await a.keyboard.press(key); await a.waitForTimeout(700); };
  await a.locator('#mpNextBtn').click(); await a.waitForTimeout(700);
  for (let i = 0; i < 2; i++) { await press('s'); await press('n'); }
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Start', null, { timeout: 10000 });
  await a.waitForTimeout(300);
  assert.deepStrictEqual(alerts.a, ['You have reached the end of the set']);
  assert.deepStrictEqual(alerts.g, ['You have reached the end of the set']);
  for (const p of [a, g]) assert.ok(await p.locator('#mpGameScreen').isVisible(), 'still in the room');
  // Start plays the set again from its first question.
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => document.getElementById('mpNextBtn').textContent === 'Skip', null, { timeout: 10000 });
  assert.match(await g.locator('#mpQuestionInfo').innerText(), /^BUMS 2026 .*(Toss-up|Bonus) \d+ of \d+$/);
  await ctx.close();
});
