const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stampHtml, pages } = require('../tools/stamp-assets.js');

test('every page links its CSS and JS with an up-to-date content tag (node tools/stamp-assets.js)', () => {
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    assert.strictEqual(stampHtml(html), html, `${path.basename(file)} has stale or missing ?v= tags`);
  }
});

test('every local CSS and JS link is tagged', () => {
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    const untagged = [...html.matchAll(/\b(?:href|src)="((?:\/sbreader\/)?(?:css|js)\/[^"]+)"/g)]
      .map((m) => m[1]).filter((u) => !/\?v=[0-9a-f]{10}$/.test(u));
    assert.deepStrictEqual(untagged, [], path.basename(file));
  }
});
