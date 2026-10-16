// Loads data/ the way the site does, through SBData's own expansion.
// `raw` is the flat one-record-per-question form (see tools/bank.js).
const fs = require('fs');
const path = require('path');

require('../js/data.js');
const { readBank } = require('../tools/bank.js');

const ROOT = path.join(__dirname, '..');
let cached = null;

function loadCorpus() {
  if (cached) return cached;
  const SBData = globalThis.SBData;
  const metaText = fs.readFileSync(path.join(ROOT, 'data/meta.json'), 'utf8');
  const rawMeta = JSON.parse(metaText);
  const bank = readBank(rawMeta);
  const raw = SBData.flattenBank(rawMeta, bank);
  const meta = SBData.normalizeMeta(JSON.parse(metaText));
  cached = { rawMeta, bank, raw, meta, questions: SBData.expandQuestions(meta, bank) };
  return cached;
}

module.exports = { loadCorpus, ROOT };
