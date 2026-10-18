// Shape checks on the question bank (data/bank/) and data/meta.json.
const test = require('node:test');
const assert = require('node:assert');
const { loadCorpus, ROOT } = require('./helpers');

const { raw, rawMeta: meta } = loadCorpus();
const LETTERS = ['W', 'X', 'Y', 'Z'];

// Collects up to 10 offending ids per problem so a failure says where to look.
function check(rows, problems) {
  const found = {};
  for (const q of rows) {
    for (const [name, isBad] of Object.entries(problems)) {
      if (isBad(q)) (found[name] = found[name] || []).length < 10 && found[name].push(q.i);
    }
  }
  return found;
}

test('every record has the fields and values the site expects', () => {
  const tournaments = new Map(meta.tournaments.map((t) => [t.slug, t]));
  const found = check(raw, {
    'missing a required field': (q) => ['i', 't', 'ts', 's', 'f', 'qt', 'q', 'a'].some((k) => q[k] == null || q[k] === ''),
    'empty answer': (q) => typeof q.a.t !== 'string' || !q.a.t.trim(),
    'unknown tournament slug': (q) => !tournaments.has(q.ts),
    'tournament name differs from meta.json': (q) => tournaments.has(q.ts) && tournaments.get(q.ts).name !== q.t,
    'unknown format': (q) => !meta.formats.includes(q.f),
    'unknown subject': (q) => !meta.subjects.includes(q.s),
    'unknown question type': (q) => !meta.qtypes.includes(q.qt),
    'round not listed in meta.rounds': (q) => q.r != null && !meta.rounds.includes(q.r),
    'MC without four choices': (q) => q.f === 'MC' && !(q.c && LETTERS.every((L) => typeof q.c[L] === 'string')),
    'MC without a W/X/Y/Z answer letter': (q) => q.f === 'MC' && !LETTERS.includes(q.a.l),
    'source URL is not https': (q) => q.u != null && !/^https:\/\//.test(q.u),
  });
  assert.deepStrictEqual(found, {});
});

test('ids are unique', () => {
  const seen = new Set();
  const dupes = raw.filter((q) => seen.has(q.i) || !seen.add(q.i)).map((q) => q.i);
  assert.deepStrictEqual(dupes.slice(0, 10), []);
});

test('meta.json counts match the bank', () => {
  assert.strictEqual(meta.totalQuestions, raw.length);
  const counts = {};
  raw.forEach((q) => { counts[q.ts] = (counts[q.ts] || 0) + 1; });
  const wrong = meta.tournaments.filter((t) => counts[t.slug] !== t.count).map((t) => `${t.slug}: meta ${t.count}, actual ${counts[t.slug] || 0}`);
  assert.deepStrictEqual(wrong, []);
});

test('bookmark aliases point at questions that exist', () => {
  const ids = new Set(raw.map((q) => q.i));
  const broken = Object.entries(meta.idAliases || {}).filter(([, to]) => !ids.has(to)).slice(0, 10);
  assert.deepStrictEqual(broken, []);
});

test('every visual question\'s images exist, and every image file is used', () => {
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./helpers');
  const imgDir = path.join(ROOT, 'data/img');
  const used = new Set();
  const problems = [];
  for (const q of raw) {
    if (q.im === undefined) continue;
    if (!Array.isArray(q.im) || !q.im.length) { problems.push(`${q.i}: im is not a non-empty list`); continue; }
    for (const im of q.im) {
      if (typeof im.f !== 'string' || !(im.w > 0) || !(im.h > 0)) problems.push(`${q.i}: bad image entry`);
      else if (!fs.existsSync(path.join(imgDir, im.f))) problems.push(`${q.i}: missing ${im.f}`);
      else used.add(im.f);
    }
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(imgDir, path.join(d, e.name))]));
  const unused = fs.existsSync(imgDir) ? walk(imgDir).filter((f) => !used.has(f)) : [];
  assert.deepStrictEqual(problems.slice(0, 10), []);
  assert.deepStrictEqual(unused.slice(0, 10), []);
});

test('the Visual filter splits the bank into visual and text-only questions', () => {
  const { questions } = loadCorpus();
  globalThis.SBData.questions = questions;
  const visual = globalThis.SBData.filterQuestions({ visuals: ['visual'] });
  const text = globalThis.SBData.filterQuestions({ visuals: ['text'] });
  assert.ok(visual.length > 0);
  assert.ok(visual.every((q) => q.images.length > 0 && q.images.every((im) => im.src.startsWith('data/img/'))));
  assert.strictEqual(visual.length + text.length, questions.length);
  assert.strictEqual(globalThis.SBData.filterQuestions({ visuals: ['visual', 'text'] }).length, questions.length);
});

