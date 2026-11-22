#!/usr/bin/env node
/* Stress-tests the grader (js/answer-check.js) against the bank. For each
   question (a random sample, or every one with --all) it types variants of
   the key and reports any graded against the principle in the README
   (Answer grading):
     should pass   the key in lower or upper case, with spaces around it, a
                   closing full stop or "the ..." in front; every accept
                   entry; on MC the letter as "w", "W)", "(W)" and the
                   choice text, alone or after its letter;
     never right   every reject entry; the key with a junk word before or
                   after it; "not <key>"; a typo; a changed digit (right or
                   Close); a flipped sign; a word dropped; a ranking
                   reversed; another question's key; a wrong MC letter or
                   another choice's text; junk input;
     should be     a one-letter typo in a long word (Close, not Wrong);
     Close
     never         throws, or takes over 300 ms (adversarial input too).
   Each list needs reading: some entries are allowed by a documented rule
   (a word the question already names can be left off, bare numbers for a
   number and a unit, case rules for formulas, the same answer said another
   way).

     node tools/grader-stress.js [sample size, default 6000] [seed]
     node tools/grader-stress.js --all [--shard i/n]     every question
   Prints each category's count and up to --show N examples (default 25). */
const { loadCorpus } = require('../tests/helpers.js');
require('../js/answer-check.js');

const A = globalThis.SBAnswer;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : (args.splice(i, 2)[1] || ''); };
const all = args.includes('--all'); if (all) args.splice(args.indexOf('--all'), 1);
const shard = (flag('--shard') || '0/1').split('/').map(Number);
const SHOW = +(flag('--show') || 25);
const json = flag('--json');
const { questions } = loadCorpus();
let seed = +(args[1] || 12345);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
let sample;
if (all) sample = questions.filter((q, i) => i % shard[1] === shard[0]);
else { sample = []; const N = +(args[0] || 6000); for (let i = 0; i < N; i++) sample.push(pick(questions)); }

const out = {};
let checks = 0;
const add = (k, v) => { (out[k] = out[k] || []).push(v); };
const verdict = (r) => (r.correct ? 'CORRECT' : r.close ? 'close' : 'wrong');
const show = (q, s, r) => `${q.id} [${q.format}] key=${JSON.stringify(q.answer.text)}${q.answer.accept.length ? ' ac=' + JSON.stringify(q.answer.accept) : ''}${q.answer.reject.length ? ' rj=' + JSON.stringify(q.answer.reject) : ''} typed=${JSON.stringify(String(s).slice(0, 120))} -> ${verdict(r)}`;
function grade(q, s) {
  checks++;
  const t = process.hrtime.bigint();
  let r;
  try { r = A.checkAnswer(q, s); } catch (e) { add('THROWS', `${q.id} ${JSON.stringify(String(s).slice(0, 80))} ${e.message}`); return { correct: false, close: false, err: true }; }
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  if (ms > 300) add('SLOW (>300 ms)', `${q.id} ${ms.toFixed(0)}ms ${JSON.stringify(String(s).slice(0, 80))}`);
  return r || { correct: false };
}
const up = (s) => String(s).toUpperCase();
const KIND = /^(EXPERIMENT|EFFECT|LAW|PRINCIPLE|THEOREM|EQUATION|RULE|PROCESS|CYCLE|RELATION|RELATIONSHIP|HYPOTHESIS|PARADOX|CONJECTURE|POSTULATE|INEQUALITY|APPROXIMATION|PHENOMENON|LIMIT)S?$/i;
const ADVERSARIAL = ['', ' ', '???', 'a'.repeat(400), '1 2 3 4 5 6 7 8 9 0 '.repeat(30), '('.repeat(150), ')('.repeat(100), '^'.repeat(200),
  '1^2^3^4^5^6^7^8^9^1^2^3^4^5^6^7^8^9', 'sqrt(sqrt(sqrt(sqrt(sqrt(sqrt(sqrt(2)))))))', 'x'.repeat(60) + '!', '1/'.repeat(80) + '1',
  'and '.repeat(100), ', '.repeat(150), 'ALL BUT ALL BUT ALL BUT 1', '-'.repeat(200), '💥🧪 ∫∑∏√∞', '\u0000\u0007', 'e'.repeat(250), '10^10^10^10^10'];

