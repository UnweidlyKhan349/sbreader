/* Gives questions with no packet link (or only speriphery.com/query, which
   is a search page) a link to where they're published.

     node tools/link-sweep.js <cache-dir> [--write]

   Sources, in order of preference:
     1. The file holding the question in a public Google Drive tree
        (DRIVE_ROOTS below): every file is downloaded once into <cache-dir>
        and its text extracted (Google Docs as plain text, PDFs with
        pdftotext, .docx/.pptx by unzipping their XML). A question links to
        the file whose text contains it (the start of the question, letters
        and digits only, as tools/packet-locations.js matches).
     2. Otherwise the tournament's own folder in that tree, when other
        questions of the tournament were found there (the closest public
        page for a question whose file isn't public).
   A tournament's folder is found by sampling its questions against every
   folder, so folder names don't have to match tournament names.
   Without --write it only reports; with it the bank is rewritten through
   tools/bank.js. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const ROOT = path.join(__dirname, '..');
const { unpack, pack } = require(path.join(ROOT, 'tools', 'bank.js'));
const { norm } = require(path.join(ROOT, 'tools', 'packet-locations.js'));

// The Science Bowl Periphery's public packet archive (speriphery.com links
// it): one folder per tournament.
const DRIVE_ROOTS = ['1IIpY8rbKS2_tf5_Kwl2Ns_qAJ1FIkMic'];
const SEARCH_PAGE = 'https://speriphery.com/query';

async function curl(args, opts) {
  const { stdout } = await execFileP('curl', ['-sSL', '--max-time', '180', '--retry', '2', ...args], { maxBuffer: 1 << 28, encoding: 'buffer', ...opts });
  return stdout;
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function listFolder(id) {
  const html = (await curl([`https://drive.google.com/embeddedfolderview?id=${id}`])).toString();
  const out = [];
  const re = /<div class="flip-entry" id="entry-[^"]*"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) out.push({ href: decodeHtml(m[1]), title: decodeHtml(m[2]) });
  return out;
}

// Every file under a folder: { path, kind, id, url, folder }.
async function crawl(folderId, prefix, depth, topFolder, acc) {
  for (const e of await listFolder(folderId)) {
    const folder = e.href.match(/\/drive\/folders\/([\w-]+)/);
    if (folder) {
      if (depth < 5) await crawl(folder[1], prefix + e.title + '/', depth + 1, topFolder || { id: folder[1], title: e.title }, acc);
      continue;
    }
    let m;
    let file = null;
    if ((m = e.href.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) {
      file = { kind: 'gdoc', id: m[1], url: `https://docs.google.com/document/d/${m[1]}/edit` };
    } else if ((m = e.href.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) {
      file = { kind: 'gslides', id: m[1], url: `https://docs.google.com/presentation/d/${m[1]}/edit` };
    } else if ((m = e.href.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) {
      const ext = (e.title.match(/\.(pdf|docx|pptx|txt)$/i) || [])[1];
      file = { kind: ext ? ext.toLowerCase() : 'other', id: m[1], url: `https://drive.google.com/file/d/${m[1]}/view` };
    }
    if (file) acc.push({ ...file, path: prefix + e.title, folder: topFolder });
  }
  return acc;
}

async function fileText(f, cacheDir) {
  const base = path.join(cacheDir, f.id);
  const txt = base + '.txt';
  if (fs.existsSync(txt)) return fs.readFileSync(txt, 'utf8');
  let text = '';
  try {
    if (f.kind === 'gdoc') {
      text = (await curl([`https://docs.google.com/document/d/${f.id}/export?format=txt`])).toString('utf8');
    } else if (f.kind === 'gslides') {
      text = (await curl([`https://docs.google.com/presentation/d/${f.id}/export/txt`])).toString('utf8');
    } else if (['pdf', 'docx', 'pptx', 'txt'].includes(f.kind)) {
      const raw = base + '.' + f.kind;
      if (!fs.existsSync(raw)) {
        const buf = await curl([`https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`]);
        fs.writeFileSync(raw, buf);
      }
      if (f.kind === 'pdf') {
        text = (await execFileP('pdftotext', ['-enc', 'UTF-8', raw, '-'], { maxBuffer: 1 << 28 })).stdout;
      } else if (f.kind === 'txt') {
        text = fs.readFileSync(raw, 'utf8');
      } else {
        const inner = f.kind === 'docx' ? ['word/document.xml'] : ['ppt/slides/*.xml'];
        const xml = (await execFileP('unzip', ['-p', raw, ...inner], { maxBuffer: 1 << 28 })).stdout;
        text = xml.replace(/<\/w:p>|<\/a:p>/g, '\n').replace(/<[^>]+>/g, '');
        text = decodeHtml(text);
      }
    }
  } catch (e) {
    text = '';
  }
  fs.writeFileSync(txt, text);
  return text;
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

function needleOf(question) {
  const q = norm(question);
  if (q.length < 20) return null;
  return q.slice(0, Math.min(45, q.length));
}

async function main() {
  const [cacheDir] = process.argv.slice(2);
  if (!cacheDir || cacheDir.startsWith('--')) {
    console.error('Usage: node tools/link-sweep.js <cache-dir> [--write]');
    process.exit(1);
  }
  const write = process.argv.includes('--write');
  fs.mkdirSync(cacheDir, { recursive: true });

  const listing = path.join(cacheDir, 'drive-files.json');
  let files;
  if (fs.existsSync(listing)) files = JSON.parse(fs.readFileSync(listing, 'utf8'));
  else {
    files = [];
    for (const root of DRIVE_ROOTS) await crawl(root, '', 0, null, files);
    fs.writeFileSync(listing, JSON.stringify(files, null, 1));
  }
  console.error(`${files.length} files in the Drive tree`);
  let n = 0;
  await pool(files, 6, async (f) => {
    f.text = norm(await fileText(f, cacheDir));
    if (++n % 100 === 0) console.error(`  text ${n}/${files.length}`);
  });
  const folders = new Map();
  files.forEach((f) => { if (f.folder) { if (!folders.has(f.folder.id)) folders.set(f.folder.id, { ...f.folder, files: [] }); folders.get(f.folder.id).files.push(f); } });

  const records = unpack();
  const todo = records.filter((r) => !r.u || r.u === SEARCH_PAGE);
  const bySlug = new Map();
  todo.forEach((r) => { if (!bySlug.has(r.ts)) bySlug.set(r.ts, []); bySlug.get(r.ts).push(r); });

  const report = [];
  bySlug.forEach((recs, slug) => {
    // Which folder holds this tournament: sample its questions against all.
    const sample = recs.map((r) => needleOf(r.q)).filter(Boolean).slice(0, 40);
    let best = null;
    let bestHits = 0;
    folders.forEach((fo) => {
      const hits = sample.filter((nd) => fo.files.some((f) => f.text.includes(nd))).length;
      if (hits > bestHits) { best = fo; bestHits = hits; }
    });
    const folderOk = best && sample.length && bestHits >= Math.max(2, sample.length * 0.2);
    const counts = { file: 0, folder: 0, none: 0, already: 0 };
    recs.forEach((r) => {
      const nd = needleOf(r.q);
      const pool2 = folderOk ? best.files : [];
      const hit = nd && pool2.find((f) => f.text.includes(nd));
      if (hit) { r.u = hit.url; counts.file++; return; }
      if (r.u === SEARCH_PAGE) { counts.already++; return; }
      if (folderOk) { r.u = `https://drive.google.com/drive/folders/${best.id}`; counts.folder++; return; }
      counts.none++;
    });
    report.push({ slug, tournament: recs[0].t, questions: recs.length, folder: folderOk ? best.title : null, ...counts });
  });

  report.sort((a, b) => b.questions - a.questions);
  console.log('tournament\tquestions\tto file\tto folder\tkept search page\tstill none\tfolder');
  report.forEach((x) => console.log(`${x.tournament}\t${x.questions}\t${x.file}\t${x.folder}\t${x.already}\t${x.none}\t${x.folder ? x.folder : '-'}`));
  const tot = report.reduce((a, x) => ({ q: a.q + x.questions, file: a.file + x.file, folder: a.folder + x.folder, none: a.none + x.none, already: a.already + x.already }), { q: 0, file: 0, folder: 0, none: 0, already: 0 });
  console.log(`TOTAL\t${tot.q}\t${tot.file}\t${tot.folder}\t${tot.already}\t${tot.none}`);
  fs.writeFileSync(path.join(cacheDir, 'link-report.json'), JSON.stringify(report, null, 1));
  if (write) { pack(records); console.log('Bank rewritten with the new links.'); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
