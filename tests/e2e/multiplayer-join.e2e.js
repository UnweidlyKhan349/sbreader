// Multiplayer, coming into a room that's already going (tests/e2e/fake-peer.js,
// as in multiplayer.e2e.js): a paused clock shows its time, the room's past
// lines are all there, skipping a paused question resumes, typing reaches
// the others straight from the player answering, and a named room's
// settings are kept for the next time it opens.
const test = require('node:test');
const assert = require('node:assert');
const { chromium, startServer, newContext, joinRoom } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

const room = () => 'e2e' + Math.random().toString(36).slice(2, 8);
const timer = (p) => p.evaluate(() => document.getElementById('mpTimerFace').textContent + document.getElementById('mpTimerFraction').textContent);
const paused = (p) => p.evaluate(() => document.getElementById('mpPauseBtn').getAttribute('aria-label') === 'Resume');
const press = async (p, k) => { await p.locator('body').click({ position: { x: 400, y: 300 } }); await p.keyboard.press(k); await p.waitForTimeout(700); };

test('someone who comes in while the clock is paused sees the time left, not 0', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await press(a, 'n');
  await press(g, ' ');
  await g.waitForSelector('#mpAnswerInput:visible');
  await g.waitForTimeout(800);
  await a.locator('#mpPauseBtn').click();
  await a.waitForTimeout(600);
  const t = await timer(a);
  assert.match(t, /^[1-9]\.\d$/, 'the answer clock stopped partway');
  const b = await joinRoom(ctx, server.url, r);
  await b.waitForTimeout(800);
  assert.strictEqual(await timer(b), t, 'the newcomer sees the same time left');
  assert.ok(await paused(b), 'and that the room is paused');
  await b.waitForTimeout(1200);
  assert.strictEqual(await timer(b), t, 'and it stays put while paused');
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

test('skipping a paused question resumes the room', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await press(a, 'n');
  await a.locator('#mpPauseBtn').click(); await a.waitForTimeout(500);
  for (const p of [a, g]) assert.ok(await paused(p));
  await press(g, 's');
  for (const p of [a, g]) assert.strictEqual(await paused(p), false, 'no longer paused');
  await press(a, 'n');
  await a.waitForTimeout(1500);
  for (const p of [a, g]) {
    const n = await p.evaluate(() => document.getElementById('mpQDisplay').textContent.length);
    assert.ok(n > 0, 'the next question reads');
  }
  assert.deepStrictEqual([...a.errors, ...g.errors], []);
  await ctx.close();
});

test('a newcomer sees the room\'s past chat, buzzes and question cards, in order', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await press(g, 'Enter'); await g.keyboard.type('first chat'); await g.keyboard.press('Enter'); await g.waitForTimeout(400);
  await press(a, 'n');
  await press(g, ' ');
  await g.waitForSelector('#mpAnswerInput:visible');
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter'); await g.waitForTimeout(700);
  await press(a, 's');
  await press(a, 'Enter'); await a.keyboard.type('second chat'); await a.keyboard.press('Enter'); await a.waitForTimeout(400);
  // The finished question's card comes up as the next one starts.
  await press(a, 'n');
  await a.waitForSelector('#mpHistory .history-card', { state: 'attached', timeout: 10000 });
  const b = await joinRoom(ctx, server.url, r);
  await b.waitForTimeout(800);
  const lines = (p) => p.evaluate(() => {
    const h = document.getElementById('mpHistory').innerText;
    return ['first chat', 'zzzz', 'second chat'].map((s) => h.indexOf(s));
  });
  const seen = await lines(b);
  assert.ok(seen.every((i) => i >= 0), `all past lines are there (${seen})`);
  // Newest first, as for everyone else.
  assert.ok(seen[2] < seen[1] && seen[1] < seen[0], `in order (${seen})`);
  assert.strictEqual(await b.locator('#mpHistory .history-card').count(), 1, 'the finished question\'s card');
  const order = (p) => p.evaluate(() => [...document.querySelectorAll('#mpHistory > li, #mpHistory > .history-card, #mpHistory > *')].map((el) => (el.classList.contains('history-card') ? 'card' : el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40))));
  assert.deepStrictEqual(await order(b), (await order(a)).slice((await order(a)).length - (await order(b)).length), 'the same lines as everyone else');
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

