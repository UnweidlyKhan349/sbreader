/* SB Reader - shared data layer */
(function (global) {
  const SBData = {
    meta: null,
    questions: null,
    _readyPromise: null,
    _metaPromise: null,
  };

  // Some scraped answer strings end with a Discord-style transcriber
  // signature (e.g. "Fermi energy dannyridel#2256") accidentally left in
  // during packet transcription. Strip just that trailing "name#1234" tag -
  // it's not part of the actual answer.
  const AUTHOR_TAG_RE = /\s+[A-Za-z0-9_]{2,32}#\d{3,6}\s*$/;
  function stripAuthorTag(s) {
    if (!s) return s;
    return s.replace(AUTHOR_TAG_RE, '').trim();
  }

  // Two specific 2019 packets ("DVHS Set 2 Round 2/3") have a page-footer
  // copyright notice leaked onto the end of every single answer in the
  // packet, e.g. an answer of "Hardness" was scraped as "Hardness 2019 DSB
  // ®" - checked against the whole bank (26 answers, all in those two
  // packets, no matches anywhere else):
  // strip a trailing "<year> <ORG> ®" tag like this wherever it turns up,
  // so a genuinely correct answer (a list-style one especially - the
  // trailing garbage broke the list/ranking canonicalizer, since "2,3,1
  // 2019 DSB ®" doesn't parse as a clean digit list) isn't silently graded
  // wrong because of an artifact from the source PDF.
  const TRAILING_WATERMARK_RE = /\s*\\?\s*(?:19|20)\d{2}\s+[A-Z]{2,6}\s*®\s*$/;
  function stripTrailingWatermark(s) {
    if (!s) return s;
    return s.replace(TRAILING_WATERMARK_RE, '').trim();
  }

  // Display names for meta.json's short subject keys.
  const SUBJECT_LABELS = {
    bio: 'Biology', chem: 'Chemistry', earth: 'Earth & Space', ess: 'Earth & Space',
    energy: 'Energy', math: 'Math', phys: 'Physics', other: 'General/Other',
  };
  function subjectLabel(key) {
    return SUBJECT_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : key);
  }
  SBData.subjectLabel = subjectLabel;

  // Competition level (high school vs middle school) is a property of the
  // tournament, not of each question, so meta.json tags each tournament with
  // `level` ("hs"/"ms") and every question inherits it at load time.
  const LEVEL_LABELS = { hs: 'High School', ms: 'Middle School' };
  SBData.LEVEL_LABELS = LEVEL_LABELS;

  // Visual questions (a packet's "visual bonus") come with one or more
  // images, stored in data/img/ and named in the record's `im` list. The
  // Visual filter has two values, like every other chip row: none selected
  // means both.
  const VISUAL_LABELS = { visual: 'Visual', text: 'Text only' };
  const VISUAL_KEYS = ['visual', 'text'];
  SBData.VISUAL_LABELS = VISUAL_LABELS;
  SBData.VISUAL_KEYS = VISUAL_KEYS;
  const IMG_DIR = 'data/img/';

  // Question/choice text sometimes has a bracketed pronunciation guide right
  // after the word it's for, e.g. "hypertrophic [hy-pur-TROH-fic]" - drop
  // it (and the space before it). This is deliberately narrow - it only
  // matches bracket content made of letters/apostrophes joined by hyphens
  // (real pronunciation guides always have at least one hyphenated syllable
  // break), so it never touches the packets' other bracketed asides like
  // "[read as: 5t, 2t squared]" (moderator instructions for reading
  // notation aloud) or plain math notation like "[0,1]".
  const PRONUNCIATION_RE = /\s*\[\s*[A-Za-z'’]+(?:\s*-\s*[A-Za-z'’]+)+\s*\]/g;
  function stripPronunciation(s) {
    if (!s) return s;
    return s.replace(PRONUNCIATION_RE, '').replace(/ {2,}/g, ' ').trim();
  }

  // PDF text extraction frequently split hyphenated compound words and
  // detached minus signs into three separate tokens with spaces on both
  // sides of the hyphen - "R-value" became "R - value", "chi-square" became
  // "chi - square", a negative number like "-3" became "- 3". Checked
  // against the whole bank (about 2,400 questions affected): collapsing any
  // "X - Y" back to "X-Y" whenever the hyphen is directly flanked by
  // non-space characters is safe here - there's no stylistic "spaced dash as
  // a sentence aside" usage in this corpus to accidentally weld two words
  // together (Science Bowl questions are terse and technical, not prose).
  // A single replace() pass can't catch adjacent/overlapping occurrences
  // like "A-T - C-T - G-C" (the regex engine advances past the char it just
  // consumed as the "Y" of one match before it can also use it as the "X" of
  // the next), so loop until a pass makes no further change - verified this
  // closes the full remaining gap (159/3692 cases needed more than one pass,
  // 0 left unresolved after looping).
  const SPACED_HYPHEN_RE = /(\S) - (\S)/g;
  function fixSpacedHyphens(s) {
    if (!s) return s;
    let prev;
    do {
      prev = s;
      s = s.replace(SPACED_HYPHEN_RE, '$1-$2');
    } while (s !== prev);
    return s;
  }

  // The same PDF extraction that spaced out hyphens (above) also spaced out curly
  // apostrophes - a possessive like "Hess's law" got scraped as "Hess ' s law" or, with the
  // curly quote the corpus actually uses, "HESS ’ S LAW". Verified against the full corpus
  // (47 fields affected, zero false positives): collapse the space before an opening curly
  // quote, the space before a closing curly quote, and - since that first pass alone would
  // leave a dangling "’ s"/"’ t" fragment - a stray space between a closing curly quote and
  // the short suffix that's actually part of the same contraction/possessive ('s, 't, 'd,
  // 'll, 're, 've, 'm). Order matters: the suffix pass has to run after the "space before
  // closing quote" pass has already pulled the quote itself in against its word.
  function fixSpacedApostrophes(s) {
    if (!s) return s;
    let out = s;
    out = out.replace(/‘\s+/g, '‘');
    out = out.replace(/\s+’/g, '’');
    out = out.replace(/’\s+(s|t|d|ll|re|ve|m)\b/gi, '’$1');
    return out;
  }

  // Only about 1 string in 20 needs any of the fixes above, and cleanText
  // runs on every question, choice and answer string (about 270,000) each
  // time a page loads the bank. One quick test for the characters the fixes
  // act on - "[", a curly quote, " - ", a double space, or whitespace at
  // either end - lets the rest skip all six regex passes, unchanged. That
  // roughly halves the time the bank takes to expand after download.
  const NEEDS_CLEANUP_RE = /[[‘’]| - | {2}|^\s|\s$/;
  function cleanText(s) {
    if (!s || !NEEDS_CLEANUP_RE.test(s)) return s;
    return fixSpacedApostrophes(fixSpacedHyphens(stripPronunciation(s)));
  }

  // There's no real LaTeX markup anywhere in the bank (no \frac, \sqrt or
  // similar commands; the "$" signs that appear are prices). What questions DO
  // sometimes have is plain-text "^" and "_" exponent/subscript notation
  // ("e^x", "K_c", "S_(n-1)"), carried over from however the original
  // packets were authored, alongside PDF-extraction damage that isn't
  // recoverable: a lost "^" leaves "x 2" indistinguishable from an
  // ordinary number ("100", "6 protons") with no way to tell them apart
  // programmatically, so those cases are left as plain text rather than
  // guessed at. This renders the well-formed "^"/"_" notation that IS
  // present as real superscript/subscript instead of raw carets and
  // underscores.
  //
  // A "^" or "_" is only ever treated as a real exponent/subscript marker
  // when a letter or digit sits directly on both sides of it - never when
  // it's preceded by another "^"/"_" (the (?<! ) lookbehinds below), which
  // is what a run of blanks looks like ("____(blank)" for a fill-in-the-
  // blank question, or a leaked "_word_" Markdown-italic reviewer comment)
  // rather than a math marker.
  //
  // Two forms are recognized: a parenthesized group right after the marker
  // - "e^(i * pi)", "S_(n - 1)" - captures everything inside the parens
  // verbatim, since that's an arbitrary sub-expression; a bare token -
  // "x^2", "K_c", "10^-3" - captures an optional leading sign followed by
  // letters/digits only, deliberately NOT allowing a later "+" or "-"
  // into the capture, because in this corpus those are almost always the
  // start of the NEXT term ("x^2 - 2x" is "x squared, minus 2x", not
  // "x to the (2-2x)") rather than part of the exponent itself. Verified
  // against every "^"/"_" occurrence in the corpus (393 fields) that this
  // produces no over-long or space-containing captures. A lone sign after
  // "^" is an ion charge ("H^+", "NO3^-", "e^−") and is superscripted on its
  // own. A single Greek letter is a token too ("n^α", "ν_μ", "log_φ"), but
  // never joins a Latin run, so "μ_0μ_r" stays two subscripts. A bare
  // exponent that starts with digits takes only the digits: "x^3y" is x³y,
  // "sp^3d" is sp³d and "^1H" is ¹H (a longer exponent like "e^(2x)" is
  // written with parentheses).
  // A bare charge before a state label ("OH^-(aq)") is still a charge, and
  // "^∞" (a series' upper limit) is raised like a number.
  const MATH_SUP_BARE_RE = /(?<!\^)\^([+\-−]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*|[\u0370-\u03FF]|∞|°)|[+\-−](?![A-Za-z0-9(])|[+\-−](?=\((?:aq|s|l|g)\)))/g;
  const MATH_SUB_BARE_RE = /(?<!_)_([+\-−]?(?:[A-Za-z0-9]+|[\u0370-\u03FF]))/g;
  // Plain string escaping (no DOM), so the math renderer also runs under
  // Node in the tests. Quotes are escaped too, for use inside attributes.
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }
  // Parenthesized groups can nest ("2^(2^(2^2))", "n^(1/ln(n))"), which a
  // single regex can't match, so they're found by paren counting and the
  // inside is rendered recursively. An unbalanced group is left as text.
  // LaTeX-style braces ("e^{-x}") are grouped the same way.
  const GROUP_CLOSE = { '(': ')', '{': '}' };
  function renderParenGroups(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const openCh = s[i + 1];
      if ((c === '^' || c === '_') && GROUP_CLOSE[openCh] && s[i - 1] !== c) {
        const closeCh = GROUP_CLOSE[openCh];
        let depth = 0;
        let j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === openCh) depth++;
          else if (s[j] === closeCh && --depth === 0) break;
        }
        if (j < s.length) {
          const tag = c === '^' ? 'sup' : 'sub';
          out += `<${tag}>` + renderParenGroups(s.slice(i + 2, j)) + `</${tag}>`;
          i = j + 1;
          continue;
        }
      }
      out += c;
      i++;
    }
    return out;
  }
  // Chemical formulas are stored the way players type them ("CO2",
  // "C3H7NO2", "Ca(OH)2") and shown with their counts as subscripts. A run
  // counts as a formula only when every symbol in it is an element, it has
  // a count, no count is 1 or starts with 0, and it isn't one of the
  // look-alikes the bank uses for other things (SN2 reactions, vitamin B2, P700,
  // histone H3, SH2 domains, K2V star classes, ...). A lone element with a
  // count ("C14", "Th1", "U235") is left alone unless it's a common
  // molecule (O2, Cl2, S8, C60). A run right before a sign is a charge
  // when it's one element or ends in two digits ("Na2+", "Al3+",
  // "SO42-"), so it's left as typed; "NH4+" and "H3O+" still get their
  // subscripts. A run written with its charge as a superscript ("H3^+",
  // "N5^(+)") is an ion, so a lone element gets its subscript there too.
  // A coefficient in front stays full size ("2H2O", "5H2O").
  // Checked against every matching run in the bank.
  const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
    'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os ' +
    'Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr').split(' '));
  const CHEM_LONE_OK = new Set(['H2', 'O2', 'N2', 'F2', 'Cl2', 'Br2', 'I2', 'O3', 'S8', 'P4', 'C60', 'Cl3', 'I3', 'C2', 'Li2', 'Na2', 'Be2', 'He2', 'Ne2', 'Hg2']);
  const CHEM_NOT = new Set(['SN2', 'SH2', 'H2B', 'K2V', 'COP2', 'PS2', 'SP2', 'SP3', 'HSP70', 'HSP90', 'KIN10', 'FBP7', 'POP3', 'SU2', 'H3K27', 'BV480', 'COV2', 'HHV3', 'IC50', 'P680', 'P700']);
  const CHEM_RUN_RE = /(?<![A-Za-z_^.\-]|\d\.)((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9]|\.\d)(?=([+\-−–](?![A-Za-z0-9]))?)/g;
  const ION_SUP_RE = /^<sup>\d*[+\-−–]<\/sup>/;
  function isFormula(run, charge, ion) {
    if (!/\d/.test(run) || CHEM_NOT.has(run)) return false;
    const els = run.match(/[A-Z][a-z]?/g);
    if (!els.every((e) => ELEMENTS.has(e))) return false;
    const counts = run.match(/\d+/g);
    if (counts.some((n) => n === '1' || n[0] === '0')) return false;
    if (els.every((e) => e === els[0]) && els.length > 1) return false;
    const lone = els.length === 1 && !run.includes('(');
    if (charge && (lone || /\d\d$/.test(run))) return false;
    return lone ? ion || CHEM_LONE_OK.has(run) : true;
  }
  function subscriptFormulas(html) {
    return html.replace(CHEM_RUN_RE, (m, run, charge, at, str) =>
      (isFormula(run, charge, ION_SUP_RE.test(str.slice(at + m.length)))
        ? run.replace(/([A-Za-z)])(\d+)/g, '$1<sub>$2</sub>') : m));
  }
  SBData.subscriptFormulas = subscriptFormulas;
  function renderMathHTML(s) {
    if (!s) return '';
    let out = renderParenGroups(escapeHtml(s));
    out = out.replace(MATH_SUP_BARE_RE, '<sup>$1</sup>');
    out = out.replace(MATH_SUB_BARE_RE, '<sub>$1</sub>');
    return subscriptFormulas(out);
  }
  SBData.renderMathHTML = renderMathHTML;

  // The authoritative text for an MC question's correct answer is its own
  // choice text (q.choices[letter]) - a separate "answer text" field also
  // exists in the source data, but it's sometimes truncated or abbreviated
  // there (a scraping artifact), which showed up as answers being cut off
  // mid-word when displayed. Preferring the matching choice's full text
  // whenever one exists sidesteps that regardless of which records still
  // have a mismatched/truncated answer.text.
  function answerDisplayText(q) {
    if (q.choices && q.answer.letter && q.choices[q.answer.letter]) return q.choices[q.answer.letter];
    return q.answer.text;
  }
  SBData.answerDisplayText = answerDisplayText;

  // Frequency lists, as QB Reader builds them: an answer's main part (what
  // comes before any "(" or "["), and a key that groups its spellings
  // (case, hyphens and spacing ignored). Number-only and "identify all"
  // answers ("2", "1 AND 3", "ALL", "NONE"), and numbers with a unit, get
  // no key: they'd top every
  // list without saying anything.
  function answerHead(q) {
    const t = String(answerDisplayText(q) || '').split(/[([]/)[0];
    return t.replace(/\s+/g, ' ').trim().replace(/[.;,:]+$/, '').trim();
  }
  function answerKey(q) {
    const head = answerHead(q);
    const key = head.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key || !/[a-z]/.test(key.replace(/\b(and|only|or|all|none|of|the|above|both)\b/g, ''))) return '';
    if (/^(all|none|both|neither)\b/.test(key)) return '';
    // A number, perhaps with a unit ("4 JOULES", "-3.72°C"), isn't a topic.
    if (/^[−+-]?\d[\d.,\s]*(?:[×x*]\s*10\^?[−-]?\d+)?(?:\s*[^\s-]\S{0,11})?$/.test(head)) return '';
    return key;
  }
  SBData.answerHead = answerHead;
  SBData.answerKey = answerKey;
  // [{ answer, count }], most frequent first (ties A-Z), at most `limit`.
  SBData.frequencyList = function (questions, limit) {
    const groups = new Map();
    questions.forEach((q) => {
      const key = answerKey(q);
      if (!key) return;
      let g = groups.get(key);
      if (!g) { g = { count: 0, forms: new Map() }; groups.set(key, g); }
      g.count++;
      const head = answerHead(q);
      g.forms.set(head, (g.forms.get(head) || 0) + 1);
    });
    // Each answer is shown in its most common spelling.
    return [...groups.values()].map((g) => ({
      answer: [...g.forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: g.count,
    })).sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer)).slice(0, limit || undefined);
  };

  // Builds the "Answer: ..." line's inner HTML, with any accept-list
  // alternates folded inline as "(also accept: ...)" rather than shown as
  // their own separate line - keeps the primary and alternate answers
  // visually tied together instead of reading as two unrelated facts.
  // "Answer: X) LITHIUM-ION (also accept: Li-ion) (do not accept: LITHIUM)",
  // all on one line.
  function answerLineHTML(mainText, letter, acceptList, rejectList) {
    let s = 'Answer: ' + (letter ? `${escapeHtml(letter)}) ` : '') + renderMathHTML(mainText);
    if (acceptList && acceptList.length) {
      s += ' <span class="also-accept">(also accept: ' + renderMathHTML(acceptList.join('; ')) + ')</span>';
    }
    if (rejectList && rejectList.length) {
      s += ' <span class="do-not-accept">(do not accept: ' + renderMathHTML(rejectList.join('; ')) + ')</span>';
    }
    return s;
  }
  SBData.answerLineHTML = answerLineHTML;
  SBData.escapeHtml = escapeHtml;

  /* ---------------- Question cards (catalog, bookmarks, session logs) ---------------- */
  const QTYPE_LABELS = { tossup: 'Toss-up', bonus: 'Bonus' };
  const FORMAT_LABELS = { SA: 'Short Answer', MC: 'Multiple Choice' };
  const GRADE_LABELS = { correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped' };
  SBData.QTYPE_LABELS = QTYPE_LABELS;
  // A bonus with a figure is a packet's "visual bonus", so its type tag says so.
  // It takes the Visual tag's colour; a visual tossup keeps a separate Visual tag.
  function isVisualBonus(q) { return !!q.visual && q.qtype === 'bonus'; }
  function qtypeLabel(q) {
    const base = QTYPE_LABELS[q.qtype] || q.qtype;
    return isVisualBonus(q) ? 'Visual ' + base : base;
  }
  // What's read out before a question, as a moderator says it:
  // "TOSS-UP Physics Short Answer ..." (the kind in semi-bold, the format in
  // italics), then the question itself.
  // Numbered statements each on their own line:
  //   "Identify all of the following that are true: 1) A; 2) B; and 3) C"
  //   -> "Identify all of the following that are true\n1) A\n2) B\n3) C"
  // Markers can be "1)", "1.", "(1)", or roman "I)" / "I." (I to VIII; never
  // "X)", a choice letter). A marker comes after a space or punctuation (or
  // at the start) and not inside parentheses (so "(5,6)", "sin(π/6)" and
  // "O(n^2)" are left alone); "1." needs a space after it, so "1.5" isn't one.
  // Only runs of one style counting up from 1, at least two long, are split;
  // a list nested in an item starts its own run. The separator before each
  // marker (";", ",", "and", or the colon before the first) goes; "?" and "."
  // stay.
  const ROMAN_VALUES = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  const MARKER_STYLES = [
    { kind: 'paren', re: /(\d{1,2})\)(?=\s)/g, n: (m) => +m[1] },
    { kind: 'dot', re: /(\d{1,2})\.(?=\s)/g, n: (m) => +m[1] },
    { kind: 'wrapped', re: /\((\d{1,2})\)(?=\s)/g, n: (m) => +m[1], wrapped: true },
    { kind: 'roman-paren', re: /\b(VIII|VII|VI|IV|V|III|II|I)\)(?=\s)/g, n: (m) => ROMAN_VALUES[m[1]] },
    { kind: 'roman-dot', re: /\b(VIII|VII|VI|IV|V|III|II|I)\.(?=\s)/g, n: (m) => ROMAN_VALUES[m[1]] },
  ];
  function parenDepth(text, at) {
    let depth = 0;
    for (let i = 0; i < at; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth = Math.max(0, depth - 1);
    }
    return depth;
  }
  function splitNumberedStatements(text) {
    if (!text || !/[).]/.test(text)) return text;
    const keep = [];
    MARKER_STYLES.forEach((style) => {
      const markers = [];
      style.re.lastIndex = 0;
      let m;
      while ((m = style.re.exec(text))) {
        const at = m.index;
        if (at > 0 && !/[\s:;,.?!]/.test(text[at - 1])) continue;
        if (parenDepth(text, at) > 0) continue;
        markers.push({ at, n: style.n(m) });
      }
      const runs = [];
      let cur = null;
      markers.forEach((mk) => {
        if (mk.n === 1) { cur = [mk]; runs.push(cur); } else if (cur && mk.n === cur[cur.length - 1].n + 1) cur.push(mk);
      });
      runs.filter((r) => r.length >= 2).forEach((r) => keep.push(...r));
    });
    if (!keep.length) return text;
    keep.sort((a, b) => a.at - b.at);
    let out = '';
    let from = 0;
    keep.forEach((mk) => {
      if (mk.at < from) return; // overlaps a marker already used
      let before = text.slice(from, mk.at).replace(/\s+$/, '');
      before = before.replace(/[\s;,]*\b(?:and|or)$/i, '').replace(/[;,:]$/, '').replace(/\s+$/, '');
      out += before + (before || out ? '\n' : '');
      from = mk.at;
    });
    return out + text.slice(from);
  }
  SBData.splitNumberedStatements = splitNumberedStatements;
  // A question's text as shown: numbered statements on their own lines,
  // math rendered.
  function questionTextHTML(q) { return renderMathHTML(splitNumberedStatements(q.question || '')); }
  SBData.questionTextHTML = questionTextHTML;

  // The header line alone ("TOSS-UP Physics Short Answer" and a newline).
  function readoutHeaderHTML(q) {
    const kind = isVisualBonus(q) ? 'VISUAL BONUS' : q.qtype === 'bonus' ? 'BONUS' : 'TOSS-UP';
    return `<span class="fw-semibold">${kind}</span> ${escapeHtml(subjectLabel(q.subject))} <i>${escapeHtml(FORMAT_LABELS[q.format] || q.format || '')}</i>\n`;
  }
  SBData.readoutHeaderHTML = readoutHeaderHTML;
  function readoutHTML(q) {
    return readoutHeaderHTML(q) + questionTextHTML(q);
  }

  SBData.readoutHTML = readoutHTML;
  function qtypeTagClass(q) { return 'tag qtype-' + q.qtype + (isVisualBonus(q) ? ' visual' : ''); }
  SBData.qtypeLabel = qtypeLabel;
  SBData.qtypeTagClass = qtypeTagClass;
  SBData.FORMAT_LABELS = FORMAT_LABELS;

  // The tag row. opts: { grade: 'correct'|'incorrect'|'skipped', sourceUrl }
  // With a packet sourceUrl, a "Source" link follows the source label.
  function questionMetaRow(q, opts) {
    opts = opts || {};
    const srcLink = isPacketUrl(opts.sourceUrl)
      ? ` / <a href="${escapeHtml(opts.sourceUrl)}" target="_blank" rel="noopener">Source</a>`
      : '';
    const row = document.createElement('div');
    row.className = 'meta-row';
    row.innerHTML = [
      opts.grade && opts.grade !== 'skipped' ? `<span class="grade-badge ${opts.grade}">${GRADE_LABELS[opts.grade]}</span>` : '',
      `<span class="tag subject-${escapeHtml(q.subject)}">${escapeHtml(subjectLabel(q.subject))}</span>`,
      `<span class="${escapeHtml(qtypeTagClass(q))}">${escapeHtml(qtypeLabel(q))}</span>`,
      `<span class="tag fmt fmt-${escapeHtml((q.format || '').toLowerCase())}">${escapeHtml(FORMAT_LABELS[q.format] || q.format)}</span>`,
      q.visual && !isVisualBonus(q) ? '<span class="tag visual">Visual</span>' : '',
      `<span class="small-note">${escapeHtml(SBData.sourceLabelFor(q, ' / '))}${srcLink}</span>`,
    ].join('');
    return row;
  }

  // A visual question's images. The width/height attributes give each image
  // its aspect ratio before it loads, so nothing below it jumps when it
  // arrives. Clicking an image opens it full size. opts: { eager }
  function questionFigures(q, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'q-figures';
    // Only the site's own figures: in Multiplayer the question arrives from
    // another player's browser, which shouldn't be able to load other images.
    const own = (q.images || []).filter((im) => im && typeof im.src === 'string' && im.src.startsWith(IMG_DIR) && !im.src.includes('..'));
    own.forEach((im, k) => {
      const img = document.createElement('img');
      img.src = im.src;
      if (im.w && im.h) { img.width = im.w; img.height = im.h; }
      img.alt = own.length > 1 ? `Figure ${k + 1} for this question` : 'Figure for this question';
      img.loading = opts && opts.eager ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.className = 'q-figure';
      img.title = 'Click to enlarge';
      img.addEventListener('click', () => openLightbox(im.src, img.alt));
      wrap.appendChild(img);
    });
    return wrap;
  }

  // Full-size view of one figure. Esc, a click anywhere, or the close
  // button dismisses it.
  function openLightbox(src, alt) {
    const old = document.getElementById('sbLightbox');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'sbLightbox';
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', alt || 'Figure');
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    const close = document.createElement('button');
    close.className = 'btn btn-sm btn-light lightbox-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    box.appendChild(img);
    box.appendChild(close);
    function dismiss() {
      box.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    // While it's open, keys belong to it: game shortcuts (Space to buzz,
    // N to skip) don't reach the page underneath.
    function onKey(e) {
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    }
    box.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    close.focus();
  }

  // Starts downloading a question's images ahead of time (the next one in a
  // session's queue), so a visual question doesn't open on an empty frame.
  function preloadImages(q) {
    (q && q.images || []).forEach((im) => { const i = new Image(); i.src = im.src; });
  }

  // Question text, its figures if it's a visual question, then the MC
  // choices if there are any.
  // Where a buzz fell in a question, as QB Reader's Best Buzz marks it: the
  // question's text and choices as HTML with "(#)" after the last word that
  // was showing. `read` is how much had been read at the buzz, 0 to 1 (1
  // minus the celerity): the share of the characters Play and Multiplayer
  // type out, choices included but not the header line (js/reveal.js), so
  // the mark is found by laying the question out the same way. Needs SBReveal;
  // without it, or without a usable `read`, nothing is marked.
  const BUZZ_MARK = ' <span class="buzz-marker" title="Where you buzzed">(#)</span> ';
  function buzzMarked(q, read) {
    const text = questionTextHTML(q);
    const letters = q.choices ? ['W', 'X', 'Y', 'Z'] : [];
    const choices = {};
    letters.forEach((L) => { choices[L] = renderMathHTML(q.choices[L] || ''); });
    const out = { text, choices };
    const R = global.SBReveal;
    if (!R || !R.insertAtVisible || typeof read !== 'number' || !(read >= 0 && read <= 1)) return out;
    // The same segments the question is read from: header and question
    // together, then each choice.
    const header = R.visibleLength(readoutHeaderHTML(q));
    const segs = [{ html: readoutHeaderHTML(q) + text }, ...letters.map((L) => ({ html: choices[L] }))];
    const lengths = segs.map((s) => R.visibleLength(s.html));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (!total) return out;
    // A buzz always falls at the end of a word; the saved celerity is
    // rounded, so take the word end nearest to it.
    const target = header + read * (total - header);
    let at = 0;
    R.schedule(segs).words.forEach((w) => { if (Math.abs(w.end - target) < Math.abs(at - target)) at = w.end; });
    // Which segment that is, and how far into it.
    let i = 0;
    while (i < segs.length - 1 && at > lengths[i]) { at -= lengths[i]; i++; }
    // (An empty choice can't hold it: back to the last text before it.)
    while (i > 0 && !lengths[i]) { i--; at = lengths[i]; }
    if (i === 0) out.text = R.insertAtVisible(text, Math.max(0, at - header), BUZZ_MARK);
    else out.choices[letters[i - 1]] = R.insertAtVisible(choices[letters[i - 1]], at, BUZZ_MARK);
    return out;
  }
  SBData.buzzMarked = buzzMarked;

  // opts.buzzAt: how much of the question had been read at a buzz to mark
  // in the text (see buzzMarked).
  function appendQuestionBody(card, q, opts) {
    const marked = buzzMarked(q, opts && opts.buzzAt);
    const qText = document.createElement('div');
    qText.className = 'q-text';
    qText.innerHTML = marked.text;
    card.appendChild(qText);
    if (q.visual) card.appendChild(questionFigures(q));
    if (q.choices) {
      const ch = document.createElement('div');
      ch.className = 'choices';
      // One choice per line, as the question reads them.
      ch.innerHTML = ['W', 'X', 'Y', 'Z'].filter((L) => q.choices[L]).map((L) => `${L}) ${marked.choices[L]}`).join('<br>');
      card.appendChild(ch);
    }
  }

  // "Answer: ..." with its alternates, the reject list and the packet link.
  // `answer` defaults to the question's own; multiplayer clients pass the
  // reveal data instead, since their question copy has no answer.
  // answer: { text, letter, accept, reject, sourceUrl }; opts: { source }
  function answerBlock(q, answer, opts) {
    answer = answer || { text: answerDisplayText(q), letter: q.answer.letter, accept: q.answer.accept, reject: q.answer.reject };
    const wrap = document.createElement('div');
    const aText = document.createElement('div');
    aText.className = 'a-text';
    aText.innerHTML = answerLineHTML(answer.text, answer.letter, answer.accept, answer.reject);
    wrap.appendChild(aText);
    const srcUrl = answer.sourceUrl || q.sourceUrl;
    if (opts && opts.source && isPacketUrl(srcUrl)) {
      const src = document.createElement('div');
      src.className = 'src';
      const a = document.createElement('a');
      a.href = srcUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Source';
      src.appendChild(a);
      wrap.appendChild(src);
    }
    return wrap;
  }

  // A star that toggles one question's bookmark. onChange(isBookmarked).
  // QB Reader's star: a link holding Bootstrap Icons' star (outline) or
  // star-fill. A click stars or unstars the question; `.paint()` repaints it
  // (another card or tab may have changed it).
  function bookmarkButton(qId, onChange) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'star-question';
    a.dataset.qid = qId;
    function paint() {
      const on = SBData.bookmarks.isBookmarked(qId);
      const icons = window.SBIcons || {};
      a.innerHTML = (on ? icons.starFill : icons.star) || (on ? '★' : '☆');
      a.classList.toggle('selected', on);
      a.title = on ? 'Unstar' : 'Star';
      a.setAttribute('aria-label', on ? 'Unstar this question' : 'Star this question');
      a.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    a.paint = paint;
    paint();
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = SBData.bookmarks.toggle(qId);
      paint();
      if (onChange) onChange(now);
    });
    return a;
  }

  // A question as a Bootstrap card, laid out like QB Reader's database cards:
  //   header - "AVES 2 | Physics | Tossup | Multiple Choice" and the star
  //   body   - "1. " and the question, its figures and choices, a rule, the answer
  //   footer - the packet and question number, and the packet link
  // Used by the catalog and the Stats page.
  // opts: {
  //   grade: 'correct'|'incorrect'|'skipped'  badge before the source label
  //   answer: reveal data for answerBlock (multiplayer; default the question's own)
  //   sourceUrl: packet link (default the question's own)
  //   hideAnswer: start with the answer hidden behind a "Show answer" link
  //   note: an extra line under the answer ("You answered: ...")
  //   buzzAt: how much had been read at a buzz to mark with "(#)" (0 to 1)
  //   onBookmark(isBookmarked)
  // }
  function questionCard(q, opts) {
    opts = opts || {};
    const card = document.createElement('div');
    card.className = 'card q-card mb-3';
    card.dataset.qid = q.id;

    // As QB Reader's database cards: "Set | Category | Subcategory | ..."
    // on the left, the star on the right, and the question's number at the
    // start of its text.
    const header = document.createElement('div');
    header.className = 'card-header d-flex justify-content-between align-items-start gap-2';
    const title = document.createElement('b');
    title.className = 'q-card-title';
    if (opts.grade && opts.grade !== 'skipped') {
      const badge = document.createElement('span');
      badge.className = 'grade-badge me-2 ' + opts.grade;
      badge.textContent = GRADE_LABELS[opts.grade];
      title.appendChild(badge);
    }
    // "AVES 2025 | RR 1 | Question 7 | Biology | Tossup | Short Answer",
    // bold and underlined, linking to the source packet when there is one.
    const parts = [q.tournament, SBData.roundLabelFor(q), q.num ? 'Question ' + q.num : '',
      subjectLabel(q.subject), qtypeLabel(q), FORMAT_LABELS[q.format] || q.format];
    if (q.visual && !isVisualBonus(q)) parts.push('Visual');
    const src = opts.answer && opts.answer.sourceUrl ? opts.answer.sourceUrl : (opts.sourceUrl || q.sourceUrl);
    const titleText = isPacketUrl(src) ? document.createElement('a') : document.createElement('span');
    titleText.className = 'q-card-title-text';
    titleText.textContent = parts.filter(Boolean).join(' | ');
    if (isPacketUrl(src)) { titleText.href = src; titleText.target = '_blank'; titleText.rel = 'noopener'; titleText.title = 'Source packet'; }
    title.appendChild(titleText);
    header.append(title, bookmarkButton(q.id, opts.onBookmark));
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'card-body';
    appendQuestionBody(body, q, { buzzAt: opts.buzzAt });
    if (q.num) {
      const n = document.createElement('span');
      n.className = 'q-num';
      n.textContent = q.num + '. ';
      body.querySelector('.q-text').prepend(n);
    }
    const hr = document.createElement('hr');
    hr.className = 'my-2';
    body.appendChild(hr);
    const answerWrap = answerBlock(q, opts.answer || null);
    answerWrap.classList.add('flex-grow-1');
    // The answer on the left, "Stats | Report" on its right.
    const answerRow = document.createElement('div');
    answerRow.className = 'd-flex justify-content-between align-items-start gap-2 q-card-answer-row';
    const links = document.createElement('small');
    links.className = 'q-card-links text-nowrap ms-auto';
    if (window.SBQuestionStats) links.append(SBQuestionStats.link(q));
    if (window.SBReports) {
      if (links.childNodes.length) links.append(' | ');
      links.append(SBReports.link(q));
    }
    answerRow.append(answerWrap, links);
    if (opts.hideAnswer) {
      answerWrap.style.display = 'none';
      const show = document.createElement('button');
      show.type = 'button';
      show.className = 'btn btn-link p-0 show-answer-btn';
      show.textContent = 'Show answer';
      show.addEventListener('click', () => {
        answerWrap.style.display = '';
        show.remove();
      });
      answerRow.prepend(show);
    }
    body.appendChild(answerRow);
    if (opts.note) {
      const note = document.createElement('div');
      note.className = 'small-note mt-1';
      note.textContent = opts.note;
      body.appendChild(note);
    }
    card.appendChild(body);
    return card;
  }

  SBData.questionCard = questionCard;
  SBData.questionMetaRow = questionMetaRow;
  SBData.appendQuestionBody = appendQuestionBody;
  SBData.questionFigures = questionFigures;
  SBData.openLightbox = openLightbox;
  SBData.preloadImages = preloadImages;
  SBData.answerBlock = answerBlock;
  SBData.bookmarkButton = bookmarkButton;

  // meta.json's `subjects` field is a flat array of short keys, and its
  // subjects/qtypes arrays are alphabetical (how the Python build scripts
  // wrote them). Every chip row expects {key, label} objects in display
  // order - Math, Physics, Biology, Chemistry, Earth & Space, Energy, and
  // Tossup before Bonus - so that's fixed here, once, for every page.
  const SUBJECT_ORDER = ['math', 'phys', 'bio', 'chem', 'earth', 'ess', 'energy'];
  const QTYPE_ORDER = ['tossup', 'bonus'];
  function byFixedOrder(order, keyOf) {
    return (a, b) => {
      const ai = order.indexOf(keyOf(a));
      const bi = order.indexOf(keyOf(b));
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    };
  }
  function normalizeMeta(meta) {
    if (Array.isArray(meta.subjects) && meta.subjects.length && typeof meta.subjects[0] === 'string') {
      meta.subjects = meta.subjects.map((key) => ({ key, label: subjectLabel(key) }));
    }
    if (Array.isArray(meta.subjects)) meta.subjects.sort(byFixedOrder(SUBJECT_ORDER, (s) => s.key));
    if (Array.isArray(meta.qtypes)) meta.qtypes.sort(byFixedOrder(QTYPE_ORDER, (q) => q));
    if (!Array.isArray(meta.levels)) meta.levels = ['hs', 'ms'];
    return meta;
  }

  // The bank is one file per tournament, data/bank/<slug>.json: an array of
  // packets, each carrying the fields its questions share (`rl` round label,
  // `r` round, `u` packet URL) and the questions under `q`. The tournament's
  // name and slug come from meta.json. tools/bank.js converts to and from
  // the flat one-record-per-question form; see the README's Data format.
  const BANK_DIR = 'data/bank/';
  const PACKET_KEYS = ['rl', 'r', 'u'];

  // Expands one tournament's packets into the shape used throughout the app,
  // applying the display-time text cleanup above.
  function expandTournament(t, packets) {
    const level = t.level || 'hs';
    const out = [];
    packets.forEach((p) => p.q.forEach((q) => {
      const images = q.im ? q.im.map((im) => ({ src: IMG_DIR + im.f, w: im.w, h: im.h })) : [];
      out.push({
        id: q.i,
        tournament: t.name,
        tSlug: t.slug,
        // The tournament's year, for the year range filter (as on QB Reader).
        year: t.date ? parseInt(String(t.date).slice(0, 4), 10) || null : null,
        level,
        round: p.r,
        roundLabel: p.rl,
        subject: q.s,
        format: q.f,
        qtype: q.qt,
        num: q.n,
        question: cleanText(q.q),
        choices: q.c ? {
          W: cleanText(q.c.W), X: cleanText(q.c.X),
          Y: cleanText(q.c.Y), Z: cleanText(q.c.Z),
        } : null,
        images,
        visual: images.length > 0,
        answer: {
          text: stripTrailingWatermark(stripAuthorTag(cleanText(q.a.t))),
          letter: q.a.l || null,
          accept: (q.a.ac || []).map(cleanText),
          reject: (q.a.rj || []).map(cleanText),
        },
        sourceUrl: p.u ? p.u + packetAnchor(p.u, q.pg) : p.u,
      });
    }));
    // How many questions each packet has, for "Question 10 of 24": its
    // highest question number (some sets number tossups and bonuses in one
    // run, so a count of either would be wrong). Only questions in a named
    // round have one; a set with no rounds isn't a packet.
    // (The cleaned round label is worked out once per packet, not per question.)
    const labels = new Map();
    const labelOf = (q) => {
      const raw = `${q.roundLabel}|${q.round}`;
      if (!labels.has(raw)) labels.set(raw, SBData.roundLabelFor(q));
      return labels.get(raw);
    };
    const most = new Map();
    out.forEach((q) => {
      const round = q.num > 0 && labelOf(q);
      if (round) most.set(round, Math.max(most.get(round) || 0, q.num));
    });
    out.forEach((q) => { if (q.num > 0) { const n = most.get(labelOf(q)); if (n) q.packetSize = n; } });
    return out;
  }

  // Where in its packet a question is (`pg`, found by
  // tools/packet-locations.js), as a fragment for the packet link: the page
  // of a PDF (browsers' PDF viewers open url#page=N there) or the line of a
  // GitHub file (#LN). Other links have no such anchor.
  function packetAnchor(url, pg) {
    if (!url || !(pg > 0)) return '';
    const bare = url.split(/[?#]/)[0];
    const githubBlob = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(url);
    if (/\.pdf$/i.test(bare) && !githubBlob) return '#page=' + pg;
    if (githubBlob && /\.(txt|md|round)$/i.test(bare)) return '#L' + pg;
    return '';
  }
  SBData.packetAnchor = packetAnchor;

  // bank: [{ slug, packets }] in any order; questions come out in
  // meta.tournaments order (A-Z), each tournament in its file's order.
  function expandQuestions(meta, bank) {
    const bySlug = new Map(bank.map((b) => [b.slug, b.packets]));
    const out = [];
    (meta.tournaments || []).forEach((t) => {
      if (bySlug.has(t.slug)) out.push(...expandTournament(t, bySlug.get(t.slug)));
    });
    return out;
  }

  // The flat record list (every field on every question, as in the old
  // data/questions.json), for tests and tools/bank.js.
  function flattenBank(meta, bank) {
    const bySlug = new Map(bank.map((b) => [b.slug, b.packets]));
    const out = [];
    (meta.tournaments || []).forEach((t) => {
      (bySlug.get(t.slug) || []).forEach((p) => p.q.forEach((q) => {
        const rec = { i: q.i, t: t.name, ts: t.slug };
        PACKET_KEYS.forEach((k) => { if (k in p) rec[k] = p[k]; });
        Object.keys(q).forEach((k) => { if (k !== 'i') rec[k] = q[k]; });
        out.push(rec);
      }));
    });
    return out;
  }
  SBData.normalizeMeta = normalizeMeta;
  SBData.expandQuestions = expandQuestions;
  SBData.flattenBank = flattenBank;

  function fetchJson(url) {
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    });
  }

  // Just meta.json (about 58 KB) - enough for pages that only show counts.
  SBData.loadMeta = function () {
    if (SBData._metaPromise) return SBData._metaPromise;
    SBData._metaPromise = fetchJson('data/meta.json')
      .then((meta) => { SBData.meta = normalizeMeta(meta); return meta; });
    return SBData._metaPromise;
  };

  // A tournament's file, with the stamp of its contents (meta.json `v`, from
  // tools/meta-counts.js) so a cached copy is only used while it's current.
  function bankUrl(t) { return BANK_DIR + t.slug + '.json' + (t.v ? '?v=' + t.v : ''); }
  function indexUrl() { const v = SBData.meta && SBData.meta.bankIndex; return BANK_DIR + 'index.json' + (v ? '?v=' + v : ''); }
  SBData.bankUrls = function (meta) {
    return meta.tournaments.map(bankUrl);
  };

  // Downloads the given tournaments' files in parallel, expanding each one as
  // it arrives so the work overlaps the downloads still in flight.
  function loadTournaments(tournaments) {
    return Promise.all(tournaments.map((t) =>
      fetchJson(bankUrl(t)).then((packets) => expandTournament(t, packets))))
      .then((parts) => {
        SBData.questions = [].concat(...parts);
        SBData.byId = new Map(SBData.questions.map((q) => [q.id, q]));
        return SBData;
      });
  }

  // Just one tournament's questions (the set and packet pages).
  SBData.loadSet = function (slug) {
    return SBData.loadMeta().then((meta) => {
      const t = meta.tournaments.find((x) => x.slug === slug);
      return t ? loadTournaments([t]).then(() => t) : null;
    });
  };

  // The whole bank, for the pages whose filters and search span all of it.
  // The pages call this from <head>, so the downloads start before the rest
  // of the page has loaded; later calls return the same promise.
  SBData.load = function () {
    if (SBData._readyPromise) return SBData._readyPromise;
    SBData._readyPromise = SBData.loadMeta().then((meta) => {
      migrateBookmarks(meta.idAliases);
      return loadTournaments(meta.tournaments);
    });
    return SBData._readyPromise;
  };

  // Which tournament a question id belongs to, from data/bank/index.json's
  // [[firstId, slug], ...] runs (sorted by id): the last run starting at or
  // below the id.
  function slugForId(runs, id) {
    let lo = 0, hi = runs.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid][0] <= id) { found = runs[mid][1]; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }
  SBData.slugForId = slugForId;

  // Only the tournaments that hold a bookmarked question (the Bookmarks
  // page), so a handful of bookmarks doesn't cost the whole bank.
  // SBData.questions then holds just those tournaments' questions.
  SBData.loadBookmarked = function () {
    if (SBData._readyPromise) return SBData._readyPromise;
    if (SBData._bookmarkedPromise) return SBData._bookmarkedPromise;
    SBData._bookmarkedPromise = SBData.loadMeta().then((meta) => Promise.all([meta, fetchJson(indexUrl())]))
      .then(([meta, index]) => {
        migrateBookmarks(meta.idAliases);
        const slugs = new Set([...bookmarkSet()].map((id) => slugForId(index.ids, id)));
        return loadTournaments(meta.tournaments.filter((t) => slugs.has(t.slug)));
      });
    return SBData._bookmarkedPromise;
  };

  // Only the tournaments holding the given question ids (the Stats page's
  // recent answers). Ids that moved when duplicates were merged are
  // followed to the copy that was kept.
  SBData.loadIds = function (ids) {
    if (SBData._readyPromise) return SBData._readyPromise;
    return SBData.loadMeta().then((meta) => Promise.all([meta, fetchJson(indexUrl())]))
      .then(([meta, index]) => {
        const aliases = meta.idAliases || {};
        const slugs = new Set(ids.map((id) => slugForId(index.ids, aliases[id] != null ? aliases[id] : id)));
        return loadTournaments(meta.tournaments.filter((t) => slugs.has(t.slug)));
      });
  };

  /* ---------------- Bookmarks (localStorage) ---------------- */
  const BOOKMARK_KEY = 'sb_bookmarks_v1';

  // Parsed once and kept in memory; re-read only when another tab changes
  // the stored list. Callers get a copy so they can't change the cache.
  let bookmarkCache = null;
  function bookmarkSet() {
    if (!bookmarkCache) {
      try {
        const raw = localStorage.getItem(BOOKMARK_KEY);
        bookmarkCache = raw ? new Set(JSON.parse(raw)) : new Set();
      } catch (e) {
        bookmarkCache = new Set();
      }
    }
    return bookmarkCache;
  }
  function readBookmarks() {
    return new Set(bookmarkSet());
  }
  function writeBookmarks(set) {
    bookmarkCache = new Set(set);
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
    } catch (e) {
      /* ignore quota errors */
    }
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
      if (e.key === BOOKMARK_KEY || e.key === null) bookmarkCache = null;
    });
  }

  // Duplicate questions were merged into one kept copy; meta.json maps each
  // removed id to the id that replaced it. Point any saved bookmark at its
  // kept copy so it doesn't silently disappear.
  function migrateBookmarks(aliases) {
    if (!aliases) return;
    const set = readBookmarks();
    let changed = false;
    const out = new Set();
    set.forEach((id) => {
      const to = aliases[id];
      if (to !== undefined) changed = true;
      out.add(to !== undefined ? to : id);
    });
    if (changed) writeBookmarks(out);
  }

  // Listeners hear every change as (id, isBookmarked); js/account.js uses
  // this to mirror bookmarks to a logged-in account.
  const bookmarkListeners = [];
  function bookmarkChanged(id, on) {
    bookmarkListeners.forEach((fn) => { try { fn(id, on); } catch (e) { /* a listener's problem */ } });
  }
  SBData.bookmarks = {
    getAll() {
      return readBookmarks();
    },
    isBookmarked(id) {
      return bookmarkSet().has(id);
    },
    toggle(id) {
      const set = readBookmarks();
      if (set.has(id)) set.delete(id);
      else set.add(id);
      writeBookmarks(set);
      bookmarkChanged(id, set.has(id));
      return set.has(id);
    },
    add(id) {
      const set = readBookmarks();
      set.add(id);
      writeBookmarks(set);
      bookmarkChanged(id, true);
    },
    remove(id) {
      const set = readBookmarks();
      set.delete(id);
      writeBookmarks(set);
      bookmarkChanged(id, false);
    },
    clear() {
      writeBookmarks(new Set());
    },
    count() {
      return bookmarkSet().size;
    },
    // Replaces the whole set without telling the listeners (an account's
    // bookmarks arriving at login).
    replaceAll(ids) {
      writeBookmarks(new Set(ids));
    },
    onChange(fn) {
      bookmarkListeners.push(fn);
    },
  };

  /* ---------------- Packet order ---------------- */
  // Sorts questions the way they'd be read: by tournament (A-Z, as in the
  // tournament picker), then round number (unlabeled rounds last), then round
  // label (so NSB's "Set 2 · Round 1" follows "Set 1 · Round 1"), then
  // question number, tossup before its bonus. Ties (e.g. packets without
  // question numbers) keep the bank's own order. With { recent: true } the
  // tournaments go newest first instead (by the date in meta.json, then
  // A-Z), each still in packet order. Each order is computed once and
  // reused, since sorting 80k questions on every keystroke would lag.
  // The ranks belong to one list of questions: a page or tool that swaps in
  // another (loadSet, loadIds, tools/build-pages.js one tournament at a
  // time) gets them worked out again, or every question of the new list
  // would be unranked and keep the bank's file order.
  let packetRanks = {};
  let packetRanksFor = null;
  const qtypeRank = (t) => (QTYPE_ORDER.indexOf(t) + 1 || QTYPE_ORDER.length + 1);
  // Ranks the distinct values of a string field with the collator, so the
  // big sort below compares integers instead of calling the collator about
  // a million times. Values the collator calls equal share a rank.
  function collatedRanks(coll, values) {
    const distinct = [...new Set(values)].sort(coll.compare);
    const rank = new Map();
    distinct.forEach((v, i) => {
      const prev = distinct[i - 1];
      rank.set(v, i && coll.compare(prev, v) === 0 ? rank.get(prev) : i);
    });
    return rank;
  }
  function buildPacketRank(recent) {
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const nullsLast = (a, b) => (a == null ? (b == null ? 0 : 1) : (b == null ? -1 : a - b));
    const tRank = collatedRanks(coll, SBData.questions.map((q) => q.tournament || ''));
    if (recent) {
      // Newest date first; tournaments without a date go last, A-Z.
      const dates = new Map(((SBData.meta && SBData.meta.tournaments) || []).map((t) => [t.name, t.date || '']));
      const names = [...tRank.keys()].sort((a, b) => {
        const da = dates.get(a) || '', db = dates.get(b) || '';
        return (da === db ? 0 : da > db ? -1 : 1) || tRank.get(a) - tRank.get(b);
      });
      names.forEach((n, i) => tRank.set(n, i));
    }
    const rlRank = collatedRanks(coll, SBData.questions.map((q) => q.roundLabel || ''));
    const all = SBData.questions.map((q, i) => ({
      q, i, t: tRank.get(q.tournament || ''), rl: rlRank.get(q.roundLabel || ''), qt: qtypeRank(q.qtype),
    }));
    all.sort((x, y) => {
      const a = x.q, b = y.q;
      return x.t - y.t
        || nullsLast(a.round, b.round)
        || x.rl - y.rl
        || nullsLast(a.num, b.num)
        || x.qt - y.qt
        || x.i - y.i;
    });
    return new Map(all.map((e, rank) => [e.q.id, rank]));
  }
  SBData.sortByPacketOrder = function (list, opts) {
    const key = opts && opts.recent ? 'recent' : 'az';
    if (packetRanksFor !== SBData.questions) { packetRanks = {}; packetRanksFor = SBData.questions; }
    const packetRank = packetRanks[key] || (packetRanks[key] = buildPacketRank(key === 'recent'));
    // Every question has its own rank, so drop each into its slot instead of
    // sorting (linear time; this runs on every filter change and keystroke).
    const slots = new Array(packetRank.size);
    const unranked = [];
    list.forEach((q) => {
      const r = packetRank.get(q.id);
      if (r === undefined) unranked.push(q); else slots[r] = q;
    });
    return slots.filter((q) => q !== undefined).concat(unranked);
  };

  /* ---------------- Filtering ---------------- */
  // opts: { subjects, roundRange:[min,max], yearRange:[min,max], includeUnlabeled, tournaments, formats, qtypes, levels, visuals, bookmarkedOnly,
  //         search, ignoreWordOrder (default true), searchType: 'all' | 'question' | 'answer', exactWords (default false) }
  // each of subjects/tournaments/formats/qtypes/levels/visuals is either null/empty (= all) or a Set/array of allowed values
  // (visuals holds 'visual' and/or 'text')
  SBData.filterQuestions = function (opts) {
    opts = opts || {};
    const subjects = toSetOrNull(opts.subjects);
    const tournaments = toSetOrNull(opts.tournaments);
    const formats = toSetOrNull(opts.formats);
    const qtypes = toSetOrNull(opts.qtypes);
    const levels = toSetOrNull(opts.levels);
    const visuals = toSetOrNull(opts.visuals);
    const bookmarkedOnly = !!opts.bookmarkedOnly;
    const bookmarks = bookmarkedOnly ? bookmarkSet() : null;
    const matchesSearch = SBData.searchMatcher(opts.search, opts.ignoreWordOrder, opts.searchType, opts.exactWords);
    const roundRange = opts.roundRange || null; // [min, max] inclusive
    const yearRange = opts.yearRange || null; // [min, max] inclusive
    const includeUnlabeled = opts.includeUnlabeled !== false;

    let out = SBData.questions.filter((q) => {
      if (subjects && !subjects.has(q.subject)) return false;
      if (roundRange) {
        if (q.round == null) { if (!includeUnlabeled) return false; }
        else if (q.round < roundRange[0] || q.round > roundRange[1]) return false;
      }
      if (yearRange && (q.year == null || q.year < yearRange[0] || q.year > yearRange[1])) return false;
      if (tournaments && !tournaments.has(q.tSlug)) return false;
      if (formats && !formats.has(q.format)) return false;
      if (qtypes && !qtypes.has(q.qtype)) return false;
      if (levels && !levels.has(q.level)) return false;
      if (bookmarkedOnly && !bookmarks.has(q.id)) return false;
      if (visuals && !visuals.has(q.visual ? 'visual' : 'text')) return false;
      return true;
    });

    if (matchesSearch) out = out.filter(matchesSearch);
    return out;
  };

  // The years the bank's tournaments span, [first, last].
  SBData.yearSpan = function () {
    const ys = ((SBData.meta && SBData.meta.tournaments) || []).map((t) => parseInt(String(t.date || '').slice(0, 4), 10)).filter((y) => y > 0);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [2000, new Date().getFullYear()];
  };

  // A search, as on QB Reader's database: where to look (all text: what a
  // card shows, that is the question, its choices, the answer with its
  // "also accept" and "do not accept" entries, and the tournament name; the
  // question with its choices only; or the answer with its accepts only),
  // whether the words may come in any order (each must appear somewhere) or,
  // with ignoreWordOrder false, must appear together as typed, and whether
  // they must be whole words (exactWords: "p waves" finds "P-waves" and
  // "... p ... waves", not "capillary waves" or "p wave"). Never
  // case-sensitive, and accents, curly quotes and long dashes are typed
  // plain (see searchFold). Null when there's nothing to search for.
  SBData.SEARCH_TYPES = ['all', 'question', 'answer'];
  SBData.searchMatcher = function (search, ignoreWordOrder, searchType, exactWords) {
    const type = SBData.SEARCH_TYPES.includes(searchType) ? searchType : 'all';
    const has = exactWords ? (text, term) => SBData.wholeWordIndex(text, term, 0) !== -1 : (text, term) => text.includes(term);
    if (ignoreWordOrder === false) {
      const phrase = SBData.searchPhrase(search);
      return phrase ? (q) => has(searchText(q, type), phrase) : null;
    }
    const words = SBData.searchWords(search);
    return words.length ? (q) => { const text = searchText(q, type); return words.every((w) => has(text, w)); } : null;
  };

  // Text as a search compares it: lowercased, with what a keyboard doesn't
  // have typed plain. Accents are dropped ("Schrödinger" is "schrodinger"),
  // curly quotes are straight ones ("Hooke’s" is "hooke's"), and every dash
  // and the minus sign are a hyphen ("P–wave" is "p-wave"); a no-break space
  // is a space. Each character becomes exactly one character, so a position
  // in the result is the same position in the text (the highlighter marks
  // matches by position).
  const FOLD_CHARS = {
    '‘': "'", '’': "'", 'ʼ': "'", '′': "'", '“': '"', '”': '"', '″': '"',
    '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
    ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  };
  const foldedChars = new Map();
  function foldChar(c) {
    let f = foldedChars.get(c);
    if (f === undefined) {
      f = FOLD_CHARS[c] || c.normalize('NFD')[0] || c;
      foldedChars.set(c, f);
    }
    return f;
  }
  SBData.searchFold = function (text) {
    const s = String(text == null ? '' : text);
    // (Plain ASCII, most of the bank, needs only lowercasing.)
    return (/[^\x00-\x7f]/.test(s) ? s.replace(/[^\x00-\x7f]/g, foldChar) : s).toLowerCase();
  };

  // Folded text with its spacing evened out and any loose accent marks
  // dropped (a hat written after its letter, "k̂", rather than as one
  // character): what the search compares. Not position for position.
  const searchKey = (text) => SBData.searchFold(text).replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

  // The query as one folded phrase.
  SBData.searchPhrase = function (search) {
    return searchKey(search || '').trim();
  };

  // A search is a list of words, each of which must appear somewhere in the
  // searched text; they needn't be next to each other or in the typed
  // order. Folded, with repeats dropped.
  SBData.searchWords = function (search) {
    return Array.from(new Set(searchKey(search || '').split(' ').filter(Boolean)));
  };

  // Where `term` next stands in `text` as a whole word (or run of words), at
  // or after `from`: the character before it and the one after it aren't a
  // letter or a digit. -1 when it doesn't. An end of the term that isn't a
  // letter or digit itself ("(a)", "x^2 +") has nothing to check. Both are
  // already folded.
  const WORD_CHAR = /[\p{L}\p{N}]/u;
  SBData.wholeWordIndex = function (text, term, from) {
    if (!term) return -1;
    const startsWord = WORD_CHAR.test(term[0]);
    const endsWord = WORD_CHAR.test(term[term.length - 1]);
    for (let i = text.indexOf(term, from || 0); i !== -1; i = text.indexOf(term, i + 1)) {
      const before = i > 0 ? text[i - 1] : '';
      const after = text[i + term.length] || '';
      if ((!startsWord || !before || !WORD_CHAR.test(before)) && (!endsWord || !after || !WORD_CHAR.test(after))) return i;
    }
    return -1;
  };

  // What a search matches against: every field of the scope, folded, each
  // also without exponent and subscript markup (invisible on screen, so
  // "7100" also finds "7^100" and "ksp" finds "K_sp"). Built the first time
  // a question is searched and kept, so later keystrokes don't fold the
  // whole bank again. The NUL separators keep a match from running across
  // two fields, since a search word can't contain one.
  // Spacing is evened out, so a phrase search isn't thrown by a line break.
  const searchTexts = new WeakMap();
  const unmarkExponents = (t) => t.replace(/[\^_]\(([^()]*)\)/g, '$1').replace(/[\^_]/g, '');
  const choiceTexts = (q) => (q.choices ? Object.values(q.choices) : []);
  // Each scope is built the first time it's searched and kept.
  const SEARCH_FIELDS = {
    all: (q) => [q.question, ...choiceTexts(q), q.answer.text, ...(q.answer.accept || []), ...(q.answer.reject || []), q.tournament],
    question: (q) => [q.question, ...choiceTexts(q)],
    answer: (q) => [q.answer.text, ...(q.answer.accept || [])],
  };
  function searchText(q, type) {
    type = type || 'all';
    let texts = searchTexts.get(q);
    if (!texts) { texts = {}; searchTexts.set(q, texts); }
    let text = texts[type];
    if (text === undefined) {
      const fields = SEARCH_FIELDS[type](q).filter(Boolean).map(searchKey);
      text = fields.join('\0');
      const plain = fields.map(unmarkExponents).join('\0');
      if (plain !== text) text += '\0' + plain;
      texts[type] = text;
    }
    return text;
  }
  // Builds the search text for the whole bank ahead of time, so the first
  // search is quick too. It runs in small batches while the browser is idle
  // (a single pass takes long enough on a phone to make the page stutter).
  SBData.prepareSearch = function () {
    const qs = SBData.questions || [];
    const idle = global.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 10 }), 50));
    let i = 0;
    const step = (deadline) => {
      while (i < qs.length && deadline.timeRemaining() > 2) {
        for (const end = Math.min(qs.length, i + 200); i < end; i++) searchText(qs[i]);
      }
      if (i < qs.length) idle(step);
    };
    idle(step);
  };

  function toSetOrNull(v) {
    if (!v) return null;
    if (v instanceof Set) return v.size ? v : null;
    if (Array.isArray(v)) return v.length ? new Set(v) : null;
    return null;
  }

  // Packet round labels are messy, inconsistently-formatted filenames scraped
  // straight from the source PDFs ("Ignis_DE1", "Copy of Copy of DE—1",
  // "rround01", ...). Clean one up for display: drop a leading repeat of the
  // tournament name, normalize separators, and space out letter/digit runs
  // ("DE1" -> "DE 1"). Best-effort, not a full per-tournament parser.
  function cleanRoundLabel(tournament, label) {
    if (!label) return null;
    let s = String(label);
    s = s.replace(/^(copy of\s+)+/gi, '');
    (tournament || '').split(/\s+/).filter(Boolean).forEach((tok) => {
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^\\s*' + escaped + '[\\s_.:\\-]*', 'i');
      if (re.test(s)) s = s.replace(re, '');
    });
    s = s.replace(/[_—–]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim();
    return s || null;
  }
  // Some packets are labelled "Set 9 · Round 14"; shown as "Set 9 Round 14",
  // since the label sits between other parts ("NSB MS Regs Set 9 Round 14 Q5").
  SBData.roundLabelFor = function (q) {
    const l = cleanRoundLabel(q.tournament, q.roundLabel) || (q.round ? 'Round ' + q.round : null);
    return l && l.replace(/\s*·\s*/g, ' ');
  };
  // Where a question comes from: tournament, round, and which toss-up or
  // bonus of the packet it is. Above the question in Play and Multiplayer
  // it's spaced ("Prometheus 2021 RR 3 Bonus 19"); under a revealed answer
  // it's slashed ("Prometheus 2021 / RR 3 / Bonus 19"). Toss-up 10 and
  // bonus 10 share the number. opts.ofPacket adds the packet's size
  // ("BASED 2025 Round Robin 1 Toss-up 10 of 24"), shown when reading a set
  // packet by packet.
  SBData.sourceLabelFor = function (q, sep, opts) {
    const roundPart = SBData.roundLabelFor(q);
    const kind = QTYPE_LABELS[q.qtype] || 'Question';
    const total = opts && opts.ofPacket && q.packetSize >= q.num ? ` of ${q.packetSize}` : '';
    const num = q.num ? `${kind} ${q.num}${total}` : null;
    return [q.tournament, roundPart, num].filter(Boolean).join(sep || ' ');
  };
  function isPacketUrl(u) { return /^https?:\/\//i.test(u || ''); }

  // ---- Where a whole tournament comes from ----
  // Packets link their own source; the set page also links the tournament's
  // packets as a whole, worked out from those links: a Google Drive folder a
  // packet already points to, or the place most of its links point into: a
  // tournament's ISOBowl page (its rounds' address without ?round=), the
  // NSB's sample-question pages, a GitHub repository, a database the
  // questions came from, the tournament's page on scibowl.live (for packets
  // LeBot hosts), a folder that lists its files, or the one file that holds
  // every packet. meta.json's `source` on a tournament overrides this. Null
  // when the packets only live as separate files (then each packet's own
  // link is listed instead).
  const LISTED_FOLDER_HOSTS = new Set(['www.csun.edu']);
  // scibowl.live names a tournament's page after its LeBot folder: lower
  // case, spaces as hyphens, other punctuation dropped ("FE!M-2025" is
  // fem-2025, "SBST (Spring)" sbst-spring, "NSI_2024" nsi_2024).
  const SCIBOWL_LIVE_PACKETS = 'https://www.scibowl.live/packets/';
  function scibowlLiveSlug(folder) {
    let name = folder;
    try { name = decodeURIComponent(folder); } catch (e) { /* as written */ }
    return name.toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
  }
  // A packet's link is to the packet as a whole: a question's own place in
  // it (#page=5 of a PDF, #L120 of a GitHub file; see packetAnchor) is left off.
  SBData.packetSourceUrl = function (packet) {
    const counts = new Map();
    (packet.questions || []).forEach((q) => {
      if (!isPacketUrl(q.sourceUrl)) return;
      const u = q.sourceUrl.replace(/#(?:page=|L)\d+$/, '');
      counts.set(u, (counts.get(u) || 0) + 1);
    });
    let best = null;
    counts.forEach((n, u) => { if (!best || n > counts.get(best)) best = u; });
    return best;
  };
  SBData.tournamentSourceUrl = function (t, packets) {
    if (t && isPacketUrl(t.source)) return t.source;
    const urls = [];
    (packets || []).forEach((p) => (p.questions || []).forEach((q) => { if (isPacketUrl(q.sourceUrl)) urls.push(q.sourceUrl); }));
    if (!urls.length) return null;
    const parsed = urls.map((u) => { try { return new URL(u); } catch (e) { return null; } }).filter(Boolean);
    // The place most of the links (70% or more) point into.
    const all = (fn) => {
      const counts = new Map();
      parsed.forEach((u) => { const k = fn(u); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
      let best = null;
      counts.forEach((n, k) => { if (!best || n > counts.get(best)) best = k; });
      return best && counts.get(best) >= 0.7 * parsed.length ? best : null;
    };
    const folder = parsed.find((u) => u.hostname === 'drive.google.com' && /^\/drive\/(?:u\/\d+\/)?folders\//.test(u.pathname));
    if (folder) return folder.origin + folder.pathname;
    const iso = all((u) => (u.hostname.endsWith('isobowl.com') && /^\/premier\/tournaments\/[^/]+\/?$/.test(u.pathname) ? u.origin + u.pathname.replace(/\/$/, '') : null));
    if (iso) return iso;
    const nsb = all((u) => { const m = u.hostname === 'science.osti.gov' && u.pathname.match(/\/(HS|MS)-Sample-Questions\//i); return m ? `https://science.osti.gov/wdts/nsb/Regional-Competitions/Resources/${m[1].toUpperCase()}-Sample-Questions` : null; });
    if (nsb) return nsb;
    const repo = all((u) => { const m = u.hostname === 'github.com' && u.pathname.match(/^\/([^/]+)\/([^/]+)/); return m ? `https://github.com/${m[1]}/${m[2]}` : null; });
    if (repo) return repo;
    const db = all((u) => (['scibowldb.com', 'speriphery.com'].includes(u.hostname) ? u.origin + (u.hostname === 'speriphery.com' ? u.pathname : '/') : null));
    if (db) return db;
    // Packets hosted by LeBot (lebot.djiang.xyz/packets/<folder>/…): the
    // folder itself doesn't list its files, but scibowl.live, which serves
    // the same files, has a page per tournament listing every packet.
    const lebot = all((u) => { const m = u.hostname === 'lebot.djiang.xyz' && u.pathname.match(/^\/packets\/([^/]+)\//); return m ? SCIBOWL_LIVE_PACKETS + scibowlLiveSlug(m[1]) : null; });
    if (lebot) return lebot;
    const dir = all((u) => (LISTED_FOLDER_HOSTS.has(u.hostname) ? u.origin + u.pathname.replace(/[^/]*$/, '') : null));
    if (dir) return dir;
    // One file that holds every packet (a single Google Doc or PDF).
    return all((u) => (u.hostname === 'speriphery.com' ? null : u.origin + u.pathname + (u.hostname.endsWith('isobowl.com') ? u.search : '')));
  };
  // The line under a packet page's heading: its source packet.
  SBData.packetSourceHTML = function (packet) {
    const u = SBData.packetSourceUrl(packet);
    return u ? `<p class="set-source"><a href="${escapeHtml(u)}" target="_blank" rel="noopener">Source packet</a></p>` : '';
  };
  // The line under a set page's heading: "Source packets" (the whole
  // tournament), or failing that "Source packets: 1 2 3 …" (each packet's).
  SBData.tournamentSourceHTML = function (t, packets) {
    const link = (u, text) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${text}</a>`;
    const whole = SBData.tournamentSourceUrl(t, packets);
    if (whole) return `<p class="set-source">${link(whole, 'Source packets')}</p>`;
    const each = (packets || []).map((p, i) => [i + 1, SBData.packetSourceUrl(p)]).filter(([, u]) => u);
    if (!each.length) return '';
    return `<p class="set-source">Source packets: ${each.map(([n, u]) => link(u, String(n))).join(' ')}</p>`;
  };
  // The source line under a revealed answer in solo and multiplayer: the
  // label, plus a link to the original packet when there is one. `url`
  // defaults to the question's own (multiplayer clients pass the reveal's,
  // since their question copy leaves it out until the answer is shown).
  SBData.sourceLineHTML = function (q, url) {
    url = url === undefined ? q.sourceUrl : url;
    let html = escapeHtml(SBData.sourceLabelFor(q, ' / '));
    if (isPacketUrl(url)) {
      html += ` / <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Source</a>`;
    }
    return html;
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  SBData.shuffle = shuffle;

  // Like shuffle(), but groups items by keyFn first and interleaves them by
  // repeatedly picking a random *group* (not a random item) and taking a
  // random item from within it. This gives every group roughly equal turns
  // regardless of how many items it has, instead of a plain shuffle where a
  // group with far more items dominates in proportion to its size. Once a
  // group is exhausted it drops out, so only the smallest groups eventually
  // run short.
  function stratifiedShuffle(arr, keyFn) {
    const groups = new Map();
    arr.forEach((item) => {
      const k = keyFn(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    });
    const keys = [];
    groups.forEach((list, k) => { groups.set(k, shuffle(list)); keys.push(k); });
    const result = [];
    while (keys.length) {
      const idx = Math.floor(Math.random() * keys.length);
      const k = keys[idx];
      const list = groups.get(k);
      result.push(list.pop());
      if (list.length === 0) { keys.splice(idx, 1); groups.delete(k); }
    }
    return result;
  }
  SBData.stratifiedShuffle = stratifiedShuffle;

  // Every item once, dealt round-robin across the groups (subjects): each
  // round takes one item from every group still holding some, in a fresh
  // random order, so the groups stay evenly mixed until the smaller ones
  // run out. Nothing repeats: an earlier version refilled a group that ran
  // out, so with 10 Math stars and 1 Biology star the Biology question came
  // up five times and half the stars never did.
  function stratifiedQueue(arr, keyFn) {
    const groups = new Map();
    arr.forEach((item) => {
      const k = keyFn(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    });
    const bags = [...groups.values()].map(shuffle);
    const result = [];
    while (bags.length) {
      for (const bag of shuffle(bags)) result.push(bag.pop());
      for (let i = bags.length - 1; i >= 0; i--) if (!bags[i].length) bags.splice(i, 1);
    }
    return result;
  }
  SBData.stratifiedQueue = stratifiedQueue;

  /* ---------------- Shared dual-handle round-range slider wiring ---------------- */
  // opts: { minInput, maxInput, fillEl, labelEl, maxRound, onChange(lo, hi) }
  SBData.wireRoundRangeSlider = function (opts) {
    // onCommit(lo, hi): once a change is finished - the handle let go, or a
    // keyboard step - and only if the range moved.
    const { minInput, maxInput, fillEl, labelEl, onChange, onCommit } = opts;
    // Rounds start at 1; the year slider passes its first year as `min` and
    // its own `label`.
    const lowest = opts.min || 1;
    const label = opts.label || ((lo, hi) => (lo === hi ? `Round ${lo}` : `Rounds ${lo}-${hi}`));
    let maxRound = opts.maxRound;
    minInput.min = maxInput.min = lowest;
    minInput.max = maxInput.max = maxRound;
    minInput.value = lowest;
    maxInput.value = maxRound;

    function draw() {
      const lo = parseInt(minInput.value, 10);
      const hi = parseInt(maxInput.value, 10);
      const span = Math.max(1, maxRound - lowest);
      const pctLo = ((lo - lowest) / span) * 100;
      const pctHi = ((hi - lowest) / span) * 100;
      if (fillEl) { fillEl.style.left = pctLo + '%'; fillEl.style.width = Math.max(0, pctHi - pctLo) + '%'; }
      if (labelEl) labelEl.textContent = label(lo, hi);
      return [lo, hi];
    }
    function render() {
      const [lo, hi] = draw();
      if (onChange) onChange(lo, hi);
    }
    function onMinInput() {
      let lo = parseInt(minInput.value, 10);
      const hi = parseInt(maxInput.value, 10);
      if (lo > hi) { lo = hi; minInput.value = lo; }
      render();
    }
    function onMaxInput() {
      const lo = parseInt(minInput.value, 10);
      let hi = parseInt(maxInput.value, 10);
      if (hi < lo) { hi = lo; maxInput.value = hi; }
      render();
    }
    minInput.addEventListener('input', onMinInput);
    maxInput.addEventListener('input', onMaxInput);
    let committed = null;
    let dragStart = null;
    function commit(from) {
      const now = [parseInt(minInput.value, 10), parseInt(maxInput.value, 10)];
      const base = from || committed;
      if (base && base[0] === now[0] && base[1] === now[1]) return;
      committed = now;
      if (onCommit) onCommit(now[0], now[1]);
    }
    // Keyboard changes fire 'change' as each step is done.
    minInput.addEventListener('change', commit);
    maxInput.addEventListener('change', commit);

    // The two <input type=range> handles are stacked exactly on top of each
    // other, and both are entirely pointer-events:none (see .dual-slider
    // CSS) - dragging is handled manually, end to end, on the container:
    //  1. A press anywhere on the track (not just exactly on a thumb) picks
    //     the nearest handle, jumps it to that point, and immediately
    //     starts dragging it - a single click-and-drag motion from any spot.
    //  2. When both handles are tied at the same value, "nearest" would be
    //     a tie for every point, so it's broken by which side of the tied
    //     point the press falls on (left moves min, right moves max) -
    //     decided ONCE at press time and then held fixed for the rest of
    //     that drag, so dragging back across the tie point mid-gesture
    //     keeps moving the same handle you originally grabbed (matches how
    //     a real slider handle behaves) instead of the two handles fighting
    //     over who's "nearest" on every subsequent move.
    const container = minInput.parentElement;
    function valueFromClientX(clientX) {
      const rect = container.getBoundingClientRect();
      const pad = 8; // half a handle: a handle stops flush with the track's ends
      const usable = Math.max(1, rect.width - pad * 2);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - pad) / usable));
      return Math.min(maxRound, Math.max(lowest, Math.round(lowest + ratio * (maxRound - lowest))));
    }
    // Where a round's handle is drawn, in client pixels.
    function xOfValue(v) {
      const rect = container.getBoundingClientRect();
      const pad = 8;
      return rect.left + pad + ((v - lowest) / Math.max(1, maxRound - lowest)) * Math.max(1, rect.width - pad * 2);
    }
    function setHandleValue(handle, val) {
      if (handle === 'min') minInput.value = Math.min(val, parseInt(maxInput.value, 10));
      else maxInput.value = Math.max(val, parseInt(minInput.value, 10));
    }

    // dragHandle is 'min' | 'max' | 'pending' | null. 'pending' only happens
    // when the press lands exactly on a tied point (lo === hi): there's no
    // directional information yet at that instant (both handles are at that
    // same spot), so which handle to grab is deferred until the first bit
    // of actual pointer movement reveals which way the drag is going - a
    // press+release with no movement in that exact case correctly does
    // nothing, same as a real slider handle that hasn't been dragged.
    let dragHandle = null;
    let pressVal = null;
    let grabOffset = 0; // how far from a grabbed handle's centre the press was
    const HANDLE_R = 8; // half a handle
    let topHandle = 'max'; // drawn on top where the two overlap
    function raise(handle) {
      topHandle = handle;
      minInput.style.zIndex = handle === 'min' ? '3' : '2';
      maxInput.style.zIndex = handle === 'min' ? '2' : '3';
    }
    // A press on a handle grabs that handle (by where it's drawn, so the one
    // under the pointer is the one that moves, as on QB Reader) and doesn't
    // move it until the pointer does. A press on the bare track moves the
    // nearer handle there.
    container.addEventListener('pointerdown', (e) => {
      const lo = parseInt(minInput.value, 10);
      const hi = parseInt(maxInput.value, 10);
      // Where this drag started: it counts as a change only if the range
      // differs when it's let go (updates arriving mid-drag don't move this).
      dragStart = [lo, hi];
      const dLo = Math.abs(e.clientX - xOfValue(lo));
      const dHi = Math.abs(e.clientX - xOfValue(hi));
      grabOffset = 0;
      if (lo === hi && dLo <= HANDLE_R) {
        // Both handles are here: the drag's direction decides.
        dragHandle = 'pending';
        grabOffset = e.clientX - xOfValue(lo);
        pressVal = lo;
      } else if (Math.min(dLo, dHi) <= HANDLE_R) {
        // Inside one handle, that one; inside both (they overlap when close),
        // the one drawn on top, as with real handle elements.
        if (dLo <= HANDLE_R && dHi <= HANDLE_R) dragHandle = topHandle;
        else dragHandle = dLo <= HANDLE_R ? 'min' : 'max';
        grabOffset = e.clientX - xOfValue(dragHandle === 'min' ? lo : hi);
        pressVal = dragHandle === 'min' ? lo : hi;
        raise(dragHandle);
      } else {
        const val = valueFromClientX(e.clientX);
        dragHandle = dLo <= dHi ? 'min' : 'max';
        pressVal = val;
        raise(dragHandle);
        setHandleValue(dragHandle, val);
        render();
      }
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    container.addEventListener('pointermove', (e) => {
      if (!dragHandle) return;
      const val = valueFromClientX(e.clientX - grabOffset);
      if (dragHandle === 'pending') {
        if (val === pressVal) return; // no directional movement yet
        dragHandle = val > pressVal ? 'max' : 'min';
        raise(dragHandle);
      }
      setHandleValue(dragHandle, val);
      render();
    });
    function endDrag(e) {
      if (!dragHandle) return;
      dragHandle = null;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      const start = dragStart;
      dragStart = null;
      commit(start); // let go: the change is done
    }
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    render();
    // Set from code (a saved range, another player's change): the new
    // starting point for onCommit, not a change of this player's.
    const settle = () => { committed = [parseInt(minInput.value, 10), parseInt(maxInput.value, 10)]; };
    minInput.addEventListener('change', () => { dragStart = null; });
    settle();
    return {
      reset() { minInput.value = lowest; maxInput.value = maxRound; render(); settle(); },
      getRange() { return [parseInt(minInput.value, 10), parseInt(maxInput.value, 10)]; },
      setRange(lo, hi) { minInput.value = lo; maxInput.value = hi; render(); settle(); },
      // Rescales the slider to the rounds the current tournaments have. A
      // range that reached the old top keeps reaching the top; otherwise it's
      // clamped. Doesn't call onChange: returns the new [lo, hi] when anything
      // moved (for the caller to store), else null.
      setMax(n) {
        n = Math.max(1, n || 1);
        if (n === maxRound) return null;
        const lo = parseInt(minInput.value, 10);
        const hi = parseInt(maxInput.value, 10);
        const newHi = hi >= maxRound ? n : Math.min(hi, n);
        const newLo = Math.min(lo, newHi);
        maxRound = n;
        minInput.max = maxInput.max = n;
        minInput.value = newLo;
        maxInput.value = newHi;
        const moved = draw();
        settle();
        return moved;
      },
    };
  };

  // The highest numbered round among the given tournament slugs (all
  // tournaments when none are picked, or when the picked ones have no
  // numbered rounds), so the round slider only spans rounds that exist.
  // Worked out once per list of questions (see packetRanks).
  let maxRoundBySlug = null;
  let maxRoundFor = null;
  SBData.maxRoundFor = function (slugs) {
    const globalMax = Math.max(1, ...(SBData.meta && SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    const list = slugs ? [...slugs] : [];
    if (!list.length || !SBData.questions) return globalMax;
    if (!maxRoundBySlug || maxRoundFor !== SBData.questions) {
      maxRoundFor = SBData.questions;
      maxRoundBySlug = new Map();
      for (const q of SBData.questions) {
        if (q.round == null) continue;
        if (!(maxRoundBySlug.get(q.tSlug) >= q.round)) maxRoundBySlug.set(q.tSlug, q.round);
      }
    }
    const m = Math.max(0, ...list.map((s) => maxRoundBySlug.get(s) || 0));
    return m || globalMax;
  };

  /* ---------------- Custom-styled multi-select dropdown ---------------- */
  // Native <select> popups are drawn by the browser outside the page, so
  // their scrollbar (or anything else) can't be styled. This turns a
  // <select> that already has its <option>s into a button plus a panel of
  // plain divs, with a search box, where clicking a row toggles it. The
  // <select> stays in the DOM, hidden, only as the option source: callers
  // use selectEl.getMultiValues()/setMultiValues() and still get a 'change'
  // event on user interaction. opts.noun names the items in the button
  // label ("All tournaments", "3 tournaments selected").
  function enhanceMultiSelect(selectEl, opts) {
    // QB Reader's checklist dropdown (its Difficulties menu): a split button,
    // the label on the left and a caret on the right, opening a list of
    // checkboxes; a ticked row is lavender and bold. Ours adds a search box
    // and Clear at the top, since a list can run to 100+ tournaments, and
    // the label says what's picked ("All tournaments", one name, or "3
    // tournaments selected"). The <select> stays as the value store:
    // getMultiValues(), setMultiValues(), and a 'change' event on it.
    const noun = (opts && opts.noun) || 'tournament';
    if (!selectEl || selectEl._sbEnhanced) return;
    selectEl._sbEnhanced = true;
    selectEl._sbMultiValues = new Set();

    const wrap = document.createElement('div');
    wrap.className = 'dropdown-checklist btn-group w-100';
    selectEl.parentNode.insertBefore(wrap, selectEl);
    selectEl.classList.add('sb-native-select-hidden');

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'btn btn-default text-start w-100 dropdown-checklist-label';
    labelBtn.setAttribute('aria-haspopup', 'true');
    labelBtn.setAttribute('aria-expanded', 'false');
    const caretBtn = document.createElement('button');
    caretBtn.type = 'button';
    caretBtn.className = 'btn btn-default dropdown-toggle dropdown-toggle-split';
    caretBtn.setAttribute('aria-label', `Choose ${noun}s`);
    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu dropdown-menu-end checkbox-menu allow-focus';
    menu.setAttribute('data-bs-popper', 'static');
    // White in both themes, as QB Reader's is.
    menu.setAttribute('data-bs-theme', 'light');
    // The <select> goes last, so Bootstrap's button-group corners still see
    // the two buttons as the first pair.
    wrap.append(labelBtn, caretBtn, menu, selectEl);

    const tools = document.createElement('li');
    tools.className = 'checkbox-menu-tools';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'form-control form-control-sm';
    search.placeholder = 'Search…';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', `Search ${noun}s`);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-link';
    clearBtn.textContent = 'Clear';
    tools.append(search, clearBtn);
    const empty = document.createElement('li');
    empty.className = 'checkbox-menu-empty';
    empty.textContent = 'No matches';

    // Ticked options first (in their usual order), so what's picked shows on
    // opening; rebuilt on each open, and a row stays put while it's open.
    function buildOptions() {
      menu.innerHTML = '';
      menu.append(tools);
      const all = Array.from(selectEl.options);
      const picked = all.filter((o) => selectEl._sbMultiValues.has(o.value));
      const rest = all.filter((o) => !selectEl._sbMultiValues.has(o.value));
      [...picked, ...rest].forEach((opt) => {
        const li = document.createElement('li');
        li.dataset.value = opt.value;
        li.dataset.search = opt.textContent.toLowerCase();
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = opt.value;
        box.checked = selectEl._sbMultiValues.has(opt.value);
        li.classList.toggle('active', box.checked);
        box.addEventListener('change', () => {
          if (box.checked) selectEl._sbMultiValues.add(opt.value); else selectEl._sbMultiValues.delete(opt.value);
          li.classList.toggle('active', box.checked);
          syncLabel();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        label.append(box, document.createTextNode(opt.textContent));
        li.append(label);
        menu.append(li);
      });
      menu.append(empty);
    }

    function applySearch() {
      const q = search.value.trim().toLowerCase();
      let any = false;
      menu.querySelectorAll('li[data-value]').forEach((li) => {
        const match = !q || li.dataset.search.indexOf(q) !== -1;
        li.hidden = !match;
        if (match) any = true;
      });
      empty.hidden = any;
    }

    function syncLabel() {
      const n = selectEl._sbMultiValues.size;
      // All of them, picked or not (none picked means all): "All tournaments
      // (113)", with how many there are (none yet, as with no set's packets:
      // just "All packets").
      const total = selectEl.options.length;
      if (n === 0 || n === total) {
        labelBtn.textContent = total ? `All ${noun}s (${total})` : `All ${noun}s`;
      } else if (n === 1) {
        const [onlyVal] = selectEl._sbMultiValues;
        const opt = Array.from(selectEl.options).find((o) => o.value === onlyVal);
        labelBtn.textContent = opt ? opt.textContent : `1 ${noun} selected`;
      } else {
        labelBtn.textContent = `${n} ${noun}s selected`;
      }
      menu.querySelectorAll('li[data-value]').forEach((li) => {
        const on = selectEl._sbMultiValues.has(li.dataset.value);
        li.classList.toggle('active', on);
        const box = li.querySelector('input');
        if (box) box.checked = on;
      });
    }

    function isOpen() { return menu.classList.contains('show'); }
    function openMenu() {
      buildOptions();
      search.value = '';
      applySearch();
      menu.classList.add('show');
      caretBtn.classList.add('show');
      labelBtn.setAttribute('aria-expanded', 'true');
      // Opens to the left from the caret, as QB Reader's does; to the right
      // if there isn't room on the left.
      menu.classList.remove('dropdown-menu-start-fallback');
      if (menu.getBoundingClientRect().left < 8) menu.classList.add('dropdown-menu-start-fallback');
      setTimeout(() => search.focus(), 0);
    }
    function closeMenu() {
      menu.classList.remove('show');
      caretBtn.classList.remove('show');
      labelBtn.setAttribute('aria-expanded', 'false');
    }
    const toggle = () => { if (isOpen()) closeMenu(); else openMenu(); };
    labelBtn.addEventListener('click', () => { labelBtn.blur(); toggle(); });
    caretBtn.addEventListener('click', () => { caretBtn.blur(); toggle(); });
    // Clicks inside the list keep it open (QB Reader's allow-focus menu).
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closeMenu(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { closeMenu(); labelBtn.focus(); } });
    search.addEventListener('input', applySearch);
    clearBtn.addEventListener('click', () => {
      selectEl._sbMultiValues.clear();
      syncLabel();
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    syncLabel();
    selectEl.getMultiValues = () => Array.from(selectEl._sbMultiValues);
    selectEl.setMultiValues = (values) => {
      selectEl._sbMultiValues = new Set(values || []);
      syncLabel();
    };
    selectEl.refreshCustomDropdown = syncLabel;
  }
  SBData.enhanceMultiSelect = enhanceMultiSelect;

  /* ---------------- Single-thumb range slider fill ---------------- */
  // Colors in the track to the left of the thumb (see the input[type=range]
  // CSS, which reads this custom property) via a CSS gradient driven by a
  // custom property, since there's no cross-browser CSS-only way to do this
  // for a plain <input type=range>. Call once after creating/finding the
  // slider; it wires itself to update on every 'input' event. Code that
  // sets `.value` on it programmatically elsewhere (restoring a saved
  // value, syncing to another player's setting, etc.) won't trigger an
  // 'input' event, so it should call `el.refreshRangeFill()` right after -
  // a no-op if this was never called on that element.
  function updateRangeFill(el) {
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const val = parseFloat(el.value);
    const pct = (isFinite(min) && isFinite(max) && max > min) ? ((val - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--range-progress', pct + '%');
  }
  function wireRangeFill(el) {
    if (!el) return;
    el.refreshRangeFill = () => updateRangeFill(el);
    el.addEventListener('input', el.refreshRangeFill);
    updateRangeFill(el);
  }
  SBData.wireRangeFill = wireRangeFill;

  global.SBData = SBData;
})(typeof window !== 'undefined' ? window : globalThis);
