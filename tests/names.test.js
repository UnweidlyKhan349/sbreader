const test = require('node:test');
const assert = require('node:assert');

require('../js/mp-rules.js');
require('../js/names.js');
const { TERMS, WORDS, FIRST, SECOND, MAX_NAME, randomPair, playerName, roomName } = globalThis.SBNames;
const { LIMITS, cleanRoomName } = globalThis.SBMpRules;

// A seeded stand-in for Math.random, so a failure can be replayed.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('the name limit matches the one the room enforces', () => {
  assert.strictEqual(MAX_NAME, LIMITS.name);
});

test('random names are a describing word and a noun from different terms of the word bank', () => {
  const termsOf = new Map(WORDS.map((w) => [w.word, w.terms]));
  const first = new Set(FIRST.map((w) => w.word));
  const second = new Set(SECOND.map((w) => w.word));
  const rand = seeded(1);
  for (let i = 0; i < 5000; i++) {
    const [a, b] = randomPair(rand);
    assert.ok(first.has(a) && second.has(b), `${a} ${b}`);
    assert.ok(![...termsOf.get(a)].some((t) => termsOf.get(b).has(t)), `${a} and ${b} share a term`);
    assert.ok(a.length + 1 + b.length <= LIMITS.name, `${a} ${b} is too long`);
  }
});

test('a player name fits and a room name is already clean', () => {
  const rand = seeded(2);
  for (let i = 0; i < 2000; i++) {
    const name = playerName(rand);
    assert.match(name, /^[A-Z][A-Za-z']* [A-Z][A-Za-z']*$/);
    const room = roomName(rand);
    assert.match(room, /^[a-z]+-[a-z]+$/);
    assert.strictEqual(cleanRoomName(room), room);
  }
});

test('the bank leaves out the USESO rocks and minerals and filler words', () => {
  const words = new Set(WORDS.map((w) => w.word.toLowerCase()));
  for (const w of ['schist', 'gneiss', 'marble', 'obsidian', 'pumice', 'pegmatite', 'diamond', 'law', 'effect', 'theorem']) {
    assert.ok(!words.has(w), w);
  }
  assert.ok(!TERMS.some((t) => /^(granite|basalt|quartz|halite)$/i.test(t)));
  assert.ok(words.has('okazaki') && words.has('tholins'));
});

test('a term\'s last word is a noun and the words before it describe', () => {
  const role = (w) => WORDS.find((x) => x.word === w);
  for (const w of ['Casparian', 'Okazaki', 'Thermal', 'Hot', 'Ampere', 'Amphoteric']) assert.ok(role(w).first && !role(w).second, w);
  for (const w of ['Strip', 'Tholins', 'Jupiter', 'Fragments', 'Center', 'Mass', 'Apoptosis']) assert.ok(role(w).second, w);
  assert.ok(role('Spiral').first && role('Spiral').second); // "Spiral galaxy", "Ekman spiral"
});
