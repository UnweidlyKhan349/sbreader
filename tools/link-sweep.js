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
// Stanford's list of tournaments, whose "Packets" links point at each
// event's Drive folder or Google Doc.
const STANFORD_LIST = 'https://scibowl.stanford.edu/tournaments';
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

// "Packets" links on Stanford's tournament list: [{ name, href }]. Each
// event is a line ("Date: Name (Place) • Results • ... • Packets").
// The name is only a label: folders are matched to tournaments by content.
async function stanfordPacketLinks() {
  const html = (await curl([STANFORD_LIST])).toString();
  const out = [];
  const re = /<a href="([^"]+)"[^>]*>(?:<strong>)?Packets/g;
  let m;
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 3000), m.index);
    const line = before.split(/<br>|<p>/).pop().replace(/<[^>]+>/g, '');
    const name = decodeHtml(line).split('•')[0].replace(/^[^:]*:\s*/, '').replace(/\s*\(.*$/, '').trim();
    out.push({ name, href: decodeHtml(m[1]) });
  }
  return out;
}

// Drive and Docs links inside a Google Doc (an event's packet hub).
async function docLinks(id) {
  const html = (await curl([`https://docs.google.com/document/d/${id}/export?format=html`])).toString();
  const links = new Set();
  const re = /https?:\/\/(?:www\.google\.com\/url\?q=)?(https?:\/\/(?:docs|drive)\.google\.com\/[^"&\s]+)/g;
  let m;
  while ((m = re.exec(html))) links.add(decodeURIComponent(m[1]));
  return [...links];
}

function fileFromHref(href, title, folder) {
  let m;
  if ((m = href.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return { kind: 'gdoc', id: m[1], url: `https://docs.google.com/document/d/${m[1]}/edit`, path: title, folder };
  if ((m = href.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return { kind: 'other', id: m[1], url: `https://drive.google.com/file/d/${m[1]}/view`, path: title, folder };
  return null;
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
    } else if (['pdf', 'docx', 'pptx', 'txt', 'other'].includes(f.kind)) {
      let kind = f.kind;
      let raw = base + '.' + kind;
      if (!fs.existsSync(raw)) {
        const buf = await curl([`https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`]);
        fs.writeFileSync(raw, buf);
      }
      if (kind === 'other') {
        // No extension in the title: tell the type from the bytes. A
        // Google Doc shared as a Drive file comes back as HTML; read it
        // through the Docs export instead.
        const head = fs.readFileSync(raw).subarray(0, 4).toString('latin1');
        if (head.startsWith('%PDF')) kind = 'pdf';
        else if (head.startsWith('PK')) {
          const names = (await execFileP('unzip', ['-l', raw])).stdout;
          kind = names.includes('word/document.xml') ? 'docx' : names.includes('ppt/slides') ? 'pptx' : 'other';
        } else {
          text = (await curl([`https://docs.google.com/document/d/${f.id}/export?format=txt`])).toString('utf8');
          if (/^\s*<!DOCTYPE|<html/i.test(text)) text = '';
          kind = 'done';
        }
      }
      if (kind === 'done') {
        // read above
      } else if (kind === 'pdf') {
        text = (await execFileP('pdftotext', ['-enc', 'UTF-8', raw, '-'], { maxBuffer: 1 << 28 })).stdout;
      } else if (kind === 'txt') {
        text = fs.readFileSync(raw, 'utf8');
      } else if (kind === 'docx' || kind === 'pptx') {
        const inner = kind === 'docx' ? ['word/document.xml'] : ['ppt/slides/*.xml'];
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
    for (const { name, href } of await stanfordPacketLinks()) {
      let m;
      if ((m = href.match(/\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/))) {
        await crawl(m[1], 'stanford/' + name + '/', 0, { id: m[1], title: name }, files);
      } else if ((m = href.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) {
        const folder = { id: 'doc-' + m[1], title: name, url: `https://docs.google.com/document/d/${m[1]}/edit` };
        files.push(fileFromHref(href, 'stanford/' + name, folder));
        for (const link of await docLinks(m[1])) {
          const f2 = link.match(/\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
          if (f2) await crawl(f2[1], 'stanford/' + name + '/', 1, folder, files);
          else { const f = fileFromHref(link, 'stanford/' + name + '/' + link, folder); if (f && f.id !== m[1]) files.push(f); }
        }
      }
    }
    // The same file can be reached twice; keep the first.
    const seen = new Set();
    files = files.filter((f) => !seen.has(f.id) && seen.add(f.id));
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
    // Every file holding each question; when several do (a stock opening,
    // a question reused within the event), the one holding most of its
    // round wins.
    const pool2 = folderOk ? best.files : [];
    const holders = new Map(recs.map((r) => { const nd = needleOf(r.q); return [r, nd ? pool2.filter((f) => f.text.includes(nd)) : []]; }));
    const roundVotes = new Map();
    holders.forEach((fs2, r) => {
      if (fs2.length !== 1) return;
      const key = r.rl + '|' + r.r;
      if (!roundVotes.has(key)) roundVotes.set(key, new Map());
      const v = roundVotes.get(key);
      v.set(fs2[0], (v.get(fs2[0]) || 0) + 1);
    });
    recs.forEach((r) => {
      const fs2 = holders.get(r);
      let hit = fs2[0];
      if (fs2.length > 1) {
        const v = roundVotes.get(r.rl + '|' + r.r) || new Map();
        hit = fs2.slice().sort((a, b) => (v.get(b) || 0) - (v.get(a) || 0))[0];
      }
      if (hit) { r.u = hit.url; counts.file++; return; }
      if (r.u === SEARCH_PAGE) { counts.already++; return; }
      if (folderOk) { r.u = best.url || `https://drive.google.com/drive/folders/${best.id}`; counts.folder++; return; }
      counts.none++;
    });
    report.push({ slug, tournament: recs[0].t, questions: recs.length, folderName: folderOk ? best.title : null, ...counts });
  });

  report.sort((a, b) => b.questions - a.questions);
  console.log('tournament\tquestions\tto file\tto folder\tkept search page\tstill none\tfolder');
  report.forEach((x) => console.log(`${x.tournament}\t${x.questions}\t${x.file}\t${x.folder}\t${x.already}\t${x.none}\t${x.folderName || '-'}`));
  const tot = report.reduce((a, x) => ({ q: a.q + x.questions, file: a.file + x.file, folder: a.folder + x.folder, none: a.none + x.none, already: a.already + x.already }), { q: 0, file: 0, folder: 0, none: 0, already: 0 });
  console.log(`TOTAL\t${tot.q}\t${tot.file}\t${tot.folder}\t${tot.already}\t${tot.none}`);
  fs.writeFileSync(path.join(cacheDir, 'link-report.json'), JSON.stringify(report, null, 1));
  if (write) { pack(records); console.log('Bank rewritten with the new links.'); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
