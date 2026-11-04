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

test('a rename needs a non-blank name, cut to length', () => {
  assert.deepStrictEqual(cleanHostMessage({ type: 'rename', name: '  Sam  ' }, meta), { type: 'rename', name: 'Sam' });
  assert.strictEqual(cleanHostMessage({ type: 'rename', name: 'x'.repeat(100) }, meta).name.length, 24);
  for (const name of ['', '   ', null, 5]) {
    assert.strictEqual(cleanHostMessage({ type: 'rename', name }, meta), null, JSON.stringify(name));
  }
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
    visuals: ['visual', 'image', 'visual'],
    tournaments: [meta.tournaments[0].slug, '__proto__'],
    roundRange: [50, -3],
    includeUnlabeled: 'no',
    rate: 1e9,
  }, meta);
  assert.deepStrictEqual(m.subjects, ['math']);
  assert.deepStrictEqual(m.qtypes, []);
  assert.deepStrictEqual(m.formats, ['SA']);
  assert.deepStrictEqual(m.visuals, ['visual']);
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

test('there is a public lobby for all subjects and one per subject but energy', () => {
  const { publicLobbies, findPublicLobby } = globalThis.SBMpRules;
  const lobbies = publicLobbies(meta);
  const keys = meta.subjects.map((s) => s.key);
  assert.deepStrictEqual(lobbies.map((l) => l.key), ['all', ...keys.filter((k) => k !== 'energy')]);
  assert.deepStrictEqual(lobbies[0].subjects, keys);
  for (const l of lobbies.slice(1)) assert.deepStrictEqual(l.subjects, [l.key]);
  assert.strictEqual(new Set(lobbies.map((l) => l.peerId)).size, lobbies.length);
  assert.strictEqual(findPublicLobby(meta, ' BIO ').key, 'bio');
  assert.strictEqual(findPublicLobby(meta, 'energy'), null);
  assert.strictEqual(findPublicLobby(meta, null), null);
});

test('a join keeps a well-formed player ID and drops anything else', () => {
  assert.deepStrictEqual(cleanHostMessage({ type: 'join', name: 'Sam', pid: 'abcDEF12-34_x' }, meta), { type: 'join', name: 'Sam', pid: 'abcDEF12-34_x' });
  for (const pid of ['short', 'x'.repeat(41), 'has space 123', '<script>12', 42, null]) {
    assert.deepStrictEqual(cleanHostMessage({ type: 'join', name: 'Sam', pid }, meta), { type: 'join', name: 'Sam' }, JSON.stringify(pid));
  }
});

test('the longest-standing player still connected runs the game', () => {
  const { coordinatorOrder, pickCoordinator } = globalThis.SBMpRules;
  const order = coordinatorOrder(['a', 'b', 'c', 'b'], new Set(['z', 'c', 'y']));
  assert.deepStrictEqual(order, ['a', 'b', 'c', 'y', 'z']);
  assert.strictEqual(pickCoordinator(order, () => true), 'a');
  assert.strictEqual(pickCoordinator(order, (id) => id !== 'a'), 'b');
  assert.strictEqual(pickCoordinator(order, (id) => id === 'y'), 'y');
  assert.strictEqual(pickCoordinator(order, () => false), null);
});

test('messages from a newer term, or from our coordinator, are followed', () => {
  const { acceptsCoordinator } = globalThis.SBMpRules;
  const view = { term: 3, coordinatorId: 'b', order: ['a', 'b', 'c'] };
  assert.strictEqual(acceptsCoordinator(view, 'b', 3), true);
  assert.strictEqual(acceptsCoordinator(view, 'c', 4), true);
  assert.strictEqual(acceptsCoordinator(view, 'a', 2), false);
  // Same term, two coordinators: the earlier one in the order wins.
  assert.strictEqual(acceptsCoordinator(view, 'a', 3), true);
  assert.strictEqual(acceptsCoordinator(view, 'c', 3), false);
  for (const t of [undefined, '4', NaN, Infinity]) assert.strictEqual(acceptsCoordinator(view, 'c', t), false);
});

test('a player who left shows as offline for an hour', () => {
  const { stillOffline, OFFLINE_KEEP_MS } = globalThis.SBMpRules;
  const now = 1_000_000_000;
  assert.strictEqual(stillOffline({ leftAt: now }, now), true);
  assert.strictEqual(stillOffline({ leftAt: now - OFFLINE_KEEP_MS + 1000 }, now), true);
  assert.strictEqual(stillOffline({ leftAt: now - OFFLINE_KEEP_MS }, now), false);
  for (const e of [null, {}, { leftAt: 'x' }]) assert.strictEqual(stillOffline(e, now), false);
});
