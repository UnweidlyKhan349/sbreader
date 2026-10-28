#!/usr/bin/env node
/* Checks each question's subject against the subject its packet prints, and
   records what the packet prints in data/source-subjects.json.

   Packets print a subject ahead of each question ("13) BIO – Short Answer",
   "TOSS-UP 5) EARTH AND SPACE Multiple Choice"). This finds each question's
   stem in the packet text and reads the last subject label between the end
   of the previous answer and the stem.

     node tools/subject-audit.js <texts-dir> [--write] [--all]

   <texts-dir> holds the packets as plain text (pdftotext, a Google Doc's
   ?format=txt export, a .docx's text). If it has a urls.json mapping packet
   URLs to file names, a question whose `u` is listed is looked for in that
   file only; any other question is looked for in every file.

   Only questions with no entry in data/source-subjects.json are checked,
   unless --all is given. The report lists each one that differs from its
   packet. --write records the printed subjects (a subject key, "other" for
   Energy, General Science, Physical Science and so on, or null when the
   stem or its label wasn't found) and leaves existing entries alone.

   Then read every difference. Fix the question's subject when the packet is
   right; when the packet mislabels it, add "printed→filed" for it to
   data/subject-overrides.json. npm test fails until each one is settled. */
const fs = require('fs');
const path = require('path');
const { unpack } = require('./bank.js');

const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data', 'source-subjects.json');

// Longest names first, so "PHYSICAL SCIENCE" isn't read as "PHYS".
const LABELS = [
  [/^EARTH\s*(?:AND|&)\s*SPACE(?:\s*SCIENCES?)?$|^EARTH\s*SCIENCES?$|^ASTRONOMY$|^ESS$|^E&S$/i, 'ess'],
  [/^LIFE\s*SCIENCES?$|^BIOLOGY$|^BIO$/i, 'bio'],
  [/^CHEMISTRY$|^CHEM$/i, 'chem'],
  [/^PHYSICS$|^PHYS$/i, 'phys'],
  [/^MATHEMATICS$|^MATH$/i, 'math'],
  [/^PHYSICAL\s*SCIENCES?$|^ENERGY$|^GENERAL\s*SCIENCES?$|^COMPUTER\s*SCIENCES?$/i, 'other'],
];
const LABEL_RE = /(?<![A-Za-z])(EARTH\s*(?:AND|&)\s*SPACE(?:\s*SCIENCES?)?|EARTH\s*SCIENCES?|ASTRONOMY|ESS|E&S|LIFE\s*SCIENCES?|BIOLOGY|BIO|CHEMISTRY|CHEM|PHYSICAL\s*SCIENCES?|PHYSICS|PHYS|MATHEMATICS|MATH|ENERGY|GENERAL\s*SCIENCES?|COMPUTER\s*SCIENCES?)(?![A-Za-z])/gi;
const ANSWER_RE = /ANSWER\s*:|ACCEPT\s*:|\n\s*\n\s*\n/gi;

function labelKey(text) {
  const hit = LABELS.find(([re]) => re.test(text.trim()));
  return hit ? hit[1] : null;
}

// Lowercase letters and digits only, with each kept character's position in
// the original text, so a match in the normalized text maps back to it.
function normalize(text) {
  let norm = '';
  const pos = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\p{L}\p{N}]/u.test(ch)) { norm += ch.toLowerCase(); pos.push(i); }
  }
  return { norm, pos };
}

function loadTexts(dir) {
  const texts = new Map();
  fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).forEach((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    texts.set(f, { raw, ...normalize(raw) });
  });
  const manifest = path.join(dir, 'urls.json');
  const urls = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : {};
  return { texts, urls };
}

// The labels printed before each place the stem appears in one text. In the
// question's own packet a short opening is enough to find it; elsewhere a
// generic opening ("which of the following is not") would match other
// questions, so it takes 60 characters, or the whole of a shorter stem of
// at least 40.
function labelsIn(text, stem, own) {
  for (const len of own ? [80, 60, 40, 25] : [80, 60]) {
    const key = stem.slice(0, len);
    if (key.length < Math.min(len, own ? 25 : 60) && key !== stem) continue;
    if (key.length < (own ? 25 : 40)) continue;
    const found = new Set();
    for (let at = text.norm.indexOf(key); at >= 0; at = text.norm.indexOf(key, at + 1)) {
      const start = text.pos[at];
      let win = text.raw.slice(Math.max(0, start - 90), start);
      const cuts = [...win.matchAll(ANSWER_RE)];
      if (cuts.length) win = win.slice(cuts[cuts.length - 1].index + cuts[cuts.length - 1][0].length);
      const hits = [...win.matchAll(LABEL_RE)];
      found.add(hits.length ? labelKey(hits[hits.length - 1][1]) : null);
    }
    if (found.size) return found;
  }
  return new Set();
}

// The single subject the packet prints for this question, or null.
function printedSubject(q, texts, urls) {
  const stem = normalize(q.q).norm;
  const own = q.u && urls[q.u];
  const pool = own && texts.has(own) ? [texts.get(own)] : [...texts.values()];
  const found = new Set();
  pool.forEach((t) => labelsIn(t, stem, pool.length === 1 && !!own).forEach((l) => found.add(l)));
  found.delete(null);
  return found.size === 1 ? [...found][0] : null;
}

function writeSources(sources) {
  const rows = Object.entries(sources).sort((a, b) => Number(a[0]) - Number(b[0]));
  fs.writeFileSync(SOURCE_FILE, '{\n' + rows.map(([id, v]) => `"${id}":${JSON.stringify(v)}`).join(',\n') + '\n}\n');
}

module.exports = { normalize, labelsIn, printedSubject };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('Usage: node tools/subject-audit.js <texts-dir> [--write] [--all]');
    process.exit(1);
  }
  const sources = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  const { texts, urls } = loadTexts(dir);
  const todo = unpack().filter((q) => args.includes('--all') || !(String(q.i) in sources));
  let agree = 0, other = 0, missing = 0;
  todo.forEach((q) => {
    const p = printedSubject(q, texts, urls);
    if (p == null) missing++;
    else if (p === 'other') other++;
    else if (p === q.s) agree++;
    else console.log(`${q.i}\t${q.t}\t${q.rl || ''}\t${q.qt} ${q.n ?? ''}\tpacket ${p}, filed ${q.s}\t${q.q.slice(0, 90)}`);
    if (args.includes('--write') && !(String(q.i) in sources)) sources[q.i] = p;
  });
  console.error(`${todo.length} checked: ${agree} agree, ${todo.length - agree - other - missing} differ (listed above), ${other} printed under a non-subject category, ${missing} not found.`);
  if (args.includes('--write')) writeSources(sources);
}
