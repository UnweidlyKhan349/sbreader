#!/usr/bin/env node
/* Step 4: rebuilds the question bank from the downloaded sources.

   Each packet in tools/ingest/sources.json is parsed (parse.js) from what
   fetch.js and extract.js left in .ingest/, and each of the bank's
   questions in that packet is matched to a parsed one (same toss-up/bonus
   and number, else the closest text). Everything the parser doesn't
   produce exactly (the years of hand corrections in docs/data-history.md:
   keys fixed, notation evened out, questions removed or reworded, ids) is
   kept in tools/ingest/corrections/<slug>.json, one line per question:
     {"i":36116,"m":4}                       parsed record 4, exactly
     {"i":36117,"m":5,"set":{"a.t":"5"}}      parsed record 5, with these fields changed
     {"i":36118,"m":-1,"set":{...whole...}}   not in the source: kept whole
   So the bank is: the sources, parsed, plus these corrections; and how much
   of it the corrections have to carry says how well the parser does.

     node tools/ingest/build.js                    report, per tournament, how much is reproduced
     node tools/ingest/build.js --check            rebuild the bank and compare it with data/bank/ (exit 1 if different)
     node tools/ingest/build.js --write-bank       rebuild data/bank/ from sources + corrections
     node tools/ingest/build.js --write-corrections  record the current bank's differences from the sources
     ... [--only <slug>[,<slug>]]

   --write-corrections is how a hand edit to data/bank/ (or a parser
   improvement) is carried into the corrections. */
const fs = require('fs');
const path = require('path');
const { ROOT, RAW, TEXT, SOURCES, CORRECTIONS, hash, readJson, sourceKind } = require('./lib/common');
const { parsePacketText, parseIsobowl, parseScibowldb, parseJsonList } = require('./parse');
const bank = require('../bank.js');

/* ---------- Parsed records per source link ---------- */
const cache = new Map();
let scibowldb = null;
const isobowl = new Map();