test('your own live answer doesn\'t jump back to older text when the runner is slow', async () => {
  const ctx = await newContext(browser, { lagMs: 250 });
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await press(a, 'n');
  await press(g, ' ');
  await g.waitForSelector('#mpAnswerInput:visible');
  // Watch g's own live line for any moment it shows less than was typed.
  await g.evaluate(() => {
    window.__shrank = false; let longest = 0;
    new MutationObserver(() => {
      const el = document.querySelector('#live-buzz .live-answer');
      const n = el ? el.textContent.length : 0;
      if (n < longest) window.__shrank = true; else longest = n;
    }).observe(document.getElementById('mpHistory'), { subtree: true, childList: true, characterData: true });
  });
  await g.keyboard.type('abcdefghij', { delay: 60 });
  await g.waitForTimeout(800);
  assert.strictEqual(await g.evaluate(() => window.__shrank), false);
  await a.waitForFunction(() => /abcdefghij/.test(document.getElementById('mpHistory').innerText), null, { timeout: 5000 });
  await ctx.close();
});

test('a named room keeps its settings after everyone leaves, and after the daily reset', async () => {
  const ctx = await newContext(browser, { liveSupabase: true });
  // As in the database: the room's record (cleared at the daily reset) and
  // its saved settings (kept 30 days) apart.
  const rooms = new Set();
  const saved = new Map();
  const saves = [];
  await ctx.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const ok = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (/\/rpc\/mp_heartbeat/.test(url)) { rooms.add(body.p_room); return ok(true); }
    if (/\/rpc\/mp_save_settings/.test(url)) { saves.push(body); saved.set(body.p_room, body.p_settings); return ok(true); }
    if (/\/rpc\/mp_saved_settings/.test(url)) return ok(saved.get(body.p_room) || null);
    if (/\/rpc\/mp_room$/.test(url)) {
      return ok(rooms.has(body.p_room) ? { is_public: true, owner_key: null, banned: [], settings: saved.get(body.p_room) || null, players: [] } : null);
    }
    if (/\/rpc\/mp_leave|\/rpc\/mp_set_room/.test(url)) return ok(null);
    if (/\/rpc\/mp_list/.test(url)) return ok([]);
    return route.abort();
  });
  const subjectOn = (page, key) => page.evaluate((k) => document.querySelector(`#mpSubjectButtons .btn-subject[data-subject="${k}"]`).classList.contains('active'), key);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  assert.strictEqual(await subjectOn(a, 'chem'), true);
  await a.locator('#mpSubjectButtons .btn-subject[data-subject="chem"]').click();
  for (let i = 0; i < 60 && !saves.length; i++) await a.waitForTimeout(100);
  assert.strictEqual(saves.length, 1, 'saved once, after the change settles');
  assert.strictEqual(saves[0].p_room, r);
  assert.ok(!saves[0].p_settings.subjects.includes('chem'));
  assert.ok(!('isPublic' in saves[0].p_settings));
  await a.close();
  // The room is empty; whoever opens it next gets the settings back.
  const b = await joinRoom(ctx, server.url, r);
  assert.strictEqual(await subjectOn(b, 'chem'), false, 'the room opens with chem still off');
  await b.close();
  // The daily reset clears the room; its settings stay.
  rooms.clear();
  const c = await joinRoom(ctx, server.url, r);
  assert.strictEqual(await subjectOn(c, 'chem'), false, 'and still after the reset');
  assert.deepStrictEqual([...b.errors, ...c.errors], []);
  await ctx.close();
});


