/* Step 3: packet text (and isobowl's and scibowldb's structured records)
   to question records in the bank's shape:
     { qt, n, s, f, q, c?, a: { t, l?, ac?, rj? }, pg? }
   build.js calls these; nothing here reads or writes files.

   Packets are read the way a moderator's packet is laid out:
     TOSS-UP
     1) BIOLOGY Multiple Choice  <question>
     W) ...  X) ...  Y) ...  Z) ...
     ANSWER: Z) ...  (ACCEPT: ...) (DO NOT ACCEPT: ...)
     BONUS
     1) ...
   with the usual variants (TOSSUP / TOSS UP, "1." for "1)", "Short Answer"
   or "Multiple Choice" after a dash, subject names old and new). */

// Subject names as packets print them, old abbreviations ("BIOL-91",
// "GENR") included.
const SUBJECTS = [
  [/^(BIOLOGY|LIFE SCIENCES?|BIO|BIOL)$/, 'bio'],
  [/^((GENERAL|ORGANIC|INORGANIC|PHYSICAL|ANALYTICAL) CHEMISTRY|BIOCHEMISTRY|CHEMISTRY|CHEM)$/, 'chem'],
  [/^(PHYSICS|PHYSICAL SCIENCE|PHYS)$/, 'phys'],
  [/^(MATH|MATHEMATICS)$/, 'math'],
  [/^(EARTH (AND|&) SPACE( SCIENCES?)?|EARTH SCIENCE|ASTRONOMY|ASTR|EARTH|ESS|EART|ERSC)$/, 'ess'],
  [/^(ENERGY|GENERAL SCIENCE|COMPUTER SCIENCE|TECHNOLOGY|GENR|ENER|COMP)$/, 'energy'],
];
const SUBJECT_WORDS = '(?:GENERAL|ORGANIC|INORGANIC|PHYSICAL|ANALYTICAL) CHEMISTRY|BIOCHEMISTRY|BIOLOGY|LIFE SCIENCES?|CHEMISTRY|PHYSICS|PHYSICAL SCIENCE|MATH(?:EMATICS)?|EARTH (?:AND|&) SPACE(?: SCIENCES?)?|EARTH SCIENCE|ASTRONOMY|ENERGY|GENERAL SCIENCE|COMPUTER SCIENCE|BIOL|CHEM|PHYS|ASTR|EART|ERSC|GENR|ENER|COMP';
function subjectKey(word) {
  const w = String(word || '').toUpperCase().replace(/-\d+$/, '').replace(/\s+/g, ' ').trim();
  const hit = SUBJECTS.find(([re]) => re.test(w));
  return hit ? hit[1] : null;
}

