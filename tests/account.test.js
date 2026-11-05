// The account logic that doesn't need a network: merging bookmarks at
// login, which settings win, and the Stats page's numbers.
const test = require('node:test');
const assert = require('node:assert');
const { mergeBookmarks, pickSettings, aggregateStats, SETTINGS_KEYS } = require('../js/account-core.js');

test('logging in keeps every bookmark from both sides and uploads only the new ones', () => {
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
  assert.ok(SETTINGS_KEYS.includes('sb_theme') && SETTINGS_KEYS.includes('sb_rate'));
});

test('stats add up by subject, type, tournament and mode', () => {
  const rows = [
    { result: 'correct', subject: 'phys', qtype: 'tossup', tournament: 'MIT 2023', mode: 'solo' },
    { result: 'incorrect', subject: 'phys', qtype: 'bonus', tournament: 'MIT 2023', mode: 'mp' },
    { result: 'skipped', subject: 'bio', qtype: 'tossup', tournament: 'AVES 2', mode: 'solo' },
    { result: 'correct', subject: 'bio', qtype: 'tossup', tournament: 'AVES 2', mode: 'solo' },
  ];
  const s = aggregateStats(rows);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.correct, 2);
  assert.strictEqual(s.accuracy, 50);
  const phys = s.bySubject.find((x) => x.key === 'phys');
  assert.deepStrictEqual([phys.total, phys.correct, phys.incorrect, phys.skipped, phys.accuracy], [2, 1, 1, 0, 50]);
  assert.strictEqual(s.byQtype[0].key, 'tossup');
  assert.strictEqual(s.byMode.find((x) => x.key === 'solo').total, 3);
  assert.deepStrictEqual(aggregateStats([]).accuracy, 0);
});
