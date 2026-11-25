#!/usr/bin/env node
/* Step 1 of the ingestion pipeline: downloads every source packet named in
   tools/ingest/sources.json into .ingest/raw/ (not committed).

     node tools/ingest/fetch.js [--only <slug>[,<slug>]] [--refresh] [--jobs 6]

   Files already downloaded are kept unless --refresh. What failed, and why,
   goes to .ingest/fetch-log.json; a second run retries only those.

   How each kind of link is fetched (lib/common.js sourceKind):
   - file:          the link itself (PDFs on lebot, OSTI, CSUN, NOSB, ...).
   - drive-file:    Google Drive's download address for the file id.
   - drive-folder:  the folder's embedded listing, then every file in it.
   - google-doc:    the document exported as .docx (keeps sub/superscripts).
   - github:        the file from raw.githubusercontent.com.
   - scibowldb:     the whole public API (/api/questions) in one request.
   - isobowl:       the public API: the tournament, its rounds, each round's questions.
   Not fetched: speriphery.com (its question table is only reachable
   through the site's own app, not a published download) and sources that
   were never online (packets sent as files). Their questions are kept
   whole in tools/ingest/corrections/. */
const fs = require('fs');
const path = require('path');
const { RAW, WORK, SOURCES, hash, readJson, writeJson, sleep, pool, sourceKind } = require('./lib/common');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(url, opts = {}) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(90000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.permanent = true; throw e; }
      return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '', url: res.url };
    } catch (e) {
      last = e;
      if (e.permanent) break;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw last;
}
async function getJson(url, opts) { return JSON.parse((await get(url, opts)).buf.toString('utf8')); }

function rawPath(url) { return path.join(RAW, hash(url)); }
function done(file) { return fs.existsSync(file + '.json') || fs.existsSync(file + '.bin') || fs.existsSync(file + '.dir'); }

// A Drive file id's bytes. Big files get a "can't scan for viruses" page
// first; its confirm form leads to the file.
async function driveFile(id) {
  let r = await get(`https://drive.google.com/uc?export=download&id=${id}`);
  if (/text\/html/.test(r.type)) {
    const html = r.buf.toString('utf8');
    const uuid = (html.match(/name="uuid" value="([^"]+)"/) || [])[1];
    r = await get(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t${uuid ? '&uuid=' + uuid : ''}`);
    if (/text\/html/.test(r.type)) throw Object.assign(new Error('Drive served a page, not the file (private, or removed)'), { permanent: true });
  }
  return r.buf;
}

// The files in a Drive folder (and its subfolders): [{ id, name }].
async function driveFolder(id, depth = 0) {
  const html = (await get(`https://drive.google.com/embeddedfolderview?id=${id}`)).buf.toString('utf8');
  const out = [];
  const re = /<a href="https:\/\/drive\.google\.com\/(file\/d|drive\/folders)\/([\w-]+)[^"]*"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === 'file/d') out.push({ id: m[2], name: m[3] });
    else if (depth < 3) (await driveFolder(m[2], depth + 1)).forEach((f) => out.push({ ...f, name: m[3] + '/' + f.name }));
  }
  return out;
}

const handlers = {
  async file(url, file) { fs.writeFileSync(file + '.bin', (await get(url)).buf); },
  async 'drive-file'(url, file) { fs.writeFileSync(file + '.bin', await driveFile(url.match(/\/file\/d\/([\w-]+)/)[1])); },
  async 'drive-folder'(url, file) {
    const files = await driveFolder(url.match(/\/folders\/([\w-]+)/)[1]);
    fs.mkdirSync(file + '.dir.tmp', { recursive: true });
    for (const f of files) {
      try { fs.writeFileSync(path.join(file + '.dir.tmp', f.id + '.bin'), await driveFile(f.id)); } catch (e) { f.error = e.message; }
    }
    writeJson(path.join(file + '.dir.tmp', 'listing.json'), files, true);
    fs.renameSync(file + '.dir.tmp', file + '.dir');
  },
  async 'google-doc'(url, file) {
    const id = url.match(/\/document\/d\/([\w-]+)/)[1];
    fs.writeFileSync(file + '.bin', (await get(`https://docs.google.com/document/d/${id}/export?format=docx`)).buf);
  },
  async github(url, file) {
    const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    fs.writeFileSync(file + '.bin', (await get(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3].split('#')[0]}`)).buf);
  },
};

// One request for every scibowldb question.
async function fetchScibowldb() {
  const file = path.join(RAW, 'scibowldb.json');
  if (!fs.existsSync(file)) writeJson(file, await getJson('https://scibowldb.com/api/questions'));
}

// isobowl: each tournament the sources link to, all its released rounds.
async function fetchIsobowl(slugs) {
  const list = (await getJson('https://isobowl.com/api/tournaments')).tournaments;
  for (const slug of slugs) {
    const file = path.join(RAW, `isobowl-${slug}.json`);
    if (fs.existsSync(file)) continue;
    const t = list.find((x) => x.slug === slug);
    if (!t) { console.warn(`isobowl: no tournament ${slug}`); continue; }
    const { rounds } = await getJson(`https://isobowl.com/api/tournaments/${t._id}/rounds`);
    const out = { tournament: t, rounds: [] };
    for (const r of rounds) {
      try {
        const { questions } = await getJson(`https://isobowl.com/api/tournaments/${t._id}/rounds/${r.roundNumber}/questions`);
        out.rounds.push({ ...r, questions });
      } catch (e) { out.rounds.push({ ...r, error: e.message }); }
    }
    writeJson(file, out);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const refresh = args.includes('--refresh');
  const jobs = args.includes('--jobs') ? +args[args.indexOf('--jobs') + 1] : 6;
  if (refresh) fs.rmSync(RAW, { recursive: true, force: true });
  fs.mkdirSync(RAW, { recursive: true });
  const sources = readJson(SOURCES);
  const tournaments = sources.tournaments.filter((t) => !only || only.has(t.slug));

  const urls = new Map(); // url -> kind
  const iso = new Set();
  let scibowldb = false;
  for (const t of tournaments) {
    for (const p of t.packets) {
      const kind = sourceKind(p.u);
      if (!kind) continue;
      if (kind === 'scibowldb') scibowldb = true;
      else if (kind === 'speriphery') continue;
      else if (kind === 'isobowl') iso.add(p.u.match(/tournaments\/([^/?#]+)/)[1]);
      else urls.set(p.u.split('#')[0], kind);
    }
  }
  const log = { failed: {} };
  const todo = [...urls].filter(([url]) => !done(rawPath(url)));
  console.log(`${urls.size} files and folders, ${todo.length} to fetch${scibowldb ? '; scibowldb' : ''}${iso.size ? `; ${iso.size} isobowl tournaments` : ''}.`);
  let n = 0;
  await pool(todo, jobs, async ([url, kind]) => {
    try { await handlers[kind](url, rawPath(url)); } catch (e) { log.failed[url] = e.message; }
    if (++n % 50 === 0) console.log(`  ${n}/${todo.length}`);
  });
  const extra = [[scibowldb, 'scibowldb', fetchScibowldb], [iso.size, 'isobowl', () => fetchIsobowl([...iso])]];
  for (const [want, name, fn] of extra) {
    if (!want) continue;
    try { await fn(); } catch (e) { log.failed[name] = e.message; }
  }
  writeJson(path.join(WORK, 'fetch-log.json'), log, true);
  const failed = Object.keys(log.failed).length;
  console.log(failed ? `${failed} failed (see .ingest/fetch-log.json); run again to retry them.` : 'All fetched.');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { rawPath };
