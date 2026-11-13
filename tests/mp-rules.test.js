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
  // Clear stats clears only the sender's own: a named player is dropped.
  assert.deepStrictEqual(cleanHostMessage({ type: 'clearStats', playerId: 'someone-else' }, meta), { type: 'clearStats' });
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
  // Reading speed is QB Reader's 0-100, 50 by default.
  assert.strictEqual(m.rate, 100);
  assert.strictEqual(cleanHostMessage({ type: 'updateSettings', rate: -5 }, meta).rate, 0);
  assert.strictEqual(cleanHostMessage({ type: 'updateSettings', rate: 'fast' }, meta).rate, 50);
  assert.strictEqual(cleanHostMessage({ type: 'updateSettings', rate: 0 }, meta).rate, 0);
});

test('a player can override only their own grade, even after someone else was right', () => {
  const wrongThenRight = [{ playerId: 'A', correct: false }, { playerId: 'B', correct: true }];
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'A', false), true);
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'B', false), true);
  assert.strictEqual(canOverrideOwn(wrongThenRight, 'C', false), false);
  assert.strictEqual(canOverrideOwn([{ playerId: 'A', correct: false }], 'A', false), true);
  assert.strictEqual(canOverrideOwn([{ playerId: 'A', correct: false }], 'A', true), false);
  // Whoever was overridden to correct can take it back; nobody else can override.
  const overridden = [{ playerId: 'A', correct: true }, { playerId: 'B', correct: false }];
  assert.strictEqual(canOverrideOwn(overridden, 'A', 'A'), true);
  assert.strictEqual(canOverrideOwn(overridden, 'B', 'A'), false);
});

