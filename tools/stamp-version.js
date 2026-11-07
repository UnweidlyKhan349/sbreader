#!/usr/bin/env node
/* Marks a deploy copy of the site with its version, so open tabs and
   returning visitors pick up a redeploy (see js/site.js, "Updates after a
   redeploy").

     node tools/stamp-version.js <siteDir> <version>

   writes <siteDir>/version.json ({"version": ...}) and adds
   <meta name="sb-version" content="..."> to every .html page under
   <siteDir>, including the built set and packet pages. The deploy workflow
   runs it with the commit's SHA. */
const fs = require('fs');
const path = require('path');

const META_RE = /<meta name="sb-version" content="[^"]*" \/>\n?/;

function stampHtml(html, version) {
  const tag = `<meta name="sb-version" content="${String(version).replace(/[^\w.-]/g, '')}" />`;
  const clean = html.replace(META_RE, '');
  if (!/<meta charset="UTF-8" \/>/i.test(clean)) return clean;
  return clean.replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n${tag}`);
}

function htmlFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'data') out.push(...htmlFiles(p)); } else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function stampSite(dir, version) {
  const files = htmlFiles(dir);
  for (const f of files) fs.writeFileSync(f, stampHtml(fs.readFileSync(f, 'utf8'), version));
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: String(version) }) + '\n');
  return files.length;
}

module.exports = { stampHtml, stampSite };

if (require.main === module) {
  const [dir, version] = process.argv.slice(2);
  if (!dir || !version) { console.error('Usage: node tools/stamp-version.js <siteDir> <version>'); process.exit(1); }
  console.log(`Stamped version ${version} into ${stampSite(path.resolve(dir), version)} pages.`);
}