for (const q of sample) {
  const key = String(q.answer.text || '');
  if (!key) continue;
  const accepts = q.answer.accept || [];
  const rejects = q.answer.reject || [];
  // Rejects: never right (unless the same text is the key or an accept).
  for (const rj of rejects) {
    if ([key, ...accepts].some((k) => up(k) === up(rj))) continue;
    const r = grade(q, rj); if (r.correct) add('reject entry right', show(q, rj, r));
  }
  if (q.format === 'MC') {
    const L = q.answer.letter;
    const own = q.choices && q.choices[L];
    for (const s of [L, L.toLowerCase(), L + ')', `${L.toLowerCase()})`, `(${L})`, ` ${L} `, L + '.']) { const r = grade(q, s); if (!r.correct) add('MC letter form not right', show(q, s, r)); }
    if (own) {
      for (const s of [own, own.toLowerCase(), `${L}) ${own}`]) { const r = grade(q, s); if (!r.correct && !r.close) add('MC own choice text wrong', show(q, s, r)); }
    }
    for (const o of ['W', 'X', 'Y', 'Z'].filter((x) => x !== L && q.choices && q.choices[x])) {
      const r1 = grade(q, o); if (r1.correct) add('MC wrong letter right', show(q, o, r1));
      const ct = q.choices[o];
      if (ct && ct !== own) { const r2 = grade(q, ct); if (r2.correct) add('MC other choice text right', show(q, ct, r2)); }
    }
    for (const s of ADVERSARIAL.slice(0, 6)) { const r = grade(q, s); if (r.correct) add('junk right', show(q, s, r)); }
    continue;
  }
  // Should pass.
  for (const s of [key.toLowerCase(), up(key), '  ' + key + '  ', key + '.', 'the ' + key.toLowerCase()]) {
    const r = grade(q, s); if (!r.correct) add('trivial variant not right', show(q, s, r));
  }
  for (const ac of accepts) {
    if (/\bORDER\b|ANYTHING|ANY VALUE|BETWEEN/i.test(ac)) continue; // notes
    const r = grade(q, ac); if (!r.correct) add('accept entry not right', show(q, ac, r));
  }
  // Never right.
  for (const s of [key + ' zebra', 'zebra ' + key]) { const r = grade(q, s); if (r.correct) add('key + junk word right', show(q, s, r)); }
  { const s = 'not ' + key; const r = grade(q, s); if (r.correct) add('"not <key>" right', show(q, s, r)); }
  const words = key.split(/\s+/);
  if (words.length >= 2 && !KIND.test(words[words.length - 1]) && !/[;,()]/.test(key) && !/\bOR\b|ACCEPT/i.test(key)) {
    const s = words.slice(0, -1).join(' ');
    const r = grade(q, s); if (r.correct && s.length > 2) add('last word dropped right (check: does the question name it?)', show(q, s, r));
  }
  const m = key.match(/\d/);
  if (m) {
    const i = key.indexOf(m[0]); const s = key.slice(0, i) + String((+m[0] + 3) % 10) + key.slice(i + 1);
    const r = grade(q, s); if (r.correct) add('changed digit right', show(q, s, r)); else if (r.close) add('changed digit Close', show(q, s, r));
  }
  if (/^\s*\d/.test(key)) {
    const s = '-' + key.trim(); const r = grade(q, s); if (r.correct) add('sign flipped right', show(q, s, r));
  }
  const sw = words.find((w) => /^[A-Za-z]{3,4}$/.test(w));
  if (sw && words.length === 1) {
    const s = key.replace(sw, sw.slice(0, 1) + sw.slice(2));
    const r = grade(q, s); if (r.correct) add('short-word typo right', show(q, s, r));
  }
  const lw = words.find((w) => /^[A-Za-z]{8,}$/.test(w));
  if (lw && !/\d/.test(key)) {
    const s = key.replace(lw, lw.slice(0, 3) + lw.slice(4)); const r = grade(q, s);
    if (r.correct) add('one-letter typo right', show(q, s, r)); else if (!r.close) add('one-letter typo Wrong (expected Close)', show(q, s, r));
  }
  const nums = key.match(/^\s*(\d)\s*,\s*(\d)\s*,\s*(\d)(?:\s*,\s*(\d))?\s*$/);
  if (nums && /order|rank|arrange|sequence/i.test(q.question)) {
    const rev = nums.slice(1).filter(Boolean).reverse();
    if (rev.join() !== nums.slice(1).filter(Boolean).join()) { const s = rev.join(', '); const r = grade(q, s); if (r.correct) add('ranking reversed right', show(q, s, r)); }
  }
  const other = pick(questions);
  if (other.format === 'SA' && other.answer.text && up(other.answer.text) !== up(key) && ![...accepts, key].some((a) => up(a) === up(other.answer.text))) {
    const r = grade(q, other.answer.text); if (r.correct) add('another question\'s key right (check: same answer?)', show(q, other.answer.text, r));
  }
  for (const s of ADVERSARIAL) { const r = grade(q, s); if (r.correct && String(s).trim() && !/^(0|A|E|ALL)$/i.test(key.trim())) add('junk right', show(q, s, r)); }
}

if (json) { require('fs').writeFileSync(json, JSON.stringify({ checks, questions: sample.length, out })); }
console.log(`${sample.length} questions, ${checks} answers graded`);
for (const k of Object.keys(out).sort()) { console.log(`\n== ${k}: ${out[k].length}`); console.log(out[k].slice(0, SHOW).join('\n')); }
