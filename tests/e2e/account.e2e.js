// Accounts against an in-memory Supabase (tests/e2e/fake-supabase.js):
// answer changes reach the right row however the inserts finish, deleted
// data stays deleted, a removed star doesn't come back from an old copy,
// and the account links work on the generated set and packet pages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium, startServer, routeCdn, ROOT } = require('./helpers');

let server; let browser;
test.before(async () => { server = await startServer(); browser = await chromium.launch(); });
test.after(async () => { await browser.close(); await server.close(); });

const FAKE = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
async function signedIn(url, init) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await routeCdn(ctx);
  if (init) await ctx.addInitScript(init.fn, init.arg);
  await ctx.addInitScript(FAKE);
  await ctx.route(/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '/* stub: window.supabase is the fake */' }));
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

test('more bookmarks than the server returns at once are all read, and none is taken for deleted', async () => {
  // 1,001 stars on both sides and at the last sync; the server hands back
  // at most 300 rows a request (less than the site asks for).
  const seed = () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    window.__MAX_ROWS = 300;
    localStorage.setItem('sb_bookmarks_synced_user-1', JSON.stringify(ids));
    window.__db = { answers: [], user_settings: [], bookmarks: ids.map((id) => ({ user_id: 'user-1', question_id: id })) };
  };
  const { ctx, page } = await signedIn('account', { fn: (s) => { eval(s)(); }, arg: `(${seed})` });
  await page.evaluate(() => { SBData.bookmarks.replaceAll(Array.from({ length: 1001 }, (_, i) => i + 1)); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ local: SBData.bookmarks.getAll().size ?? [...SBData.bookmarks.getAll()].length, remote: __db.bookmarks.length, has1001: [...SBData.bookmarks.getAll()].includes(1001) }));
  assert.deepStrictEqual(r, { local: 1001, remote: 1001, has1001: true });
  await ctx.close();
});