function textFor(url) {
  const f = path.join(TEXT, hash(url) + '.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
function parsedFor(url) {
  const u = String(url || '').split('#')[0];
  if (cache.has(u)) return cache.get(u);
  let out = [];
  const kind = sourceKind(u);
  if (kind === 'scibowldb') {
    if (!scibowldb) {
      const f = path.join(RAW, 'scibowldb.json');
      scibowldb = fs.existsSync(f) ? parseScibowldb(readJson(f)) : new Map();
    }
    const rec = scibowldb.get(u.replace('https://scibowldb.com/', ''));
    out = rec ? [rec] : [];
  } else if (kind === 'isobowl') {
    const slug = u.match(/tournaments\/([^/?#]+)/)[1];
    if (!isobowl.has(slug)) {
      const f = path.join(RAW, `isobowl-${slug}.json`);
      isobowl.set(slug, fs.existsSync(f) ? parseIsobowl(readJson(f)) : new Map());
    }
    out = isobowl.get(slug).get(+u.match(/round=(\d+)/)[1]) || [];
  } else if (kind === 'drive-folder') {
    const dir = path.join(TEXT, hash(u) + '.dir');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).sort()) out.push(...parsePacketText(fs.readFileSync(path.join(dir, f), 'utf8')));
    }
  } else if (kind && kind !== 'speriphery') {
    const text = textFor(u);
    let list = null;
    if (text != null && /^\s*\[/.test(text)) { try { list = parseJsonList(JSON.parse(text)); } catch (e) { list = null; } }
    if (list) out = list;
    else if (text != null) {
      const bare = u.split('?')[0];
      const pdf = /\.pdf$/i.test(bare) && kind !== 'github';
      out = parsePacketText(text, { pages: pdf, lines: kind === 'github' && /\.(txt|md|round)$/i.test(bare) });
    }
  }
  cache.set(u, out);
  return out;
}

/* ---------- Matching and differences ---------- */
const QUESTION_KEYS = ['s', 'f', 'qt', 'n', 'q', 'c', 'a', 'pg', 'im'];
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2));
function similarity(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  x.forEach((w) => { if (y.has(w)) n++; });
  return n / Math.max(x.size, y.size);
}
// Bank questions of one packet -> index of the parsed record each comes from (or -1).
function match(questions, parsed) {
  const used = new Set();
  const out = questions.map(() => -1);
  if (parsed.length === 1 && questions.length === 1) return [0];
  questions.forEach((q, i) => {
    const same = parsed.map((p, j) => j).filter((j) => !used.has(j) && parsed[j].qt === q.qt && parsed[j].n === q.n && q.n != null);
    const best = same.sort((a, b) => similarity(q.q, parsed[b].q) - similarity(q.q, parsed[a].q))[0];
    if (best != null && similarity(q.q, parsed[best].q) >= 0.3) { out[i] = best; used.add(best); }
  });
  questions.forEach((q, i) => {
    if (out[i] >= 0) return;
    let best = -1, score = 0.6;
    parsed.forEach((p, j) => { if (!used.has(j) && p.qt === q.qt) { const s = similarity(q.q, p.q); if (s > score) { score = s; best = j; } } });
    if (best >= 0) { out[i] = best; used.add(best); }
  });
  return out;
}
// Fields: top-level keys, and a.t / a.l / a.ac / a.rj, c.W ... c.Z one by one.
function flat(rec) {
  const out = {};
  for (const k of QUESTION_KEYS) {
    if (!(k in rec)) continue;
    if ((k === 'a' || k === 'c') && rec[k] && typeof rec[k] === 'object') {
      out[k] = true;
      for (const [sk, v] of Object.entries(rec[k])) out[k + '.' + sk] = v;
    } else out[k] = rec[k];
  }
  return out;
}
function unflat(f) {
  const out = {};
  for (const k of QUESTION_KEYS) {
    if (!(k in f)) continue;
    if (k === 'a' || k === 'c') {
      const obj = {};
      Object.keys(f).filter((x) => x.startsWith(k + '.')).forEach((x) => { obj[x.slice(2)] = f[x]; });
      out[k] = obj;
    } else out[k] = f[k];
  }
  return out;
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
// Key order inside a and c follows the bank's own (t, l, ac, rj; W..Z).
function orderAs(rec, keys) {
  const out = {};
  keys.forEach((k) => { if (k in rec) out[k] = rec[k]; });
  Object.keys(rec).forEach((k) => { if (!(k in out)) out[k] = rec[k]; });
  return out;
}
function correction(q, parsed) {
  const want = flat(q);
  if (!parsed) return { i: q.i, m: -1, set: want, order: Object.keys(q).filter((k) => k !== 'i') };
  const have = flat(parsed);
  const set = {};
  Object.keys(want).forEach((k) => { if (!same(want[k], have[k])) set[k] = want[k]; });
  const del = Object.keys(have).filter((k) => !(k in want));
  const out = { i: q.i, m: parsed.index };
  if (Object.keys(set).length) out.set = set;
  if (del.length) out.del = del;
  const order = Object.keys(q).filter((k) => k !== 'i');
  const natural = Object.keys(unflat({ ...have, ...set })).filter((k) => !del.includes(k));
  if (!same(order, natural)) out.order = order;
  ['a', 'c'].forEach((k) => {
    if (q[k] && parsed[k] && !set[k] && !same(Object.keys(q[k]), Object.keys(applyFields(have, set, del, k)))) {
      (out.sub = out.sub || {})[k] = Object.keys(q[k]);
    }
  });
  return out;
}
function applyFields(have, set, del, k) {
  const f = { ...have, ...set };
  del.forEach((d) => delete f[d]);
  return unflat(f)[k] || {};
}
function apply(entry, parsedList) {
  const base = entry.m >= 0 ? flat(parsedList[entry.m]) : {};
  const f = { ...base, ...(entry.set || {}) };
  (entry.del || []).forEach((d) => delete f[d]);
  let rec = unflat(f);
  if (entry.sub) Object.entries(entry.sub).forEach(([k, keys]) => { rec[k] = orderAs(rec[k], keys); });
  if (entry.order) rec = orderAs(rec, entry.order);
  return { i: entry.i, ...rec };
}

/* ---------- Commands ---------- */
function bankByTournament() {
  const meta = readJson(path.join(ROOT, 'data', 'meta.json'));
  return new Map(meta.tournaments.map((t) => [t.slug, readJson(path.join(ROOT, 'data', 'bank', t.slug + '.json'))]));
}
function correctionsFile(slug) { return path.join(CORRECTIONS, slug + '.json'); }
function writeCorrections(slug, packets) {
  fs.mkdirSync(CORRECTIONS, { recursive: true });
  const body = packets.map((entries) => '[\n' + entries.map((e) => JSON.stringify(e)).join(',\n') + ']').join(',\n');
  fs.writeFileSync(correctionsFile(slug), '[\n' + body + '\n]\n');
}

// One tournament's packets, rebuilt: [{ rl?, r?, u?, q: [...] }].
function rebuild(t) {
  const file = correctionsFile(t.slug);
  if (!fs.existsSync(file)) throw new Error(`${t.slug}: no corrections file (run --write-corrections)`);
  const corr = readJson(file);
  return t.packets.map((p, j) => {
    const parsed = parsedFor(p.u).map((x, index) => ({ ...x, index }));
    const out = {};
    ['rl', 'r', 'u'].forEach((k) => { if (k in p) out[k] = p[k]; });
    out.q = (corr[j] || []).map((e) => apply(e, parsed));
    return out;
  });
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const sources = readJson(SOURCES).tournaments.filter((t) => !only || only.has(t.slug));
  const current = bankByTournament();

  if (args.includes('--write-corrections')) {
    const total = { n: 0, exact: 0, changed: 0, whole: 0 };
    for (const t of sources) {
      const packets = current.get(t.slug);
      if (!packets || packets.length !== t.packets.length) throw new Error(`${t.slug}: sources.json is out of date (run node tools/ingest/sources.js)`);
      const entries = packets.map((p, j) => {
        const parsed = parsedFor(t.packets[j].u).map((x, index) => ({ ...x, index }));
        const m = match(p.q, parsed);
        return p.q.map((q, k) => {
          const parsedRec = m[k] >= 0 ? parsed[m[k]] : null;
          const e = correction(q, parsedRec);
          total.n++;
          if (e.m < 0) total.whole++; else if (e.set || e.del) total.changed++; else total.exact++;
          // Strip the index helper from what's compared.
          return e;
        });
      });
      // Sanity: what's written rebuilds exactly.
      writeCorrections(t.slug, entries);
      const back = rebuild(t);
      if (!same(back, packets)) throw new Error(`${t.slug}: corrections don't rebuild the bank exactly (a bug in build.js)`);
    }
    console.log(`Wrote corrections for ${sources.length} tournaments: ${total.n} questions; ${total.exact} straight from the source, ${total.changed} from the source with corrections, ${total.whole} kept whole.`);
    return;
  }

  const rows = [];
  let bad = 0;
  const rebuilt = new Map();
  for (const t of sources) {
    const packets = rebuild(t);
    rebuilt.set(t.slug, packets);
    const corr = readJson(correctionsFile(t.slug)).flat();
    const exact = corr.filter((e) => e.m >= 0 && !e.set && !e.del).length;
    const whole = corr.filter((e) => e.m < 0).length;
    const ok = same(packets, current.get(t.slug));
    if (!ok) bad++;
    rows.push({ slug: t.slug, n: corr.length, exact, changed: corr.length - exact - whole, whole, ok });
  }
  if (args.includes('--write-bank')) {
    const meta = readJson(path.join(ROOT, 'data', 'meta.json'));
    const flatRecords = [];
    for (const t of meta.tournaments) {
      const packets = rebuilt.get(t.slug) || current.get(t.slug);
      packets.forEach((p) => p.q.forEach((q) => {
        const rec = { i: q.i, t: t.name, ts: t.slug };
        ['r', 'rl', 'u'].forEach((k) => { if (k in p) rec[k] = p[k]; });
        Object.keys(q).forEach((k) => { if (k !== 'i') rec[k] = q[k]; });
        flatRecords.push(rec);
      }));
    }
    bank.pack(flatRecords);
    console.log('Rebuilt data/bank/ from the sources and corrections. Run node tools/meta-counts.js and npm test.');
    return;
  }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  if (!args.includes('--quiet')) {
    rows.sort((a, b) => (b.exact / b.n) - (a.exact / a.n)).forEach((r) => {
      console.log(`${r.ok ? '  ' : '✗ '}${r.slug.padEnd(40)} ${String(r.n).padStart(6)}  ${(100 * r.exact / r.n).toFixed(0).padStart(3)}% exact  ${(100 * r.changed / r.n).toFixed(0).padStart(3)}% corrected  ${(100 * r.whole / r.n).toFixed(0).padStart(3)}% kept whole`);
    });
  }
  const n = sum('n');
  console.log(`${n} questions: ${(100 * sum('exact') / n).toFixed(1)}% straight from the sources, ${(100 * sum('changed') / n).toFixed(1)}% from the sources with corrections, ${(100 * sum('whole') / n).toFixed(1)}% kept whole in the corrections.`);
  if (bad) { console.log(`${bad} tournaments don't rebuild to data/bank/ (a source changed, or the bank was edited: run --write-corrections).`); if (args.includes('--check')) process.exit(1); } else console.log('The rebuilt bank is identical to data/bank/.');
}

if (require.main === module) main();
module.exports = { parsedFor, match, correction, apply, rebuild };
