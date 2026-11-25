// tools/ingest: the packet parser, and corrections that rebuild a question
// exactly. (The full rebuild needs the downloads: node tools/ingest/build.js --check.)
const test = require('node:test');
const assert = require('node:assert');
const { parsePacketText } = require('../tools/ingest/parse.js');
const { correction, apply } = require('../tools/ingest/build.js');

const PACKET = `AVES 2 DE 1
TOSS-UP
1) BIOLOGY Multiple Choice As glucose concentration increases, how does cAMP [c-A-M-P] change?
W) Increases
X) Decreases
Y) Stays the same
Z) Oscillates
ANSWER: X) Decreases [EH]
BONUS
1) MATH Short Answer What is 2^(10)?
ANSWER: 1024 (ACCEPT: 2^10) (DO NOT ACCEPT: 1000)
\fAmador Valley Science Bowl
TOSS-UP
2) EARTH AND SPACE Short Answer Which planet has the
longest day?
ANSWER: Venus
Page 2`;

test('a packet is read into toss-ups and bonuses, with choices, accepts and pages', () => {
  const r = parsePacketText(PACKET, { pages: true });
  assert.deepStrictEqual(r.map((x) => [x.qt, x.n, x.s, x.f, x.pg]), [['tossup', 1, 'bio', 'MC', 1], ['bonus', 1, 'math', 'SA', 1], ['tossup', 2, 'ess', 'SA', 2]]);
  assert.strictEqual(r[0].q, 'As glucose concentration increases, how does cAMP change?');
  assert.deepStrictEqual(r[0].c, { W: 'Increases', X: 'Decreases', Y: 'Stays the same', Z: 'Oscillates' });
  assert.deepStrictEqual(r[0].a, { l: 'X', t: 'Decreases' });
  assert.deepStrictEqual(r[1].a, { t: '1024', ac: ['2^10'], rj: ['1000'] });
  assert.strictEqual(r[1].q, 'What is 2^10?');
  assert.strictEqual(r[2].q, 'Which planet has the longest day?');
  assert.deepStrictEqual(r[2].a, { t: 'Venus' }, 'the page footer is not part of the answer');
});

test('a correction rebuilds the bank\'s question exactly, from a parsed record or from nothing', () => {
  const parsed = parsePacketText(PACKET).map((x, index) => ({ ...x, index }));
  const bank = [
    { i: 7, s: 'bio', f: 'MC', qt: 'tossup', n: 1, q: 'As glucose concentration increases, how does cAMP change?', c: parsed[0].c, a: { t: 'Decreases', l: 'X' } },
    { i: 8, s: 'math', f: 'SA', qt: 'bonus', n: 1, q: 'What is 2^10?', a: { t: '1,024', ac: ['2^10'] } },
    { i: 9, s: 'phys', f: 'SA', qt: 'tossup', n: 9, q: 'Not in the packet', a: { t: 'x' }, pg: 3 },
  ];
  const entries = [correction(bank[0], parsed[0]), correction(bank[1], parsed[1]), correction(bank[2], null)];
  assert.strictEqual(entries[0].set, undefined, 'straight from the source');
  assert.deepStrictEqual(entries[1].set, { 'a.t': '1,024' });
  assert.deepStrictEqual(entries[1].del, ['a.rj']);
  assert.strictEqual(entries[2].m, -1);
  entries.forEach((e, k) => assert.strictEqual(JSON.stringify(apply(e, parsed)), JSON.stringify(bank[k])));
});
