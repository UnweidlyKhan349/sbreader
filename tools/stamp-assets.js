#!/usr/bin/env node
/* Stamps every local script and stylesheet link in the site's pages with a
   hash of the file's contents: src="js/solo.js?v=1a2b3c4d".

   GitHub Pages lets browsers cache .js and .css for up to 10 minutes, so
   right after a deploy a browser could run a new page with an old script
   (in November 2026 that left Multiplayer throwing on an element the new
   page no longer had). With the stamp, a changed file has a new address and
   is fetched fresh, while an unchanged one stays cached.

     node tools/stamp-assets.js          rewrite the stamps in every page
     node tools/stamp-assets.js --check  exit 1 if any stamp is out of date

   npm test runs the check, so a commit that changes a script without
   restamping fails. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// src="js/x.js", href="css/style.css", or the same under /sbreader/ (404.html).
const REF_RE = /\b(src|href)="((?:\/sbreader\/)?((?:js|css)\/[^"?#]+\.(?:js|css)))(?:\?v=[^"]*)?"/g;

function hashOf(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

function stamp(html) {
  return html.replace(REF_RE, (whole, attr, url, rel) => {
    const h = hashOf(rel);
    return h ? `${attr}="${url}?v=${h}"` : whole;
  });
}

function pages() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, f));
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    const out = stamp(html);
    if (out === html) continue;
    if (check) stale.push(path.basename(file));
    else fs.writeFileSync(file, out);
  }
  if (check && stale.length) {
    console.error('Out-of-date asset stamps in: ' + stale.join(', ') + '. Run node tools/stamp-assets.js');
    process.exit(1);
  }
  if (!check) console.log('Stamped script and stylesheet links in ' + pages().length + ' pages.');
}

module.exports = { stamp, pages };
