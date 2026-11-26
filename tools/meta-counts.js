/* Refreshes each tournament's counts in data/meta.json from the bank:
   count (questions), tossups, bonuses and packets (distinct round labels),
   which the Set List shows, and the total. It also writes the number of
   questions and tournaments into the home page (index.html, #tagline),
   which shows them without loading meta.json, and data/frequency.json,
   each subject's most frequent answers (SBData.frequencyList), so the
   Frequency List doesn't need the whole bank.

     node tools/meta-counts.js            rewrite data/meta.json
     node tools/meta-counts.js --check    exit 1 if anything is out of date */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'data', 'meta.json');
const HOME = path.join(ROOT, 'index.html');
const FREQUENCY = path.join(ROOT, 'data', 'frequency.json');
const FREQUENCY_LIMIT = 50;
const { readBank } = require(path.join(ROOT, 'tools', 'bank.js'));
const SBData = globalThis.SBData; // js/data.js, loaded by tools/bank.js

function countsFor(packets) {
  const out = { count: 0, tossups: 0, bonuses: 0, packets: 0 };
  const labels = new Set();
  packets.forEach((p) => {
    labels.add(p.rl || '');
    p.q.forEach((q) => {
      out.count++;
      if (q.qt === 'tossup') out.tossups++;
      else if (q.qt === 'bonus') out.bonuses++;
    });
  });
  out.packets = labels.size;
  return out;
}

// A stamp of a bank file's contents. The site fetches <slug>.json?v=<stamp>,
// so a browser's cached copy (js/sw.js keeps them) is only reused while the
// file is unchanged.
function fileStamp(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10) : '';
}

function expectedMeta(meta) {
  const bank = new Map(readBank(meta).map((b) => [b.slug, b.packets]));
  const tournaments = meta.tournaments.map((t) => ({ ...t, ...countsFor(bank.get(t.slug) || []), v: fileStamp(`data/bank/${t.slug}.json`) }));
  return {
    ...meta,
    totalQuestions: tournaments.reduce((n, t) => n + t.count, 0),
    bankIndex: fileStamp('data/bank/index.json'),
    bankAliases: fileStamp('data/bank/aliases.json'),
    tournaments,
  };
}

// The home page's Question Database line, with the counts in it.
const TAGLINE_RE = /<p id="tagline">[^<]*<\/p>/;
function homeTagline(meta) {
  return `<p id="tagline">A searchable database of ${meta.totalQuestions.toLocaleString('en-US')} Science Bowl questions from ${meta.tournaments.length} tournaments, from regionals and nationals to invitationals and school-team practice sets.</p>`;
}
function expectedHome(html, meta) {
  if (!TAGLINE_RE.test(html)) throw new Error('index.html has no <p id="tagline">');
  return html.replace(TAGLINE_RE, () => homeTagline(meta));
}

// data/frequency.json: { subject: [{ answer, count }] }, each subject's
// FREQUENCY_LIMIT most frequent answers over the whole bank, one subject to
// a line. js/frequency-list.js shows these.
function expectedFrequency(meta) {
  const norm = SBData.normalizeMeta(JSON.parse(JSON.stringify(meta)));
  const questions = SBData.expandQuestions(norm, readBank(meta));
  const lines = norm.subjects.map((s) => {
    const list = SBData.frequencyList(questions.filter((q) => q.subject === s.key), FREQUENCY_LIMIT);
    return JSON.stringify(s.key) + ': ' + JSON.stringify(list);
  });
  return '{\n' + lines.join(',\n') + '\n}\n';
}

// meta.json is written the way Python's json.dumps writes it (", " and
// ": " separators, UTF-8 left as is), so the file keeps its layout.
function pyJson(v) {
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => pyJson(k) + ': ' + pyJson(x)).join(', ') + '}';
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v);
}

module.exports = { countsFor, expectedMeta, expectedHome, expectedFrequency, fileStamp, pyJson };

if (require.main === module) {
  const text = fs.readFileSync(META, 'utf8');
  const meta = JSON.parse(text);
  const next = expectedMeta(meta);
  const stale = meta.tournaments.filter((t, i) => ['count', 'tossups', 'bonuses', 'packets', 'v'].some((k) => t[k] !== next.tournaments[i][k]));
  if (meta.bankIndex !== next.bankIndex) stale.push({ slug: 'index.json' });
  if (meta.bankAliases !== next.bankAliases) stale.push({ slug: 'aliases.json' });
  if (meta.totalQuestions !== next.totalQuestions) stale.push({ slug: 'totalQuestions' });
  const home = fs.readFileSync(HOME, 'utf8');
  const nextHome = expectedHome(home, next);
  if (home !== nextHome) stale.push({ slug: 'the home page (index.html)' });
  const freq = fs.existsSync(FREQUENCY) ? fs.readFileSync(FREQUENCY, 'utf8') : '';
  const nextFreq = expectedFrequency(next);
  if (freq !== nextFreq) stale.push({ slug: 'data/frequency.json' });
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error('Out of date:', stale.map((t) => t.slug).join(', ')); process.exit(1); }
    console.log('meta.json counts, the home page and the frequency lists are up to date.');
  } else {
    fs.writeFileSync(META, pyJson(next) + (text.endsWith('\n') ? '\n' : ''));
    fs.writeFileSync(HOME, nextHome);
    fs.writeFileSync(FREQUENCY, nextFreq);
    console.log(`Updated ${stale.length} item(s): ${stale.map((t) => t.slug).join(', ') || 'none'}.`);
  }
}