// The bank's text conventions, applied to every field.
function clean(s) {
  if (s == null) return s;
  return String(s)
    .replace(/ /g, ' ')
    .replace(/[‐‑]/g, '-')
    // Math italic letters (𝑔, 𝑥) as plain ones.
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, (ch) => ch.normalize('NFKC'))
    // Sub/superscripts from .docx runs: x^(2) -> x^2, C_(30) -> C30.
    .replace(/_\((\d+)\)/g, '$1')
    .replace(/\^\(([^()\s]{1})\)/g, '^$1')
    .replace(/\^\((\d+)\)/g, '^$1')
    // Author tags and pronunciation guides: [EH], [c-A-M-P], [SIN-uh-mun].
    .replace(/\s*\[[A-Z]{1,4}(?:\/[A-Z]{1,4})*\]/g, '')
    .replace(/\s*\[(?=[^\]]*-)[A-Za-z' -]+\]/g, '')
    .replace(/\s*\[[a-z][a-z' ]*\]/g, '')
    // "30pi" is written 30π.
    .replace(/(\d)\s?pi\b/g, '$1π')
    // Reading aids: "(read as: SU-doe-POH-dee-ah)", "(pronounced ...)".
    .replace(/\s*\((?:read|pronounced|say)(?: as)?\s*:?[^()]*\)/gi, '')
    .replace(/º/g, '°')
    // A PDF's text layer drops superscripts: "× 105" is × 10^5.
    .replace(/(×\s*10)([−–-]?\d{1,3})\b/g, (_, a, e) => `${a}^${e.replace(/[−–]/, '-')}`)
    // Ion charges: "H+", "OH–" -> H^+, OH^-.
    .replace(/\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*)([+−–])(?=[\s,.;:)]|$)/g, (_, ion, c) => `${ion}^${c === '+' ? '+' : '-'}`)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
}

// "ANSWER: Z) DECREASES, DECREASES (ACCEPT: ...) (DO NOT ACCEPT: ...)"
function parseAnswer(raw, choices) {
  // The author's tag and anything after it on the line (topic codes,
  // "[LW] FLMO 7") isn't part of the answer.
  let t = clean(raw.replace(/^\s*ANSWER\s*:?\s*/i, '').replace(/\s*\[[A-Z]{1,4}(?:\s*[,/&]\s*[A-Z]{1,4})*\][^\n(]*$/, ''));
  const ac = [];
  const rj = [];
  t = t.replace(/\(\s*(DO NOT ACCEPT|DON'T ACCEPT|DO NOT TAKE)\s*:?\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_, __, x) => { rj.push(...x.split(/\s*[;,]\s*(?:OR\s+)?|\s+OR\s+/i).map(clean).filter(Boolean)); return ''; });
  t = t.replace(/\(\s*(ACCEPT|ALSO ACCEPT|ACCEPT ALSO)\s*:?\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_, __, x) => { ac.push(...x.split(/\s*;\s*|,\s+(?=[A-Z(])|\s+[Oo][Rr]\s+/).map(clean).filter(Boolean)); return ''; });
  t = clean(t);
  const a = {};
  const m = t.match(/^\(?([WXYZ])\s*(?:[).:]|--|—|–|-(?=\s))\s*(.*)$/i) || (choices && t.match(/^([WXYZ])$/i));
  if (choices && m) {
    a.l = m[1].toUpperCase();
    // The answer reads as its choice does (packets print it in capitals).
    const said = clean(m[2] || '');
    a.t = choices[a.l] && said.toLowerCase() === choices[a.l].toLowerCase() ? choices[a.l] : (said || choices[a.l] || '');
  } else a.t = t;
  if (ac.length) a.ac = ac;
  if (rj.length) a.rj = rj;
  return a;
}

// Packet text -> records. Page breaks (\f, from pdftotext) give each
// question's page; `lines` true gives its line instead (GitHub text files).
function parsePacketText(text, opts = {}) {
  const src = String(text).replace(/\r\n?/g, '\n').replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  // A question starts at a line's start: an optional TOSS-UP / BONUS line
  // (possibly numbered, "TOSSUP 1"), an optional number ("1)", "1."), the
  // subject, a separator (space, dash, comma, semicolon or colon) and the
  // format, "Short Answer" or "Multiple Choice".
  const header = new RegExp(`(^|\\n)[ \\t]*(?:(TOSS[- ]?UP|BONUS|VISUAL BONUS)(?:[ \\t]+(\\d{1,2}))?[ \\t]*\\n+[ \\t]*)?(?:(\\d{1,2})[).][ \\t]*)?(?:(TOSS[- ]?UP|BONUS)[ \\t]*[-–—:][ \\t]*)?(${SUBJECT_WORDS})(?:-\\d\\d)?[ \\t]*(?:[-–—:;,][ \\t]*)?(SHORT[ -]ANSWER|MULTIPLE[ -]CHOICE)[ \\t]*:?`, 'gi');
  const hits = [];
  let m;
  while ((m = header.exec(src))) {
    const n = m[4] || m[3];
    const numAt = m.index + (n ? m[0].indexOf(n, m[1].length) : m[1].length);
    hits.push({ at: m.index + m[1].length, numAt, end: header.lastIndex, kind: m[2] || m[5], n: n ? +n : null, subject: m[6], format: m[7] });
  }
  // A file with no TOSS-UP / BONUS lines at all (a subject set) is all toss-ups.
  const anyMarks = /^[ \t\f]*(TOSS[- ]?UP|BONUS)\b/im.test(src);
  const counts = { tossup: 0, bonus: 0 };
  const out = [];
  let lastType = null;
  hits.forEach((h, i) => {
    let body = src.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : src.length);
    // The next question's TOSS-UP/BONUS marker sits at the end of this body.
    body = body.replace(/\n[ \t]*(TOSS[- ]?UP|BONUS|VISUAL BONUS)(?:[ \t]+\d{1,2})?[ \t]*\n?[\s\S]*$/i, '');
    // Toss-up or bonus: the last TOSS-UP / BONUS line since the previous
    // question began (page furniture can sit between it and the number),
    // else the opposite of the previous question.
    const gap = src.slice(i ? hits[i - 1].end : 0, h.end);
    const marks = gap.match(/^[ \t\f]*(TOSS[- ]?UP|BONUS|VISUAL BONUS)(?:[ \t]+\d{1,2})?[ \t]*$/gim);
    const kind = h.kind || (marks && marks[marks.length - 1]);
    let qt;
    if (kind) qt = /BONUS/i.test(kind.trim().split(/\s/)[0]) ? 'bonus' : 'tossup';
    else if (!anyMarks) qt = 'tossup';
    else qt = lastType === 'tossup' ? 'bonus' : 'tossup';
    lastType = qt;
    counts[qt]++;
    const ansAt = body.search(/\n?[ \t]*ANSWER\s*:/i);
    let stem = ansAt >= 0 ? body.slice(0, ansAt) : body;
    let answer = ansAt >= 0 ? body.slice(ansAt) : '';
    // The answer is its line, and the lines after it while a bracket is
    // still open (a long accept list); a page footer or the next heading
    // after it isn't part of it.
    {
      const lines = answer.replace(/^\n/, '').split('\n');
      let a = lines[0];
      for (let k = 1; k < lines.length && /^[ \t]*$/.test(lines[k]) === false; k++) {
        const open = (a.match(/\(/g) || []).length - (a.match(/\)/g) || []).length;
        if (open <= 0) break;
        a += ' ' + lines[k];
      }
      answer = a.replace(/\f[\s\S]*$/, '');
    }
    const f = /MULTIPLE/i.test(h.format) ? 'MC' : 'SA';
    let c = null;
    if (f === 'MC') {
      // W) ... X) ... (OSTI's sets write w) x) y) z)), each at a line's start.
      const cm = stem.match(/(?:^|\n)[ \t]*\(?[Ww][).][ \t]*([\s\S]*?)\n[ \t]*\(?[Xx][).][ \t]*([\s\S]*?)\n[ \t]*\(?[Yy][).][ \t]*([\s\S]*?)\n[ \t]*\(?[Zz][).][ \t]*([\s\S]*)$/)
        || stem.match(/(?:^|\s)W[).]\s*([\s\S]*?)\s+X[).]\s*([\s\S]*?)\s+Y[).]\s*([\s\S]*?)\s+Z[).]\s*([\s\S]*)$/);
      if (cm) {
        c = { W: clean(cm[1]), X: clean(cm[2]), Y: clean(cm[3]), Z: clean(cm[4]) };
        stem = stem.slice(0, cm.index);
      }
    }
    stem = stem.replace(/^[ \t]*[-–—:][ \t]*/, '');
    const rec = { qt, n: h.n != null ? h.n : counts[qt], s: subjectKey(h.subject) || 'energy', f, q: clean(stem.replace(/\f/g, ' ')), a: parseAnswer(answer, c) };
    if (c) rec.c = c;
    if (opts.pages) rec.pg = (src.slice(0, h.numAt).match(/\f/g) || []).length + 1;
    if (opts.lines) rec.pg = src.slice(0, h.numAt).split('\n').length;
    out.push(rec);
  });
  return out;
}

// isobowl's round records (fetch.js: isobowl-<slug>.json) -> { round number: records }.
function latexToText(s) {
  return String(s || '')
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{(\w+)\}\{(\w+)\}/g, '$1/$2')
    .replace(/\\sqrt\{(\w+)\}/g, '√$1')
    .replace(/\^([+-])/g, '^($1)')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|Omega|phi|rho|tau|epsilon)/g, (_, g) => ({ alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', Delta: 'Δ', Omega: 'Ω', phi: 'φ', rho: 'ρ', tau: 'τ', epsilon: 'ε' }[g]))
    .replace(/\\(sin|cos|tan|ln|log|exp)\b\s*/g, '$1 ')
    .replace(/\\(cdot|times)/g, (_, x) => (x === 'cdot' ? '·' : '×'))
    .replace(/\\(le|leq)/g, '≤').replace(/\\(ge|geq)/g, '≥').replace(/\\infty/g, '∞')
    .replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/_\{([^{}]*)\}/g, '_($1)')
    .replace(/\\(left|right|,|;|!|text|mathrm)/g, '').replace(/[{}]/g, '');
}
function parseIsobowl(data) {
  const byRound = new Map();
  for (const r of data.rounds || []) {
    const recs = (r.questions || []).map((x) => {
      const mc = x.questionFormat === 'multiple_choice';
      const rec = {
        qt: x.questionType === 'bonus' ? 'bonus' : 'tossup',
        n: x.questionNumber,
        s: subjectKey(String(x.subject || '').replace(/_/g, ' ')) || ({ earth_and_space: 'ess', earth_space: 'ess' }[x.subject]) || 'energy',
        f: mc ? 'MC' : 'SA',
        // Items to rank or identify: "1) ...; 2) ..." after the question.
        q: clean(latexToText(x.questionText) + (x.possibleChoices && !/\b1\)/.test(x.questionText) ? ' ' + String(x.possibleChoices).split(/\s*;\s*/).map((c, k) => `${k + 1}) ${latexToText(c)}`).join('; ') : '')),
        a: { t: clean(latexToText(x.answerText)) },
      };
      if (mc) {
        rec.c = { W: clean(latexToText(x.choiceW)), X: clean(latexToText(x.choiceX)), Y: clean(latexToText(x.choiceY)), Z: clean(latexToText(x.choiceZ)) };
        if (x.correctChoice) { rec.a.l = x.correctChoice; rec.a.t = rec.c[x.correctChoice] || rec.a.t; }
      }
      if (x.accept) rec.a.ac = String(x.accept).split(/\s*;\s*/).map((y) => clean(latexToText(y))).filter(Boolean);
      if (x.doNotAccept) rec.a.rj = String(x.doNotAccept).split(/\s*;\s*/).map((y) => clean(latexToText(y))).filter(Boolean);
      return rec;
    });
    byRound.set(r.roundNumber, recs);
  }
  return byRound;
}