test('account links on a generated packet page point at the site root', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await routeCdn(ctx);
  await ctx.addInitScript(() => { window.__signedOut = true; });
  await ctx.addInitScript(FAKE);
  await ctx.route(/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
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

// The account pages laid out as QB Reader's: stats tables, graphs, starred
// questions, and the profile and password forms.
const day = (d, h) => new Date(2026, 10, d, h || 12).toISOString();
const seedStats = () => {
  const row = (id, question_id, result, points, celerity, subject, qtype, tournament, mode, created_at) => ({ id, user_id: 'user-1', question_id, result, points, celerity, subject, qtype, format: 'SA', tournament, mode, created_at });
  const d = (n, h) => new Date(2026, 10, n, h || 12).toISOString();
  window.__db = { user_settings: [], bookmarks: [], answers: [
    row(1, 101, 'correct', 4, 0.8, 'phys', 'tossup', 'MIT 2023', 'solo', d(1)),
    row(2, 102, 'incorrect', -4, 0.5, 'phys', 'tossup', 'MIT 2023', 'mp', d(1, 13)),
    row(3, 103, 'incorrect', 0, 0, 'bio', 'tossup', 'LOST 3 MS', 'solo', d(2)),
    row(4, 104, 'skipped', 0, null, 'bio', 'tossup', 'LOST 3 MS', 'solo', d(2, 13)),
    row(5, 105, 'correct', 4, 0.2, 'bio', 'tossup', 'LOST 3 MS', 'solo', d(3)),
    row(6, 106, 'correct', 4, 0.9, 'bio', 'bonus', 'LOST 3 MS', 'solo', d(3, 13)),
  ] };
};
const withStats = (url) => signedIn(url, { fn: (s) => { eval(s)(); }, arg: `(${seedStats})` });
const cells = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

test('stats: a line per subject and a Total for tossups and bonuses together, filters, sorting', async () => {
  const { ctx, page } = await withStats('stats');
  await page.waitForSelector('#subject-stats tbody tr');
  assert.deepStrictEqual(await cells(page, '#subject-stats thead th'), ['Subject', 'Heard', '4', '0', '-4', 'Celerity', 'Points', 'PPQ']);
  assert.deepStrictEqual(await cells(page, '#subject-stats tbody tr:nth-child(1) > *'), ['Biology', '4', '2', '1', '0', '0.550', '8', '2.00']);
  assert.deepStrictEqual(await cells(page, '#subject-stats tbody tr:nth-child(2) > *'), ['Physics', '2', '1', '0', '1', '0.800', '0', '0.00']);
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '6', '3', '1', '1', '0.633', '8', '1.33']);
  // Tossups alone, then bonuses alone.
  await page.uncheck('#include-bonuses');
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '5', '2', '1', '1', '0.500', '4', '0.80']);
  await page.check('#include-bonuses');
  await page.uncheck('#include-tossups');
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '1', '1', '0', '0', '0.900', '4', '4.00']);
  await page.check('#include-tossups');
  // Singleplayer only: the multiplayer neg goes.
  await page.uncheck('#include-multiplayer');
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '5', '3', '1', '0', '0.633', '12', '2.40']);
  await page.check('#include-multiplayer');
  // One set, by name.
  await page.fill('#set-name', 'MIT 2023');
  await page.click('#form button[type=submit]');
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '2', '1', '0', '1', '0.800', '0', '0.00']);
  await page.fill('#set-name', '');
  await page.click('#form button[type=submit]');
  // The Set tab, sorted by name when its heading is clicked.
  await page.click('#set-tab');
  assert.strictEqual(await page.isVisible('#set-stats'), true);
  assert.strictEqual(await page.isVisible('#subject-stats'), false);
  await page.click('#set-stats thead th:first-child');
  assert.deepStrictEqual(await cells(page, '#set-stats tbody th'), ['LOST 3 MS', 'MIT 2023']);
  await page.click('#set-stats thead th:first-child');
  assert.deepStrictEqual(await cells(page, '#set-stats tbody th'), ['MIT 2023', 'LOST 3 MS']);
  // Best Buzz: the right answer with the highest celerity.
  await page.click('#best-buzz-tab');
  await page.waitForFunction(() => /Celerity: 0\.900/.test(document.getElementById('best-buzz').textContent));
  // The CSV holds every answer.
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('#download-stats-csv')]);
  assert.strictEqual(file.suggestedFilename(), 'stats.csv');
  const csv = fs.readFileSync(await file.path(), 'utf8').trim().split('\n');
  assert.strictEqual(csv.length, 7);
  assert.match(csv[1], /,106,LOST 3 MS,ms,bio,bonus,SA,false,correct,0\.9,4$/);

  // An old link to the bonus stats opens with only bonuses switched on.
  await page.goto(server.url + 'stats?type=bonus', { waitUntil: 'load' });
  await page.waitForSelector('#subject-stats tbody tr');
  assert.strictEqual(await page.isChecked('#include-tossups'), false);
  assert.deepStrictEqual(await cells(page, '#subject-stats tfoot th'), ['Total', '1', '1', '0', '0', '0.900', '4', '4.00']);
  await ctx.close();
});

test('graphs plot a point per day, leaving out thin days until the switch is turned off', async () => {
  const { ctx, page } = await withStats('graphs');
  await page.waitForFunction(() => !document.getElementById('graphNote').hidden);
  assert.match(await page.textContent('#graphNote'), /No day has 5 or more questions/);
  await page.uncheck('#filter');
  const points = () => page.evaluate(() => Chart.getChart('question-count').data.datasets.map((d) => [d.label, d.data.map((p) => p.y)]));
  assert.deepStrictEqual(await points(), [['Total', [2, 2, 2]], ['4s', [1, 0, 2]], ['0s', [0, 1, 0]], ['Dead', [0, 1, 0]], ['Negs', [1, 0, 0]]]);
  await page.check('#cumulative');
  assert.deepStrictEqual((await points())[0], ['Total', [2, 4, 6]]);
  assert.deepStrictEqual(await page.evaluate(() => Chart.getChart('ppq').data.datasets[0].data.map((p) => p.y)), [0, 0, 4]);
  // Tossups alone: the bonus leaves the third day.
  await page.uncheck('#include-bonuses');
  assert.deepStrictEqual((await points())[0], ['Total', [2, 4, 5]]);
  // Every chart is a modest height, on a phone too.
  const heights = () => page.$$eval('.chart-box', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.deepStrictEqual(await heights(), [280, 280, 280, 280]);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('statsBody').hidden);
  assert.deepStrictEqual(await heights(), [220, 220, 220, 220]);
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await ctx.close();
});

