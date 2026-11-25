// Paths and small helpers the ingestion steps share.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const INGEST = path.join(ROOT, 'tools', 'ingest');
// Downloads and extracted text: large, re-creatable, never committed.
const WORK = process.env.SB_INGEST_DIR || path.join(ROOT, '.ingest');
const RAW = path.join(WORK, 'raw');
const TEXT = path.join(WORK, 'text');
const PARSED = path.join(WORK, 'parsed');
const SOURCES = path.join(INGEST, 'sources.json');
const CORRECTIONS = path.join(INGEST, 'corrections');

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value, pretty) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, pretty ? 1 : 0) + '\n');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Runs fn over items, `limit` at a time.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Which fetcher and parser a source link needs.
function sourceKind(url) {
  const u = String(url || '');
  if (/^https:\/\/scibowldb\.com\/(tossup|bonus)\/\d+$/.test(u)) return 'scibowldb';
  if (/^https:\/\/isobowl\.com\/premier\/tournaments\/[^/?#]+\?round=\d+/.test(u)) return 'isobowl';
  if (/^https:\/\/speriphery\.com\/query$/.test(u)) return 'speriphery';
  if (/^https:\/\/drive\.google\.com\/drive\/folders\//.test(u)) return 'drive-folder';
  if (/^https:\/\/drive\.google\.com\/file\/d\//.test(u)) return 'drive-file';
  if (/^https:\/\/docs\.google\.com\/document\/d\//.test(u)) return 'google-doc';
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(u)) return 'github';
  if (/^https?:\/\//.test(u)) return 'file';
  return null;
}

module.exports = { ROOT, INGEST, WORK, RAW, TEXT, PARSED, SOURCES, CORRECTIONS, hash, readJson, writeJson, sleep, pool, sourceKind };