// A newcomer's page that notes who first told it who's in the room: the
// door, or a player it asked (a knock with metadata).
async function watchedNewcomer(ctx, base, r) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.addInitScript(() => {
    window.__knocks = [];
    const wrap = () => {
      const connect = window.Peer.prototype.connect;
      window.Peer.prototype.connect = function (to, opts) {
        const c = connect.call(this, to, opts);
        c.on('data', (d) => { if (d && d.type === '__members') window.__knocks.push({ to, member: !!(opts && opts.metadata && opts.metadata.knock), at: performance.now() }); });
        return c;
      };
    };
    if (window.Peer) wrap(); else document.addEventListener('DOMContentLoaded', wrap);
  });
  const t0 = Date.now();
  await p.goto(`${base}multiplayer?room=${r}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('.mp-player-row.user-score') && /joined the game/.test(document.getElementById('mpHistory').textContent), null, { timeout: 40000 });
  p.joinMs = Date.now() - t0;
  return p;
}

test('joining doesn\'t wait on a slow player who isn\'t running the game', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  await g.evaluate(() => { window.__SLOW_MS = 8000; });
  const b = await watchedNewcomer(ctx, server.url, r);
  assert.ok(b.joinMs < 7000, `in after ${b.joinMs} ms, not after the slow link (8 s)`);
  // The slow player's link still comes up, and they hear who joined.
  await b.waitForFunction(() => document.querySelectorAll('.mp-player-row:not(.offline)').length >= 3, null, { timeout: 15000 });
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

test('a slow door doesn\'t hold up joining: the players the room list knows are asked too', async () => {
  const ctx = await newContext(browser, { liveSupabase: true });
  // "room|pid|peer" -> row (the tabs share one browser's player ID, so the
  // connection ID tells them apart here)
  const players = new Map();
  await ctx.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const ok = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (/\/rpc\/mp_heartbeat/.test(url)) {
      players.set(`${body.p_room}|${body.p_pid}|${body.p_peer}`, { pid: body.p_pid, username: body.p_username, score: 0, peer: body.p_peer || null, last_seen: new Date().toISOString() });
      return ok(true);
    }
    if (/\/rpc\/mp_room$/.test(url)) {
      const rows = [...players].filter(([k]) => k.startsWith(body.p_room + '|')).map(([, v]) => v);
      return ok(rows.length ? { is_public: true, owner_key: null, banned: [], players: rows } : null);
    }
    if (/\/rpc\/mp_saved_settings|\/rpc\/mp_leave|\/rpc\/mp_set_room|\/rpc\/mp_save_settings/.test(url)) return ok(null);
    if (/\/rpc\/mp_list/.test(url)) return ok([]);
    return route.abort();
  });
  const r = room();
  const a = await joinRoom(ctx, server.url, r);
  const g = await joinRoom(ctx, server.url, r);
  for (let i = 0; i < 50 && [...players.values()].filter((p) => p.peer).length < 2; i++) await g.waitForTimeout(100);
  assert.strictEqual([...players.values()].filter((p) => p.peer).length, 2, 'both players sent their connection IDs');
  // The door's holder (who also runs the game) is on a slow connection.
  await a.evaluate(() => { window.__SLOW_MS = 3000; });
  const b = await watchedNewcomer(ctx, server.url, r);
  const knocks = await b.evaluate(() => window.__knocks);
  assert.ok(knocks.length >= 1);
  assert.strictEqual(knocks[0].member, true, `the first answer came from a player, not the slow door (${JSON.stringify(knocks)})`);
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

// A player whose connection is slow from the start (fake-peer's __SLOW_MS,
// each way).
async function slowPlayer(ctx, base, r, slowMs) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.addInitScript((ms) => { window.__SLOW_MS = ms; }, slowMs);
  // Loaded in full, as joinRoom does: a tab still busy loading answers the
  // fake broker late, and another tab could claim the same room's door.
  await p.goto(`${base}multiplayer?room=${r}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.querySelector('.mp-player-row.user-score') && /joined the game/.test(document.getElementById('mpHistory').textContent), null, { timeout: 40000 });
  return p;
}

