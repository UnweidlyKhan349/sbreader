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

test('a named room keeps its settings after everyone leaves', async () => {
  const ctx = await newContext(browser, { liveSupabase: true });
  const rooms = new Map(); // room -> { settings }
  const saves = [];
  await ctx.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const ok = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (/\/rpc\/mp_heartbeat/.test(url)) { if (!rooms.has(body.p_room)) rooms.set(body.p_room, { settings: null }); return ok(true); }
    if (/\/rpc\/mp_save_settings/.test(url)) { saves.push(body); rooms.set(body.p_room, { settings: body.p_settings }); return ok(true); }
    if (/\/rpc\/mp_room$/.test(url)) {
      const d = rooms.get(body.p_room);
      return ok(d ? { is_public: true, owner_key: null, banned: [], settings: d.settings, players: [] } : null);
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
  assert.deepStrictEqual(b.errors, []);
  await ctx.close();
});

