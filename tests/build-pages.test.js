// tools/build-pages.js: a real HTML page for every set and packet (built at
// deploy), each with its content in the HTML and its canonical address, and
// a sitemap listing them all.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../tools/build-pages.js');

test('every set and packet gets a page, listed in the sitemap', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sbreader-pages-'));
  try {
    fs.copyFileSync(path.join(__dirname, '..', 'sitemap.xml'), path.join(out, 'sitemap.xml'));
    const r = build(out);
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'meta.json'), 'utf8'));
    assert.strictEqual(fs.readdirSync(path.join(out, 'sets')).length, meta.tournaments.length);
    const set = fs.readFileSync(path.join(out, 'sets', 'lost-3-ms', 'index.html'), 'utf8');
    assert.match(set, /<link rel="canonical" href="https:\/\/sbreader\.github\.io\/sets\/lost-3-ms\/" \/>/);
    assert.match(set, /<base href="\/" \/>/);
    assert.match(set, /id="setPage" data-set="lost-3-ms"/);
    const packet = fs.readFileSync(path.join(out, 'sets', 'lost-3-ms', '1.html'), 'utf8');
    assert.match(packet, /data-set="lost-3-ms" data-packet="1"/);
    assert.match(packet, /class="packet-question"/);
    assert.match(packet, /ANSWER: /);
    const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    assert.strictEqual((sitemap.match(/<loc>[^<]*\/sets\//g) || []).length, r.urls);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
