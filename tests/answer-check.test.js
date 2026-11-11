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

test('numbers written as words match their digits', () => {
  const q = (t) => ({ answer: { text: t }, question: '', format: 'SA' });
  assert.strictEqual(checkAnswer(q('ZERO'), '0').correct, true);
  assert.strictEqual(checkAnswer(q('0'), 'zero').correct, true);
  assert.strictEqual(checkAnswer(q('THREE'), '3').correct, true);
  assert.strictEqual(checkAnswer(q('12 PROTONS'), 'twelve protons').correct, true);
  assert.strictEqual(checkAnswer(q('ZERO'), '1').correct, false);
  assert.strictEqual(checkAnswer(q('TWO'), 'three').correct, false);
});

test('a swapped sign, charge, operation or inequality is wrong', () => {
  for (const [key, typed] of [
    ['OH^-', 'OH^+'], ['y=x+3/2', 'y=x-3/2'], ['x < 17/15', 'x > 17/15'], ['a/b', 'a*b'],
    ['Fe^(2+)', 'Fe 2-'], ['x ≤ 3', 'x < 3'], ['4C/3', '4C*3'], ['ΔG = ΔH-TΔS', 'ΔG = ΔH+TΔS'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  // Accepts with the sides swapped still read the right way round.
  assert.ok(!isCorrect('x < 17/15', 'x > 17/15', { accept: ['17/15 > x'] }));
  assert.ok(isCorrect('x < 17/15', '17/15 > x'));
  // Leaving symbols out, or writing them another way, isn't a contradiction.
  for (const [key, typed] of [
    ['OH^-', 'OH'], ['Fe^(2+)', 'Fe2+'], ['3.2 × 10^23', '3.2*10^23'], ['x ≤ 3', 'x <= 3'],
    ['ALPHA-HELIX', 'alpha helix'], ['1/(i*hbar)', '1/(i hbar)'], ['e^(-x)', 'e^-x'], ['NA^+ AND K^+', 'na+ and k+'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
});

test('the same symbols in other places, or the operands in another order, are wrong', () => {
  for (const [key, typed] of [
    ['x+y-z', 'x-y+z'], ['a/b', 'b/a'], ['-cos(x) + C', '+cos(x) - C'],
    ['x^2-1/3x^4 + 2/45x^6', 'x^2+1/3x^4 - 2/45x^6'], ['x^2', '2^x'], ['x+y-z', 'x+z-y'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  // Rearranging terms or factors the way algebra allows is still right.
  for (const [key, typed] of [
    ['x+y-z', '-z+y+x'], ['-cos(x) + C', 'C - cos(x)'], ['a*b', 'b*a'], ['y=x+3', 'x+3=y'],
    ['(x+1)^2', '(1+x)^2'], ['2x+1', '1+2x'], ['x-y+1', '-(y-x)+1'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
});

test('signed exponents, absolute values and labelled parts keep their signs', () => {
  for (const [key, typed] of [
    ['x^-2+y', 'y^-2+x'], ['e^-x + 1', 'e^x + 1'], ['-ln(|cos(x)|) + C', '+ln(|cos(x)|) - C'],
    ['|x-1|', '|1+x|'], ['1) +, 2) –, 3) -', '1) -, 2) -, 3) +'], ['1) +, 2) –, 3) -', '1) + 2) + 3) -'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  for (const [key, typed] of [
    ['x^-2+y', 'y+x^-2'], ['x^-2+y', 'x^(-2)+y'], ['-ln(|cos(x)|) + C', 'C - ln(|cos(x)|)'], ['|x-1|', '|-1+x|'],
    ['1) +, 2) –, 3) -', '1) +, 2) -, 3) -'], ['1) +, 2) –, 3) -', '1) + 2) - 3) -'], ['OH^-', 'OH'], ['Na^+ + Cl^-', 'Na^+ + Cl^-'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
  // The bank's own questions.
  const { questions } = loadCorpus();
  const byId = (id) => questions.find((x) => x.id === id);
  assert.strictEqual(checkAnswer(byId(39752), '+ln(|cos(x)|) - C').correct, false);
  assert.strictEqual(checkAnswer(byId(39752), '-ln(|cos(x)|) + C').correct, true);
  assert.strictEqual(checkAnswer(byId(52944), '1) -, 2) -, 3) +').correct, false);
  assert.strictEqual(checkAnswer(byId(52944), '1) +, 2) -, 3) -').correct, true);
});

test('a math answer is only matched out of order when it is the same expression', () => {
  for (const [key, typed] of [
    ['x^-2 + √y', 'y^-2 + √x'], ['2 − √3', '√3 − 2'], ['-√3/3', '√3/3'], ['(1 + √5)/2', '1 + √5/2'], ['√(3/2)', '√3/2'],
    ['N2 + 3H2 →2NH3', '2NH3 → N2 + 3H2'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  for (const [key, typed] of [
    ['x^-2 + √y', 'x^-2 + √y'], ['1 + √3', '√3 + 1'], ['6√3 + 8π', '8π + 6√3'], ['(1 + √5)/2', '(√5 + 1)/2'],
    ['N2 + 3H2 →2NH3', '3H2 + N2 → 2NH3'], ['2SO2(g) + O2(g) ⇌ 2SO3(g)', 'O2(g) + 2SO2(g) ⇌ 2SO3(g)'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
  // ordinary words still match in any order
  assert.ok(isCorrect('SATURN AND JUPITER', 'jupiter saturn'));
});

test('across the corpus, flipping one sign, charge, operation or inequality in a key makes it wrong', () => {
  // Checking each key against itself can't catch an answer that's accepted
  // when it shouldn't be; this mutates every key that has a symbol. The
  // listed exceptions are multi-part keys whose accepted alternates are
  // written too differently to compare symbol by symbol, and an HTML-tag key.
  const KNOWN = new Set([50124, 82508, 86932, 87677]);
  const FLIP = { '+': '-', '-': '+', '<': '>', '>': '<', '*': '/', '/': '*' };
  const still = [];
  for (const q of loadCorpus().questions) {
    if (q.format === 'MC' || !q.answer || !q.answer.text) continue;
    const k = q.answer.text;
    const m = k.match(/\^\(?\d*[+\-]|[<>]|=[^=]*?[+\-*/]|\d\s*[*/]\s*[A-Za-z(]|[A-Za-z)]\s*[*/]\s*[A-Za-z(\d]/);
    if (!m) continue;
    const i = m[0][0] === '=' ? m.index + 1 + m[0].slice(1).search(/[+\-*/]/) : m.index + m[0].search(/[+\-<>*/]/);
    const typed = k.slice(0, i) + FLIP[k[i]] + k.slice(i + 1);
    if (typed !== k && checkAnswer(q, typed).correct && !KNOWN.has(q.id)) still.push(`${q.id}: ${typed} for ${k}`);
  }
  assert.deepStrictEqual(still, []);
});

// A long answer to a many-part key used to try every way of cutting its
// words into the parts (hundreds of thousands of cuts), freezing the page
// for seconds to minutes - and, in Multiplayer, the whole room, since
// whoever runs the game grades everyone. Every key in the bank must grade
// a 24-word answer quickly, and long answers still grade right.
test('long answers to many-part keys grade quickly', () => {
  const { raw } = loadCorpus();
  const keys = raw.filter((q) => q.f !== 'MC' && ((q.a.t || '').split(/,|\band\b/i).length >= 7 || (q.a.t || '').split(';').length >= 5));
  assert.ok(keys.length > 50);
  const noise = Array.from({ length: 24 }, (_, i) => 'word' + i).join(' ');
  let slowest = 0;
  for (const q of keys) {
    const question = { question: q.q, format: 'SA', choices: null, answer: { text: q.a.t, letter: null, accept: q.a.ac || [], reject: q.a.rj || [] } };
    const start = Date.now();
    checkAnswer(question, noise);
    slowest = Math.max(slowest, Date.now() - start);
  }
  assert.ok(slowest < 1500, `slowest took ${slowest} ms`);
  const gases = 'HELIUM; NEON; ARGON; KRYPTON; XENON; RADON';
  assert.ok(isCorrect(gases, 'helium neon argon krypton xenon radon'));
  assert.ok(isCorrect(gases, 'the noble gases are helium neon argon krypton xenon radon') === false);
  const start = Date.now();
  grade(gases, 'i think it is helium and then maybe neon or argon krypton xenon and radon but not sure at all really');
  assert.ok(Date.now() - start < 1500);
});

test('items labelled with Roman numerals take numbers or numerals: "3" for "III ONLY"', () => {
  const stem = 'Identify ALL of the following statements that are true regarding photoperiodism: I. Day neutral plants also display it II. It is controlled by auxin III. Long day plants flower in summer';
  const q = (t) => ({ answer: { text: t, accept: [], reject: [] }, question: stem, format: 'SA' });
  const ok = (key, typed) => assert.ok(checkAnswer(q(key), typed).correct, `${typed} for ${key}`);
  const no = (key, typed) => assert.ok(!checkAnswer(q(key), typed).correct, `${typed} for ${key}`);
  assert.strictEqual(globalThis.SBAnswer.detectItemCount(stem), 3);
  for (const typed of ['3', 'iii', 'III', '3 only', 'iii only', 'only 3', 'three']) ok('III ONLY', typed);
  for (const typed of ['2', 'ii', '1 and 3', 'i and iii', '13', 'all', 'none']) no('III ONLY', typed);
  for (const typed of ['1 and 3', '1, 3', '13', 'i, iii', 'iii and i', '3 1']) ok('I AND III', typed);
  for (const typed of ['1', '3', 'i', '123', 'ii and iii']) no('I AND III', typed);
  for (const typed of ['all', '123', 'i, ii, iii', '1 2 3']) ok('I, II, AND III', typed);
  ok('II', '2');
  // A key in numbers takes numerals too.
  const arabic = { answer: { text: '3 ONLY', accept: [], reject: [] }, question: 'Identify all of the following that are noble gases: 1) Oxygen 2) Nitrogen 3) Neon', format: 'SA' };
  assert.ok(checkAnswer(arabic, 'iii').correct);
  assert.ok(!checkAnswer(arabic, 'ii').correct);
  // A stem numbered 1, 2, 3 is read by its numbers, whatever Roman numerals it mentions.
  assert.strictEqual(globalThis.SBAnswer.detectItemCount('Which are in group I? 1) Na 2) Mg 3) K'), 3);
  // Words that only look like numerals aren't item numbers.
  assert.strictEqual(globalThis.SBAnswer.canonicalizeList('IV FLUIDS', 4), null);
  assert.strictEqual(globalThis.SBAnswer.canonicalizeList('VITAMIN D', 4), null);
  // One "I." alone (a sentence ending in "I") isn't a list.
  assert.strictEqual(globalThis.SBAnswer.detectItemCount('What is the charge of an ion of group I. Give a number.'), null);
});

test('"all" said another way: "all" for "ALL OF THEM", "all of them" for "ALL"', () => {
  const three = 'Identify all of the following three that are true: 1) a; 2) b; 3) c';
  const four = 'Identify all of the following four that are true: 1) a; 2) b; 3) c; 4) d';
  const plain = 'Identify all of the following three gases that are noble: helium, neon, argon';
  const ok = (key, typed, question) => assert.ok(isCorrect(key, typed, { question }), `${typed} for ${key}`);
  const no = (key, typed, question) => assert.ok(!isCorrect(key, typed, { question }), `${typed} for ${key}`);
  for (const key of ['ALL', 'ALL OF THEM', 'All of the above', 'ALL THREE', '1, 2, AND 3']) {
    for (const typed of ['all', 'all of them', 'all three', 'all 3', 'all of the above', 'all of these', 'every one', '123']) ok(key, typed, three);
    for (const typed of ['all four', 'none', '1 and 2']) no(key, typed, three);
  }
  for (const key of ['ALL', 'ALL OF THEM', 'ALL 4', 'ALL (1, 2, 3, 4)']) {
    for (const typed of ['all', 'all of them', 'all four', '1234']) ok(key, typed, four);
    no(key, 'all three', four);
  }
  // Items that aren't numbered: the stem's "following three" is the count.
  for (const key of ['ALL', 'ALL OF THEM']) {
    for (const typed of ['all', 'all of them', 'all three', 'all of the above']) ok(key, typed, plain);
    no(key, 'all four', plain);
  }
  // Not every key with "all" in it, and not for a key that isn't all of them.
  no('1 AND 2', 'all', three);
  no('ALL BUT 2', 'all', three);
  no('ALL REAL NUMBERS', 'all');
  no('ALL', 'all real numbers');
  no('1: RIGHT; 2: LEFT; 3: LEFT', 'all', three);
});

test('a law, effect or experiment named after someone by the name alone: "michelson-morley", but not "rock" for ROCK CYCLE', () => {
  for (const [key, typed] of [
    ['MICHELSON-MORLEY EXPERIMENT', 'michelson-morley'], ['MICHELSON-MORLEY EXPERIMENT', 'michaelson-morley'],
    ['Michelson Morley experiment', 'morley michelson'],
    ['DOPPLER EFFECT', 'doppler'], ['THE DOPPLER EFFECT', 'doppler'], ['KREBS CYCLE', 'krebs'], ['HALL EFFECT', 'hall'],
    ["HOOKE'S LAW", "hooke's"], ["HOOKE'S LAW", 'hookes'], ["HOOKE'S LAW", 'hooke'], ["HESS'S LAW", 'hess'],
    ['PAULI EXCLUSION PRINCIPLE', 'pauli exclusion'], ['PYTHAGOREAN THEOREM', 'pythagorean'], ['NERNST EQUATION', 'nernst'],
    ["HUND'S RULE", 'hunds'], ['HABER-BOSCH PROCESS', 'haber bosch'], ["NEWTON'S FIRST LAW", "newton's first"],
    ["TORRICELLI'S THEOREM (OR LAW)", 'torricelli'],
    ['DOPPLER EFFECT; RED SHIFT', 'doppler, red shift'],
    // a name with more words to it, a possessive not on the list, and accented names typed plain
    ['QUANTUM HALL EFFECT', 'quantum hall'], ['MILLIKAN OIL DROP EXPERIMENT', 'millikan oil drop'], ["ORE'S THEOREM", 'ores'],
    ['SCHRÖDINGER EQUATION', 'schrodinger'], ['HÜCKEL’S RULE', 'huckels'], ["LE CHÂTELIER'S PRINCIPLE", 'le chatelier'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
  // Accents don't matter anywhere.
  assert.ok(isCorrect('SCHRÖDINGER EQUATION', 'schrodinger equation'));
  assert.ok(isCorrect('MOSSBAUER EFFECT', 'mössbauer effect'));
  // The name itself still has to be all there, and right.
  for (const [key, typed] of [
    ['MICHELSON-MORLEY EXPERIMENT', 'michelson'], ['MICHELSON-MORLEY EXPERIMENT', 'experiment'],
    ['PAULI EXCLUSION PRINCIPLE', 'pauli'], ['PAULI EXCLUSION PRINCIPLE', 'exclusion'], ['KREBS CYCLE', 'calvin'],
    // only a name stands alone: after an ordinary word, the last word is half the answer
    ['ROCK CYCLE', 'rock'], ['SKIN EFFECT', 'skin'], ['CELL CYCLE', 'cell'], ['CARBON CYCLE', 'carbon'], ['GREENHOUSE EFFECT', 'greenhouse'],
    ['PHOTOELECTRIC EFFECT', 'photoelectric'], ['CONTACT PROCESS', 'contact'], ['FOUNDER EFFECT', 'founder'], ['IDEAL GAS LAW', 'ideal gas'],
    ['DOUBLE SLIT EXPERIMENT', 'double slit'], ['OCTET RULE', 'octet'], ['UNCERTAINTY PRINCIPLE', 'uncertainty'], ['CHAIN RULE', 'chain'],
    ['CNO CYCLE', 'cno'], ["THE OBSERVER'S EFFECT", "observer's"], ['SKIN EFFECT; RED SHIFT', 'skin, red shift'],
    // other last words aren't dropped, nor is one inside the key
    ['CARBON DIOXIDE', 'carbon'], ['WHITE DWARF', 'white'], ['LAW OF CONSERVATION OF MASS', 'conservation of mass'],
    ['FIRST LAW OF THERMODYNAMICS', 'first'],
    // a number and its unit isn't a name; nor is a single letter
    ['2 METERS PER CYCLE', '2 meters per'], ['S PROCESS', 's'],
  ]) assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  // A typo in the name is close, as anywhere else; a rejected name stays rejected.
  assert.strictEqual(grade('MICHELSON-MORLEY EXPERIMENT', 'mickelson morley').close, true);
  assert.ok(!isCorrect('DOPPLER EFFECT', 'doppler', { reject: ['DOPPLER'] }));
});

test('British and American spellings and possessives are the same word', () => {
  for (const [key, typed] of [
    ['SULFUR', 'sulphur'], ['COLOR', 'colour'], ['HEMOGLOBIN', 'haemoglobin'], ['ALUMINUM', 'aluminium'],
    ['CENTIMETER', 'centimetre'], ['FIBER', 'fibre'], ['ESTROGEN', 'oestrogen'], ['IONIZATION ENERGY', 'ionisation energy'],
    ['HOMOLOG', 'homologue'], ['ETHER', 'aether'], ['MICHELSON', 'michaelson'],
    ["HOOKE'S LAW", 'hookes law'], ["HOOKE'S LAW", 'hooke law'], ["EARTH'S CORE", 'earth core'], ["HUYGENS' PRINCIPLE", 'huygens principle'],
  ]) {
    assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
    assert.ok(isCorrect(typed.toUpperCase(), key.toLowerCase()), `${key} for ${typed}`);
  }
  // Short words, where the same swap is another word, and real differences stay apart.
  for (const [key, typed] of [['LESS', 'loess'], ['LOESS', 'less'], ['AEROBIC', 'anaerobic'], ['ALKANE', 'alkene'], ['FE', 'foe']]) {
    assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  }
});

test('"the other one" is the one item left in an ordering the question lists', () => {
  const waves = 'Arrange the following 3 types of seismic waves from the FIRST to arrive at a seismic recording station to the LAST from a given earthquake: S-wave; L-wave; P-wave';
  const key = 'P-WAVE; S-WAVE; L-WAVE';
  for (const typed of ['p wave s wave other one', 'p wave, s wave, the other one', 'p-wave; s-wave; the last one', 'p wave s wave other',
    'p wave, s wave, the remaining one', 'p wave other one l wave', 'other one s wave l wave']) {
    assert.ok(isCorrect(key, typed, { question: waves }), typed);
  }
  // The rest must be right and in place, and only one item can be left.
  for (const typed of ['s wave p wave other one', 'p wave other one', 'other one other one l wave', 'other one', 'the other one and the last one and l wave']) {
    assert.ok(!isCorrect(key, typed, { question: waves }), typed);
  }
  // Not when the question doesn't list the things (it would be a guess) ...
  assert.ok(!isCorrect(key, 'p wave s wave other one', { question: 'Name the three types of seismic waves in order of arrival.' }));
  // ... or isn't an ordering (the other one of four isn't one thing).
  assert.ok(!isCorrect('HELIUM; NEON', 'helium and the other one', { question: 'Which two of the following four are noble gases: helium, oxygen, neon, iron' }));
  // Numbered items, by number or by name; and a comma-list key.
  const rank = 'Rank the following three from smallest to largest: 1) Sun; 2) Moon; 3) Earth';
  for (const typed of ['2, 3, other one', '2 3 the last one', 'moon, earth, the other one', '2, other one, 1']) assert.ok(isCorrect('2, 3, 1', typed, { question: rank }), typed);
  for (const typed of ['3, 2, other one', 'other one', '2, other one']) assert.ok(!isCorrect('2, 3, 1', typed, { question: rank }), typed);
  assert.ok(isCorrect('LEAD, PHOSPHORUS, HYDROGEN, CALCIUM', 'lead, phosphorus, hydrogen, the other one',
    { question: 'Organize the following elements from oldest date of discovery, to most recent: Calcium, Phosphorus, Hydrogen, Lead' }));
});

test('a key that listed synonyms takes each one: "bog" for BOG (also accept QUAGMIRE, MIRE)', () => {
  const { questions } = loadCorpus();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const bog = byId.get(115053);
  assert.strictEqual(bog.answer.text, 'BOG');
  assert.deepStrictEqual(bog.answer.accept, ['QUAGMIRE', 'MIRE']);
  for (const typed of ['bog', 'quagmire', 'mire']) assert.ok(checkAnswer(bog, typed).correct, typed);
  for (const [id, typed] of [[98657, 'stapes'], [98657, 'stirrup'], [104564, 'coenzyme q'], [98777, 'concave'], [114551, 'ram'], [114238, 'pluto']]) {
    assert.ok(checkAnswer(byId.get(id), typed).correct, `${typed} for question ${id}`);
  }
  // The ordering the "other one" report came from.
  assert.ok(checkAnswer(byId.get(75346), 'p wave s wave other one').correct);
});

test('what a keyboard has: slash fractions, Greek letters by name, x for a times sign', () => {
  for (const [key, typed] of [
    ['½', '1/2'], ['½', '0.5'], ['1/2', '½'], ['2½', '2 1/2'], ['5 ⅔', '5 2/3'], ['¼ F', '1/4 F'], ['⅔mr^2', '2/3 mr^2'], ['½ OHM', '1/2 ohm'],
    ['sin θ', 'sin theta'], ['Rω^2', 'R omega^2'], ['ΔH', 'delta H'], ['2 sec θ', '2 sec theta'], ['λ/2', 'lambda/2'], ['ℏ/2', 'hbar/2'],
    ['(-∞, -4)', '(-infinity, -4)'], ['σ BOND', 'sigma bond'], ['α PARTICLE', 'alpha particle'], ['μ', 'mu'],
    ['67 × 101', '67 x 101'], ['2×2×3', '2x2x3'], ['50 × √3', '50 x √3'],
  ]) assert.ok(isCorrect(key, typed), `${typed} for ${key}`);
  // The symbol is part of the answer: it used to be dropped, so these passed.
  for (const [key, typed] of [['sin θ', 'sin'], ['5 ⅔', '5'], ['½ OHM', 'ohm'], ['ρ = 6', '= 6'], ['(-∞, -4)', '-4)'], ['ΔH', 'h'], ['4x', '4']]) {
    assert.ok(!isCorrect(key, typed), `${typed} for ${key}`);
  }
  // A fraction is one number, never a list of two.
  const list = { question: 'Identify all of the following three that are true: 1) a; 2) b; 3) c' };
  assert.ok(!isCorrect('1/2', '1 and 2'));
  assert.ok(!isCorrect('1/2', '1, 2'));
  assert.ok(!isCorrect('½', '1 2'));
  assert.ok(!isCorrect('1 AND 2', '1/2', list));
  assert.ok(isCorrect('1 AND 2', '1, 2', list));
  assert.ok(isCorrect('1 / 2', '1/2'));
  // A slash inside a longer expression is still just punctuation.
  assert.ok(isCorrect('x^2/2', '(x^2)/2'));
  assert.ok(isCorrect('(a + b)/2', '(a+b) / 2'));
  assert.ok(isCorrect('(1/2)mv^2', '1/2 mv^2'));
});

test('part numbers alone are not the parts: "1, 2" for "1) HALITE; 2) LISTRIC FAULT"', () => {
  const key = '1) HALITE; 2) LISTRIC FAULT';
  for (const typed of ['1, 2', '1/2', '1; 2', '1 and 2']) assert.ok(!isCorrect(key, typed), typed);
  for (const typed of ['halite, listric fault', '1) halite 2) listric fault', 'halite; listric fault']) assert.ok(isCorrect(key, typed), typed);
  // Parts that are numbers still take the bare numbers.
  assert.ok(isCorrect('1) 5 METERS; 2) 7 SECONDS', '5, 7'));
  assert.ok(isCorrect('1) 5; 2) 7', '5, 7'));
});
