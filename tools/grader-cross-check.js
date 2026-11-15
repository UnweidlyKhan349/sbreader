/* Grades every 10th short-answer question with three other questions'
   answers from its own set, and lists the ones accepted: the grader's
   cross-question check (see tests/answer-check.test.js). An answer key of
   one question passing for another is usually a false positive ("1/3" vs
   "1 and 3"); the few that are the same answer said another way ("1 and 2"
   for "12", "All" for "1, 2, 3") are listed in tests/grader-cross-accepts.json.

     node tools/grader-cross-check.js            print the accepted pairs
     node tools/grader-cross-check.js --write    rewrite the snapshot */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'answer-check.js'));
const { checkAnswer, normalize } = globalThis.SBAnswer;

function crossAccepts(step = 10) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  const out = [];
  for (const t of meta.tournaments) {
    const qs = [];
    for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bank', t.slug + '.json'), 'utf8'))) {
      for (const q of p.q) if (q.f === 'SA') qs.push(q);
    }
    for (let i = 0; i < qs.length; i += step) {
      const q = qs[i];
      const own = new Set([q.a.t, ...(q.a.ac || [])].map(normalize));
      const question = { question: q.q, format: 'SA', choices: null, answer: { text: q.a.t, letter: null, accept: q.a.ac || [], reject: q.a.rj || [] } };
      for (const d of [1, 7, 13]) {
        const other = qs[(i + d) % qs.length];
        if (other === q || own.has(normalize(other.a.t))) continue;
        if (checkAnswer(question, other.a.t).correct) out.push(`${q.i} | ${q.a.t} | ${other.a.t}`);
      }
    }
  }
  return out.sort();
}
module.exports = { crossAccepts };

if (require.main === module) {
  const list = crossAccepts();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(ROOT, 'tests', 'grader-cross-accepts.json'), JSON.stringify(list, null, 1) + '\n');
    console.log(`Wrote ${list.length} accepted pairs.`);
  } else list.forEach((x) => console.log(x));
}
