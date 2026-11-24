#!/usr/bin/env node
/* Builds the site served at the old address https://sbreader.github.io/
   (the sbreader organization's sbreader.github.io repo), which only sends
   people on to https://sbreader.org/ (run by
   .github/workflows/redirect-old-address.yml):

     node tools/redirect-site.js <out> [<site>]

   <site> is a built copy of the site (default: this repo); a stub is written
   for every .html page in it, so the set and packet pages made by
   tools/build-pages.js get one too.

   GitHub Pages can't send a real (301) redirect from a site without the
   custom domain, so every page is a stub that moves the browser on at once:
   a script keeps the rest of the address
   (/solo?x=1#y -> https://sbreader.org/solo?x=1#y), and a
   <meta http-equiv="refresh"> to the same page without the query is the
   fallback without JavaScript (search engines read it as a permanent move).
   - One stub per page (index.html, solo.html, sets/<slug>/3.html, ...), so
     the old addresses answer 200 and their canonical names the new page.
   - 404.html, served for every other address, redirects by the script alone.
   - sw.js replaces the old service worker with one that deletes its caches,
     unregisters itself and reloads any open tab (which then redirects).
   No analytics tag: the visit is counted on sbreader.org.

   (The older https://unweidlykhan349.github.io/sbreader/ needs none of this:
   it is this repo's Pages site, which has the custom domain, so GitHub
   redirects it.) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NEW_SITE = 'https://sbreader.org';

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function stub(target, { refresh }) {
  const href = escapeAttr(target);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<script>location.replace('${NEW_SITE}' + location.pathname + location.search + location.hash);</script>
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

// Every .html page under dir, as paths relative to it ('solo.html', 'sets/x/3.html').
function htmlPages(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!rel && /^(\.|node_modules$|tests$|tools$|docs$|supabase$|data$|js$|css$|img$)/.test(entry.name)) continue;
      out.push(...htmlPages(dir, p));
    } else if (entry.name.endsWith('.html') && p !== '404.html' && !/^google[0-9a-f]+\.html$/.test(p)) {
      out.push(p);
    }
  }
  return out;
}

// The address a page is served at: solo.html -> /solo, sets/x/index.html -> /sets/x/.
function addressOf(file) {
  return '/' + file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
}

function build(out, site = ROOT) {
  const pages = htmlPages(site);
  for (const file of pages) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), stub(NEW_SITE + addressOf(file), { refresh: true }));
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '404.html'), stub(`${NEW_SITE}/`, { refresh: false }));
  fs.writeFileSync(path.join(out, 'sw.js'), KILL_SW);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return pages.length + 1;
}

module.exports = { build, stub, addressOf, NEW_SITE };

if (require.main === module) {
  const [out, site] = process.argv.slice(2);
  if (!out) {
    console.error('Usage: node tools/redirect-site.js <out> [<site>]');
    process.exit(1);
  }
  console.log(`Wrote ${build(path.resolve(out), site ? path.resolve(site) : ROOT)} redirect pages to ${out}.`);
}
