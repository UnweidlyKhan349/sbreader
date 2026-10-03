// Grader tests. Run with `node --test tests/`.
const test = require('node:test');
const assert = require('node:assert');
const { loadCorpus } = require('./helpers');

require('../js/answer-check.js');
const { checkAnswer } = globalThis.SBAnswer;

function sa(text, extra = {}) {
  return { question: extra.question || 'Q?', format: 'SA', choices: null,
    answer: { text, letter: null, accept: extra.accept || [], reject: extra.reject || [] } };
}
const grade = (key, typed, extra) => checkAnswer(sa(key, extra), typed);
const isCorrect = (key, typed, extra) => grade(key, typed, extra).correct;

test('exact, symbolic and spacing-insensitive answers pass', () => {
  for (const [key, typed] of [
    ['MITOCHONDRIA', 'mitochondria'],
    ['128 π', '128 pi'],
    ['CUBE ROOT OF 35', 'cbrt(35)'],
    ['SI O2', 'SiO2'],
    ['ROUGH ENDOPLASMIC RETICULUM', 'rough ER'],
    ['x^2', 'x2'],
    ['1/2', '0.5'],
    ['8 FACTORS', '8'],
    ['+6', '+6'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
});

test('word order, stop words and singular/plural pass', () => {
  assert.ok(isCorrect('SATURN AND JUPITER', 'jupiter saturn'));
  assert.ok(isCorrect('THE TROPOSPHERE', 'troposphere'));
  assert.ok(isCorrect('MITOCHONDRIA', 'mitochondrion'));
  assert.ok(isCorrect('PROTONS', 'proton'));
  assert.ok(isCorrect('NUCLEI', 'nucleus'));
});

test('alternates written inside the key pass', () => {
  assert.ok(isCorrect('ITCZ OR INTERTROPICAL CONVERGENCE ZONE', 'itcz'));
  assert.ok(isCorrect('GREEN ACCEPT: EMERALD', 'emerald'));
  assert.ok(isCorrect("TORRICELLI'S THEOREM (OR LAW)", "torricelli's theorem"));
  assert.ok(isCorrect('DNA or Deoxyribonucleic Acid', 'dna'));
});

test('halves of a must-give-both key do not pass', () => {
  assert.ok(!isCorrect('x = 0 or x = 9 (MUST GIVE BOTH ANSWERS)', 'x = 0'));
  assert.ok(!isCorrect('1 OR 3 (MUST GIVE BOTH ANSWERS)', '3'));
  assert.ok(!isCorrect('x ≥ 10 or x ≤ − 4', 'x ≤ − 4'));
  assert.ok(!isCorrect('+7 or 7, do not accept -7', '-7'));
});

test('a different term one or two letters away is wrong, not close', () => {
  for (const [key, typed] of [
    ['HYPERTONIC', 'hypotonic'],
    ['ALKANE', 'alkene'],
    ['ETHANE', 'ethene'],
    ['NITRATE', 'nitrite'],
    ['ADENOSINE TRIPHOSPHATE', 'adenosine diphosphate'],
    ['AEROBIC', 'anaerobic'],
    ['PROKARYOTE', 'eukaryote'],
    ['AFFERENT', 'efferent'],
  ]) {
    const r = grade(key, typed);
    assert.ok(!r.correct && !r.close, `${typed} for ${key}: ${JSON.stringify(r)}`);
  }
});

test('incomplete answers are wrong', () => {
  for (const [key, typed] of [
    ['SODIUM CHLORIDE', 'sodium'],
    ['CARBON DIOXIDE', 'carbon'],
    ['WHITE DWARF', 'dwarf'],
    ['SQRT(20)', 'sqrt'],
    ['WATER AND SALT', 'water'],
  ]) {
    const r = grade(key, typed);
    assert.ok(!r.correct && !r.close, `${typed} for ${key}: ${JSON.stringify(r)}`);
  }
});

test('typos and the key plus extra words are close, not correct', () => {
  for (const [key, typed] of [
    ['DEUTEROSTOMES', 'deuterosomes'],
    ['PROTON', 'photon'],
    ['SODIUM', 'sodium chloride'],
    ['NITROGEN', 'nitrogen dioxide'],
    ['SUPERNOVA', 'supernova remnant'],
  ]) {
    const r = grade(key, typed);
    assert.ok(!r.correct && r.close, `${typed} for ${key}: ${JSON.stringify(r)}`);
  }
});

test('reject list and signs', () => {
  assert.ok(!isCorrect('CURIE', 'becquerel', { reject: ['BECQUEREL'] }));
  assert.ok(!isCorrect('-195 DEGREES', '195 degrees'));
  assert.ok(isCorrect('-2', 'negative 2'));
});

test('multi-part answers need every part', () => {
  const q = 'What are the phases of the moon on day 7 and day 14?';
  assert.ok(isCorrect('FIRST QUARTER; FULL', 'first quarter and full moon', { question: q }));
  assert.ok(!isCorrect('FIRST QUARTER; FULL', 'full moon', { question: q }));
  assert.ok(!isCorrect('LUTEINIZING HORMONE; FOLLICLE STIMULATING HORMONE', 'LH', { accept: ['LH'] }));
});

test('multiple choice is strict', () => {
  const q = { question: 'Q?', format: 'MC', choices: { W: 'Proton', X: 'Neutron', Y: 'Electron', Z: 'Photon' },
    answer: { text: 'Electron', letter: 'Y', accept: [], reject: [] } };
  assert.ok(checkAnswer(q, 'y').correct);
  assert.ok(checkAnswer(q, 'electron').correct);
  assert.ok(!checkAnswer(q, 'electrons').correct);
  assert.ok(!checkAnswer(q, 'X').correct);
});

test('every answer key in the corpus grades as correct', () => {
  const failures = [];
  for (const q of loadCorpus().questions) {
    const typed = q.format === 'MC' ? q.answer.letter : q.answer.text;
    if (typed && !checkAnswer(q, typed).correct) failures.push(`${q.id}: ${typed}`);
  }
  assert.deepStrictEqual(failures.slice(0, 20), []);
});

test('every whole-answer accept in the corpus grades as correct', () => {
  const failures = [];
  for (const q of loadCorpus().questions) {
    // a multi-part key's single-part accepts are alternates for one part only
    if (q.format === 'MC' || /;|\s\|\s/.test(q.answer.text)) continue;
    for (const acc of q.answer.accept) {
      if (!checkAnswer(q, acc).correct) failures.push(`${q.id}: ${acc}`);
    }
  }
  assert.deepStrictEqual(failures.slice(0, 20), []);
});
