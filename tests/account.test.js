// The account logic that doesn't need a network: merging bookmarks at
// login, which settings win, and the stats pages' numbers.
const test = require('node:test');
const assert = require('node:assert');
const core = require('../js/account-core.js');
const { mergeBookmarks, pickSettings, SETTINGS_KEYS } = core;

test('a first login on a device keeps every bookmark from both sides and uploads only the new ones', () => {
  const m = mergeBookmarks([1, 2, 3], [3, 4]);
  assert.deepStrictEqual(m.all.sort(), [1, 2, 3, 4]);
  assert.deepStrictEqual(m.toUpload.sort(), [1, 2]);
  assert.deepStrictEqual(mergeBookmarks([], [5]).toUpload, []);
});

test('the newer copy of the settings wins', () => {
  const local = { sb_theme: 'dark' };
  const remote = { sb_theme: 'light' };
  assert.strictEqual(pickSettings(local, '2026-11-01T00:00:00Z', remote, '2026-11-02T00:00:00Z').from, 'remote');
  assert.strictEqual(pickSettings(local, '2026-11-03T00:00:00Z', remote, '2026-11-02T00:00:00Z').from, 'local');
  assert.strictEqual(pickSettings(local, null, null, null).from, 'local');
  assert.ok(SETTINGS_KEYS.includes('sb_theme') && SETTINGS_KEYS.includes('sb_reading_speed'));
});

const at = (day, h) => new Date(2026, 10, day, h || 12).toISOString();
const ROWS = [
  { question_id: 1, result: 'correct', points: 4, celerity: 0.8, subject: 'phys', qtype: 'tossup', format: 'SA', tournament: 'MIT 2023', level: 'hs', mode: 'solo', created_at: at(1) },
  { question_id: 2, result: 'incorrect', points: -4, celerity: 0.5, subject: 'phys', qtype: 'tossup', format: 'MC', tournament: 'MIT 2023', level: 'hs', mode: 'mp', created_at: at(1, 13) },
  { question_id: 3, result: 'incorrect', points: 0, celerity: 0, subject: 'bio', qtype: 'tossup', format: 'SA', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(2) },
  { question_id: 4, result: 'skipped', points: 0, subject: 'bio', qtype: 'tossup', format: 'SA', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(2, 13) },
  { question_id: 5, result: 'correct', points: 4, celerity: 0.2, subject: 'bio', qtype: 'tossup', format: 'SA', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(3) },
  { question_id: 6, result: 'correct', points: 4, celerity: 0.9, subject: 'bio', qtype: 'bonus', format: 'SA', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(3, 13) },
  // Saved before points and celerity were stored.
  { question_id: 7, result: 'correct', subject: 'math', qtype: 'tossup', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(3, 14) },
  { question_id: 8, result: 'incorrect', subject: 'math', qtype: 'tossup', tournament: 'AVES 2', level: 'ms', mode: 'solo', created_at: at(3, 15) },
].map(core.normalizeAnswer);

test('tossup stats: questions heard, 4s, 0s, -4s, celerity over right answers, points and points per tossup', () => {
  const tossups = core.filterAnswers(ROWS, { qtype: 'tossup' });
  const t = core.totalStats(tossups);
  assert.deepStrictEqual([t.count, t.fours, t.zeros, t.negs, t.dead, t.points], [7, 3, 2, 1, 1, 8]);
  assert.strictEqual(t.celerity, 0.5); // (0.8 + 0.2) / 2: the old row has no celerity
  assert.strictEqual(+t.ppq.toFixed(4), +(8 / 7).toFixed(4));
  const bySubject = core.groupStats(tossups, (r) => r.subject);
  assert.deepStrictEqual(bySubject.map((g) => [g.key, g.count, g.points]), [['bio', 3, 4], ['math', 2, 4], ['phys', 2, 0]]);
  const phys = bySubject.find((g) => g.key === 'phys');
  assert.deepStrictEqual([phys.fours, phys.negs, phys.celerity, phys.buzzpoint], [1, 1, 0.8, 0.65]);
  assert.strictEqual(core.totalStats([]).ppq, 0);
});

test('stats filters: type, mode, set, level and dates', () => {
  const n = (f) => core.filterAnswers(ROWS, f).length;
  assert.strictEqual(n({ qtype: 'bonus' }), 1);
  assert.strictEqual(n({ qtype: 'tossup', mp: false }), 6);
  assert.strictEqual(n({ qtype: 'tossup', solo: false }), 1);
  assert.strictEqual(n({ qtype: 'tossup', solo: false, mp: false }), 0);
  assert.strictEqual(n({ set: 'mit 2023' }), 2);
  assert.strictEqual(n({ levels: ['ms'] }), 6);
  assert.strictEqual(n({ levels: [] }), 8);
  assert.strictEqual(n({ start: '2026-11-02' }), 6);
  assert.strictEqual(n({ start: '2026-11-02', end: '2026-11-02' }), 2);
});

test('best buzz is the right answer with the highest celerity', () => {
  assert.strictEqual(core.bestBuzz(core.filterAnswers(ROWS, { qtype: 'tossup' })).question_id, 1);
  assert.strictEqual(core.bestBuzz(ROWS.filter((r) => r.outcome !== 'correct')), null);
});

test('daily stats are in date order, and the CSV has one line per answer', () => {
  const days = core.dailyStats(core.filterAnswers(ROWS, { qtype: 'tossup' }));
  assert.deepStrictEqual(days.map((d) => [d.key, d.count, d.points]), [['2026-11-01', 2, 0], ['2026-11-02', 2, 0], ['2026-11-03', 3, 8]]);
  const csv = core.answersCsv([{ ...ROWS[1], tournament: 'A, "B"' }]).trim().split('\n');
  assert.strictEqual(csv[0], 'created,question_id,set,level,subject,type,format,multiplayer,result,celerity,points');
  assert.match(csv[1], /,2,"A, ""B""",hs,phys,tossup,MC,true,neg,0\.5,-4$/);
});

test('with a last-synced copy, removals on either side stick and additions on either side are kept', () => {
  // Last sync: {1, 2, 3}. Since then this device removed 2 and added 4; the
  // account removed 3 and gained 5.
  const m = mergeBookmarks([1, 3, 4], [1, 2, 5], [1, 2, 3]);
  assert.deepStrictEqual(m.all.sort(), [1, 4, 5]);
  assert.deepStrictEqual(m.toUpload.sort(), [4]);
  assert.deepStrictEqual(m.toDelete.sort(), [2]);
  // After "Delete my data" (base and local both empty) nothing comes back.
  assert.deepStrictEqual(mergeBookmarks([], [], []).all, []);
});
