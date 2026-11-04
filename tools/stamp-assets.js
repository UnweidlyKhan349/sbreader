#!/usr/bin/env node
/* Tags every local stylesheet and script link in the site's pages with a
   hash of the file's contents (css/style.css?v=1a2b3c4d5e), so a browser
   never pairs a fresh page with a stale cached copy of a file it uses.
   GitHub Pages lets browsers keep each file for 10 minutes; without the
   tags, a deploy can leave someone with new HTML and old JS for that long.

     node tools/stamp-assets.js          rewrite the tags in place
     node tools/stamp-assets.js --check  exit 1 if any tag is out of date

   Run it after changing any CSS or JS file; the test suite fails until you do. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE_PREFIX = '/sbreader/'; // absolute links (404.html) start with this
const LINK_RE = /\b(href|src)="((?:\/sbreader\/)?(?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]*)?"/g;

function fileHash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

// Returns `html` with each local CSS/JS link tagged with its file's hash.
function stampHtml(html, root = ROOT) {
  return html.replace(LINK_RE, (_, attr, url) => {
    const rel = url.startsWith(SITE_PREFIX) ? url.slice(SITE_PREFIX.length) : url;
    return `${attr}="${url}?v=${fileHash(path.join(root, rel))}"`;
  });
}

function pages(root = ROOT) {
  return fs.readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => path.join(root, f));
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    const stamped = stampHtml(html);
    if (stamped === html) continue;
    stale.push(path.basename(file));
    if (!check) fs.writeFileSync(file, stamped);
  }
  if (check && stale.length) {
    console.error(`Out-of-date asset tags in: ${stale.join(', ')}. Run: node tools/stamp-assets.js`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? 'Stale' : 'Stamped'}: ${stale.join(', ')}` : 'All asset tags up to date.');
}

module.exports = { stampHtml, pages, LINK_RE };
