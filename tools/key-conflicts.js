#!/usr/bin/env node
/* Lists pairs of questions that read almost the same but are keyed
   differently: the quickest way to find wrong keys, since a question printed
   in two packets (or a packet that reworded another's) should have the same
   answer. Word sets are compared with signs and numbers kept ("-7" isn't
   "7"), every number must match, and a pair is listed only when neither key
   (nor an accept) passes the grader for the other question. For multiple
   choice, the two must share at least three choices.

   Each pair still needs reading: most differ for a reason ("increasing" vs
   "decreasing", items numbered in another order, a different genotype).
   Found this way (November 22, 2026): see docs/data-history.md, Wrong-key
   corrections.

     node tools/key-conflicts.js [min similarity, default 0.65]  */
const { loadCorpus } = require('../tests/helpers.js');
require('../js/answer-check.js');
const A = globalThis.SBAnswer;
const MIN = Number(process.argv[2]) || 0.65;
const { questions } = loadCorpus();
// words with signs and digits kept ("-7" and "7" differ)
const words = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–−]/g, '-').match(/-?[a-z0-9^.\/+]+/g) || [];
const STOP = new Set('the a an of to in is what which following and or for by on with as at that this be are from it its of'.split(' '));
const qs = questions.filter((q) => q.question && q.question.length >= 30);
const sets = qs.map((q) => new Set(words(q.question).filter((w) => !STOP.has(w))));
// index by rare-ish words
const df = new Map();
sets.forEach((s) => s.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
const index = new Map();
sets.forEach((s, i) => { [...s].filter((w) => df.get(w) <= 60).forEach((w) => { if (!index.has(w)) index.set(w, []); index.get(w).push(i); }); });
const pairs = new Set();
const out = [];
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9+\-./^]+/g, ' ').trim();
const answerText = (q) => (q.format === 'MC' && q.choices && q.answer.letter ? q.choices[q.answer.letter] : q.answer.text);
for (let i = 0; i < qs.length; i++) {
  const cand = new Map();
  for (const w of sets[i]) for (const j of index.get(w) || []) if (j > i) cand.set(j, (cand.get(j) || 0) + 1);
  for (const [j, shared] of cand) {
    if (shared < 3) continue;
    const a = sets[i], b = sets[j];
    let inter = 0; for (const w of a) if (b.has(w)) inter++;
    const jac = inter / (a.size + b.size - inter);
    if (jac < MIN) continue;
    // every number in one question is in the other: otherwise a different problem
    const nums = (s) => [...s].filter((w) => /\d/.test(w)).sort().join(' ');
    if (nums(a) !== nums(b)) continue;
    const x = qs[i], y = qs[j];
    // same answer?
    const xa = answerText(x), ya = answerText(y);
    if (!xa || !ya) continue;
    if (norm(xa) === norm(ya)) continue;
    // MC with the same choices but a different right choice, or answers the grader can't reconcile
    const asSA = (q) => ({ question: q.question, format: 'SA', choices: null, answer: { text: answerText(q), accept: q.format === 'SA' ? q.answer.accept : [], reject: [] } });
    const ok = (p, r) => A.checkAnswer(asSA(p), answerText(r)).correct || (r.format === 'SA' && (r.answer.accept || []).some((ac) => A.checkAnswer(asSA(p), ac).correct));
    if (ok(x, y) || ok(y, x)) continue;
    // MC questions with different choice sets where the other's key isn't even offered: skip (different question)
    if (x.format === 'MC' && y.format === 'MC') {
      const cs = (q) => new Set(Object.values(q.choices || {}).map(norm));
      const cx = cs(x), cy = cs(y);
      let same = 0; cx.forEach((c) => { if (cy.has(c)) same++; });
      if (same < 3) continue;
    }
    out.push({ jac, x, y });
  }
}
out.sort((p, q) => q.jac - p.jac);
const show = (q) => `${q.id} ${q.tSlug} | ${q.roundLabel || ''} #${q.num} [${q.format}] KEY=${q.format === 'MC' ? q.answer.letter + ') ' + answerText(q) : answerText(q)}${q.answer.accept.length ? ' ac=' + JSON.stringify(q.answer.accept) : ''}`;
console.log(out.length, 'candidate pairs');
for (const { jac, x, y } of out) console.log(`\n[${jac.toFixed(2)}] A: ${x.question.slice(0, 200).replace(/\n/g, ' ')}${x.choices ? '\n     ' + JSON.stringify(x.choices).slice(0, 200) : ''}\n   B: ${y.question.slice(0, 200).replace(/\n/g, ' ')}${y.choices ? '\n     ' + JSON.stringify(y.choices).slice(0, 200) : ''}\n   ${show(x)}\n   ${show(y)}`);
