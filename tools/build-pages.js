#!/usr/bin/env node
/* Builds a real HTML page for every set and packet, so search engines can
   find each tournament and its questions, plus a sitemap that lists them.

     node tools/build-pages.js <siteDir>

   writes into <siteDir> (the deploy copy of the site; see
   .github/workflows/deploy.yml):
     sets/<slug>/index.html  the set's packets      -> /sets/<slug>/
     sets/<slug>/<n>.html    every question in a packet, with answers -> /sets/<slug>/<n>
     sitemap.xml             the main pages, then every set and packet

   Each page is set.html / packet.html with the content already in the HTML,
   a <base href="/"> (the site is served from the domain root) and
   data-set / data-packet on #setPage, so js/set-pages.js redraws it with the
   interactive parts (downloads, Report links, enlarging figures). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://sbreader.github.io/';
globalThis.window = globalThis;
require(path.join(ROOT, 'js', 'data.js'));
const SBData = globalThis.SBData;
require(path.join(ROOT, 'js', 'play-common.js'));
const SBPlay = globalThis.SBPlay;
const { escapeHtml } = SBData;

function heading(html) {
  return `<div class="float-row mb-3"><span class="float-start">${html}</span><a class="float-end" href="set-list">Back to all sets</a></div>`;
}

function setBody(t, packets) {
  const rows = packets.map((p, i) => {
    const tu = p.questions.filter((q) => q.qtype === 'tossup').length;
    const b = p.questions.length - tu;
    return `<tr><td>${i + 1}</td><td><a href="sets/${encodeURIComponent(t.slug)}/${i + 1}">${escapeHtml(p.label)}</a></td><td>${tu}</td><td>${b}</td></tr>`;
  }).join('');
  return heading(`View ${escapeHtml(t.name)} here:`)
    + SBData.tournamentSourceHTML(t, packets)
    + '<div class="table-responsive"><table class="table table-hover"><thead><tr><th scope="col">#</th><th scope="col">Packet Name</th><th scope="col"># of Toss-ups</th><th scope="col"># of Bonuses</th></tr></thead>'
    + `<tbody class="table-group-divider">${rows}</tbody></table></div>`;
}

function figures(q) {
  const ims = q.images || [];
  return '<div class="q-figures">' + ims.map((im, k) => `<img class="q-figure" src="${escapeHtml(im.src)}"${im.w && im.h ? ` width="${im.w}" height="${im.h}"` : ''} alt="${ims.length > 1 ? `Figure ${k + 1} for this question` : 'Figure for this question'}" loading="lazy" decoding="async">`).join('') + '</div>';
}

function packetBody(t, p, n) {
  let html = heading(`Packet ${n} (${escapeHtml(p.label)}) of <a href="sets/${encodeURIComponent(t.slug)}/">${escapeHtml(t.name)}</a>:`)
    + SBData.packetSourceHTML(p);
  html += p.questions.map((q, i) => {
    const a = q.answer || {};
    return '<div class="packet-question">'
      + `<div class="q-text">${escapeHtml(String(q.num || i + 1))}. ${SBData.readoutHTML(q)}</div>`
      + (q.visual ? figures(q) : '')
      + (q.choices ? `<div>${['W', 'X', 'Y', 'Z'].filter((L) => q.choices[L]).map((L) => `${L}) ${SBData.renderMathHTML(q.choices[L])}`).join('<br>')}</div>` : '')
      + `<div>ANSWER: ${SBData.answerLineHTML(SBData.answerDisplayText(q), a.letter, a.accept, a.reject).replace(/^Answer: /, '')}</div>`
      + '</div>';
  }).join('<hr>');
  return html;
}

// set.html / packet.html with this page's title, description, address and
// content filled in.
function fillTemplate(template, { title, description, urlPath, data, body }) {
  let out = template
    .replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n<base href="/" />`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>\n<link rel="canonical" href="${SITE}${urlPath}" />`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  const open = out.match(/<div class="container-xl mt-3 mb-5 pb-5" id="setPage">[\s\S]*?<\/div>\n<\/div>/);
  if (!open) throw new Error('#setPage not found in the template');
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`).join('');
  out = out.replace(open[0], `<div class="container-xl mt-3 mb-5 pb-5" id="setPage"${attrs}>\n${body}\n</div>`);
  return out;
}

function build(outDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  SBData.meta = SBData.normalizeMeta(meta);
  const setTpl = fs.readFileSync(path.join(ROOT, 'set.html'), 'utf8');
  const packetTpl = fs.readFileSync(path.join(ROOT, 'packet.html'), 'utf8');
  const urls = [];
  let pages = 0;
  for (const t of meta.tournaments) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bank', t.slug + '.json'), 'utf8'));
    SBData.questions = SBData.expandQuestions({ tournaments: [t] }, [{ slug: t.slug, packets: raw }]);
    SBData.byId = new Map(SBData.questions.map((q) => [q.id, q]));
    const packets = SBPlay.packetsOf(t.slug);
    const dir = path.join(outDir, 'sets', t.slug);
    fs.mkdirSync(dir, { recursive: true });
    const level = t.level === 'ms' ? 'middle school' : 'high school';
    fs.writeFileSync(path.join(dir, 'index.html'), fillTemplate(setTpl, {
      title: `SBReader - ${t.name}`,
      description: `${t.name}: ${t.count.toLocaleString('en-US')} ${level} Science Bowl questions in ${packets.length} packets, with answers.`,
      urlPath: `sets/${t.slug}/`,
      data: { set: t.slug },
      body: setBody(t, packets),
    }));
    urls.push(`sets/${t.slug}/`);
    pages++;
    packets.forEach((p, i) => {
      const n = i + 1;
      fs.writeFileSync(path.join(dir, n + '.html'), fillTemplate(packetTpl, {
        title: `SBReader - ${t.name} ${p.label}`,
        description: `${t.name} ${p.label}: ${p.questions.length} Science Bowl toss-ups and bonuses, with answers.`,
        urlPath: `sets/${t.slug}/${n}`,
        data: { set: t.slug, packet: n },
        body: packetBody(t, p, n),
      }));
      urls.push(`sets/${t.slug}/${n}`);
      pages++;
    });
  }
  // The sitemap: the main pages (from the repo's sitemap.xml), then these.
  const base = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const extra = urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${u.endsWith('/') ? '0.5' : '0.4'}</priority></url>`).join('\n');
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), base.replace('</urlset>', extra + '\n</urlset>'));
  return { pages, urls: urls.length };
}

module.exports = { build, fillTemplate };

if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) { console.error('Usage: node tools/build-pages.js <siteDir>'); process.exit(1); }
  const r = build(path.resolve(outDir));
  console.log(`Built ${r.pages} set and packet pages; the sitemap lists ${r.urls} of them.`);
}
