// The reveal types math already formatted: it's given renderMathHTML's
// output and shows it one visible character at a time.
const test = require('node:test');
const assert = require('node:assert');
require('../js/data.js');
const { visibleTruncate, visibleLength, msPerUnit, wordUnits, schedule, normalizeSpeed } = require('../js/reveal.js');

const render = (s) => globalThis.SBData.renderMathHTML(s);
// Every prefix the reveal would show, in order.
const frames = (html) => Array.from({ length: visibleLength(html) + 1 }, (_, n) => visibleTruncate(html, n));

test('a superscript types in raised, never as a caret (AVES 2 RR 3 B12)', () => {
  const html = render('s(t) = (3t^2 – t)i + 4tj');
  for (const f of frames(html)) assert.ok(!f.includes('^'), f);
  assert.ok(frames(html).some((f) => f.endsWith('3t<sup>2</sup>')));
  assert.strictEqual(visibleTruncate(html, visibleLength(html)), html);
});

test('every frame is well formed: open tags are closed again', () => {
  for (const s of ['Fe^(2+) + 2e^- → Fe', 'CO2 and H2O', 'x^4*e^{-x}', 'Σn=1^∞ (−1)^(n+1)/n^2', 'OH^-(aq) &lt; 5']) {
    for (const f of frames(render(s))) {
      const opens = (f.match(/<(sup|sub)>/g) || []).length;
      const closes = (f.match(/<\/(sup|sub)>/g) || []).length;
      assert.strictEqual(opens, closes, f);
    }
  }
});

test('entities count as one character and are never cut in half', () => {
  const html = render('a < b & c');
  assert.strictEqual(visibleLength(html), 9);
  for (const f of frames(html)) assert.ok(!/&[a-z#0-9]*$/i.test(f), f);
});

test('the renderer raises ∞, degree signs, braced groups and charges before a state label', () => {
  assert.strictEqual(render('Σn=1^∞'), 'Σn=1<sup>∞</sup>');
  assert.strictEqual(render('ΔH^°'), 'ΔH<sup>°</sup>');
  assert.strictEqual(render('e^{-x}'), 'e<sup>-x</sup>');
  assert.strictEqual(render('OH^-(aq)'), 'OH<sup>-</sup>(aq)');
  assert.strictEqual(render('e^-(x)'), 'e^-(x)');
});

test('words are timed with QB Reader\'s reading-speed formula', () => {
  // (ln(length) + 1) units per word, +2.5 at a sentence end, +1.5 after a comma;
  // a unit is 0.9 * (140 - speed) ms.
  assert.strictEqual(msPerUnit(50), 81);
  assert.strictEqual(msPerUnit(100), 36);
  assert.strictEqual(msPerUnit(0), 126);
  assert.strictEqual(msPerUnit(undefined), 81);
  assert.ok(Math.abs(wordUnits('atom') - (Math.log(4) + 1)) < 1e-9);
  assert.ok(Math.abs(wordUnits('atom.') - (Math.log(5) + 3.5)) < 1e-9);
  assert.ok(Math.abs(wordUnits('atom,') - (Math.log(5) + 2.5)) < 1e-9);
  assert.strictEqual(normalizeSpeed('1'), 1);
  assert.strictEqual(normalizeSpeed(''), 50);
  assert.strictEqual(normalizeSpeed(250), 100);
});

test('the reveal shows whole words, across segments and tags', () => {
  const html = '<span class="fw-semibold">TOSS-UP</span> Math <i>Short Answer</i>\nWhat is 3t<sup>2</sup>?';
  const { words, totalUnits } = schedule([{ html }, { text: 'x y' }]);
  const ends = words.map((w) => w.end);
  const visible = 'TOSS-UP Math Short Answer\nWhat is 3t2?';
  assert.deepStrictEqual(ends.slice(0, 7).map((e) => visible.slice(0, e).split(/\s+/).pop()), ['TOSS-UP', 'Math', 'Short', 'Answer', 'What', 'is', '3t2?']);
  assert.deepStrictEqual(ends.slice(7), [visible.length + 1, visible.length + 3]);
  assert.strictEqual(words[0].at, 0);
  assert.ok(totalUnits > words[words.length - 1].at);
  // A tag with attributes is a tag, not visible text.
  assert.strictEqual(visibleTruncate(html, 3), '<span class="fw-semibold">TOS</span>');
});
