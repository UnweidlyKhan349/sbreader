#!/usr/bin/env node
/* Builds the site served at the old address, https://unweidlykhan349.github.io/sbreader/,
   which only sends people on to https://sbreader.org/ (run by
   .github/workflows/redirect-old-address.yml):

     node tools/redirect-site.js <folder>

   GitHub Pages can't send a real (301) redirect, so every page is a stub that
   moves the browser on at once: a script keeps the rest of the address
   (/sbreader/solo?x=1#y -> https://sbreader.org/solo?x=1#y), and a
   <meta http-equiv="refresh"> to the same page without the query is the
   fallback without JavaScript (search engines read it as a permanent move).
   - One stub per page at the root (index.html, solo.html, ...), so the old
     addresses answer 200 and their canonical names the new page.
   - 404.html, served for every other address, redirects by the script alone.
   - sw.js replaces the old service worker with one that deletes its caches,
     unregisters itself and reloads any open tab (which then redirects).
   No analytics tag: the visit is counted on sbreader.org. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NEW_SITE = 'https://sbreader.org';
const OLD_PREFIX = '/sbreader';

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function stub(target, { refresh }) {
  const href = escapeAttr(target);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<script>(function () {
  var rest = location.pathname.replace(/^${OLD_PREFIX.replace(/\//g, '\\/')}(?=\\/|$)/, '') || '/';
  location.replace('${NEW_SITE}' + rest + location.search + location.hash);
})();</script>
${refresh ? `<meta http-equiv="refresh" content="0; url=${href}" />\n<link rel="canonical" href="${href}" />\n` : '<meta name="robots" content="noindex" />\n'}<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SB Reader has moved to sbreader.org</title>
</head>
<body>
<p>SB Reader has moved to <a href="${href}">sbreader.org</a>.</p>
</body>
</html>
`;
}

const KILL_SW = `// SB Reader moved to ${NEW_SITE}/. This replaces the service worker the old
// address installed: it deletes its caches, unregisters itself and reloads
// open tabs, which then redirect.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

function build(out) {
  fs.mkdirSync(out, { recursive: true });
  const pages = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f) && f !== '404.html' && !/^google[0-9a-f]+\.html$/.test(f));
  for (const file of pages) {
    const name = file.replace(/\.html$/, '');
    const target = `${NEW_SITE}/${name === 'index' ? '' : name}`;
    fs.writeFileSync(path.join(out, file), stub(target, { refresh: true }));
  }
  fs.writeFileSync(path.join(out, '404.html'), stub(`${NEW_SITE}/`, { refresh: false }));
  fs.writeFileSync(path.join(out, 'sw.js'), KILL_SW);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return pages.length + 1;
}

module.exports = { build, stub, NEW_SITE, OLD_PREFIX };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node tools/redirect-site.js <folder>');
    process.exit(1);
  }
  console.log(`Wrote ${build(path.resolve(out))} redirect pages to ${out}.`);
}
