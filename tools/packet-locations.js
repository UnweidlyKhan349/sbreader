/* Finds where each question sits in its packet, so a source link can open
   the packet there: the page of a PDF (opened as url#page=N) or the line of
   a GitHub text file (url#LN). The result is each question's `pg` field.

     node tools/packet-locations.js <cache-dir> [--write] [--only <url-substring>]

   Every PDF and GitHub .txt packet the bank links to is downloaded into
   <cache-dir> (once; later runs reuse it), its text extracted with
   pdftotext (poppler-utils) or read as is, and each question located:
   the start of the question's text (letters and digits only, lower case)
   is searched for in the packet, in packet order, falling back to a run of
   words from its middle. A question that can't be placed gets no `pg`.
   Without --write it only reports; with it, the bank is rewritten through
   tools/bank.js (the same unpack/pack route as every other data change). */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const ROOT = path.join(__dirname, '..');
const { unpack, pack } = require(path.join(ROOT, 'tools', 'bank.js'));

const PDF_RE = /\.pdf$/i;
const GH_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

function packetKind(url) {
  const bare = (url || '').split(/[?#]/)[0];
  // A PDF on github.com opens in GitHub's own viewer, which has no page
  // anchor; a PDF anywhere else opens in the browser's, which does.
  if (PDF_RE.test(bare) && !GH_BLOB_RE.test(url)) return 'pdf';
  // Only files GitHub shows as text have line anchors (not .doc/.docx/.odt
  // or mail archives).
  if (GH_BLOB_RE.test(url || '') && /\.(txt|md|round)$/i.test(bare)) return 'line';
  return null;
}

function norm(s) {
  return (s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Text plus a map from each character of it back to the page/line it's on.
function indexUnits(units) {
  let text = '';
  const starts = [];
  units.forEach((u) => { starts.push(text.length); text += norm(u); });
  return {
    text,
    unitAt(pos) {
      let lo = 0; let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return lo + 1; // 1-based page or line
    },
  };
}

// The question's place in the packet text, searching from `from` first so
// a question that repeats an earlier one's opening lands on its own copy.
function locate(doc, question, from) {
  const q = norm(question);
  if (q.length < 12) return null;
  const tries = [];
  for (const len of [80, 50, 30]) if (q.length >= len || len === 30) tries.push(q.slice(0, Math.min(len, q.length)));
  // A run from the middle, for questions whose opening the packet words
  // differently (a "TOSSUP" label glued on, a symbol the PDF drops).
  if (q.length > 60) tries.push(q.slice(Math.floor(q.length / 2) - 20, Math.floor(q.length / 2) + 20));
  for (const needle of tries) {
    let at = doc.text.indexOf(needle, from);
    if (at === -1) at = doc.text.indexOf(needle);
    if (at !== -1) return at;
  }
  return null;
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function cacheName(url) {
  return require('crypto').createHash('sha1').update(url).digest('hex').slice(0, 20);
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  try {
    await execFileP('curl', ['-sSfL', '--max-time', '120', '--retry', '2', '-o', file + '.part', url]);
    fs.renameSync(file + '.part', file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(file + '.part'); } catch (e2) { /* nothing to remove */ }
    return false;
  }
}

function rawGithubUrl(url) {
  const m = url.match(GH_BLOB_RE);
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
}

async function packetUnits(url, cacheDir) {
  const kind = packetKind(url);
  const base = path.join(cacheDir, cacheName(url));
  if (kind === 'pdf') {
    if (!(await download(url, base + '.pdf'))) return null;
    const txt = base + '.txt';
    if (!fs.existsSync(txt)) {
      try {
        await execFileP('pdftotext', ['-enc', 'UTF-8', base + '.pdf', txt], { maxBuffer: 1 << 28 });
      } catch (e) { return null; }
    }
    const pages = fs.readFileSync(txt, 'utf8').split('\f');
    if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
    return pages;
  }
  if (kind === 'line') {
    if (!(await download(rawGithubUrl(url), base + '.gh.txt'))) return null;
    return fs.readFileSync(base + '.gh.txt', 'utf8').split('\n');
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const cacheDir = args[0];
  if (!cacheDir || cacheDir.startsWith('--')) {
    console.error('Usage: node tools/packet-locations.js <cache-dir> [--write] [--only <url-substring>]');
    process.exit(1);
  }
  const write = args.includes('--write');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
  fs.mkdirSync(cacheDir, { recursive: true });

  const records = unpack();
  const byUrl = new Map();
  records.forEach((r) => {
    if (!packetKind(r.u) || (only && !r.u.includes(only))) return;
    if (!byUrl.has(r.u)) byUrl.set(r.u, []);
    byUrl.get(r.u).push(r);
  });
  const urls = [...byUrl.keys()];
  console.error(`${urls.length} packets, ${records.filter((r) => byUrl.has(r.u)).length} questions`);

  const stats = new Map(); // host -> { q, placed, failedFiles }
  const unplaced = [];
  let done = 0;
  await pool(urls, 4, async (url) => {
    const host = new URL(url).host;
    if (!stats.has(host)) stats.set(host, { q: 0, placed: 0, failedFiles: 0 });
    const st = stats.get(host);
    const recs = byUrl.get(url);
    st.q += recs.length;
    const units = await packetUnits(url, cacheDir);
    if (!units) {
      st.failedFiles++;
      recs.forEach((r) => { delete r.pg; unplaced.push([r.i, url, 'file not readable']); });
    } else {
      const doc = indexUnits(units);
      let from = 0;
      recs.forEach((r) => {
        const at = locate(doc, r.q, from);
        if (at === null) {
          delete r.pg;
          unplaced.push([r.i, url, 'text not found']);
          return;
        }
        r.pg = doc.unitAt(at);
        from = at + 1;
        st.placed++;
      });
    }
    if (++done % 100 === 0) console.error(`  ${done}/${urls.length}`);
  });

  console.log('host\tquestions\tplaced\tunreadable files');
  [...stats.entries()].sort((a, b) => b[1].q - a[1].q).forEach(([h, s]) => {
    console.log(`${h}\t${s.q}\t${s.placed} (${((100 * s.placed) / s.q).toFixed(1)}%)\t${s.failedFiles}`);
  });
  fs.writeFileSync(path.join(cacheDir, 'unplaced.json'), JSON.stringify(unplaced, null, 1));
  console.log(`${unplaced.length} questions not placed (listed in ${path.join(cacheDir, 'unplaced.json')})`);
  if (write) {
    pack(records);
    console.log('Bank rewritten with pg fields.');
  }
}

module.exports = { packetKind, norm, indexUnits, locate };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
