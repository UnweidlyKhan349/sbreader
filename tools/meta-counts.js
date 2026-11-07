/* Refreshes each tournament's counts in data/meta.json from the bank:
   count (questions), tossups, bonuses and packets (distinct round labels),
   which the Set List shows.

     node tools/meta-counts.js            rewrite data/meta.json
     node tools/meta-counts.js --check    exit 1 if anything is out of date */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'data', 'meta.json');
const { readBank } = require(path.join(ROOT, 'tools', 'bank.js'));

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
  return {
    ...meta,
    bankIndex: fileStamp('data/bank/index.json'),
    tournaments: meta.tournaments.map((t) => ({ ...t, ...countsFor(bank.get(t.slug) || []), v: fileStamp(`data/bank/${t.slug}.json`) })),
  };
}

// meta.json is written the way Python's json.dumps writes it (", " and
// ": " separators, UTF-8 left as is), so the file keeps its layout.
function pyJson(v) {
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => pyJson(k) + ': ' + pyJson(x)).join(', ') + '}';
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v);
}

module.exports = { countsFor, expectedMeta, fileStamp, pyJson };

if (require.main === module) {
  const text = fs.readFileSync(META, 'utf8');
  const meta = JSON.parse(text);
  const next = expectedMeta(meta);
  const stale = meta.tournaments.filter((t, i) => ['count', 'tossups', 'bonuses', 'packets', 'v'].some((k) => t[k] !== next.tournaments[i][k]));
  if (meta.bankIndex !== next.bankIndex) stale.push({ slug: 'index.json' });
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error('Out of date:', stale.map((t) => t.slug).join(', ')); process.exit(1); }
    console.log('meta.json counts are up to date.');
  } else {
    fs.writeFileSync(META, pyJson(next) + (text.endsWith('\n') ? '\n' : ''));
    console.log(`Updated ${stale.length} tournament(s).`);
  }
}
