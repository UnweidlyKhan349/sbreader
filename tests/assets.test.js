// Every page's local scripts and stylesheets carry a stamp of their current
// contents (tools/stamp-assets.js), so a deploy never pairs a new page with
// a script a browser cached before it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stamp, pages } = require('../tools/stamp-assets.js');

test('script and stylesheet stamps match the files (run node tools/stamp-assets.js)', () => {
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    assert.strictEqual(stamp(html), html, path.basename(file) + ' has an out-of-date or missing stamp');
  }
});

test('every local script and stylesheet link is stamped', () => {
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    const bare = html.match(/\b(?:src|href)="\/?(?:js|css)\/[^"?#]+\.(?:js|css)"/g) || [];
    assert.deepStrictEqual(bare, [], path.basename(file));
  }
});