test('packet order matches a direct collator sort, for the whole bank and for a filtered subset', () => {
  const { questions } = loadCorpus();
  globalThis.SBData.questions = questions;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const nullsLast = (a, b) => (a == null ? (b == null ? 0 : 1) : (b == null ? -1 : a - b));
  const qtRank = (t) => ['tossup', 'bonus'].indexOf(t);
  const pos = new Map(questions.map((q, i) => [q, i]));
  const reference = (list) => list.slice().sort((a, b) =>
    coll.compare(a.tournament || '', b.tournament || '')
    || nullsLast(a.round, b.round)
    || coll.compare(a.roundLabel || '', b.roundLabel || '')
    || nullsLast(a.num, b.num)
    || qtRank(a.qtype) - qtRank(b.qtype)
    || pos.get(a) - pos.get(b)).map((q) => q.id);
  const ids = (list) => globalThis.SBData.sortByPacketOrder(list).map((q) => q.id);
  assert.deepStrictEqual(ids(questions), reference(questions));
  const subset = globalThis.SBData.filterQuestions({ subjects: ['chem'], qtypes: ['bonus'] }).reverse();
  assert.deepStrictEqual(ids(subset), reference(subset));
});

test('data/bank holds exactly one file per meta.json tournament, in the form tools/bank.js writes', () => {
  const fs = require('fs');
  const path = require('path');
  const { packRecords, formatShard } = require('../tools/bank.js');
  const dir = path.join(ROOT, 'data/bank');
  const files = fs.readdirSync(dir).filter((f) => f !== 'index.json').sort();
  assert.deepStrictEqual(files, meta.tournaments.map((t) => t.slug + '.json').sort());
  // Re-packing the flat records reproduces every file byte for byte, so the
  // files and the tool agree on the format (and packets aren't split up).
  const repacked = packRecords(raw);
  const differ = meta.tournaments.filter((t) =>
    formatShard(repacked.get(t.slug)) !== fs.readFileSync(path.join(dir, t.slug + '.json'), 'utf8'));
  assert.deepStrictEqual(differ.map((t) => t.slug), []);
});

test('data/bank/index.json maps every question id to its own tournament', () => {
  const fs = require('fs');
  const path = require('path');
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bank/index.json'), 'utf8'));
  const SBData = globalThis.SBData;
  const wrong = raw.filter((q) => SBData.slugForId(index.ids, q.i) !== q.ts).map((q) => q.i);
  assert.deepStrictEqual(wrong.slice(0, 10), []);
  // Every alias target resolves too, since bookmarks are migrated first.
  const aliasWrong = Object.values(meta.idAliases || {}).filter((to) => !SBData.slugForId(index.ids, to));
  assert.deepStrictEqual(aliasWrong.slice(0, 10), []);
});

test('search matches every word in the question, answer or tournament, ignoring case, order and exponent markup', () => {
  const { questions } = loadCorpus();
  const SBData = globalThis.SBData;
  SBData.questions = questions;
  const plain = (t) => t.replace(/\^\(([^()]*)\)/g, '$1').replace(/\^/g, '');
  const has = (t, s) => { const l = t.toLowerCase(); return l.includes(s) || plain(l).includes(s); };
  const hasWord = (q, w) => has(q.question, w) || has(q.answer.text, w) || has(q.tournament, w);
  for (const search of ['7100', 'enzyme', 'MIT 2025', 'x^2', 'e^(', 'sodium chloride', ' q', 'aves 2025 photosynthesis', 'chloride  sodium', 'cell mitochondria membrane']) {
    const words = search.trim().toLowerCase().split(/\s+/);
    const expected = questions.filter((q) => words.every((w) => hasWord(q, w))).map((q) => q.id);
    assert.deepStrictEqual(SBData.filterQuestions({ search }).map((q) => q.id), expected, search);
  }
  // Words needn't be adjacent or in order.
  const apart = SBData.filterQuestions({ search: 'chloride sodium' }).length;
  assert.ok(apart >= SBData.filterQuestions({ search: 'sodium chloride' }).length && apart > 0);
});
