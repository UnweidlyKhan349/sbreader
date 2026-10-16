#!/usr/bin/env node
/* Converts the question bank between its on-disk form (data/bank/) and a
   flat list of records that's easier to edit or audit.

   On disk, each tournament is its own file, data/bank/<slug>.json: an array
   of packets, each holding the fields its questions share (round label `rl`,
   round `r`, packet URL `u`) and the questions themselves under `q`, minus
   those fields and the tournament name/slug, which come from meta.json.
   data/bank/index.json maps question ids to tournaments, so a page that
   needs a few questions by id (Bookmarks) loads only their tournaments.

   The flat form is the record list the site used to ship as
   data/questions.json: one object per question with every field
   (i, t, ts, r, rl, s, f, qt, n, q, c, a, u, im), in bank order.

     node tools/bank.js unpack [out.json]   bank -> flat (default: stdout)
     node tools/bank.js pack <in.json>      flat -> bank (rewrites data/bank/)

   After `pack`, rebuild meta.json's counts if they changed and run npm test. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BANK_DIR = path.join(ROOT, 'data', 'bank');
const PACKET_KEYS = ['rl', 'r', 'u'];
const SLUG_RE = /^[a-z0-9_-]+$/;

require(path.join(ROOT, 'js', 'data.js'));
const SBData = globalThis.SBData;

function readMeta() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
}

function readBank(meta) {
  return meta.tournaments.map((t) => ({
    slug: t.slug,
    packets: JSON.parse(fs.readFileSync(path.join(BANK_DIR, t.slug + '.json'), 'utf8')),
  }));
}

// Flat records -> { slug: packets }. Consecutive questions of a tournament
// with the same round label, round and packet URL share one packet, so the
// questions keep their order.
function packRecords(records) {
  const bySlug = new Map();
  const names = new Map();
  for (const rec of records) {
    if (!SLUG_RE.test(rec.ts || '')) throw new Error(`question ${rec.i}: bad tournament slug ${JSON.stringify(rec.ts)}`);
    if (names.has(rec.ts) && names.get(rec.ts) !== rec.t) {
      throw new Error(`question ${rec.i}: tournament ${rec.ts} is named both "${names.get(rec.ts)}" and "${rec.t}"`);
    }
    names.set(rec.ts, rec.t);
    if (!bySlug.has(rec.ts)) bySlug.set(rec.ts, []);
    const packets = bySlug.get(rec.ts);
    const last = packets[packets.length - 1];
    const same = last && PACKET_KEYS.every((k) => last[k] === rec[k]);
    let packet = last;
    if (!same) {
      packet = {};
      PACKET_KEYS.forEach((k) => { if (k in rec) packet[k] = rec[k]; });
      packet.q = [];
      packets.push(packet);
    }
    const q = { i: rec.i };
    for (const [k, v] of Object.entries(rec)) {
      if (k !== 'i' && k !== 't' && k !== 'ts' && !PACKET_KEYS.includes(k)) q[k] = v;
    }
    packet.q.push(q);
  }
  return bySlug;
}

// One packet header per line and one question per line, so a change to a
// question shows up as a one-line diff.
function formatShard(packets) {
  const parts = packets.map((p) => {
    const head = JSON.stringify({ ...p, q: [] }).slice(0, -3);
    return head + '[\n' + p.q.map((q) => JSON.stringify(q)).join(',\n') + ']}';
  });
  return '[\n' + parts.join(',\n') + '\n]\n';
}

// Runs of consecutive ids (in id order) that belong to the same tournament:
// [[firstId, slug], ...]. A few hundred runs cover the whole bank.
function buildIndex(bySlug) {
  const owner = [];
  bySlug.forEach((packets, slug) => packets.forEach((p) => p.q.forEach((q) => owner.push([q.i, slug]))));
  owner.sort((a, b) => a[0] - b[0]);
  const ids = [];
  owner.forEach(([id, slug]) => {
    if (!ids.length || ids[ids.length - 1][1] !== slug) ids.push([id, slug]);
  });
  return { ids };
}

function formatIndex(index) {
  return '{"ids":[\n' + index.ids.map((r) => JSON.stringify(r)).join(',\n') + '\n]}\n';
}

function pack(records) {
  const bySlug = packRecords(records);
  fs.mkdirSync(BANK_DIR, { recursive: true });
  const keep = new Set(['index.json']);
  bySlug.forEach((packets, slug) => {
    keep.add(slug + '.json');
    fs.writeFileSync(path.join(BANK_DIR, slug + '.json'), formatShard(packets));
  });
  fs.readdirSync(BANK_DIR).forEach((f) => {
    if (f.endsWith('.json') && !keep.has(f)) fs.unlinkSync(path.join(BANK_DIR, f));
  });
  fs.writeFileSync(path.join(BANK_DIR, 'index.json'), formatIndex(buildIndex(bySlug)));
  return bySlug;
}

function unpack() {
  const meta = readMeta();
  return SBData.flattenBank(meta, readBank(meta));
}

module.exports = { packRecords, buildIndex, formatShard, readBank, unpack, pack };

if (require.main === module) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'unpack') {
    const out = '[\n' + unpack().map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';
    if (file) fs.writeFileSync(file, out); else process.stdout.write(out);
  } else if (cmd === 'pack' && file) {
    const bySlug = pack(JSON.parse(fs.readFileSync(file, 'utf8')));
    let n = 0;
    bySlug.forEach((packets) => packets.forEach((p) => { n += p.q.length; }));
    console.log(`Wrote ${n.toLocaleString()} questions in ${bySlug.size} tournament files to data/bank/.`);
  } else {
    console.error('Usage: node tools/bank.js unpack [out.json] | pack <in.json>');
    process.exit(1);
  }
}
