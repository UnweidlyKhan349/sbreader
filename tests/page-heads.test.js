// Every page carries the same <head> essentials (analytics, icons, manifest,
// theme colours), and every indexable page its search and link-preview tags.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Not pages people browse: Google's verification file, and the old Bookmarks
// address, which only redirects.
const SKIP = new Set(['bookmarks.html']);
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f) && !SKIP.has(f));
const head = (f) => { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); return s.slice(0, s.indexOf('</head>')); };

const EVERY_PAGE = {
  'Google tag': /googletagmanager\.com\/gtm\.js\?id=GTM-MHDN9VXB/,
  charset: /<meta charset="UTF-8" \/>/,
  viewport: /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/,
  title: /<title>SBReader - [^<]+<\/title>/,
  Bootstrap: /bootstrap@5\.3\.8\/dist\/css\/bootstrap\.min\.css/,
  stylesheet: /href="\/?css\/style\.css\?v=/,
  'site.js': /src="\/?js\/site\.js\?v=/,
  'favicon.ico': /<link rel="icon" href="\/?favicon\.ico" sizes="32x32" \/>/,
  'favicon.svg': /<link rel="icon" href="\/?favicon\.svg" type="image\/svg\+xml" \/>/,
  'apple-touch-icon': /<link rel="apple-touch-icon" href="\/?apple-touch-icon\.png" \/>/,
  manifest: /<link rel="manifest" href="\/?site\.webmanifest" \/>/,
  'home-screen name': /<meta name="apple-mobile-web-app-title" content="SB Reader" \/>/,
  'light theme colour': /<meta name="theme-color" content="#dfebfb" media="\(prefers-color-scheme: light\)" \/>/,
  'dark theme colour': /<meta name="theme-color" content="#333333" media="\(prefers-color-scheme: dark\)" \/>/,
};

test('every page has the shared head tags', () => {
  const missing = [];
  for (const f of pages) {
    const h = head(f);
    for (const [name, re] of Object.entries(EVERY_PAGE)) if (!re.test(h)) missing.push(`${f}: ${name}`);
  }
  assert.deepStrictEqual(missing, []);
});

test('every indexable page has a description, a canonical address and link-preview tags', () => {
  const missing = [];
  // set.html and packet.html are templates: their canonical is the static page (js/set-pages.js).
  for (const f of pages.filter((p) => !/name="robots" content="noindex"/.test(head(p)) && p !== 'set.html' && p !== 'packet.html')) {
    const h = head(f);
    const address = 'https://sbreader.org/' + (f === 'index.html' ? '' : f.replace(/\.html$/, ''));
    if (!/<meta name="description" content="[^"]{50,}" \/>/.test(h)) missing.push(`${f}: description`);
    if (!h.includes(`<link rel="canonical" href="${address}" />`)) missing.push(`${f}: canonical ${address}`);
    if (!h.includes(`<meta property="og:url" content="${address}" />`)) missing.push(`${f}: og:url`);
    for (const tag of ['og:type', 'og:site_name', 'og:title', 'og:description']) if (!h.includes(`property="${tag}"`)) missing.push(`${f}: ${tag}`);
    if (!h.includes('<meta name="twitter:card" content="summary" />')) missing.push(`${f}: twitter:card`);
  }
  assert.deepStrictEqual(missing, []);
});

test('every page in the sitemap exists and is indexable', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const [, url] of sitemap.matchAll(/<loc>https:\/\/sbreader\.org\/([^<]*)<\/loc>/g)) {
    const f = (url || 'index') + '.html';
    assert.ok(pages.includes(f), `${f} is in the sitemap but isn't a page`);
    assert.doesNotMatch(head(f), /noindex/, `${f} is in the sitemap but noindex`);
  }
});
