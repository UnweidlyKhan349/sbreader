// Accounts against an in-memory Supabase (tests/e2e/fake-supabase.js):
// answer changes reach the right row however the inserts finish, deleted
// data stays deleted, a removed star doesn't come back from an old copy,
// and the account links work on the generated set and packet pages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium, startServer, ROOT } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

const FAKE = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
async function signedIn(url, init) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  await ctx.addInitScript(FAKE);
  await ctx.route(/supabase\.min\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '/* stub: window.supabase is the fake */' }));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(server.url + (url || 'account'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.SBAccount && SBAccount.user());
  return { ctx, page };
}

test('an override made before the answer is saved still reaches that answer', async () => {
  const { ctx, page } = await signedIn('account', { fn: () => { window.__INSERT_DELAYS = [600]; }, arg: null });
  const rows = await page.evaluate(async () => {
    SBAccount.recordAnswer({ id: 7, subject: 'bio' }, 'incorrect', 'solo');
    SBAccount.updateLastAnswer('correct'); // the insert hasn't come back yet
    await new Promise((r) => setTimeout(r, 1000));
    return __db.answers.map((r) => [r.question_id, r.result]);
  });
  assert.deepStrictEqual(rows, [[7, 'correct']]);
  await ctx.close();
});

test('with inserts finishing out of order, an override changes the current question, not the previous one', async () => {
  const { ctx, page } = await signedIn('account', { fn: () => { window.__INSERT_DELAYS = [700, 50]; }, arg: null });
  const rows = await page.evaluate(async () => {
    SBAccount.recordAnswer({ id: 1 }, 'incorrect', 'solo');
    SBAccount.recordAnswer({ id: 2 }, 'incorrect', 'solo');
    await new Promise((r) => setTimeout(r, 900)); // question 1's insert finishes last
    SBAccount.updateLastAnswer('correct');
    await new Promise((r) => setTimeout(r, 300));
    return __db.answers.sort((a, b) => a.question_id - b.question_id).map((r) => [r.question_id, r.result]);
  });
  assert.deepStrictEqual(rows, [[1, 'incorrect'], [2, 'correct']]);
  await ctx.close();
});

test('Delete my data clears this browser\'s stars too, so the next login doesn\'t restore them', async () => {
  const { ctx, page } = await signedIn('account');
  const after = await page.evaluate(async () => {
    SBData.bookmarks.toggle ? SBData.bookmarks.toggle(17) : SBData.bookmarks.replaceAll([17]);
    await new Promise((r) => setTimeout(r, 200));
    await SBAccount.deleteMyData();
    return { remote: __db.bookmarks.length, local: [...SBData.bookmarks.getAll()] };
  });
  assert.deepStrictEqual(after, { remote: 0, local: [] });
  // Log in again in a new tab of the same browser.
  const again = await ctx.newPage();
  await again.goto(server.url + 'account', { waitUntil: 'load' });
  await again.waitForFunction(() => window.SBAccount && SBAccount.user());
  await again.waitForTimeout(500);
  assert.deepStrictEqual(await again.evaluate(() => [...SBData.bookmarks.getAll()]), []);
  await ctx.close();
});

test('a star removed on another device stays removed when this device logs in with its older copy', async () => {
  // This device synced {5, 6} earlier; since then the account dropped 6
  // (removed elsewhere) and gained 8; this device starred 9 offline.
  const seed = () => {
    localStorage.setItem('sb_bookmarks_synced_user-1', '[5,6]');
    window.__db = { answers: [], user_settings: [], bookmarks: [{ user_id: 'user-1', question_id: 5 }, { user_id: 'user-1', question_id: 8 }] };
  };
  const { ctx, page } = await signedIn('account', { fn: (s) => { eval(s)(); }, arg: `(${seed})` });
  await page.evaluate(() => { SBData.bookmarks.replaceAll([5, 6, 9]); });
  // Sync runs at login; reload so it runs with the seeded local stars.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ local: [...SBData.bookmarks.getAll()].sort((a, b) => a - b), remote: __db.bookmarks.map((b) => b.question_id).sort((a, b) => a - b) }));
  assert.deepStrictEqual(r, { local: [5, 8, 9], remote: [5, 8, 9] });
  await ctx.close();
});

test('account links on a generated packet page point at the site root', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window.__signedOut = true; });
  await ctx.addInitScript(FAKE);
  await ctx.route(/supabase\.min\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const { fillTemplate } = require('../../tools/build-pages.js');
  const html = fillTemplate(fs.readFileSync(path.join(ROOT, 'packet.html'), 'utf8'), { title: 't', description: 'd', urlPath: 'sets/demo/1', data: { set: 'lost-3-hs', packet: 1 }, body: '' });
  await ctx.route(/\/sets\/demo\/1$/, (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  await page.goto(server.url + 'sets/demo/1', { waitUntil: 'load' });
  await page.waitForSelector('#login-link', { state: 'attached', timeout: 15000 });
  assert.strictEqual(await page.getAttribute('#login-link', 'href'), server.url + 'login');
  await ctx.close();
});
