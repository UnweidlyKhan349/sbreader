#!/usr/bin/env node
/* Step 2: turns every downloaded file in .ingest/raw/ into plain text in
   .ingest/text/ (same names, .txt), whatever it was:
   - PDF: pdftotext -raw (poppler-utils): the text in the order it was
     written, which keeps a question's lines together where reading order
     (or -layout) can move a wrapped line ahead of its question.
   - .docx (and Google Docs, fetched as .docx): the document's paragraphs,
     with superscript and subscript runs written the bank's way, x^(2) and
     H_2 (cleaned to x^2 later).
   - .odt: its paragraphs. .pptx: each slide's text.
   - Plain text (.txt, .round, .md): as is.
   - Old binary .doc (Word 97-2003): its text, read by lib/doc.js.
   Anything else is listed as unsupported.

     node tools/ingest/extract.js [--refresh] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RAW, TEXT, WORK, writeJson } = require('./lib/common');
const { readZip } = require('./lib/zip');
const { docText } = require('./lib/doc');

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

function docxText(zip) {
  const xml = zip.text('word/document.xml');
  const paras = xml.split(/<\/w:p>/);
  return paras.map((p) => {
    let out = '';
    const runs = p.match(/<w:r[ >][\s\S]*?<\/w:r>|<m:r>[\s\S]*?<\/m:r>/g) || [];
    for (const r of runs) {
      const t = (r.match(/<(?:w|m):t(?: [^>]*)?>([^<]*)<\/(?:w|m):t>/g) || []).map((x) => decode(x.replace(/<[^>]+>/g, ''))).join('')
        + (/<w:tab\/>/.test(r) ? '\t' : '') + (/<w:br\/>/.test(r) ? '\n' : '');
      if (!t) continue;
      const align = (r.match(/<w:vertAlign w:val="(\w+)"/) || [])[1];
      out += align === 'superscript' ? `^(${t})` : align === 'subscript' ? `_(${t})` : t;
    }
    return out;
  }).join('\n');
}
function odtText(zip) {
  return decode(zip.text('content.xml').replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
    .replace(/<\/text:(p|h)>/g, '\n').replace(/<[^>]+>/g, ''));
}
function pptxText(zip) {
  const slides = zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  return slides.map((n) => decode(zip.text(n).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))).join('\n\f\n');
}

// -> { text } or { unsupported: reason }
function extract(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 8);
  if (head.toString('latin1', 0, 5) === '%PDF-') {
    return { text: execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') };
  }
  if (head.readUInt32LE(0) === 0x04034b50) {
    const zip = readZip(buf);
    if (zip.has('word/document.xml')) return { text: docxText(zip) };
    if (zip.has('content.xml')) return { text: odtText(zip) };
    if (zip.names().some((n) => n.startsWith('ppt/slides/'))) return { text: pptxText(zip) };
    return { unsupported: 'zip that is not a document' };
  }
  if (head.toString('hex') === 'd0cf11e0a1b11ae1') {
    try { return { text: docText(buf) }; } catch (e) { return { unsupported: `old binary Office file (${e.message})` }; }
  }
  const text = buf.toString('utf8');
  if (/<html|<!doctype html/i.test(text.slice(0, 500))) return { unsupported: 'a web page, not the file' };
  if (/\u0000/.test(text.slice(0, 2000))) return { unsupported: 'binary file of unknown type' };
  return { text: text.replace(/^﻿/, '') };
}

function main() {
  const refresh = process.argv.includes('--refresh');
  fs.mkdirSync(TEXT, { recursive: true });
  const unsupported = {};
  let n = 0;
  const each = (src, dest) => {
    if (!refresh && fs.existsSync(dest)) return;
    try {
      const r = extract(src);
      if (r.unsupported) { unsupported[path.relative(RAW, src)] = r.unsupported; return; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, r.text);
      n++;
    } catch (e) { unsupported[path.relative(RAW, src)] = e.message.split('\n')[0]; }
  };
  for (const name of fs.readdirSync(RAW)) {
    const full = path.join(RAW, name);
    if (name.endsWith('.bin')) each(full, path.join(TEXT, name.replace(/\.bin$/, '.txt')));
    else if (name.endsWith('.dir')) {
      for (const f of fs.readdirSync(full)) if (f.endsWith('.bin')) each(path.join(full, f), path.join(TEXT, name, f.replace(/\.bin$/, '.txt')));
    }
  }
  writeJson(path.join(WORK, 'extract-log.json'), { unsupported }, true);
  console.log(`Extracted ${n} files; ${Object.keys(unsupported).length} unsupported (see .ingest/extract-log.json).`);
}

if (require.main === module) main();
module.exports = { extract };