test('General starts with every subject but energy, and each subject but energy has a lobby', () => {
  const { publicLobbies, findPublicLobby } = globalThis.SBMpRules;
  const lobbies = publicLobbies(meta);
  const keys = meta.subjects.map((s) => s.key);
  assert.deepStrictEqual(lobbies.map((l) => l.key), ['all', ...keys.filter((k) => k !== 'energy')]);
  assert.deepStrictEqual(lobbies[0].subjects, keys.filter((k) => k !== 'energy'));
  for (const l of lobbies.slice(1)) assert.deepStrictEqual(l.subjects, [l.key]);
  assert.strictEqual(new Set(lobbies.map((l) => l.peerId)).size, lobbies.length);
  assert.strictEqual(findPublicLobby(meta, ' BIO ').key, 'bio');
  assert.strictEqual(findPublicLobby(meta, 'general').key, 'all');
  assert.strictEqual(findPublicLobby(meta, 'all').key, 'all');
  assert.strictEqual(globalThis.SBMpRules.lobbySlug(lobbies[0]), 'general');
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

test('a takeover is followed only from a member, by a small step, and from the right player', () => {
  const { acceptsCoordinator } = globalThis.SBMpRules;
  const gone = (id) => id !== 'b';
  const view = { term: 3, coordinatorId: 'b', order: ['a', 'b', 'c'], isUp: () => true };
  assert.strictEqual(acceptsCoordinator(view, 'b', 3), true);
  // Our coordinator is still here: only the next in line ('a') may take over.
  assert.strictEqual(acceptsCoordinator(view, 'a', 4), true);
  assert.strictEqual(acceptsCoordinator(view, 'c', 4), false);
  // It has gone: any member may.
  assert.strictEqual(acceptsCoordinator({ ...view, isUp: gone }, 'c', 4), true);
  // Not a member, or a term far ahead: no, whatever the coordinator's state.
  assert.strictEqual(acceptsCoordinator({ ...view, isUp: gone }, 'mallory', 4), false);
  assert.strictEqual(acceptsCoordinator({ ...view, isUp: gone }, 'c', 999), false);
  assert.strictEqual(acceptsCoordinator(view, 'a', 2), false);
  // Same term, two coordinators: the earlier one in the order wins.
  assert.strictEqual(acceptsCoordinator(view, 'a', 3), true);
  assert.strictEqual(acceptsCoordinator(view, 'c', 3), false);
  for (const t of [undefined, '4', NaN, Infinity, -1]) assert.strictEqual(acceptsCoordinator(view, 'c', t), false);
  // Just joined, no coordinator yet: the first member to speak is followed.
  assert.strictEqual(acceptsCoordinator({ term: 0, coordinatorId: null, order: [] }, 'x', 7), true);
  // Ours left and we named 'a' as next: its first message has a newer term.
  assert.strictEqual(acceptsCoordinator({ ...view, coordinatorId: 'a' }, 'a', 4), true);
  assert.strictEqual(acceptsCoordinator({ ...view, coordinatorId: 'a' }, 'a', 99), false);
});

test('a player who left stays on the list, offline, until the daily restart at 08:00 UTC', () => {
  const { stillOffline, lastRestart } = globalThis.SBMpRules;
  const at = (h, m = 0, day = 12) => Date.UTC(2026, 10, day, h, m);
  assert.strictEqual(lastRestart(at(9)), at(8));
  assert.strictEqual(lastRestart(at(8)), at(8));
  assert.strictEqual(lastRestart(at(7, 59)), at(8, 0, 11));
  // Left after the last restart: still there, however long ago.
  assert.strictEqual(stillOffline({ leftAt: at(8, 1) }, at(8, 1)), true);
  assert.strictEqual(stillOffline({ leftAt: at(8, 1, 11) }, at(7, 59)), true);
  // Left before it: gone, even a minute ago.
  assert.strictEqual(stillOffline({ leftAt: at(7, 59) }, at(8, 0)), false);
  assert.strictEqual(stillOffline({ leftAt: at(9, 0, 11) }, at(9)), false);
  for (const e of [null, {}, { leftAt: 'x' }]) assert.strictEqual(stillOffline(e, at(9)), false);
});

test('a player has activity once they have heard or answered a question', () => {
  const { hasActivity } = globalThis.SBMpRules;
  assert.strictEqual(hasActivity({ score: 0, correct: 0, incorrect: 0, negs: 0, heard: 0 }), false);
  assert.strictEqual(hasActivity({}), false);
  assert.strictEqual(hasActivity(null), false);
  for (const k of ['heard', 'correct', 'incorrect', 'negs']) assert.strictEqual(hasActivity({ [k]: 1 }), true);
});

test('room names are cleaned to letters, digits and dashes, and give a stable door', () => {
  const { cleanRoomName, roomPeerId } = globalThis.SBMpRules;
  assert.strictEqual(cleanRoomName('  Physics Club! '), 'physics-club');
  assert.strictEqual(cleanRoomName('a--b__c'), 'a-bc');
  assert.strictEqual(cleanRoomName('x'.repeat(50)).length, 32);
  assert.strictEqual(cleanRoomName('!!!'), '');
  // "pub-" belongs to the built-in rooms' records ("pub-all" is General's).
  assert.strictEqual(cleanRoomName('pub-all'), 'all');
  assert.strictEqual(cleanRoomName('PUB pub-math'), 'math');
  assert.strictEqual(cleanRoomName('pub'), '');
  assert.strictEqual(cleanRoomName('public-room'), 'public-room');
  assert.strictEqual(cleanRoomName('pubquiz'), 'pubquiz');
  assert.strictEqual(roomPeerId('Physics Club'), 'sbowl-room-physics-club');
  assert.strictEqual(roomPeerId(''), '');
});

test('room settings carry the switches, cleaned, and are always random questions', () => {
  const s = cleanHostMessage({ type: 'updateSettings', mode: 'set', setName: meta.tournaments[0].slug, packetNumbers: '1-3, 5<script>', rebuzz: true, timer: false, isPublic: false }, meta);
  assert.deepStrictEqual([s.mode, s.setName, s.packetNumbers], ['random', '', '']);
  assert.deepStrictEqual([s.rebuzz, s.timer, s.isPublic], [true, false, false]);
  const d = cleanHostMessage({ type: 'updateSettings', mode: 'weird', setName: 'no-such-set' }, meta);
  assert.deepStrictEqual([d.mode, d.setName, d.rebuzz, d.timer, d.isPublic], ['random', '', false, true, true]);
});

test('vote kicks: QB Reader threshold, message shape and 30-minute ban', () => {
  const { votekickThreshold, isKicked, cleanHostMessage, KICK_BAN_MS } = globalThis.SBMpRules;
  assert.deepStrictEqual([1, 2, 3, 4, 5, 8, 12].map(votekickThreshold), [2, 2, 2, 3, 3, 6, 9]);
  assert.deepStrictEqual(cleanHostMessage({ type: 'votekick', targetId: 'abc' }), { type: 'votekick', targetId: 'abc' });
  assert.strictEqual(cleanHostMessage({ type: 'votekick' }), null);
  const now = Date.now();
  const kicked = [{ pid: 'p1', at: now - 1000 }, { pid: 'p2', at: now - KICK_BAN_MS - 1 }];
  assert.strictEqual(isKicked(kicked, 'p1', now), true);
  assert.strictEqual(isKicked(kicked, 'p2', now), false);
  assert.strictEqual(isKicked(kicked, null, now), false);
});

test('a room\'s year range stays within the bank\'s years; the whole span means every year', () => {
  const ys = meta.tournaments.map((t) => parseInt(String(t.date).slice(0, 4), 10));
  const [first, last] = [Math.min(...ys), Math.max(...ys)];
  const year = (yearRange) => cleanHostMessage({ type: 'updateSettings', yearRange }, meta).yearRange;
  assert.deepStrictEqual(year([2015, 2020]), [2015, 2020]);
  assert.deepStrictEqual(year([2020, 2015]), [2015, 2020], 'swapped ends are put in order');
  assert.deepStrictEqual(year([1000, 2020]), [first, 2020], 'clamped to the first year');
  assert.strictEqual(year([first, last]), null);
  assert.strictEqual(year('2015-2020'), null);
  assert.deepStrictEqual(cleanHostMessage({ type: 'announceYears', yearRange: [1, 2] }, meta), { type: 'announceYears' });
});
