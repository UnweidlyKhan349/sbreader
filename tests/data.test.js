// Shape checks on data/questions.json and data/meta.json.
const test = require('node:test');
const assert = require('node:assert');
const { loadCorpus } = require('./helpers');

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

test('meta.json counts match questions.json', () => {
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
