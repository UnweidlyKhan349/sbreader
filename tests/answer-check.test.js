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
    ['10√2', '10sqrt(2)'], ['K_sp', 'Ksp'], ['log_2(8)', 'log2(8)'], ['Fe^(2+)', 'Fe2+'],
    ['2√(6/5)', '2sqrt(6/5)'],
    ['5√2/2', '5 sqrt 2 / 2'],
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
  const wPlus = { reject: ['W BOSON', 'W^- BOSON'] };
  assert.ok(isCorrect('W^+ BOSON', 'W+ boson', wPlus));
  assert.ok(!isCorrect('W^+ BOSON', 'W boson', wPlus));
  assert.ok(!isCorrect('W^+ BOSON', 'W- boson', wPlus));
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

test('multiple choice ignores a choice\'s reading guide', () => {
  const q = { question: 'Q?', format: 'MC', choices: { W: 'slate', X: 'limestone', Y: 'gneiss [nice]', Z: 'schist' },
    answer: { text: 'gneiss [nice]', letter: 'Y', accept: [], reject: [] } };
  assert.ok(checkAnswer(q, 'gneiss').correct);
  assert.ok(checkAnswer(q, 'gneiss [nice]').correct);
  assert.ok(!checkAnswer(q, 'nice').correct);
  const twin = { question: 'Q?', format: 'MC', choices: { W: 'Fe [iron two]', X: 'Fe [iron three]', Y: 'Cu', Z: 'Zn' },
    answer: { text: 'Fe [iron two]', letter: 'W', accept: [], reject: [] } };
  assert.ok(!checkAnswer(twin, 'Fe').correct);
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

test('ranking answers must be in the keyed order', () => {
  const q = 'Order the following three things by size: 1) a 2) b 3) c';
  assert.ok(isCorrect('1, 3, 2', '1, 3, 2', { question: q }));
  assert.ok(isCorrect('1, 3, 2', '132', { question: q }));
  assert.ok(isCorrect('1, 3, 2', '1 and 3 and 2', { question: q }));
  assert.ok(!isCorrect('1, 3, 2', '1, 2, 3', { question: q }));
  assert.ok(!isCorrect('1, 3, 2', '3 2 1', { question: q }));
  // typed digits that only include the item numbers are not a ranking
  assert.ok(!isCorrect('1, 3, 2', '138/2', { question: q }));
  assert.ok(!isCorrect('1, 3, 2', 'vertices = 1, edges = 32', { question: q }));
  assert.ok(!isCorrect('1, 3, 2', '1, 3, 4, 2', { question: q }));
  // a key may carry the item names after its numbers
  assert.ok(isCorrect('1, 3, 2 (A, C, B)', '1, 3, 2', { question: q }));
  assert.ok(!isCorrect('1, 3, 2 (A, C, B)', '2, 3, 1', { question: q }));
  // the ordering can live in an accept when the key is written as values
  const v = 'Order the following three numbers from least to greatest: 1) 42%; 2) 0.402; 3) 2/5.';
  assert.ok(isCorrect('2/5; 0.402; 42%', '3, 2, 1', { question: v, accept: ['3, 2, 1'] }));
  assert.ok(!isCorrect('2/5; 0.402; 42%', '1, 2, 3', { question: v, accept: ['3, 2, 1'] }));
});

test('longer ranking stems are recognised; set questions are not', () => {
  const { isRankingQuestion } = globalThis.SBAnswer;
  for (const q of [
    'Order the convectively available potential energy of the following three setups in increasing order. 1) a 2) b 3) c',
    'Place the following three events in chronological order: 1) a; 2) b; 3) c.',
    'By name or number, sort the following compounds by increasing vibrational modes: 1) a 2) b 3) c',
  ]) assert.ok(isRankingQuestion(q), q);
  for (const q of [
    'In a second-order phase transition, identify all of the following quantities that are discontinuous: 1) a 2) b 3) c',
    'In order to improve his training sample, identify all of the following techniques that would help: 1) a 2) b 3) c',
    'Identify all of the following that are true: 1) a 2) b 3) c',
  ]) assert.ok(!isRankingQuestion(q), q);
});

test('list answers mix names with an all-formula accept, in any order', () => {
  const co2 = { accept: ['CARBON DIOXIDE AND NITROGEN', 'CO2 AND N2', 'CO2 AND N'] };
  for (const typed of ['nitrogen and carbon dioxide', 'co2 n', 'CO2 and nitrogen', 'n2, carbon dioxide'])
    assert.ok(isCorrect('CARBON DIOXIDE AND MOLECULAR NITROGEN', typed, co2), typed);
  for (const typed of ['co2', 'carbon dioxide', 'co2 and o2'])
    assert.ok(!isCorrect('CARBON DIOXIDE AND MOLECULAR NITROGEN', typed, co2), typed);
  // a second answer in words is a whole answer, not a source of alternates
  const pair = { accept: ['ALUMINUM AND SILICON'] };
  assert.ok(isCorrect('CALCIUM AND SODIUM', 'silicon and aluminum', pair));
  assert.ok(!isCorrect('CALCIUM AND SODIUM', 'calcium and silicon', pair));
  // all-caps words are not formulas
  assert.ok(!isCorrect('IRON AND SULFUR', 'iron and ion', { accept: ['NO AND ION'] }));
});

test('list answers to ordered questions keep their order', () => {
  const resp = { question: 'What metal is in forsterite and what metal is in fayalite, respectively?', accept: ['Mg AND Fe'] };
  assert.ok(isCorrect('MAGNESIUM AND IRON', 'magnesium, iron', resp));
  assert.ok(isCorrect('MAGNESIUM AND IRON', 'mg and iron', resp));
  assert.ok(!isCorrect('MAGNESIUM AND IRON', 'iron, magnesium', resp));
  assert.ok(!isCorrect('MAGNESIUM AND IRON', 'fe and mg', resp));
  const rank = { question: 'Order the following from worst to best conductor: aluminum, water, gold' };
  assert.ok(isCorrect('WATER, ALUMINUM, GOLD', 'water aluminum gold', rank));
  assert.ok(!isCorrect('WATER, ALUMINUM, GOLD', 'gold, aluminum, water', rank));
  // "not necessarily in that order" doesn't ask for an order; "40,000" is one item
  assert.ok(isCorrect('ARGON AND NEON', 'neon and argon', { question: 'Name the two gases, not necessarily in that order.' }));
  assert.ok(!isCorrect('-40,000 VOLTS', '000 volts, -40'));
  // "3/2" is a fraction, not the items 3 and 2
  assert.ok(isCorrect('x = 2 AND x = 3', '3 and 2'));
  assert.ok(!isCorrect('x = 2 AND x = 3', '3/2'));
});

test('"1: ... 2: ..." items count, but times, ratios and labels do not', () => {
  const { detectItemCount, extractItemTexts } = globalThis.SBAnswer;
  const q = 'Which of the following planets have rings? 1: Mars 2: Jupiter 3: Uranus 4: Neptune';
  assert.strictEqual(detectItemCount(q), 4);
  assert.deepStrictEqual(extractItemTexts(q, 4), ['Mars', 'Jupiter', 'Uranus', 'Neptune']);
  assert.ok(isCorrect('2, 3, AND 4', '234', { question: q }));
  assert.ok(isCorrect('2, 3, AND 4', 'jupiter, uranus and neptune', { question: q }));
  assert.ok(!isCorrect('2, 3, AND 4', '2 and 3', { question: q }));
  // a colon ending the stem doesn't hide the "1)" after it
  assert.strictEqual(detectItemCount('Identify all of the following about the number 6: 1) perfect 2) prime 3) triangular'), 3);
  for (const s of [
    'The train leaves at 3:30 and arrives at 4:15. 1:2 is the ratio of 2:3 mixtures.',
    'What is 3 times the 2 by 2 matrix with row 1: −2, 1 and row 2: 0, 5?',
    'The proposed mechanism is Step 1: A + B → D Step 2: D + B → E Step 3: E + A → C.',
  ]) assert.strictEqual(detectItemCount(s), null, s);
});

test('rankings with "1:" markers keep their order, and can be typed as names', () => {
  const q = 'Rank the following elements in increasing order of their reactivity with fluorine: 1: Carbon 2: Lithium 3: Cesium 4: Oxygen';
  assert.ok(isCorrect('4, 1, 2, 3', '4123', { question: q }));
  assert.ok(isCorrect('4, 1, 2, 3', 'oxygen, carbon, lithium, cesium', { question: q }));
  assert.ok(!isCorrect('4, 1, 2, 3', '3, 2, 1, 4', { question: q }));
  assert.ok(!isCorrect('4, 1, 2, 3', 'carbon, oxygen, lithium, cesium', { question: q }));
  assert.ok(!isCorrect('4, 1, 2, 3', 'all', { question: q }));
  // names that only differ by a charge can't carry an order
  const ions = 'Rank the following species in increasing bond angle: 1) NO2 2) NO2^- 3) NO2^+';
  assert.ok(isCorrect('2, 1, 3', '213', { question: ions }));
  assert.ok(!isCorrect('2, 1, 3', 'NO2^+, NO2, NO2^-', { question: ions }));
  // "put/list/place ... in (the correct) order" is a ranking
  const { isRankingQuestion } = globalThis.SBAnswer;
  for (const s of [
    'Put the following plant structures in order, starting at the center of the woody stem. 1: a 2: b 3: c',
    'List the following steps in order, for the secretion of H^+ ions. 1: a 2: b 3: c',
    'Place the following four geological time divisions in the correct order, from longest to shortest: 1) a, 2) b, 3) c, 4) d.',
  ]) assert.ok(isRankingQuestion(s), s);
  assert.ok(!isRankingQuestion('What would the pressure have to be, in atmospheres, in order for the gas to have a volume of 500 mL?'));
});

test('a key that answers each item in turn is not a choice of items', () => {
  const q = 'For the following 3 processes, predict whether the change in enthalpy is positive or negative: 1: melting 2: freezing 3: boiling';
  assert.ok(isCorrect('1: +; 2: –; 3: +', '1: +; 2: –; 3: +', { question: q }));
  assert.ok(!isCorrect('1: +; 2: –; 3: +', 'all', { question: q }));
  assert.ok(!isCorrect('1: +; 2: –; 3: +', '123', { question: q }));
  // numbers written with their markers still name items
  const sel = 'Identify all of the following three statements that are true: 1) a 2) b 3) c';
  assert.ok(isCorrect('1) AND 2)', '12', { question: sel }));
  assert.ok(isCorrect('2) AND 3)', '2 and 3', { question: sel }));
});

test('"name any N" keys pass any N distinct listed items, and nothing else', () => {
  const key = 'ANY TWO OF: EARTH, TITAN, PLUTO, TRITON';
  for (const typed of ['Earth and Titan', 'pluto, triton', 'Titan Earth', 'earth, titan, pluto']) assert.ok(isCorrect(key, typed), typed);
  for (const typed of ['earth', 'earth, mars', 'earth, earth']) assert.ok(!isCorrect(key, typed), typed);
  assert.ok(isCorrect('(ACCEPT 4) LEVER, WEDGE, PULLEY, WHEEL & AXLE, INCLINED PLANE, SCREW', 'lever, pulley, screw, wedge'));
  assert.ok(!isCorrect('(ACCEPT 4) LEVER, WEDGE, PULLEY, WHEEL & AXLE, INCLINED PLANE, SCREW', 'lever, pulley, screw'));
  assert.ok(isCorrect('{ANY 2} PHENYLALANINE; TYROSINE; TRYPTOPHAN; METHIONINE', 'tyrosine and tryptophan'));
  assert.ok(isCorrect('Pluto, Ceres, Makemake, Eris, Haumea (any 3)', 'pluto ceres eris'));
  // a parenthetical is another name for the item
  assert.ok(isCorrect('Accept any four of the following five: Tetrahedron, Hexahedron (cube), Octahedron, Dodecahedron, Icosahedron', 'cube, tetrahedron, octahedron, icosahedron'));
});

test('multi-part keys: roman part labels and a part keyed as letter plus choice', () => {
  assert.ok(isCorrect('I) 490; II) 40', '490, 40'));
  assert.ok(!isCorrect('I) 490; II) 40', '40, 490'));
  assert.ok(isCorrect('I) Line; II) Parabola; III) Circle', 'line, parabola, circle'));
  const key = '1) Carbon; 2) X) B-V increases because B-band flux is suppressed';
  for (const typed of ['carbon; X', 'carbon, x', 'carbon; B-V increases because B-band flux is suppressed']) assert.ok(isCorrect(key, typed), typed);
  assert.ok(!isCorrect(key, 'carbon; W'));
  assert.ok(isCorrect('1) 3; 2) W ((R)-METHYL 3-HYDROXYBUTANOATE)', '3, W'));
});

test('scientific notation in any common form, and numbers compared whole', () => {
  for (const typed of ['3.2 * 10^23', '3.2*10^23', '3.2 x 10^23', '3.2x10^23', '3.2e23', '3.2 × 10^23 J']) assert.ok(isCorrect('3.2 × 10^23 J', typed), typed);
  for (const typed of ['2.3 * 10^23', '3.2 * 10^32', '3.2e32']) assert.ok(!isCorrect('3.2 × 10^23 J', typed), typed);
  assert.ok(isCorrect('1.6 × 10^-19 C', '1.6e-19'));
  assert.ok(!isCorrect('1.6 × 10^-19 C', '1.6e19'));
  // a decimal is one number: its digits can't be reordered
  assert.ok(!isCorrect('7.2', '2.7'));
  assert.ok(!isCorrect('4.5 METERS', '5.4'));
  assert.ok(!isCorrect('12.5 GRAMS', '5.12'));
  assert.ok(isCorrect('12.5 GRAMS', '12.5'));
  assert.ok(isCorrect('40,000 VOLTS', '40000'));
  // a bare number passes for a number and its units, not for more math or a sign word
  assert.ok(isCorrect('1080 N', '1080'));
  assert.ok(isCorrect('4 TIMES AS FAST', '4'));
  assert.ok(!isCorrect('7 times 10^-10', '7'));
  assert.ok(!isCorrect('20 pi', '20'));
  assert.ok(!isCorrect('3.9', '3.9 x 10^2'));
  assert.ok(!isCorrect('-870 JOULES', '870', { accept: ['870 JOULES LESS'] }));
  assert.ok(isCorrect('-870 JOULES', '870 joules less', { accept: ['870 JOULES LESS'] }));
  // the same in one part of a multi-part answer
  assert.ok(isCorrect('I) W; II) 3.2 × 10^23 J', 'W; 3.2 * 10^23'));
  assert.ok(!isCorrect('I) W; II) 3.2 × 10^23 J', 'W; 2.3 * 10^23'));
});

test('short answer: a unit may be written out or abbreviated; multiple choice stays exact', () => {
  for (const [key, typed] of [
    ['3.2 × 10^23 J', '3.2*10^23 joules'], ['10 JOULES', '10 J'], ['9.8 m/s^2', '9.8 meters per second squared'],
    ['5 kJ/mol', '5 kilojoules per mole'], ['100 °C', '100 degrees Celsius'], ['300 K', '300 kelvin'],
    ['2.5 eV', '2.5 electron volts'], ['5 OHMS', '5 Ω'], ['12 CM BEHIND THE MIRROR', '12 centimeters behind the mirror'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
  for (const [key, typed] of [
    ['10 JOULES', '10 N'], ['9.8 m/s^2', '9.8 meters per second'], ['5 kJ/mol', '5 J/mol'],
    ['5 COULOMBS', '5 celsius'], ['5 FARADS', '5 fahrenheit'], ['5 MOLAR', '5 meters'], ['3.2 × 10^23 J', '2.3*10^23 joules'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  // only after a number: a unit's name and its symbol are different answers
  assert.ok(!isCorrect('JOULE', 'J'));
  // in a multi-part answer too, but a number cut out of unseparated words isn't bare
  assert.ok(isCorrect('4 SECONDS; 1/16', '4 s; 1/16'));
  assert.ok(!isCorrect('4 SECONDS; 1/16', '4 meters; 1/16'));
  const mc = { question: 'Q?', format: 'MC', choices: { W: '10 joules', X: '10 newtons', Y: '5 J', Z: '5 N' },
    answer: { text: '10 joules', letter: 'W', accept: [], reject: [] } };
  for (const typed of ['W', '10 joules', 'W) 10 joules']) assert.ok(checkAnswer(mc, typed).correct, typed);
  for (const typed of ['10 J', '10 joule']) assert.ok(!checkAnswer(mc, typed).correct, typed);
});

test('roman numerals and digits match after a stage, type or complex name', () => {
  const q = (t, extra) => ({ answer: { text: t }, question: '', format: 'SA', ...extra });
  assert.strictEqual(checkAnswer(q('MEIOSIS II'), 'meiosis 2').correct, true);
  assert.strictEqual(checkAnswer(q('ANAPHASE I'), 'anaphase 1').correct, true);
  assert.strictEqual(checkAnswer(q('PHOTOSYSTEM 2'), 'photosystem II').correct, true);
  assert.strictEqual(checkAnswer(q('TYPE IA'), 'type 1a').correct, true);
  assert.strictEqual(checkAnswer(q('COMPLEX III'), 'complex 3').correct, true);
  // Still different numbers, and a bare numeral isn't touched.
  assert.strictEqual(checkAnswer(q('MEIOSIS II'), 'meiosis 1').correct, false);
  assert.strictEqual(checkAnswer(q('ANAPHASE I'), 'anaphase 2').correct, false);
});
