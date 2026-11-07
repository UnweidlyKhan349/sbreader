// tools/stamp-version.js marks a deploy with its version (js/site.js
// reloads pages older than version.json).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stampHtml, stampSite } = require('../tools/stamp-version.js');

test('stampHtml adds the version meta once, after the charset', () => {
  const html = '<head>\n<meta charset="UTF-8" />\n<title>x</title>';
  const once = stampHtml(html, 'abc123');
  assert.match(once, /<meta charset="UTF-8" \/>\n<meta name="sb-version" content="abc123" \/>/);
  const twice = stampHtml(once, 'def456');
  assert.strictEqual((twice.match(/sb-version/g) || []).length, 1);
  assert.match(twice, /content="def456"/);
  assert.match(stampHtml(html, 'a"><script>'), /content="ascript"/);
});

test('stampSite writes version.json and stamps nested pages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbv-'));
  fs.mkdirSync(path.join(dir, 'sets', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<meta charset="UTF-8" />');
  fs.writeFileSync(path.join(dir, 'sets', 'x', '1.html'), '<meta charset="UTF-8" />');
  assert.strictEqual(stampSite(dir, 'v1'), 2);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')), { version: 'v1' });
  assert.match(fs.readFileSync(path.join(dir, 'sets', 'x', '1.html'), 'utf8'), /sb-version" content="v1"/);
  fs.rmSync(dir, { recursive: true });
});
