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
    'source URL already has a fragment': (q) => q.u != null && q.u.includes('#'),
    'packet location (pg) is not a positive whole number': (q) => q.pg != null && !(Number.isInteger(q.pg) && q.pg > 0),
    'packet location (pg) on a link that has no pages or lines': (q) => q.pg != null && !globalThis.SBData.packetAnchor(q.u, q.pg),
  });
  assert.deepStrictEqual(found, {});
});

// PDF extraction can leave control characters in text: form feeds from page
// breaks, Symbol-font glyphs decoded as U+000F, newlines from layout. The
// bank writes everything on one line (matrices as "first row 2, 3, 4, ...").
test('no text field holds a control character', () => {
  const CONTROL = /[\u0000-\u001f]/;
  const texts = (q) => [q.t, q.rl, q.q, ...Object.values(q.c || {}), q.a.t, ...(q.a.ac || []), ...(q.a.rj || [])];
  const found = check(raw, {
    'control character in text': (q) => texts(q).some((s) => typeof s === 'string' && CONTROL.test(s)),
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

test('the newest-first order lists tournaments by meta.json date, each in packet order', () => {
  const { questions } = globalThis.SBData;
  globalThis.SBData.meta = loadCorpus().meta;
  const date = new Map(meta.tournaments.map((t) => [t.name, t.date]));
  assert.ok(meta.tournaments.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || '')), 'every tournament has a YYYY-MM-DD date');
  const recent = globalThis.SBData.sortByPacketOrder(questions, { recent: true });
  const packet = globalThis.SBData.sortByPacketOrder(questions);
  assert.strictEqual(recent.length, questions.length);
  for (let i = 1; i < recent.length; i++) {
    assert.ok(date.get(recent[i - 1].tournament) >= date.get(recent[i].tournament), `dates descend at ${i}`);
  }
  // Within one tournament the two orders agree.
  const t = recent[0].tournament;
  assert.deepStrictEqual(recent.filter((q) => q.tournament === t).map((q) => q.id),
    packet.filter((q) => q.tournament === t).map((q) => q.id));
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

// data/source-subjects.json holds, for every question, the subject its
// packet prints (or its ScibowlDB/isobowl entry, or a copy's packet when its
// own isn't online): a subject key, "other" for
// Energy, General Science and the like (placed by the Energy rule), or null
// when no source could be checked. A question filed under a different subject
// than its source prints must be listed in data/subject-overrides.json as
// "printed→filed", so a mislabel can't slip in unnoticed (README: Placement).
test('every subject matches what its source prints, or is a listed override', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const printed = read('data/source-subjects.json');
  const overrides = read('data/subject-overrides.json');
  const subjects = new Set(meta.subjects);
  const byId = new Map(raw.map((q) => [String(q.i), q]));
  const found = check(raw, {
    'no entry in data/source-subjects.json (null if the source can\'t be checked)': (q) => !(String(q.i) in printed),
    'unknown printed subject': (q) => printed[q.i] != null && printed[q.i] !== 'other' && !subjects.has(printed[q.i]),
    'differs from its source and isn\'t a listed override': (q) => {
      const p = printed[q.i];
      return p != null && p !== 'other' && p !== q.s && overrides[q.i] !== `${p}→${q.s}`;
    },
  });
  // An override that no longer describes a difference is stale.
  const stale = Object.entries(overrides).filter(([id, v]) => {
    const q = byId.get(id);
    return !q || v !== `${printed[id]}→${q.s}`;
  }).map(([id]) => id);
  if (stale.length) found['stale override'] = stale.slice(0, 10);
  const extra = Object.keys(printed).filter((id) => !byId.has(id));
  if (extra.length) found['source subject for a question not in the bank'] = extra.slice(0, 10);
  assert.deepStrictEqual(found, {});
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

test('a packet location becomes a #page= or #L fragment only on PDF and GitHub links', () => {
  const { packetAnchor } = globalThis.SBData;
  assert.strictEqual(packetAnchor('https://lebot.djiang.xyz/packets/AVES-2025/AVES%20DE1.pdf', 4), '#page=4');
  assert.strictEqual(packetAnchor('https://example.org/round1.PDF?dl=1', 2), '#page=2');
  assert.strictEqual(packetAnchor('https://github.com/a/b/blob/master/sets/x.txt', 120), '#L120');
  assert.strictEqual(packetAnchor('https://docs.google.com/document/d/abc/edit', 3), '');
  assert.strictEqual(packetAnchor('https://isobowl.com/premier/tournaments/icsbt-3?round=1', 3), '');
  assert.strictEqual(packetAnchor('https://example.org/a.pdf', undefined), '');
  const { questions } = loadCorpus();
  const placed = questions.find((q) => /\.pdf#page=\d+$/.test(q.sourceUrl || ''));
  assert.ok(placed, 'some question links to its page');
});

test("meta.json's per-set counts (tossups, bonuses, packets) match the bank", () => {
  const { expectedMeta } = require('../tools/meta-counts.js');
  const { rawMeta } = loadCorpus();
  const expected = expectedMeta(rawMeta);
  const stale = rawMeta.tournaments.filter((t, i) => ['count', 'tossups', 'bonuses', 'packets']
    .some((k) => t[k] !== expected.tournaments[i][k])).map((t) => t.slug);
  assert.deepStrictEqual(stale, [], 'run node tools/meta-counts.js');
});

test('numbered statements go on their own lines, and parenthesised numbers are left alone', () => {
  const f = SBData.splitNumberedStatements;
  assert.strictEqual(f('identify all of the following statements that are true: 1) pi donor ligands decrease delta nought; 2) pi acceptor ligands do not affect delta nought; 3) the inner d orbitals are affected'),
    'identify all of the following statements that are true\n1) pi donor ligands decrease delta nought\n2) pi acceptor ligands do not affect delta nought\n3) the inner d orbitals are affected');
  assert.strictEqual(f('Which would increase it? 1) A 2) B, and 3) C.'), 'Which would increase it?\n1) A\n2) B\n3) C.');
  assert.strictEqual(f('Rank: 1) sin(π/6) + 1; 2) e^3/2'), 'Rank\n1) sin(π/6) + 1\n2) e^3/2');
  assert.strictEqual(f('The point (5,6) moves: 1) up; 2) down'), 'The point (5,6) moves\n1) up\n2) down');
  assert.strictEqual(f('Runtime O(n^2) here. 1) X 2) Y'), 'Runtime O(n^2) here.\n1) X\n2) Y');
  assert.strictEqual(f('Two parts: 1) Name it? 2) Order these: 1) a 2) b'), 'Two parts\n1) Name it?\n2) Order these\n1) a\n2) b');
  // A lone "1)" or numbers in parentheses aren't a list.
  assert.strictEqual(f('Only one 1) here'), 'Only one 1) here');
  assert.strictEqual(f('Points (1, 2) and (3, 4)'), 'Points (1, 2) and (3, 4)');
  assert.ok(SBData.questionTextHTML({ question: 'Name: 1) x^2; 2) y' }).includes('\n1) x<sup>2</sup>\n2) y'));
});

test('meta.json stamps each bank file with its contents (node tools/meta-counts.js)', () => {
  const { fileStamp } = require('../tools/meta-counts.js');
  const meta = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'meta.json'), 'utf8'));
  assert.strictEqual(meta.bankIndex, fileStamp('data/bank/index.json'));
  for (const t of meta.tournaments) assert.strictEqual(t.v, fileStamp(`data/bank/${t.slug}.json`), t.slug);
});
