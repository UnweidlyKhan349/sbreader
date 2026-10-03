const test = require('node:test');
const assert = require('node:assert');
const { loadCorpus } = require('./helpers');

require('../js/mp-rules.js');
const { cleanHostMessage, canOverrideOwn } = globalThis.SBMpRules;
const { meta } = loadCorpus();

test('messages that are not objects with a known type are dropped', () => {
  for (const msg of [null, 'buzz', 42, {}, { type: 7 }, { type: 'hack' }, { type: 'chatSend', text: '   ' }]) {
    assert.strictEqual(cleanHostMessage(msg, meta), null, JSON.stringify(msg));
  }
});

test('string fields are coerced and cut to length', () => {
  assert.deepStrictEqual(cleanHostMessage({ type: 'submitAnswer', text: 1 }, meta), { type: 'submitAnswer', text: '' });
  assert.deepStrictEqual(cleanHostMessage({ type: 'join', name: { x: 1 } }, meta), { type: 'join', name: 'Player' });
  assert.strictEqual(cleanHostMessage({ type: 'join', name: 'x'.repeat(100) }, meta).name.length, 24);
  assert.strictEqual(cleanHostMessage({ type: 'typing', text: 'x'.repeat(5000) }, meta).text.length, 200);
  assert.strictEqual(cleanHostMessage({ type: 'chatSend', text: 'x'.repeat(5000) }, meta).text.length, 300);
});

test('extra fields on simple messages are dropped', () => {
  assert.deepStrictEqual(cleanHostMessage({ type: 'buzz', playerId: 'HOST' }, meta), { type: 'buzz' });
});

test('settings are limited to known values and clamped', () => {
  const m = cleanHostMessage({
    type: 'updateSettings',
    subjects: ['math', 'bogus', 3, 'math'],
    qtypes: 'tossup',
    formats: ['SA'],
    levels: ['hs'],
    tournaments: [meta.tournaments[0].slug, '__proto__'],
    roundRange: [50, -3],
    includeUnlabeled: 'no',
    rate: 1e9,
  }, meta);
  assert.deepStrictEqual(m.subjects, ['math']);
  assert.deepStrictEqual(m.qtypes, []);
  assert.deepStrictEqual(m.formats, ['SA']);
  assert.deepStrictEqual(m.tournaments, [meta.tournaments[0].slug]);
  assert.deepStrictEqual(m.roundRange, [1, Math.max(...meta.rounds)]);
  assert.strictEqual(m.includeUnlabeled, true);
  assert.strictEqual(m.rate, 2.5);
  assert.strictEqual(cleanHostMessage({ type: 'updateSettings', rate: -5 }, meta).rate, 0.5);
  assert.strictEqual(cleanHostMessage({ type: 'updateSettings', rate: 'fast' }, meta).rate, 1);
});

test('a player can override only their own grade, and only one player scores', () => {
  const wrongThenRight = [{ playerId: 'A', correct: false }, { playerId: 'B', correct: true }];
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'A', false), false);
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'B', false), true);
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'C', false), false);
  assert.strictEqual(canOverrideOwn([{ playerId: 'A', correct: false }], 'A', false), true);
  assert.strictEqual(canOverrideOwn([{ playerId: 'A', correct: false }], 'A', true), false);
});
