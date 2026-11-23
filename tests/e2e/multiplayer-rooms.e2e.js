// Multiplayer, rooms (tests/e2e/fake-peer.js, as in multiplayer.e2e.js):
// room owners (crown, ban), Allow skips, room links
// and joining from the lobby, join messages, and the end of a set.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, joinRoom, openPage } = require('./helpers');

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

// Waits until a player row on page p shows the given score.
const waitScore = (p, name, want) => p.waitForFunction(([n, w]) => [...document.querySelectorAll('.mp-player-row')]
  .some((x) => x.querySelector('span') && x.querySelector('span').textContent.trim() === n && Number(x.querySelector('.badge').textContent) === w), [name, want], { timeout: 10000 });

test('the room\'s creator has a crown; everyone can change the settings', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  const aName = await myName(a);
  assert.deepStrictEqual(await crowned(g), [aName], 'only the creator is crowned, on everyone\'s list');
  assert.strictEqual(await g.locator('#mpToggleControlled').count(), 0, 'there are no controlled rooms');
  assert.strictEqual(await g.locator('#mpRoomSettings').evaluate((x) => x.disabled), false);
  // A player who isn't the owner changes the settings for everyone.
  const before = await subjectOn(a, 'chem');
  await g.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  await a.waitForFunction((was) => document.querySelector('#mpSubjectButtons .btn-subject[data-subject="chem"]').classList.contains('active') !== was, before, { timeout: 10000 });
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

test('a permanent room says some settings are restricted', async () => {
  const ctx = await newContext(browser);
  const a = await openPage(ctx, `${server.url}multiplayer?lobby=bio`);
  await a.waitForFunction(() => document.getElementById('mpPermanentNote') && !document.getElementById('mpPermanentNote').classList.contains('d-none'), null, { timeout: 40000 });
  assert.strictEqual(await a.locator('#mpPermanentNote').innerText(), 'This is a permanent room. Some settings have been restricted.');
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('Clear stats zeroes your own score for the room', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  // A wrong buzz while the question is read: -4.
  await a.locator('#mpNextBtn').click();
  await g.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled, null, { timeout: 15000 });
  await g.locator('#mpBuzzBtn').click();
  await g.waitForFunction(() => !document.getElementById('mpAnswerRow').classList.contains('d-none'), null, { timeout: 10000 });
  await g.locator('#mpAnswerInput').fill('zzzz not it');
  await g.keyboard.press('Enter');
  const score = (p, name) => p.evaluate((n) => {
    const row = [...document.querySelectorAll('.mp-player-row')].find((x) => x.textContent.includes(n));
    return row ? Number(row.querySelector('.badge').textContent) : NaN;
  }, name);
  await a.waitForFunction((n) => [...document.querySelectorAll('.mp-player-row')].some((x) => x.textContent.includes(n) && x.querySelector('.badge').textContent === '-4'), gName, { timeout: 10000 });
  await g.locator('#mpClearStats').click();
  await a.waitForFunction(() => /cleared their stats/.test(document.getElementById('mpHistory').textContent), null, { timeout: 10000 });
  await g.waitForTimeout(300);
  assert.strictEqual(await score(a, gName), 0, 'the score is back to zero for everyone');
  assert.strictEqual(await score(g, gName), 0);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
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
  await a.waitForFunction(() => document.querySelector('.mp-player-row:not(.offline) .mp-crown'), null, { timeout: 15000 });
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

test('the owner can ban: the player sees why in a dialog, OK goes to the Multiplayer page, and they stay out; there is no Mute', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, privateRoom(r));
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  const gPid = await g.evaluate(() => localStorage.getItem('sb_mp_pid'));
  assert.ok(!(await g.locator('.mp-player-row', { hasText: await myName(a) }).first().locator('[data-ban]').count()), 'only the owner has Ban');
  // The menu as QB Reader's: a yellow Votekick and a red Ban, no Mute.
  const gRow = a.locator('.mp-player-row', { hasText: gName }).first();
  await gRow.locator('[data-sb-dropdown]').click();
  assert.deepStrictEqual(await gRow.locator('.dropdown-menu button').evaluateAll((bs) => bs.map((b) => `${b.textContent}:${b.className}`)),
    ['Votekick:btn btn-warning btn-sm mt-2 me-1 dropdown-item', 'Ban:btn btn-danger btn-sm mt-2 me-1 dropdown-item']);
  await gRow.locator('[data-sb-dropdown]').click();
  // Ban asks first, in a dialog on the page: Cancel leaves the player in.
  await ownerMenu(a, gName, 'ban');
  await a.waitForSelector('#confirm-modal.show');
  assert.match(await a.textContent('#confirm-modal-text'), /^Ban .+ from this room\? They won't be able to come back\.$/);
  await a.click('#confirm-modal-cancel');
  await a.waitForSelector('#confirm-modal', { state: 'hidden' });
  await a.waitForTimeout(500);
  assert.ok(await a.locator('.mp-player-row', { hasText: gName }).count(), 'still in the room after Cancel');
  await ownerMenu(a, gName, 'ban');
  await a.click('#confirm-modal-ok');
  // As on QB Reader: a dialog says why, and OK goes to the Multiplayer page.
  await g.waitForSelector('#alert-modal.show', { timeout: 15000 });
  assert.strictEqual(await g.textContent('#alert-modal-text'), 'You were banned from this room by the room owner.');
  await Promise.all([g.waitForURL(/\/multiplayer$/, { timeout: 15000 }), g.click('#alert-modal-close')]);
  await a.waitForFunction((n) => ![...document.querySelectorAll('.mp-player-row')].some((x) => x.textContent.includes(n)), gName, { timeout: 10000 });
  // Back with the same player ID: turned away, with the same kind of dialog.
  const again = await stranger(ctx, server.url, r, gPid);
  await again.waitForSelector('#alert-modal.show', { timeout: 20000 });
  assert.strictEqual(await again.textContent('#alert-modal-text'), 'You were banned from this room by the room owner, and cannot rejoin it.');
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

test('a public room has no owner: no crown or owner tools', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  const gName = await myName(g);
  assert.deepStrictEqual(await crowned(g), []);
  assert.deepStrictEqual(await crowned(a), []);
  const row = a.locator('.mp-player-row', { hasText: gName }).first();
  await row.locator('[data-sb-dropdown]').click();
  assert.strictEqual(await row.locator('[data-ban]').count(), 0, 'no Ban');
  assert.strictEqual(await row.locator('[data-votekick]').count(), 1, 'Votekick is still there');
  // Made private, the creator is the owner again.
  await a.locator('label[for=mpTogglePublic]').click();
  await g.waitForFunction(() => document.querySelector('.mp-player-row:not(.offline) .mp-crown'), null, { timeout: 10000 });
  assert.deepStrictEqual(await crowned(g), [await myName(a)]);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('the timer is always on: there is no Enable timer switch, and a read question\'s buzz countdown runs out to the answer', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  assert.strictEqual(await a.locator('#mpToggleTimer').count(), 0);
  await a.evaluate(() => { const s = document.getElementById('mpSettingsRateSlider'); s.value = 100; s.dispatchEvent(new Event('change')); });
  await a.locator('#mpNextBtn').click();
  await a.waitForFunction(() => document.getElementById('mpRevealBox').offsetParent, null, { timeout: 60000 });
  assert.ok(!/skipped the question/.test(await a.locator('#mpHistory').innerText()), 'not logged as a skip');
  assert.deepStrictEqual(a.errors, []);
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


test('the lobby\'s active player count stays right as players come and go', async () => {
  // A room list in memory: heartbeats mark a player online, mp_leave marks
  // them offline, mp_list counts. Everything else bound for Supabase is
  // turned away, as in the other tests.
  const ctx = await newContext(browser, { liveSupabase: true });
  const online = new Map(); // "room|pid" -> true while online
  const leaves = [];
  await ctx.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const ok = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (/\/rpc\/mp_heartbeat/.test(url)) { online.set(`${body.p_room}|${body.p_pid}`, true); return ok(true); }
    if (/\/rpc\/mp_leave/.test(url)) { leaves.push(body); online.delete(`${body.p_room}|${body.p_pid}`); return ok(null); }
    if (/\/rpc\/mp_room$/.test(url)) return ok(null);
    if (/\/rpc\/mp_list/.test(url)) {
      const rooms = new Map();
      online.forEach((v, k) => { const name = k.split('|')[0]; rooms.set(name, (rooms.get(name) || 0) + 1); });
      return ok([...rooms].map(([name, n]) => ({ name, is_public: true, is_permanent: false, players: n, online: n })));
    }
    return route.abort();
  });
  const summary = (p) => p.locator('#activeSummary').textContent();
  const lobby = await openPage(ctx, `${server.url}multiplayer`);
  await lobby.waitForFunction(() => /active rooms?\.$/.test(document.getElementById('activeSummary').textContent), null, { timeout: 10000 });
  assert.strictEqual(await summary(lobby), 'There are 0 active players in 0 active rooms.');
  // Someone comes in: the open lobby picks it up within its 15 seconds.
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  await lobby.waitForFunction(() => document.getElementById('activeSummary').textContent === 'There is 1 active player in 1 active room.', null, { timeout: 20000 });
  // They close the tab: marked offline at once, and the lobby goes back to 0.
  // (The test's fake list can't see a request sent as a page unloads, though
  // browsers send it, so the page's goodbye is fired before it closes.)
  await a.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  for (let i = 0; i < 40 && !leaves.length; i++) await a.waitForTimeout(50);
  await a.close();
  await lobby.waitForFunction(() => document.getElementById('activeSummary').textContent === 'There are 0 active players in 0 active rooms.', null, { timeout: 20000 });
  assert.strictEqual(leaves.length, 1);
  assert.strictEqual(leaves[0].p_room, r);
  // Back to the lobby from a room: the lobby that loads doesn't count them.
  const b = await openPage(ctx, `${server.url}multiplayer`);
  await b.locator('#permanentRoomList a').first().click();
  await b.waitForFunction(() => document.querySelector('.mp-player-row.user-score'), null, { timeout: 40000 });
  await lobby.waitForFunction(() => document.getElementById('activeSummary').textContent === 'There is 1 active player in 1 active room.', null, { timeout: 20000 });
  await Promise.all([b.waitForEvent('load', { timeout: 15000 }), b.goBack()]);
  await b.waitForFunction(() => /active rooms?\.$/.test(document.getElementById('activeSummary').textContent), null, { timeout: 10000 });
  assert.strictEqual(await summary(b), 'There are 0 active players in 0 active rooms.');
  assert.deepStrictEqual(lobby.errors, []);
  await ctx.close();
});

test('an answer on an earlier question can be claimed later: I was right on its line, for everyone, and taken back', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r); // its own player ID
  const gName = await g.evaluate(() => document.getElementById('mpUsername').value);
  await a.locator('#mpNextBtn').click(); await a.waitForTimeout(1200);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' '); await g.waitForTimeout(400);
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(600);
  await a.keyboard.press('s'); await a.waitForTimeout(1200);
  // On to the next question: the first is past.
  await a.locator('body').click({ position: { x: 400, y: 300 } });
  await a.keyboard.press('n'); await a.waitForTimeout(1200);
  const scoreOf = (p) => p.$$eval('.mp-player-row', (rows, n) => {
    const row = rows.find((x) => x.querySelector('span') && x.querySelector('span').textContent.trim() === n);
    return row ? row.querySelector('.badge').textContent : 'NaN';
  }, gName);
  const before = Number(await scoreOf(a));
  const pastLink = g.locator('#mpHistory .mp-past-override');
  await g.waitForSelector('#mpHistory .mp-past-override', { timeout: 10000 });
  assert.strictEqual(await pastLink.innerText(), 'I was right');
  assert.strictEqual(await a.locator('#mpHistory .mp-past-override').count(), 0, 'only on your own answers');
  await pastLink.click();
  // (no line in the history for it: the score and the line's colour show it)
  await waitScore(a, gName, 4);
  // zzzz was 0 (after the reading) or -4 (an interrupt); right, it's +4
  assert.strictEqual(Number(await scoreOf(a)), 4, 'the score follows');
  const lineColour = (p) => p.$$eval('#mpHistory li[data-buzz-q]', (ls) => ls.map((l) => (l.querySelector('.badge.bg-success') ? 'green' : 'red')).join(' '));
  assert.strictEqual(await lineColour(a), 'green');
  await g.waitForFunction(() => document.querySelector('#mpHistory .mp-past-override') && document.querySelector('#mpHistory .mp-past-override').textContent === 'I was wrong', null, { timeout: 5000 });
  await g.locator('#mpHistory .mp-past-override').click();
  await waitScore(a, gName, before);
  assert.strictEqual(await lineColour(a), 'red');
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('"I was right" on an earlier question someone else got takes it from them (no penalty), and gives it back when undone', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  const [aName, gName] = [await myName(a), await myName(g)];
  await a.locator('#mpNextBtn').click(); await a.waitForTimeout(1200);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' '); await g.waitForTimeout(400);
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(600);
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
  await a.keyboard.type(answer); await a.keyboard.press('Enter'); await a.waitForTimeout(1000);
  // (by the exact name: the second player is often "Name 2")
  const score = (p, name) => p.$$eval('.mp-player-row', (rows, n) => {
    const row = rows.find((x) => x.querySelector('span') && x.querySelector('span').textContent.trim() === n);
    return row ? Number(row.querySelector('.badge').textContent) : NaN;
  }, name);
  const gBefore = await score(a, gName);
  assert.strictEqual(await score(a, aName), 4);
  // Next question: the first is past.
  await a.locator('body').click({ position: { x: 400, y: 300 } });
  await a.keyboard.press('n'); await a.waitForTimeout(1200);
  await g.waitForSelector('#mpHistory .mp-past-override', { timeout: 10000 });
  await g.locator('#mpHistory .mp-past-override').click();
  await a.waitForFunction(() => /was marked incorrect on an earlier question/.test(document.getElementById('mpHistory').textContent), null, { timeout: 10000 });
  assert.strictEqual(await score(a, aName), 0, 'no points, and no penalty');
  assert.strictEqual(await score(a, gName), 4);
  assert.ok(gBefore === 0 || gBefore === -4);
  // The other player can still say they were right: they take it back.
  await a.waitForSelector('#mpHistory .mp-past-override', { timeout: 5000 });
  assert.strictEqual(await a.locator('#mpHistory .mp-past-override').innerText(), 'I was right');
  await a.locator('#mpHistory .mp-past-override').click();
  await waitScore(a, aName, 4);
  assert.strictEqual(await score(a, aName), 4);
  assert.strictEqual(await score(a, gName), 0, 'taken from the guest, without a penalty');
  // and give it back
  await a.locator('#mpHistory .mp-past-override').click();
  await waitScore(a, gName, 4); // the guest has it again
  // ("I was wrong" on a buzz made during the reading is an interrupt, -4)
  const aWrong = await score(a, aName);
  assert.ok(aWrong === 0 || aWrong === -4, String(aWrong));
  // The guest gives it up too: back to their own wrong answer.
  await g.locator('#mpHistory .mp-past-override').click();
  await waitScore(a, gName, gBefore);
  assert.strictEqual(await score(a, aName), aWrong);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('a permanent room\'s link is ?room=general, and Clear all filters there turns on every subject', async () => {
  const ctx = await newContext(browser);
  const a = await openPage(ctx, `${server.url}multiplayer?room=general`);
  await a.waitForFunction(() => document.getElementById('mpPermanentNote') && !document.getElementById('mpPermanentNote').classList.contains('d-none'), null, { timeout: 40000 });
  assert.match(a.url(), /\?room=general$/);
  assert.strictEqual(await subjectOn(a, 'energy'), false, 'General starts without Energy');
  await a.evaluate(() => document.getElementById('mpClearFilters').click());
  await a.waitForFunction(() => [...document.querySelectorAll('#mpSubjectButtons .btn-subject')].every((b) => b.classList.contains('active')), null, { timeout: 10000 });
  assert.deepStrictEqual(a.errors, []);
  await ctx.close();
});

test('a buzz during the reading is an Interrupt; changing the subjects again edits the last line', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await strangerIn(ctx, server.url, r);
  await a.locator('#mpNextBtn').click(); await a.waitForTimeout(1200);
  await g.locator('body').click({ position: { x: 400, y: 300 } });
  await g.keyboard.press(' ');
  await a.waitForSelector('#live-buzz', { timeout: 10000 });
  assert.strictEqual(await a.locator('#live-buzz .badge').first().innerText(), 'Interrupt');
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(600);
  const lines = (p) => p.$$eval('#mpHistory li i', (xs) => xs.map((x) => x.textContent.trim()).filter((t) => /changed the subjects|turned on every subject/.test(t)));
  await g.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  await a.waitForFunction(() => /changed the subjects|turned on every subject/.test(document.getElementById('mpHistory').textContent), null, { timeout: 10000 });
  const first = (await lines(a))[0];
  await g.locator('#mpSubjectButtons .btn-subject[data-subject="bio"]').click();
  await a.waitForFunction((was) => [...document.querySelectorAll('#mpHistory li i')].some((x) => /changed the subjects|turned on every subject/.test(x.textContent) && x.textContent.trim() !== was), first, { timeout: 10000 });
  await g.waitForTimeout(500);
  assert.strictEqual((await lines(a)).length, 1, 'one line, edited');
  assert.strictEqual((await lines(g)).length, 1);
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});