test('answers are saved with their points and celerity, and without on a project that has no such columns yet', async () => {
  const { ctx, page } = await signedIn('account');
  const rows = await page.evaluate(async () => {
    SBAccount.recordAnswer({ id: 7, qtype: 'tossup' }, 'incorrect', 'solo', { points: -4, celerity: 0.61234 });
    SBAccount.updateLastAnswer('correct', { points: 4, celerity: 0.61234 });
    SBAccount.recordAnswer({ id: 8, qtype: 'tossup' }, 'skipped', 'solo', { points: 0, celerity: null });
    await new Promise((r) => setTimeout(r, 300));
    return __db.answers.map((r) => [r.question_id, r.result, r.points, r.celerity]);
  });
  assert.deepStrictEqual(rows, [[7, 'correct', 4, 0.612], [8, 'skipped', 0, null]]);
  await ctx.close();

  const old = await signedIn('account', { fn: () => { window.__OLD_ANSWERS = true; }, arg: null });
  const saved = await old.page.evaluate(async () => {
    SBAccount.recordAnswer({ id: 9, qtype: 'tossup' }, 'correct', 'solo', { points: 4, celerity: 0.5 });
    await new Promise((r) => setTimeout(r, 300));
    return __db.answers.map((r) => [r.question_id, r.result, 'points' in r]);
  });
  assert.deepStrictEqual(saved, [[9, 'correct', false]]);
  await old.ctx.close();
});

test('starred tossups and bonuses are listed together, and Clear unstars them all', async () => {
  // Two tossups and a bonus from one packet.
  const packet = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bank', 'lost-3-ms.json'), 'utf8'))[0].q;
  const tossups = packet.filter((q) => q.qt === 'tossup').slice(0, 2).map((q) => q.i);
  const bonus = packet.find((q) => q.qt === 'bonus').i;
  const all = [...tossups, bonus].sort((a, b) => a - b);
  const { ctx, page } = await signedIn('stars', { fn: (ids) => { localStorage.setItem('sb_bookmarks_v1', JSON.stringify(ids)); }, arg: all });
  await page.waitForSelector('#question-list .q-card');
  assert.strictEqual(await page.locator('#question-list .q-card').count(), 3);
  assert.strictEqual(await page.textContent('#clear-starred'), 'Clear Starred Questions');
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('#download-questions-json')]);
  assert.strictEqual(file.suggestedFilename(), 'starred-questions.json');
  const saved = JSON.parse(fs.readFileSync(await file.path(), 'utf8')).questions;
  assert.deepStrictEqual(saved.map((q) => q.id).sort((a, b) => a - b), all);
  assert.deepStrictEqual(saved.map((q) => q.type).sort(), ['bonus', 'tossup', 'tossup']);
  await page.click('#clear-starred');
  await page.click('#confirm');
  await page.waitForFunction(() => /You have no starred questions/.test(document.getElementById('question-list').textContent));
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await page.evaluate(() => ({ local: [...SBData.bookmarks.getAll()], remote: __db.bookmarks.map((b) => b.question_id) })), { local: [], remote: [] });
  await ctx.close();
});

test('the account page welcomes you, and the profile and password forms save', async () => {
  const { ctx, page } = await signedIn('account');
  await page.waitForSelector('#acctLoggedIn:not([hidden])');
  assert.strictEqual((await page.textContent('#acctLoggedIn .display-5')).trim(), 'Welcome, Tester!');
  assert.strictEqual(await page.textContent('#email-verified'), 'Email verified');
  assert.deepStrictEqual(await page.$$eval('#acctLoggedIn .card a', (as) => as.map((a) => a.getAttribute('href'))), ['stats', 'graphs', 'stars']);

  await page.click('a[href="edit-profile"]');
  await page.waitForSelector('#profile-form');
  await page.waitForFunction(() => document.getElementById('username').value === 'Tester');
  await page.fill('#username', 'Quark');
  await page.click('#submission');
  await page.waitForFunction(() => /Profile saved\.$/.test(document.getElementById('acctMsgIn').textContent));
  assert.deepStrictEqual(await page.evaluate(() => window.__authUpdates), [{ data: { username: 'Quark' } }]);

  await page.goto(server.url + 'edit-password', { waitUntil: 'load' });
  await page.waitForSelector('#acctLoggedIn:not([hidden])');
  await page.fill('#old-password', 'not-it');
  await page.fill('#new-password', 'new-password-1');
  await page.fill('#confirm-password', 'new-password-1');
  await page.click('#submission');
  await page.waitForFunction(() => /current password is incorrect/.test(document.getElementById('acctMsgIn').textContent));
  assert.strictEqual(await page.evaluate(() => window.__authUpdates), undefined);
  await page.fill('#old-password', 'old-password');
  await page.fill('#confirm-password', 'different');
  await page.click('#submission');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => window.__authUpdates), undefined, 'mismatched passwords are not saved');
  await page.fill('#confirm-password', 'new-password-1');
  await page.click('#submission');
  await page.waitForFunction(() => /Password changed/.test(document.getElementById('acctMsgIn').textContent));
  assert.deepStrictEqual(await page.evaluate(() => window.__authUpdates), [{ password: 'new-password-1' }]);
  await ctx.close();
});