test('a room opened on a slow connection is handed to a better-connected player, and plays on', async () => {
  const ctx = await newContext(browser);
  const r = room();
  const role = (p) => p.evaluate(() => document.documentElement.dataset.mpRole);
  // a opens the room (so it runs the game) on a slow connection.
  const a = await slowPlayer(ctx, server.url, r, 150);
  assert.strictEqual(await role(a), 'host');
  const g = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  // Two checks in a row, 10 s apart, once everyone has reported.
  await b.waitForFunction(() => document.documentElement.dataset.mpRole === 'host', null, { timeout: 60000 })
    .catch(() => g.waitForFunction(() => document.documentElement.dataset.mpRole === 'host', null, { timeout: 30000 }));
  const roles = [await role(a), await role(g), await role(b)];
  assert.strictEqual(roles[0], 'client', `a no longer runs it (${roles})`);
  assert.strictEqual(roles.filter((x) => x === 'host').length, 1, `exactly one player does (${roles})`);
  // Nobody was told, and the game goes on: a question, a wrong buzz.
  for (const p of [a, g, b]) assert.ok(!/coordinator|handed/i.test(await p.locator('#mpHistory').innerText()));
  await press(a, 'n');
  for (const p of [g, b]) await p.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled, null, { timeout: 10000 });
  await press(g, ' ');
  await g.waitForSelector('#mpAnswerInput:visible', { timeout: 10000 });
  await g.keyboard.type('zzzz'); await g.keyboard.press('Enter');
  for (const p of [a, g, b]) await p.waitForFunction(() => /zzzz/.test(document.getElementById('mpHistory').innerText) && /Incorrect/.test(document.getElementById('mpHistory').innerText), null, { timeout: 10000 });
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

// A slow player opens the room and two fast ones join; resolves once the
// slow one has handed the game over (data-mp-role), with the pages set up
// by `before` (run in the fast players' pages before that).
async function roomAboutToHandOff(ctx, before) {
  const r = room();
  const a = await slowPlayer(ctx, server.url, r, 150);
  const g = await joinRoom(ctx, server.url, r);
  const b = await joinRoom(ctx, server.url, r);
  for (const p of [g, b]) await p.evaluate(before);
  await a.waitForFunction(() => document.documentElement.dataset.mpRole === 'client', null, { timeout: 60000 });
  return { a, g, b };
}
const roles = (ps) => Promise.all(ps.map((p) => p.evaluate(() => document.documentElement.dataset.mpRole)));
const chat = async (p, text) => { await p.locator('body').click({ position: { x: 400, y: 300 } }); await p.keyboard.press('Enter'); await p.keyboard.type(text); await p.keyboard.press('Enter'); };

test('what players send while the game changes hands isn\'t lost', async () => {
  const ctx = await newContext(browser);
  // The handoff message reaches the fast players 2.5 s late, so both send
  // their chat to the player who has just handed the game over.
  const { a, g, b } = await roomAboutToHandOff(ctx, () => { window.__DELAY_IN = (d) => (d && d.type === 'handoff' ? 2500 : 0); });
  await Promise.all([chat(g, 'hello from g'), chat(b, 'hello from b')]);
  for (const p of [a, g, b]) {
    await p.waitForFunction(() => /hello from g/.test(document.getElementById('mpHistory').innerText) && /hello from b/.test(document.getElementById('mpHistory').innerText), null, { timeout: 15000 });
  }
  const now = await roles([a, g, b]);
  assert.strictEqual(now.filter((x) => x === 'host').length, 1, `one player runs the game (${now})`);
  assert.strictEqual(now[0], 'client');
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});

test('if the player handed the game never takes it, someone else does', async () => {
  const ctx = await newContext(browser);
  // The handoff never arrives: whoever it named stays a follower.
  const { a, g, b } = await roomAboutToHandOff(ctx, () => { window.__DELAY_IN = (d) => (d && d.type === 'handoff' ? -1 : 0); });
  // After the watchdog, the next in line (the slow player, longest in the
  // room) runs it again, and the game goes on.
  await a.waitForFunction(() => document.documentElement.dataset.mpRole === 'host', null, { timeout: 15000 });
  const now = await roles([a, g, b]);
  assert.deepStrictEqual(now, ['host', 'client', 'client']);
  await press(a, 'n');
  for (const p of [g, b]) await p.waitForFunction(() => !document.getElementById('mpBuzzBtn').disabled, null, { timeout: 10000 });
  await press(b, ' ');
  await b.waitForSelector('#mpAnswerInput:visible', { timeout: 10000 });
  await b.keyboard.type('zzzz'); await b.keyboard.press('Enter');
  for (const p of [a, g, b]) await p.waitForFunction(() => /zzzz/.test(document.getElementById('mpHistory').innerText) && /Incorrect/.test(document.getElementById('mpHistory').innerText), null, { timeout: 10000 });
  assert.deepStrictEqual([...a.errors, ...g.errors, ...b.errors], []);
  await ctx.close();
});
