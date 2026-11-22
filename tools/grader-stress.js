#!/usr/bin/env node
/* Stress-tests the grader (js/answer-check.js) against the bank: for a random
   sample of questions it types variants of each key and reports any that come
   out against the grading principle in the README (Answer grading):
     - variants that should pass but don't (lower case, spaces, a full stop,
       "the ...", the MC letter as "w" or "W)");
     - more said than the key ("<key> zebra") or a typo marked right, a typo
       not even Close, a changed digit right or Close, a dropped word right,
       a wrong MC letter or another choice's text right, junk input right;
     - inputs that throw or take over 300 ms.
   Each list needs reading: some entries are allowed by a documented rule
   (a word the question already names can be left off, bare numbers for a
   number and a unit, case rules for formulas).

     node tools/grader-stress.js [sample size, default 6000] [seed] */
const { loadCorpus } = require('../tests/helpers.js');
require('../js/answer-check.js');
const A = globalThis.SBAnswer;
const { questions } = loadCorpus();
let seed = +(process.argv[3] || 12345); const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const N = +process.argv[2] || 6000;
const sample = []; for (let i = 0; i < N; i++) sample.push(pick(questions));
const out = {}; const add = (k, v) => { (out[k] = out[k] || []).push(v); };
const grade = (q, s) => { const t = Date.now(); let r; try { r = A.checkAnswer(q, s); } catch (e) { add('THROWS', `${q.id} ${JSON.stringify(s)} ${e.message}`); return { correct: false, err: true }; } const d = Date.now() - t; if (d > 300) add('SLOW', `${q.id} ${d}ms ${JSON.stringify(s).slice(0, 80)}`); return r; };
const show = (q, s, r) => `${q.id} [${q.format}] key=${JSON.stringify(q.answer.text)}${q.answer.accept.length ? ' ac=' + JSON.stringify(q.answer.accept) : ''} typed=${JSON.stringify(s)} -> ${r.correct ? 'CORRECT' : r.close ? 'close' : 'wrong'}`;
const isNum = (s) => /\d/.test(s);
for (const q of sample) {
  const key = String(q.answer.text || '');
  if (!key) continue;
  if (q.format === 'MC') {
    const L = q.answer.letter;
    for (const s of [L, L.toLowerCase(), L + ')', `${L.toLowerCase()})`, ` ${L} `]) { const r = grade(q, s); if (!r.correct) add('MC letter variant rejected', show(q, s, r)); }
    for (const o of ['W', 'X', 'Y', 'Z'].filter((x) => x !== L && q.choices && q.choices[x])) {
      const r1 = grade(q, o); if (r1.correct) add('MC wrong letter accepted', show(q, o, r1));
      const ct = q.choices[o]; if (ct && ct !== q.choices[L]) { const r2 = grade(q, ct); if (r2.correct) add('MC other choice text accepted', show(q, ct, r2)); }
    }
    const r3 = grade(q, (q.choices && q.choices[L] || '').toLowerCase()); if (q.choices && q.choices[L] && !r3.correct && !r3.close) add('MC own choice text (lowercased) wrong', show(q, q.choices[L].toLowerCase(), r3));
    continue;
  }
  // Variants that should pass.
  for (const s of [key.toLowerCase(), '  ' + key + '  ', key + '.', 'the ' + key.toLowerCase()]) {
    const r = grade(q, s); if (!r.correct) add('SA trivial variant not correct', show(q, s, r));
  }
  // Key plus a junk word: never correct.
  { const s = key + ' zebra'; const r = grade(q, s); if (r.correct) add('SA key+junk correct', show(q, s, r)); }
  { const s = 'zebra ' + key; const r = grade(q, s); if (r.correct) add('SA junk+key correct', show(q, s, r)); }
  // Last word dropped (multi-word, not a kind word): never correct.
  const words = key.split(/\s+/);
  if (words.length >= 2 && !/^(EXPERIMENT|EFFECT|LAW|PRINCIPLE|THEOREM|EQUATION|RULE|PROCESS|CYCLE|RELATION|RELATIONSHIP|HYPOTHESIS|PARADOX|CONJECTURE|POSTULATE|INEQUALITY|APPROXIMATION|PHENOMENON|LIMIT)S?$/i.test(words[words.length - 1]) && !/[;,()]/.test(key) && !/\bOR\b|ACCEPT/i.test(key)) {
    const s = words.slice(0, -1).join(' '); const r = grade(q, s); if (r.correct && s.length > 2) add('SA last word dropped correct', show(q, s, r));
    const s2 = words.slice(1).join(' '); const r2 = grade(q, s2); if (r2.correct && s2.length > 2 && !/^(THE|A|AN)$/i.test(words[0])) add('SA first word dropped correct', show(q, s2, r2));
  }
  // A changed digit: wrong, not close, not correct.
  const m = key.match(/\d/);
  if (m) {
    const i = key.indexOf(m[0]); const d = String((+m[0] + 3) % 10); const s = key.slice(0, i) + d + key.slice(i + 1);
    const r = grade(q, s); if (r.correct) add('SA changed digit correct', show(q, s, r)); else if (r.close) add('SA changed digit close', show(q, s, r));
  }
  // One-letter typo in a long word: close (or correct only via accepts), never wrong silently is fine; flag correct.
  const lw = words.find((w) => /^[A-Za-z]{8,}$/.test(w));
  if (lw && !isNum(key)) {
    const j = 3; const typo = lw.slice(0, j) + lw.slice(j + 1);
    const s = key.replace(lw, typo); const r = grade(q, s);
    if (r.correct) add('SA one-letter typo correct', show(q, s, r)); else if (!r.close) add('SA one-letter typo not close', show(q, s, r));
  }
  // Another question's key (same subject, SA): flag correct.
  const other = pick(questions);
  if (other.format === 'SA' && other.answer.text && other.answer.text.toUpperCase() !== key.toUpperCase() && !q.answer.accept.some((a) => a.toUpperCase() === other.answer.text.toUpperCase())) {
    const r = grade(q, other.answer.text); if (r.correct) add('SA other question key correct', show(q, other.answer.text, r));
  }
  // Garbage.
  for (const s of ['', ' ', '???', 'a'.repeat(400), '1 2 3 4 5 6 7 8 9 0 '.repeat(30), '((((((((', '^^^^', '0']) { const r = grade(q, s); if (r.correct && s.trim() && !/^(0|A)$/i.test(key.trim())) add('SA garbage correct', show(q, s.slice(0, 30), r)); }
}
for (const k of Object.keys(out)) { console.log(`\n== ${k}: ${out[k].length}`); console.log(out[k].slice(0, 25).join('\n')); }
