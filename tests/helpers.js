// Loads data/ the way the site does, through SBData's own expansion.
const fs = require('fs');
const path = require('path');

require('../js/data.js');

const ROOT = path.join(__dirname, '..');
let cached = null;

function loadCorpus() {
  if (cached) return cached;
  const SBData = globalThis.SBData;
  const metaText = fs.readFileSync(path.join(ROOT, 'data/meta.json'), 'utf8');
  const rawMeta = JSON.parse(metaText);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions.json'), 'utf8'));
  const meta = SBData.normalizeMeta(JSON.parse(metaText));
  cached = { rawMeta, raw, meta, questions: SBData.expandQuestions(meta, raw) };
  return cached;
}

module.exports = { loadCorpus, ROOT };