// scibowldb's API (fetch.js: scibowldb.json) -> Map "tossup/5196" -> record.
function parseScibowldb(data) {
  const out = new Map();
  for (const x of data.questions || []) {
    for (const qt of ['tossup', 'bonus']) {
      const text = x[qt + '_question'];
      if (!text) continue;
      const mc = /multiple/i.test(x[qt + '_format'] || '');
      let q = String(text);
      let c = null;
      if (mc) {
        const cm = q.match(/^([\s\S]*?)\s*W[).]\s*([\s\S]*?)\s*X[).]\s*([\s\S]*?)\s*Y[).]\s*([\s\S]*?)\s*Z[).]\s*([\s\S]*)$/);
        if (cm) { q = cm[1]; c = { W: clean(cm[2]), X: clean(cm[3]), Y: clean(cm[4]), Z: clean(cm[5]) }; }
      }
      const rec = { qt, s: subjectKey(x.category) || 'energy', f: mc ? 'MC' : 'SA', q: clean(q), a: parseAnswer(String(x[qt + '_answer'] || ''), c) };
      if (c) rec.c = c;
      out.set(`${qt}/${x.id}`, rec);
    }
  }
  return out;
}

// A JSON list of questions (a question bank's export, e.g. Blurt's
// questions.json): objects with question, answer, mode (Tossup/Bonus),
// subject, type, W..Z and letter. Numbered in file order.
function parseJsonList(list) {
  if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object' || !('question' in list[0])) return null;
  return list.map((x, k) => {
    const mc = /multiple/i.test(x.type || '') || (x.W && x.X);
    const rec = {
      qt: /bonus/i.test(x.mode || '') ? 'bonus' : 'tossup',
      n: k + 1,
      s: subjectKey(x.subject) || 'energy',
      f: mc ? 'MC' : 'SA',
      q: clean(x.question),
      a: { t: clean(x.answer) },
    };
    if (mc) {
      rec.c = { W: clean(x.W), X: clean(x.X), Y: clean(x.Y), Z: clean(x.Z) };
      if (x.letter) rec.a.l = String(x.letter).toUpperCase();
    }
    return rec;
  });
}

module.exports = { parseJsonList, parsePacketText, parseIsobowl, parseScibowldb, parseAnswer, clean, subjectKey, latexToText };