test('Best Buzz marks where you buzzed in the question', async () => {
  // A real multiple-choice tossup, buzzed on with 60% of it still to read.
  const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bank', 'lost-3-ms.json'), 'utf8'))[0].q.find((x) => x.qt === 'tossup' && x.c);
  const seed = (id) => {
    window.__db = { user_settings: [], bookmarks: [], answers: [
      { id: 1, user_id: 'user-1', question_id: id, result: 'correct', points: 4, celerity: 0.6, subject: 'phys', qtype: 'tossup', format: 'MC', tournament: 'LOST 3 MS', mode: 'solo', created_at: new Date(2026, 10, 1, 12).toISOString() },
    ] };
  };
  const { ctx, page } = await signedIn('stats', { fn: ({ s, id }) => { eval(s)(id); }, arg: { s: `(${seed})`, id: q.i } });
  await page.click('#best-buzz-tab');
  await page.waitForSelector('#best-buzz .q-card .buzz-marker');
  assert.strictEqual(await page.locator('#best-buzz .q-card .buzz-marker').count(), 1);
  // The mark is part-way through: text on both sides of it, in the card's body.
  const around = await page.evaluate(() => {
    const body = document.querySelector('#best-buzz .q-card .card-body');
    const all = body.querySelector('.q-text').textContent + ' ' + (body.querySelector('.choices') || { textContent: '' }).textContent;
    const [before, after] = all.split('(#)');
    return { before: before.trim().length, after: after.trim().length };
  });
  assert.ok(around.before > 10 && around.after > 10, JSON.stringify(around));
  // Recent answers aren't marked.
  await page.click('#recent-tab');
  await page.waitForSelector('#recent .q-card');
  assert.strictEqual(await page.locator('#recent .buzz-marker').count(), 0);
  await ctx.close();
});

test('signing up with an email that already has an account says so; a reset says the link was sent', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await routeCdn(ctx);
  await ctx.addInitScript(() => { window.__signedOut = true; });
  await ctx.addInitScript(FAKE);
  await ctx.route(/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(server.url + 'signup', { waitUntil: 'load' });
  await page.fill('#signupName', 'Dup');
  await page.fill('#signupEmail', 'taken@example.com');
  await page.fill('#signupPassword', 'long-enough-1');
  await page.click('#signupForm button[type=submit]');
  await page.waitForFunction(() => /already has an account/.test(document.getElementById('authMsg').textContent));
  assert.deepStrictEqual(await page.$$eval('#authMsg a', (as) => as.map((a) => a.getAttribute('href'))), ['login', 'forgot-password']);
  // A new email still gets "check your email".
  await page.fill('#signupEmail', 'new@example.com');
  await page.click('#signupForm button[type=submit]');
  await page.waitForFunction(() => /Check your email for a link to confirm/.test(document.getElementById('authMsg').textContent));

  await page.goto(server.url + 'forgot-password', { waitUntil: 'load' });
  await page.fill('#forgotEmail', 'someone@example.com');
  await page.click('#forgotForm button[type=submit]');
  await page.waitForFunction(() => /A link to reset your password has been sent to someone@example\.com/.test(document.getElementById('authMsg').textContent));
  await ctx.close();
});
