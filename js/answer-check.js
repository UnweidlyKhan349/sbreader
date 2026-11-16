/* SB Reader - answer checking logic
   Handles Science Bowl grading conventions:
   - "1 and 2" <-> "12" <-> "1, 2"
   - "all" / "all three" <-> "123" (when the question enumerates 1/2/3 items)
   - "3 only" <-> "3"
   - multiple choice: exact letter (W/X/Y/Z) and/or exact choice text
   - packet ACCEPT / DO NOT ACCEPT alternates
*/
(function (global) {
  function normalize(s) {
    if (s == null) return '';
    return String(s)
      // accents are dropped, so "schrodinger" is "SCHRÖDINGER" and "huckel"
      // "HÜCKEL" (the accented letter used to be cut out as punctuation)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      // one-character fractions are typed with a slash: "½" is "1/2", "2½" is "2 1/2"
      .replace(VULGAR_RE, (m, digit, f) => (digit ? digit + ' ' : '') + VULGAR[f])
      .toUpperCase()
      .replace(/['’‘]/g, "'")
      // "2.5 billion" is 2500000000, and "2,500,000,000" too (a comma
      // between 3-digit groups, two or more of them, or after 1-2 digits)
      .replace(/(\d+(?:\.\d+)?)\s*(THOUSAND|MILLION|BILLION|TRILLION)\b/g, (m, n, w) => {
        const v = Number(n) * { THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 }[w];
        return Number.isSafeInteger(v) ? String(v) : m;
      })
      .replace(/\b\d{1,3}(?:,\d{3}){2,}\b|\b\d{1,2},\d{3}\b(?!,\d)/g, (m) => m.replace(/,/g, ''))
      // "50 percent" is "50%" (the % sign is dropped as punctuation below)
      .replace(/(\d)\s*PER\s?CENT\b/g, '$1 ')
      // math said in words, as a player types it: "x squared" is "x^2",
      // "10 to the fifth (power)" is "10^5", "e to the x" is "e^x", "1
      // over 2" is "1/2", "root 2" is "√2", "natural log of 2" is "ln 2"
      .replace(/(\d)\s+TIMES\s+(?=\d)/g, '$1 ')
      .replace(/\b(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)(?=\s+(?:RAISED\s+)?TO\s+THE\b)/g, (m) => String(SPELLED_NUMBERS.indexOf(m)))
      .replace(/\s*\bSQUARED\b/g, '2').replace(/\s*\bCUBED\b/g, '3')
      .replace(/\s+(?:RAISED\s+)?TO\s+THE\s+(?:POWER\s+(?:OF\s+)?)?([+\-−]?\s*\d+|[A-Z]|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)(?:ST|ND|RD|TH)?(?:\s+POWER)?\b/g,
        (m, e) => (ORDINAL_WORDS[e] || e.replace(/\s+/g, '')))
      .replace(/\s+OVER\s+/g, ' / ')
      .replace(/(^|[\s(])(?:SQUARE\s+)?(?:ROOT|RT)\s*(?=\d)/g, '$1 SQRT ')
      .replace(/\bNATURAL\s+LOG(?:ARITHM)?(?:\s+OF)?\b|\bLOG\s*(?:_\s*|BASE\s+)E\b/g, 'LN')
      .replace(/∫/g, ' INTEGRAL ').replace(/\bINTEGRAL\s+OF\b/g, 'INTEGRAL')
      // the Greek letters' short names and misspellings, and "naught",
      // "not" or "sub 0" for a subscript 0 ("epsilon naught" is ε0)
      .replace(/\bEPS(?![A-Z])/g, 'EPSILON').replace(/\bLAMDA\b/g, 'LAMBDA').replace(/\bINF\b/g, 'INFINITY')
      .replace(/\b(EPSILON|MU|LAMBDA|SIGMA|RHO|OMEGA|PHI|NU|TAU|THETA|ALPHA|BETA|GAMMA|DELTA|PSI|CHI|KAPPA|ETA|[A-Z])[\s_]*(?:NAUGHT|NOUGHT|NOT|SUB\s*0|_?0)\b/g, '$1 0')
      // "24pi", "2pi/3": pi written straight after its number, as "24π" is
      .replace(/(\d)PI(?![A-Z])/g, '$1 PI')
      // a times sign typed as the letter x between numbers: "67 x 101", "2x2x3"
      .replace(/(\d)\s*X\s*(?=[\d√(])/g, '$1 ')
      // "3.2 x 10^23" and "3.2e23" read as "3.2 × 10^23" (the × and * are
      // dropped as punctuation below)
      .replace(/(\d)\s*X\s*(?=10\s*\^)/g, '$1 ')
      .replace(/(^|[^A-Z\d.])(\d+(?:\.\d+)?)E([+\-]?\d+)(?![A-Z\d])/g, '$1$2 10^$3')
      // exponent and subscript markup is ignored, so "x^2" = "x2",
      // "e^(-x)" = "e-x" and "K_sp" = "Ksp"
      .replace(/[\^_]\(([^()]*)\)/g, '$1')
      .replace(/[\^_]/g, '')
      .replace(/√/g, ' SQRT ') // so a typed "sqrt" matches a displayed "√" and vice versa
      .replace(/∛/g, ' CBRT ') // same idea for a cube-root radical
      .replace(/(SQRT|CBRT)/g, ' $1 ') // a typed "10sqrt(2)" splits like "10√2"
      // matched as [πΠ] (not just π) because .toUpperCase() above already
      // ran and turns lowercase π into capital Π - a bare /π/ here would
      // silently never match and the symbol would just get stripped as
      // punctuation below instead of becoming "PI".
      .replace(/[πΠ]/g, ' PI ') // so a typed "pi" matches a displayed "π" and vice versa
      // the other Greek letters, ħ and ∞ are typed by name too: "omega" for
      // "ω", "delta H" for "ΔH", "hbar", "infinity" (the text is in capitals
      // by now, so "ω" is "Ω"; a name can't tell Δ from δ, as when spoken)
      .replace(GREEK_RE, (c) => ' ' + GREEK_NAMES[c] + ' ')
      // spelled-out "square/cube root of X" (however the packet phrased the
      // answer key) collapses to the same "SQRT X"/"CBRT X" form a student
      // typing the shorthand would produce, so either way of writing it
      // matches the other.
      .replace(/\bSQUARE\s+ROOTS?\s+OF\b/g, ' SQRT ')
      .replace(/\bCUBE\s+ROOTS?\s+OF\b/g, ' CBRT ')
      // a decimal point stays part of its number, so "7.2" is one word and
      // never matches "2.7" by word order
      .replace(/(\d)\.(?=\d)/g, '$1\u0001')
      // a fraction standing by itself stays one word too, so "1/2" is never
      // the list "1, 2" (it used to pass for a key of "1 AND 2", and "1 and
      // 2" for a key of "1/2"); a slash inside a longer expression
      // ("x^2/2", "(a + b)/2") is punctuation as before
      .replace(/(^|[\s,;(=±+\-−–])(\d+)\s*\/\s*(\d+)(?=$|[\s,;)])/g, '$1$2\u0002$3')
      .replace(/[^A-Z0-9'\s\u0001\u0002]/g, ' ') // strip punctuation except apostrophe
      .replace(/\u0001/g, '.')
      .replace(/\u0002/g, '/')
      .replace(/\s+/g, ' ')
      .trim()
      // standard abbreviations become the full term, so "ER" and "rough ER"
      // match "endoplasmic reticulum" and "rough endoplasmic reticulum" (and
      // the full term still gets the usual typo tolerance)
      .replace(ABBREVIATION_RE, (m) => ABBREVIATIONS[m])
      // A numbered stage, type or complex reads the same with a roman numeral
      // or a digit: "meiosis 2" = "MEIOSIS II", "anaphase 1" = "ANAPHASE I",
      // "type 1a" = "TYPE IA", "photosystem 2" = "PHOTOSYSTEM II".
      .replace(NUMBERED_RE, (m, word, roman, suffix) => `${word} ${ROMAN[roman]}${suffix}`)
      // A number written as a word reads the same as its digits, either way
      // round: "0" = "ZERO", "three" = "3".
      .replace(SPELLED_NUMBER_RE, (m) => String(SPELLED_NUMBERS.indexOf(m)));
  }
  const ORDINAL_WORDS = { FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10' };
  const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
  const VULGAR_RE = new RegExp('(\\d)?([' + Object.keys(VULGAR).join('') + '])', 'g');
  const GREEK_NAMES = { Α: 'ALPHA', Β: 'BETA', Γ: 'GAMMA', Δ: 'DELTA', Ε: 'EPSILON', Ζ: 'ZETA', Η: 'ETA', Θ: 'THETA', Ι: 'IOTA', Κ: 'KAPPA',
    Λ: 'LAMBDA', Μ: 'MU', Ν: 'NU', Ξ: 'XI', Ρ: 'RHO', Σ: 'SIGMA', Τ: 'TAU', Υ: 'UPSILON', Φ: 'PHI', Χ: 'CHI', Ψ: 'PSI', Ω: 'OMEGA',
    ℏ: 'HBAR', Ħ: 'HBAR', '∞': 'INFINITY' };
  const GREEK_RE = new RegExp('[' + Object.keys(GREEK_NAMES).join('') + ']', 'g');
  // (Without the g flag, for .test(), which a g flag makes remember where it stopped.)
  const GREEK_TEST = new RegExp(GREEK_RE.source);
  const VULGAR_TEST = new RegExp('[' + Object.keys(VULGAR).join('') + ']');
  const SPELLED_NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
    'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY'];
  const SPELLED_NUMBER_RE = new RegExp('\\b(?:' + SPELLED_NUMBERS.join('|') + ')\\b', 'g');
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  const NUMBERED_RE = /\b(MEIOSIS|MITOSIS|PROPHASE|PROMETAPHASE|METAPHASE|ANAPHASE|TELOPHASE|PHOTOSYSTEM|COMPLEX|CLASS|TYPE|STAGE|PHASE|GENERATION|POPULATION|GROUP|PERIOD|LEVEL|GRADE) (VIII|VII|VI|IV|V|III|II|I)([ABCP]?)\b/g;
  const ABBREVIATIONS = {
    ER: 'ENDOPLASMIC RETICULUM',
    RER: 'ROUGH ENDOPLASMIC RETICULUM',
    SER: 'SMOOTH ENDOPLASMIC RETICULUM',
  };
  const ABBREVIATION_RE = new RegExp('\\b(?:' + Object.keys(ABBREVIATIONS).join('|') + ')\\b', 'g');

  // How many enumerated items ("1) ...; 2) ...; 3) ...", or the equally
  // common "1. ...; 2. ...; 3. ...") appear in question text. Verified
  // against the full corpus: a "N)" marker doesn't need a space after it
  // ("1)Salivary Glands" appears as-is in some packets), but a "N." marker
  // does - packets never write "1.Word" with no space, and requiring the
  // space is what keeps this from matching an ordinary decimal number like
  // "3.14" or a sentence that happens to end right after a small digit.
  // Either way, a handful of scattered digit-then-punctuation matches isn't
  // enough by itself - matching a coordinate pair like "(2, 2)" or a matrix
  // entry "...4)" is common and NOT an enumerated list. What actually marks
  // a real enumeration is a genuine 1, 2, 3, ... run in increasing order
  // (not necessarily adjacent, since other numbers can appear in between),
  // so the item count is the length of the longest such run starting at 1.
  // Newer packets use "1." rather than "1)", so both forms count.
  // Some packets (Mira Loma's especially) write "1: ... 2: ..." instead; a
  // colon counts only with a space after it, so times ("3:30") and ratios
  // ("1:2") never do. The space is only looked at, not consumed, so a stem
  // ending "... of order 8: 1) ..." still sees the "1)" after it. A colon
  // after a label word ("row 1: 2, 3", "Step 1: A + B → D") is a heading,
  // not a list item.
  const ITEM_MARKER_RE = /(?:^|[\s;,:])([1-9])(?:\)|\.\s|\.(?=[A-Z][a-z])|:(?=\s))/g;
  const COLON_LABEL_RE = /\b(?:rows?|columns?|cols?|steps?|stages?|phases?|parts?|rounds?|sets?|levels?|questions?|problems?)\s*$/i;
  // Some packets label the items with Roman numerals instead ("I. Gravity
  // II. Normal force III. Friction", keyed "I ONLY" or "I AND III"). They
  // count the same way, as items 1, 2, 3, ..., when the stem has no run of
  // arabic ones; the labels are capitals (a lower-case "i." is more likely
  // the end of a sentence), and stop at IX ("X)" is a choice letter).
  const ROMAN_ITEM_RE = /(?:^|[\s;,:])(IX|IV|V?I{1,3}|V)(?:\)|\.\s|:(?=\s)|\s[–—-]\s(?=[A-Z][a-z]))/g;
  const ROMAN_VALUE = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 };
  // How many of the markers continue a 1, 2, 3, ... run.
  function markerRun(markers) {
    let want = 1;
    for (const m of markers) { if (m.num === want) want++; }
    return want - 1;
  }
  function itemMarkers(questionText) {
    const markers = [];
    for (const m of questionText.matchAll(ITEM_MARKER_RE)) {
      const end = m.index + m[0].length;
      if (m[0].endsWith(':') && COLON_LABEL_RE.test(questionText.slice(Math.max(0, m.index - 20), end - 2))) continue;
      markers.push({ num: parseInt(m[1], 10), index: m.index, end });
    }
    if (markerRun(markers) >= 2) return markers;
    const roman = [];
    for (const m of questionText.matchAll(ROMAN_ITEM_RE)) {
      roman.push({ num: ROMAN_VALUE[m[1]], index: m.index, end: m.index + m[0].length });
    }
    return markerRun(roman) >= 2 ? roman : markers;
  }
  // An answer given in Roman numerals ("III ONLY", "I AND III", "ii, iii")
  // as its item numbers ("3 ONLY", "1 AND 3", "2, 3"): every word must be a
  // numeral from I to IX or a list word, so "IV FLUIDS" or "VITAMIN K" is
  // left alone. `up` is already normalized (capitals, no punctuation).
  const LIST_WORDS = new Set(['AND', 'OR', 'ONLY', 'THEN']);
  function romanItemsToDigits(up) {
    const words = up.split(/[\s,]+/).filter(Boolean);
    if (!words.some((w) => ROMAN_VALUE[w]) || !words.every((w) => ROMAN_VALUE[w] || LIST_WORDS.has(w))) return up;
    return up.replace(/[A-Z]+/g, (w) => (ROMAN_VALUE[w] ? String(ROMAN_VALUE[w]) : w));
  }
  function detectItemCount(questionText) {
    if (!questionText) return null;
    const nums = itemMarkers(questionText).map((m) => m.num);
    if (!nums.length) return null;
    let want = 1;
    for (const n of nums) { if (n === want) want++; }
    const found = want - 1;
    return found >= 2 && found <= 9 ? found : null;
  }

  // Does the question ask for a *sequence* ("order/rank/arrange the following...")
  // rather than an order-independent *set* ("identify/list all that apply...")?
  // This matters because "312" (a ranking answer) must NOT be treated as
  // equivalent to "132" the way "1 and 2" is equivalent to "2 and 1" for a
  // set-selection question - order is the whole point of a ranking answer.
  function isRankingQuestion(questionText) {
    if (!questionText) return false;
    const t = questionText;
    if (/\b(order|rank|arrange)\b(?:[^.?!]{0,20}\b(the following|these|below)\b)/i.test(t)
      || /\bin order (from|of)\b[^.?!]{0,60}\bto\b/i.test(t)
      || /\bfrom\b[^.?!]{0,30}\bto\b[^.?!]{0,10}\b(order|arrange|rank)\b/i.test(t)) return true;
    // Longer stems put the measured quantity between the verb and "the
    // following" ("Order the convectively available potential energy of the
    // following three setups"), or say how to order instead ("in chronological
    // order", "by increasing distance"). A set question ("identify all ...")
    // never counts, nor does "order" inside "second-order" or "in order to".
    if (/\b(identify|select|choose|name)\s+all\b/i.test(t)) return false;
    const s = t.replace(/-order\b/gi, ' ').replace(/\bin order (?:to|for|that)\b/gi, ' ');
    return /\b(order|rank|arrange|sort)\b[^.?!]{0,80}\b(the following|these|below)\b/i.test(s)
      || /\b(order|rank|arrange|sort|list|put|place)\b[^.?!]{0,100}\b(by|in)\s+(increasing|decreasing|ascending|descending)\b/i.test(s)
      || /\b(order|rank|arrange|sort|list|put|place)\b[^.?!]{0,100}\bin\s+(?:the\s+)?(?:correct\s+|proper\s+|right\s+)?order\b/i.test(s)
      || /\bin\s+(increasing|decreasing|ascending|descending|chronological|sequential|reverse)\s+order\b/i.test(s)
      || /\bin\s+order\s+of\s+(increasing|decreasing|ascending|descending)\b/i.test(s)
      || /\b(order|rank|arrange|sort)\s+them\b/i.test(s)
      || /\bchronologically\b|\bfrom (earliest|oldest|first|youngest|latest|newest|most recent)\b[^.?!]{0,40}\bto\b/i.test(s);
  }

  // Canonicalize a ranking-style answer ("3, 1, 2" / "312") to its digit
  // sequence AS TYPED - order is preserved, not sorted.
  // A typed answer (`typed`) must be item numbers only: "3, 1, 2", "3 then 1
  // then 2", "312" - never "128/3" or "VERTICES = 12, EDGES = 30", whose
  // digits merely include 1 to 3. A key keeps its labels ("1, 3, 2
  // (TACHOCLINE, …)", "1. INFLATION 3. RECOMBINATION 2. REIONIZATION").
  function canonicalizeRanked(raw, itemCount, typed) {
    if (!itemCount) return null;
    const up = romanItemsToDigits(normalize(raw));
    if (!up) return null;
    if (typed && !/^[1-9]+$/.test(up) && !/^[1-9](?:\s+(?:(?:AND|THEN)\s+)?[1-9])*$/.test(up)) return null;
    const all = (up.match(/[1-9]/g) || []).map(Number);
    if (typed && all.some((d) => d > itemCount)) return null;
    const digits = all.filter((d) => d <= itemCount);
    if (!digits.length) return null;
    return digits.join('');
  }

  // "ALL", "ALL OF THEM", "ALL THREE", "ALL OF THE ABOVE", "ALL 4 OF THESE",
  // "EVERY ONE": every listed item, however it's said. Returns { n }, the
  // count the phrase names (null when it names none), or null when `up`
  // (already normalized, so "THREE" reads "3") is something else.
  const ALL_RE = /^(?:ALL(?: OF)?(?: THE)?(?: (\d))?(?: OF)?(?: THE)?(?: (?:ABOVE|THEM|THESE|THOSE|FOLLOWING|ITEMS|OPTIONS|CHOICES|STATEMENTS|ANSWERS))?|EVERY 1(?: OF (?:THEM|THESE|THE ABOVE))?|EVERYTHING)$/;
  function allPhrase(up) {
    const m = up.match(ALL_RE);
    return m ? { n: m[1] ? parseInt(m[1], 10) : null } : null;
  }
  // How many things a stem says it lists: "the following three", "these 4".
  function statedCount(questionText) {
    const m = normalize(questionText).match(/\b(?:FOLLOWING|THESE|THOSE) (\d)\b/);
    return m ? parseInt(m[1], 10) : null;
  }
  // A key without a note in brackets at its end: "ALL (1, 2, 3)" -> "ALL".
  function withoutEndNote(key) { return String(key).replace(/\s*\([^()]*\)\s*$/, ''); }

  // Try to interpret a string as a "list of item numbers" answer, e.g.
  // "1 AND 3", "1, 3", "13", "ALL", "3 ONLY", "NONE" -> canonical sorted-digit string like "13".
  // Returns null if it doesn't look like a list-style answer.
  function canonicalizeList(raw, itemCount) {
    if (!itemCount) return null;
    const up = romanItemsToDigits(normalize(raw));
    if (!up) return null;

    // "all three" of four listed items names the wrong count
    const all = allPhrase(up);
    if (all) return all.n == null || all.n === itemCount ? digitsToCanonical(range(1, itemCount)) : null;
    if (/^NONE( OF THE ABOVE)?$/.test(up)) {
      return '0';
    }

    // pure compact digit string like "13" or "123" - only treat as a list if every
    // character is a digit between 1 and itemCount (and it's short)
    if (/^[1-9]+$/.test(up.replace(/\s/g, '')) && up.replace(/\s/g, '').length <= itemCount) {
      const compact = up.replace(/\s/g, '');
      const digits = compact.split('').map(Number);
      // (an item named twice, "133", isn't a clear list)
      if (digits.every((d) => d >= 1 && d <= itemCount) && new Set(digits).size === digits.length) {
        return digitsToCanonical(digits);
      }
    }

    // "1 AND 3", "1, 3", "3 ONLY", "2 AND 3 ONLY" - must contain a real list
    // separator (comma) or list word (AND/OR/ONLY), never a bare number like
    // "144", which is not a list-style answer at all.
    const hasListWord = /\b(AND|OR|ONLY)\b/.test(up) || up.includes(',');
    if (hasListWord && /^[1-9OANDRLY,\s]+$/.test(up.replace(/ONLY/g, '').replace(/AND|OR/g, ''))) {
      const digits = (up.match(/[1-9]/g) || []).map(Number);
      if (digits.length && digits.every((dd) => dd <= itemCount) && new Set(digits).size === digits.length) {
        return digitsToCanonical(digits);
      }
    }
    return null;
  }

  function range(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }
  function digitsToCanonical(digits) {
    return [...new Set(digits)].sort((a, b) => a - b).join('');
  }

  // Pulls out the actual enumerated item text for each numbered entry in a
  // question ("1) Newtonian 2) Galilean 3) Cassegrain" -> ["Newtonian",
  // "Galilean", "Cassegrain"]), using the same marker rule as detectItemCount
  // (the longest 1,2,3,... run in increasing order) so the two always agree
  // on which markers are the real enumeration. Returns null if the markers
  // can't be cleanly matched up to itemCount.
  function extractItemTexts(questionText, itemCount) {
    if (!questionText || !itemCount) return null;
    const markers = itemMarkers(questionText);
    const picked = [];
    let want = 1;
    for (const mk of markers) {
      if (mk.num === want) { picked.push(mk); want++; if (want > itemCount) break; }
    }
    if (picked.length !== itemCount) return null;
    const texts = [];
    for (let i = 0; i < picked.length; i++) {
      const start = picked[i].end;
      const sliceEnd = i + 1 < picked.length ? picked[i + 1].index : questionText.length;
      let t = questionText.slice(start, sliceEnd);
      t = t.replace(/^[\s:]+/, '').replace(/[\s;,.]+$/, '');
      if (!t) return null;
      texts.push(t);
    }
    return texts;
  }

  // Does an answer key label its parts ("1) +, 2) -, 3) -", "1: RIGHT;
  // 2: LEFT", "1) Equilibrium line; 2) 2, 1, 3") rather than name items by
  // number ("2) AND 3)", "3) SA NODE; 1) AV NODE; ...", "1) 2) 3)")? It does
  // when its markers run 1, 2, 3, ... in order and at least one of them is
  // followed by something other than that item's own text.
  function keyLabelsParts(key, questionText, itemCount) {
    if (!key) return false;
    const marks = itemMarkers(key);
    if (marks.length < 2 || marks.some((m, i) => m.num !== i + 1)) return false;
    const items = extractItemTexts(questionText, itemCount) || [];
    const norm = (s) => normalize(s).toLowerCase().replace(/\b(and|or)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return marks.some((m, i) => {
      const text = key.slice(m.end, i + 1 < marks.length ? marks[i + 1].index : key.length);
      if (!text.replace(/\b(?:and|or)\b/gi, '').replace(/[\s,;.]/g, '')) return false;
      const seg = norm(text);
      if (!seg) return true; // only signs or symbols ("+", "–"): an answer, not an item
      const item = items[m.num - 1] ? norm(items[m.num - 1]) : '';
      return !(item && (item.includes(seg) || seg.includes(item)));
    });
  }

  // Tries to read a typed answer as a set of the question's own enumerated
  // item names ("diatoms radiolarians" for a question listing "1)
  // Radiolarians 2) Diatoms 3) Coccolithophores") rather than item numbers -
  // students very often answer with the actual terms, not "1 and 2". Splits
  // on real separators (comma/semicolon/and/or) first; if the student just
  // wrote short terms back to back with no separator at all ("diatoms
  // radiolarians"), falls back to splitting on whitespace. Each segment must
  // match a distinct, not-yet-used item (exact, then word-order/typo
  // tolerant, then whole-word substring) - if any segment can't be matched,
  // the whole attempt is abandoned (returns null) rather than guessing.
  // `strict` (used on answer keys) takes whole names only: no splitting on
  // spaces and no part-of-a-name matches.
  function resolveTermsToNumbers(raw, itemTexts, strict) {
    if (!itemTexts || !itemTexts.length || !raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const segments = trimmed.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (!segments.length) return null;
    // An answer with no separator is one item's name ("Paschen series",
    // "gap junctions") before it is several short ones ("diatoms
    // radiolarians"): the whole thing is tried first, and may only be the
    // name or a part of it, never something that merely contains a name.
    if (segments.length < 2) {
      const exact = matchSegments(segments, itemTexts, 'none');
      if (exact || strict) return exact;
      const wsSplit = trimmed.split(/\s+/).filter(Boolean);
      const words = wsSplit.length >= 2 ? matchSegments(wsSplit, itemTexts, 'none') : null; // "A B", "diatoms radiolarians"
      if (words) return words;
      return matchSegments(segments, itemTexts, 'inside')
        || (wsSplit.length >= 2 ? matchSegments(wsSplit, itemTexts, 'either') : null);
    }
    return matchSegments(segments, itemTexts, strict ? 'none' : 'either');
  }
  function itemAliases(item, all) {
    const out = [];
    const t = String(item).trim();
    const up = t.toUpperCase();
    const EL = ELEMENT_NAMES;
    if (EL) {
      if (EL.byName[up]) out.push(EL.byName[up]);
      const ion = t.match(/^([A-Z][a-z]?)(?:\s*\^?\(?\d*[+\-−]\)?|\s*\d*[+\-−])?$/);
      if (ion && EL.bySym[ion[1].toUpperCase()] === ion[1]) {
        out.push(ion[1]);
        const name = Object.keys(EL.byName).find((n) => EL.byName[n] === ion[1] && !/^(?:ALUMINIUM|SULPHUR|CAESIUM)$/.test(n));
        if (name) out.push(name);
      }
    }
    for (const [f, name] of Object.entries(COMPOUND_NAMES)) {
      if (name === up || COMPOUND_ALT[f] === up) out.push(f);
      if (f === t) { out.push(name); if (COMPOUND_ALT[f]) out.push(COMPOUND_ALT[f]); }
    }
    const words = normalize(t.replace(/\([^()]*\)/g, ' ')).split(' ').filter(Boolean);
    const headOf = (x) => normalize(String(x).replace(/\([^()]*\)/g, ' ')).split(' ').filter(Boolean).slice(0, -1).join(' ');
    if (words.length >= 2) {
      const head = words.slice(0, -1).join(' ');
      if (head.length >= 4 && all.filter((x) => headOf(x) === head).length === 1) { out.push(head); out.push(head.replace(/['’]?S$/, '')); }
      const initials = words.map((w) => w[0]).join('');
      const initialsOf = (x) => normalize(String(x).replace(/\([^()]*\)/g, ' ')).split(' ').filter(Boolean).map((w) => w[0]).join('');
      if (/^[A-Z]{2,5}$/.test(initials) && all.filter((x) => initialsOf(x) === initials).length === 1) out.push(initials);
    }
    if (typeof abbrCanon === 'function') {
      const canon = abbrCanon(t);
      for (const [abbr, full] of Object.entries(STANDARD_ABBREVIATIONS)) if (full === canon) out.push(abbr);
    }
    return out.filter(Boolean);
  }
  // `contain` says how far a part-of-a-name match may go: 'either' way round,
  // only the typed text 'inside' the item's name, or 'none'.
  function matchSegments(segments, itemTexts, contain) {
    const used = new Array(itemTexts.length).fill(false);
    const nums = [];
    for (const seg of segments) {
      let bestIdx = -1;
      for (let i = 0; i < itemTexts.length; i++) {
        if (used[i]) continue;
        if (normEqual(seg, itemTexts[i])) { bestIdx = i; break; }
      }
      if (bestIdx === -1) {
        for (let i = 0; i < itemTexts.length; i++) {
          if (used[i]) continue;
          const m = lenientWordMatch(seg, itemTexts[i]);
          if (contain === 'none' ? m === 'exact' : m) { bestIdx = i; break; }
        }
      }
      if (bestIdx === -1 && contain !== 'none' && normalize(seg).length >= 4) {
        for (let i = 0; i < itemTexts.length; i++) {
          if (used[i]) continue;
          const hit = contain === 'either' ? eitherContains(seg, itemTexts[i]) : containsWholeRun(normalize(itemTexts[i]), normalize(seg));
          if (hit) { bestIdx = i; break; }
        }
      }
      if (bestIdx === -1 && contain !== 'none') {
        // another name a player gives a listed item: an element's symbol or
        // name, initials ("LDL"), a standard abbreviation, or the name
        // without its last word ("Turner" for "Turner's syndrome")
        const hits = [];
        for (let i = 0; i < itemTexts.length; i++) {
          if (!used[i] && itemAliases(itemTexts[i], itemTexts).some((al) => normEqual(seg, al))) hits.push(i);
        }
        if (hits.length === 1) bestIdx = hits[0];
      }
      if (bestIdx === -1) return null;
      used[bestIdx] = true;
      nums.push(bestIdx + 1);
    }
    return nums;
  }

  // "ALL BUT <item>" / "ALL EXCEPT <item>" - a common way to answer a
  // multi-select question by naming what's left OUT rather than what's
  // in. <item> can be a bare number ("all but 2") or the item's own name
  // ("all but galilean").
  function tryAllButCanonical(raw, itemCount, itemTexts) {
    if (!itemCount) return null;
    const up = normalize(raw);
    const m = up.match(/^ALL (?:BUT|EXCEPT)\s+(.+)$/);
    if (!m) return null;
    const rest = m[1].trim();
    let excluded = null;
    const compact = rest.replace(/\s/g, '');
    if (/^[1-9]+$/.test(compact) && compact.length <= itemCount) {
      excluded = compact.split('').map(Number);
    } else if (itemTexts) {
      excluded = resolveTermsToNumbers(rest, itemTexts);
    }
    if (!excluded || !excluded.length) return null;
    const remaining = range(1, itemCount).filter((n) => !excluded.includes(n));
    if (!remaining.length) return null;
    return digitsToCanonical(remaining);
  }

  // A number-led answer that carries a trailing unit/descriptor word in the
  // packet ("8 FACTORS", "120 AND 130 DEGREES") is still fully answered by
  // just the number(s) - a student isn't expected to also recite "factors"
  // or "degrees". `extractPureNumbers` requires the ENTIRE typed answer to
  // be numbers (plus AND/OR connectors) - if there's any other word in
  // there, bail rather than risk treating a wrong answer that happens to
  // start with the right number as correct. `extractLeadingNumbers` is used
  // on the answer-key side instead, where trailing descriptor words are
  // expected and fine to ignore.
  // The numbers in a text as whole values: "4.5" stays 4.5 (normalize()
  // would split it into 4 and 5), "40,000" is 40000, and scientific notation
  // in any common form ("3.2 × 10^23", "3.2 x 10^23", "3.2*10^23", "3.2e23",
  // a bare "10^23") is one number, "3.2E23", with its exponent's sign kept.
  // Signs on the numbers themselves are left to signConflict().
  const SCI_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:[X×*·∙]|TIMES)\s*10\s*\^\s*\(?\s*([+\-−–]?\s*\d+)\s*\)?/g;
  function numberTokens(text) {
    const s = String(text == null ? '' : text).toUpperCase()
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      .replace(SCI_RE, (m, a, b) => ` ${a}E${b.replace(/[−–]/, '-').replace(/\s+/g, '')} `)
      .replace(/(^|[^\dA-Z.])10\s*\^\s*\(?\s*([+\-−–]?\d+)\s*\)?/g, (m, pre, b) => `${pre} 1E${b.replace(/[−–]/, '-')} `)
      .replace(/(^|[^A-Z\d.])(\d+(?:\.\d+)?)E([+\-]?\d+)(?![A-Z\d])/g, '$1 $2E$3 ');
    return s.split(/[\s;,()[\]]+/).map((w) => w.replace(/^[+\-−–]+/, '').replace(/[.:!?]+$/, '')).filter(Boolean);
  }
  const NUMBER_TOKEN_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:E[+\-]?\d+)?$/;
  const canonNumber = (w) => (w.startsWith('.') ? '0' + w : w);
  function extractPureNumbers(text) {
    const nums = [];
    for (const w of numberTokens(text)) {
      if (NUMBER_TOKEN_RE.test(w)) { nums.push(canonNumber(w)); continue; }
      if (w === 'AND' || w === 'OR' || w === '&') continue;
      return null;
    }
    return nums.length ? nums : null;
  }
  function extractLeadingNumbers(text) {
    const nums = [];
    for (const w of numberTokens(text)) {
      if (NUMBER_TOKEN_RE.test(w)) { nums.push(canonNumber(w)); continue; }
      if (w === 'AND' || w === 'OR' || w === '&') continue;
      break;
    }
    return nums;
  }
  // Does what follows a key's leading number(s) read as units ("8 FACTORS",
  // "12 CM BEHIND THE MIRROR", "3.9 kcal/mol", "2 ONLY (8)")? Not when it is
  // more math ("3 TIMES THE SQUARE ROOT OF 3", "3 SQRT 11") or a word that
  // carries the sign ("870 JOULES LESS", "273 DEGREES BELOW ZERO"): then a
  // bare number isn't the whole answer.
  const SIGN_WORDS = new Set(['LESS', 'BELOW', 'DECREASE', 'DECREASES', 'DECREASED', 'LOSS', 'LOST', 'LOSE', 'LOSES',
    'DROP', 'DROPS', 'DROPPED', 'LOWER', 'FALL', 'FALLS', 'NEGATIVE', 'MINUS', 'DOWN', 'UNDER', 'DEFICIT', 'REDUCTION']);
  const MATH_WORDS = new Set(['SQRT', 'CBRT', 'PI', 'OVER', 'PLUS', 'MINUS', 'DIVIDED', 'I']);
  // A magnitude ("15 MILLION YEARS"), a second quantity ("1 CM X 1 CM",
  // "2n AND 4s") or letters stuck to the number ("2k^2", "4C9", "2N") are
  // part of the answer, not its unit.
  const NOT_A_UNIT_TAIL = /^(?:THOUSAND|MILLION|BILLION|TRILLION|HUNDRED|DOZEN|X|BY|PER|OVER|AND|OR|PLUS|MINUS|SQUARED|CUBED)$/;
  function unitTail(text) {
    const raw = String(text == null ? '' : text);
    if (/^\s*[+\-−–]?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+)[A-Za-z]/.test(raw) && !/^\s*[+\-−–]?[\d.,]+\s*(?:%|°|[A-Za-zμΩ]{1,4}(?:\/[A-Za-z]{1,4})?(?:\^\d)?)\s*$/.test(raw.replace(/\s*\([^)]*\)\s*$/, ''))) return false;
    if (/\d[A-Za-z]*\s*(?:\^|[xX×*]\s*\d|[A-Za-z]+\s*(?:and|AND|x|X|×)\s*\d)/.test(raw) && !/^\s*[\d.,]+\s*[xX×*]\s*10\s*\^/.test(raw)) return false;
    const words = numberTokens(text);
    let i = 0;
    while (i < words.length && (NUMBER_TOKEN_RE.test(words[i]) || ['AND', 'OR', '&'].includes(words[i]))) i++;
    const tail = words.slice(i);
    if (!tail.length) return true;
    // a second number further on is a second quantity or more math
    // ("2 N EQUALS 46", "1 CM X 1 CM"), not part of a unit (an exponent,
    // "m/s^2", is)
    const NUM = '[+\\-−–]?\\s*(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)(?:\\s*(?:[xX×*·]|times)\\s*10\\s*\\^\\s*\\(?\\s*[+\\-−–]?\\d+\\s*\\)?|[eE][+\\-]?\\d+)?';
    const after = String(text).replace(new RegExp('^\\s*' + NUM + '(?:\\s*(?:and|or|&|,)\\s*' + NUM + ')*', 'i'), '')
      .replace(/\^\s*\(?\s*[+\-−–]?\d+\s*\)?|[²³]/g, '').replace(/\([^)]*\)\s*$/, '');
    if (/\d/.test(after)) return false;
    if (!/^[A-Z][A-Z0-9'./^*\-]*$/.test(tail[0]) || MATH_WORDS.has(tail[0]) || NOT_A_UNIT_TAIL.test(tail[0])) return false;
    // "1000 TIMES" or "4 TIMES AS FAST" is an answer; "24 TIMES THE
    // PERMITTIVITY ..." or "2 TIMES 10 TO THE 8TH" is more math
    if (tail[0] === 'TIMES' && tail.length > 1 && (/^\d|^\.\d/.test(tail[1]) || ['THE', 'SQUARE', 'CUBE', 'PI', 'SQRT', 'A', 'AN'].includes(tail[1]))) return false;
    return !tail.some((w) => SIGN_WORDS.has(w.replace(/[^A-Z]/g, '')));
  }
  function numsEqualAsSet(a, b) {
    if (!a.length || a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  }

  // Core string equality after normalization
  // ---- Signs on numeric answers ----
  // normalize() strips punctuation, "-" included, so "-2" and "2" used to
  // compare equal - and so did "-195 degrees" / "195 degrees" and "-2+sqrt6"
  // / "2+sqrt6". When both sides START with a number, that number's sign is
  // part of the answer and must agree. "negative 2" / "minus 2" count as
  // "-2", and the dash variants PDFs produce (− – ‐) as "-". A dash inside
  // the answer ("20 – 21", "G-2", "x - 2") isn't a leading sign and is left
  // to the ordinary rules. Checked on the corpus: of 673 keys that start with
  // a negative number, 658 used to accept the answer with its sign dropped.
  // A key that's exactly one number (optional sign, digits, decimal, "/n")
  // also matches the same number written another way ("negative 2" = "-2").
  const SIGN_RE = '(?:([+\\-\u2212\u2013\u2010])\\s*|(NEGATIVE|MINUS|POSITIVE|PLUS)\\s+)?';
  const PURE_NUMBER_RE = new RegExp('^\\s*' + SIGN_RE + '((?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)?)\\s*$', 'i');
  const LEADING_NUMBER_RE = new RegExp('^\\s*' + SIGN_RE + '(?:\\d|\\.\\d)', 'i');
  function signOf(m) {
    const sym = m[1] || (m[2] && m[2].toUpperCase());
    return sym && /^(?:[-\u2212\u2013\u2010]|NEGATIVE|MINUS)$/.test(sym) ? -1 : 1;
  }
  function pureNumber(s) {
    const m = String(s == null ? '' : s).match(PURE_NUMBER_RE);
    if (!m) return null;
    const digits = m[3].replace(/[,\s]/g, '');
    // ".5" = "0.5"; otherwise digits are compared as written ("001" is not "1")
    return { sign: signOf(m), digits: digits.startsWith('.') ? '0' + digits : digits };
  }
  // A decimal and a fraction with exactly the same value are the same
  // answer: "0.5" = "1/2", "0.75" = "3/4", "5.5" = "11/2". Nothing else is
  // compared by value - two decimals, two fractions, or a decimal and an
  // integer are still compared as written, because packets reject unreduced
  // fractions ("15/60" for "1/4") and dropped significant figures
  // ("1 × 10^-8" for "1.0 × 10^-8"). The fraction must also be in lowest
  // terms, and only exact equality counts ("0.33" is not "1/3").
  function decimalToRational(t) {
    const m = t.match(/^(\d*)(?:\.(\d+))?$/);
    if (!m || (!m[1] && !m[2])) return null;
    const frac = m[2] || '';
    return { n: BigInt((m[1] || '0') + frac), d: 10n ** BigInt(frac.length) };
  }
  function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
  function sameValue(pa, pb) {
    if (pa.digits === pb.digits) return pa.sign === pb.sign;
    const [fr, dec] = pa.digits.includes('/') ? [pa, pb] : [pb, pa];
    if (!fr.digits.includes('/') || dec.digits.includes('/') || !dec.digits.includes('.')) return false;
    const f = fr.digits.match(/^(\d+)\/(\d+)$/);
    if (!f) return false;
    const n = BigInt(f[1]), d = BigInt(f[2]);
    if (d === 0n || gcd(n, d) !== 1n) return false;
    const r = decimalToRational(dec.digits);
    if (!r) return false;
    if (n === 0n && r.n === 0n) return true;
    return pa.sign === pb.sign && n * r.d === r.n * d;
  }
  // A leading number followed by the rest of the answer ("1/2 METERS",
  // "0.5 PI"), split so the number can be compared by value.
  const LEADING_VALUE_RE = new RegExp('^\\s*' + SIGN_RE + '((?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)(?:\\s*\\/\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+))?)(?![\\d.\\/])\\s*(.*)$', 'i');
  function leadingValue(s) {
    const m = String(s == null ? '' : s).match(LEADING_VALUE_RE);
    if (!m) return null;
    const digits = m[3].replace(/[,\s]/g, '');
    return {
      sign: signOf(m),
      digits: digits.startsWith('.') ? '0' + digits : digits,
      rest: normalize(m[4]),
    };
  }
  // Same leading value written differently, same remainder: "0.5 PI" for
  // "1/2 PI", "2.5 METERS" for "5/2 METERS" (see sameValue for which
  // forms count as the same value).
  function leadingValueEqual(a, b) {
    const la = leadingValue(a), lb = leadingValue(b);
    if (!la || !lb || !la.rest || la.rest !== lb.rest || la.digits === lb.digits) return false;
    return sameValue(la, lb);
  }
  // Every number in the string with its sign, for answers whose terms can
  // come in any order ("5i - 3" vs "3 + 5i", "7, -5" vs "5, 7"). A dash
  // after a digit ("20 – 21", "2 - 3i") or glued to a letter ("G-2", "A-1",
  // "x-2") may be a range, subtraction or label hyphen rather than a sign,
  // so that number is left out entirely.
  const DASH = /[-\u2212\u2013\u2010]/;
  function signedTerms(s) {
    const str = String(s == null ? '' : s);
    const out = [];
    const re = /\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(str))) {
      let j = m.index - 1;
      if (j >= 0 && /[\d.]/.test(str[j])) continue;
      while (j >= 0 && str[j] === ' ') j--;
      let sign = '+';
      if (j >= 0 && DASH.test(str[j])) {
        const spaced = str[j - 1] === ' ';
        let k = j - 1;
        while (k >= 0 && str[k] === ' ') k--;
        const prev = k >= 0 ? str[k] : '';
        if (/[\d.]/.test(prev) || (/[A-Za-z]/.test(prev) && !spaced)) continue;
        sign = '-';
      } else if (/\b(?:NEGATIVE|MINUS)\s*$/i.test(str.slice(0, j + 1))) {
        sign = '-';
      }
      out.push({ sign, mag: m[0] });
    }
    return out;
  }
  function termSignConflict(a, b) {
    const ta = signedTerms(a), tb = signedTerms(b);
    if (!ta.length || ta.length !== tb.length) return false;
    const mags = (t) => t.map((x) => x.mag).sort().join(' ');
    const signed = (t) => t.map((x) => x.sign + x.mag).sort().join(' ');
    return mags(ta) === mags(tb) && signed(ta) !== signed(tb);
  }
  function signConflict(a, b) {
    const parts = partSignConflict(a, b);
    if (parts !== null) return parts;
    const la = String(a).match(LEADING_NUMBER_RE), lb = String(b).match(LEADING_NUMBER_RE);
    if (la && lb && signOf(la) !== signOf(lb)) return true;
    return termSignConflict(a, b) || operatorConflict(a, b);
  }

  // ---- Operators, inequalities and charges ----
  // normalize() drops symbols, so "OH^-" and "OH^+", "y=x+3/2" and
  // "y=x-3/2", "x < 17/15" and "x > 17/15", or "a*b" and "a/b" would read
  // the same. Each side's symbols are collected, and the two conflict when
  // one has a symbol whose opposite the other has instead (+ against -,
  // * against /), or both state a comparison and the comparisons differ
  // (<, >, ≤, ≥, =, ≠). An answer that leaves the symbols out ("OH" for
  // "OH^-") isn't contradicting the key, so it's judged as before.
  // A dash glued between two letters ("alpha-helix", "beta-plus") or a
  // letter and a digit ("G-2", "A-1") is a hyphen or a label, unless the
  // answer has other math in it ("y=x-3/2", "ΔG = ΔH-TΔS").
  function operatorsOf(raw) {
    const str = String(raw == null ? '' : raw)
      .replace(/<=|=</g, '≤').replace(/>=|=>/g, '≥').replace(/!=|=\/=|<>/g, '≠')
      .replace(/[\u2212\u2013\u2010\u2014]/g, '-').replace(/[×·∙]/g, '*').replace(/÷/g, '/');
    const mathy = /[=<>≤≥≠^+*/()]/.test(str);
    const ops = new Map();
    const add = (c) => ops.set(c, (ops.get(c) || 0) + 1);
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '-') {
        const prev = str[i - 1] || ' ', next = str[i + 1] || ' ';
        if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next) && !mathy) continue;
        if (/[A-Za-z]/.test(prev) && /\d/.test(next) && !mathy) continue;
        if (/\d/.test(prev) && /\d/.test(next) && !mathy) continue; // a range, "20-21"
        add('-');
      } else if ('+*/<>≤≥=≠'.includes(c)) {
        add(c);
      }
    }
    return ops;
  }
  // Labelled parts ("1) +, 2) –, 3) -") are compared part by part: counting
  // symbols over the whole answer can't tell "1) -, 2) -, 3) +" from it, and
  // would read the "-" that ends part 2 of "1) + 2) - 3) -" as the sign of
  // the 3. Null when the two don't label the same parts.
  function labelledParts(raw) {
    const str = String(raw == null ? '' : raw);
    const marks = itemMarkers(str);
    if (marks.length < 2 || marks.some((m, i) => m.num !== i + 1)) return null;
    return marks.map((m, i) => str.slice(m.end, i + 1 < marks.length ? marks[i + 1].index : str.length)
      .replace(/^[\s:]+/, '').replace(/[\s,;.]+$/, ''));
  }
  function partSignConflict(a, b) {
    const pa = labelledParts(a), pb = labelledParts(b);
    if (!pa || !pb || pa.length !== pb.length) return null;
    return pa.some((x, i) => signConflict(x, pb[i]));
  }
  function operatorConflict(a, b) {
    const parts = partSignConflict(a, b);
    if (parts !== null) return parts;
    const oa = operatorsOf(a), ob = operatorsOf(b);
    if (!oa.size || !ob.size) return false;
    // Same numbers and letters, arranged into a different expression:
    // "x-y+z" for "x+y-z", "b/a" for "a/b" (counting symbols can't see it).
    if (expressionConflict(a, b)) return true;
    // One side has more of a symbol and the other more of its opposite: a
    // sign, charge or operation was swapped ("x^2-1/3x^4" for "x^2+1/3x^4").
    // A symbol simply missing on one side ("1/(i hbar)" for "1/(i*hbar)")
    // isn't a swap.
    const d = (c) => (oa.get(c) || 0) - (ob.get(c) || 0);
    if (d('+') * d('-') < 0 || d('*') * d('/') < 0) return true;
    // One inequality on each side: compare them as "low < high", so
    // "17/15 > x" agrees with "x < 17/15" and disagrees with "x > 17/15".
    const ia = inequalityOf(a), ib = inequalityOf(b);
    if (ia && ib) {
      if (ia.strict !== ib.strict) return true;
      return ia.lo !== ia.hi && ia.lo === ib.hi && ia.hi === ib.lo;
    }
    const cmp = (o) => ['<', '>', '≤', '≥', '=', '≠'].filter((x) => o.has(x)).filter((x, _, all) => !(x === '=' && all.length > 1)).join('');
    // ("=" next to another comparison is part of it, so it's left out.)
    const ca = cmp(oa), cb = cmp(ob);
    if (ia || ib) return false; // "x < 3" against "3 > x or so": leave it to the rest
    return !!ca && !!cb && ca !== cb;
  }
  // ---- Expressions compared by structure ----
  // A plain algebraic expression (numbers, letters, + - * / ^, brackets,
  // functions such as cos(x), radicals √x, absolute values |x|, signed
  // exponents as in "x^-2", and implicit multiplication as in "1/3x^4") is
  // parsed and written
  // out in one canonical form: sums as a sorted list of signed terms,
  // products as sorted factors over sorted factors. So "y+x" meets "x+y" and
  // "1-x" meets "-x+1", while "x-y+z" (for "x+y-z"), "b/a" (for "a/b") and
  // "y^-2+x" (for "x^-2+y") don't. Anything else (words, units, commas,
  // charges like "OH^-") doesn't parse, and is left to the other checks.
  const EXPR_FUNCS = new Set(['SIN', 'COS', 'TAN', 'SEC', 'CSC', 'COT', 'ARCSIN', 'ARCCOS', 'ARCTAN',
    'SINH', 'COSH', 'TANH', 'LN', 'LOG', 'EXP', 'SQRT', 'ABS']);
  // Longer names that are symbols, not words.
  const EXPR_NAMES = new Set(['PI', 'HBAR', 'ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'THETA', 'LAMBDA',
    'SIGMA', 'OMEGA', 'PHI', 'PSI', 'RHO', 'TAU', 'ETA', 'ZETA', 'KAPPA', 'CHI', 'NU', 'MU', 'XI']);
  function exprTokens(raw) {
    const s = String(raw == null ? '' : raw).toUpperCase()
      .replace(/[−–‐—]/g, '-').replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/')
      .replace(/[[{]/g, '(').replace(/[\]}]/g, ')');
    const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Zα-ωΑ-Ωπ](?:[A-Zα-ωΑ-Ωπ]|_[A-Z0-9]+)*)|([-+*/^()=|√∛]))/y;
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (/^\s+$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) return null;
      if (m[1]) out.push({ t: 'num', v: m[1].replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0' });
      else if (m[2]) out.push({ t: 'id', v: m[2] });
      else out.push({ t: m[3] });
      i = re.lastIndex;
    }
    return out;
  }
  function parseExpression(raw) {
    const toks = exprTokens(raw);
    if (!toks || !toks.length) return null;
    let p = 0;
    // Inside |...| a "|" closes the bar; outside one it opens a new one
    // ("2|x|" is 2 times |x|).
    let bars = 0;
    const peek = () => toks[p] && toks[p].t;
    const startsAtom = () => ['num', 'id', '(', '√', '∛'].includes(peek()) || (peek() === '|' && !bars);
    function sum() {
      let n = product();
      while (peek() === '+' || peek() === '-') { const op = toks[p++].t; n = { t: op === '+' ? 'add' : 'sub', a: n, b: product() }; }
      return n;
    }
    function product() {
      let n = unary();
      for (;;) {
        if (peek() === '*' || peek() === '/') { const op = toks[p++].t; n = { t: op === '*' ? 'mul' : 'div', a: n, b: unary() }; }
        else if (startsAtom()) n = { t: 'mul', a: n, b: power() };
        else return n;
      }
    }
    function unary() {
      if (peek() === '-') { p++; return { t: 'neg', x: unary() }; }
      if (peek() === '+') { p++; return unary(); }
      return power();
    }
    function power() {
      const base = atom();
      if (peek() === '^') {
        p++;
        // A sign after "^" is a signed exponent when an operand follows it
        // ("x^-2", "e^-x"), and a charge when nothing does ("OH^-", "Na^+ +
        // Cl^-"), which doesn't parse. "W^+ BOSON" fails on the word.
        if ((peek() === '+' || peek() === '-') && !['num', 'id', '(', '|', '√', '∛'].includes(toks[p + 1] && toks[p + 1].t)) throw new Error('charge');
        return { t: 'pow', a: base, b: unary() };
      }
      return base;
    }
    function atom() {
      const tok = toks[p++];
      if (!tok) throw new Error('end');
      if (tok.t === 'num') return { t: 'leaf', v: tok.v };
      if (tok.t === 'id') {
        if (EXPR_FUNCS.has(tok.v) && peek() === '(') { p++; const arg = sum(); if (toks[p++]?.t !== ')') throw new Error(')'); return { t: 'fn', name: tok.v, x: arg }; }
        // A word ("BOSON", "ION") means this isn't a bare expression.
        if (/^[A-Z]{3,}$/.test(tok.v) && !EXPR_FUNCS.has(tok.v) && !EXPR_NAMES.has(tok.v)) throw new Error('word');
        return { t: 'leaf', v: tok.v };
      }
      if (tok.t === '(') { const n = sum(); if (toks[p++]?.t !== ')') throw new Error(')'); return n; }
      // a radical takes the operand right after it: "√2/2" is (√2)/2
      if (tok.t === '√' || tok.t === '∛') return { t: 'fn', name: tok.t === '√' ? 'SQRT' : 'CBRT', x: atom() };
      if (tok.t === '|' && !bars) {
        bars++;
        const n = sum();
        bars--;
        if (toks[p++]?.t !== '|') throw new Error('|');
        return { t: 'fn', name: 'ABS', x: n };
      }
      throw new Error('token');
    }
    try {
      const sides = [sum()];
      while (peek() === '=') { p++; sides.push(sum()); }
      return p === toks.length ? sides : null;
    } catch (e) { return null; }
  }
  // { sign, str } for a node, with sums and products in canonical order.
  function canonSum(node) {
    const terms = [];
    (function walk(n, s) {
      if (n.t === 'add') { walk(n.a, s); walk(n.b, s); }
      else if (n.t === 'sub') { walk(n.a, s); walk(n.b, -s); }
      else if (n.t === 'neg') walk(n.x, -s);
      else { const f = canonProduct(n); terms.push({ s: s * f.sign, str: f.str }); }
    })(node, 1);
    if (terms.length === 1) return { sign: terms[0].s, str: terms[0].str };
    terms.sort((x, y) => (x.str < y.str ? -1 : x.str > y.str ? 1 : x.s - y.s));
    // "-(b-a)" and "(a-b)" are one thing: the first term carries the sign.
    const sign = terms[0].s;
    return { sign, str: '(' + terms.map((x) => (x.s * sign > 0 ? '+' : '-') + x.str).join('') + ')' };
  }
  function canonProduct(node) {
    const num = [], den = [];
    let sign = 1;
    (function walk(n, top, bottom) {
      if (n.t === 'mul') { walk(n.a, top, bottom); walk(n.b, top, bottom); }
      else if (n.t === 'div') { walk(n.a, top, bottom); walk(n.b, bottom, top); }
      else if (n.t === 'neg') { sign = -sign; walk(n.x, top, bottom); }
      else { const f = canonAtom(n); sign *= f.sign; top.push(f.str); }
    })(node, num, den);
    if (num.length === 1 && !den.length) return { sign, str: num[0] };
    num.sort(); den.sort();
    return { sign, str: '[' + num.join('*') + (den.length ? '/' + den.join('*') : '') + ']' };
  }
  function canonAtom(n) {
    if (n.t === 'leaf') return { sign: 1, str: n.v };
    if (n.t === 'fn') { const x = canonSum(n.x); return { sign: 1, str: n.name + '(' + (x.sign < 0 ? '-' : '') + x.str + ')' }; }
    if (n.t === 'pow') {
      const b = canonSum(n.a), e = canonSum(n.b);
      return { sign: 1, str: '{' + (b.sign < 0 ? '-' : '') + b.str + '}^{' + (e.sign < 0 ? '-' : '') + e.str + '}' };
    }
    return canonSum(n); // a bracketed sum or product
  }
  function exprLeaves(sides) {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (n.t === 'leaf') out.push(n.v);
      else if (n.t === 'fn') { out.push(n.name + '('); walk(n.x); }
      else { walk(n.a); walk(n.b); walk(n.x); }
    };
    sides.forEach(walk);
    return out.sort().join(' ');
  }
  // An equation's sides in either order ("y=x+1" is "x+1=y").
  function canonExpression(sides) {
    return sides.map((s) => { const c = canonSum(s); return (c.sign < 0 ? '-' : '+') + c.str; }).sort().join('=');
  }
  // Both sides parse, use exactly the same numbers and letters, and still
  // come out as different expressions. Different numbers or letters ("x^2"
  // against "x2", "0.5x" against "x/2") are another kind of difference, left
  // to the rest of the grader.
  function expressionConflict(a, b) {
    const ea = parseExpression(a), eb = parseExpression(b);
    if (!ea || !eb || ea.length !== eb.length) return false;
    if (exprLeaves(ea) !== exprLeaves(eb)) return false;
    return canonExpression(ea) !== canonExpression(eb);
  }
  // A formula rather than words: it has math symbols, and every word in it is
  // a variable, function or named constant ("x^-2 + √y", "-ln|cos x| + C").
  // A hyphenated name ("alpha-helix") has no math symbols (see operatorsOf).
  const MATH_WORDS_OK = new Set([...EXPR_FUNCS, ...EXPR_NAMES, 'CBRT']);
  function isMathAnswer(raw) {
    const str = String(raw == null ? '' : raw);
    if (!operatorsOf(str).size && !/[√∛|^]/.test(str)) return false;
    return !(str.toUpperCase().match(/[A-Z]{3,}/g) || []).some((w) => !MATH_WORDS_OK.has(w));
  }
  // A reaction's sides, each a sorted list of its species: "N2 + 3H2 →
  // 2NH3" is [["3H2", "N2"], ["2NH3"]]. A "+" after "^" or before nothing
  // but another "+" or the end is a charge ("H^+ + OH^-", "Na+ + Cl-").
  const ARROW_RE = /\s*(?:→|⟶|⇌|⇄|<=+>|<-+>|-+>|=+>|\byields\b|\bproduces\b|\bforms\b)\s*/i;
  function reactionSides(raw) {
    const sides = String(raw == null ? '' : raw).split(ARROW_RE);
    if (sides.length !== 2) return null;
    return sides.map((side) => {
      const species = [];
      let depth = 0, cur = '';
      for (let i = 0; i < side.length; i++) {
        const ch = side[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        const next = side.slice(i + 1).trim()[0];
        if (ch === '+' && !depth && side[i - 1] !== '^' && next && next !== '+') { species.push(cur); cur = ''; continue; }
        cur += ch;
      }
      species.push(cur);
      return species.map((x) => compact(x)).filter(Boolean).sort();
    });
  }
  function sameMath(a, b) {
    const ra = reactionSides(a), rb = reactionSides(b);
    if (ra || rb) return !!ra && !!rb && ra.every((side, i) => side.join(' + ') === rb[i].join(' + '));
    const ea = parseExpression(a), eb = parseExpression(b);
    if (ea && eb) return ea.length === eb.length && canonExpression(ea) === canonExpression(eb);
    const ia = inequalityOf(a), ib = inequalityOf(b);
    return !!ia && !!ib && ia.strict === ib.strict && ia.lo === ib.lo && ia.hi === ib.hi;
  }
  function inequalityOf(raw) {
    const str = String(raw == null ? '' : raw).replace(/<=|=</g, '≤').replace(/>=|=>/g, '≥');
    const ops = str.match(/[<>≤≥]/g);
    if (!ops || ops.length !== 1) return null;
    const [left, right] = str.split(/[<>≤≥]/);
    const L = normalize(left), R = normalize(right);
    if (!L || !R) return null;
    const op = ops[0];
    const less = op === '<' || op === '≤';
    return { strict: op === '<' || op === '>', lo: less ? L : R, hi: less ? R : L };
  }

  // A bare decimal against a key of "FRACTION UNIT-WORD(S)" or the reverse,
  // compared by value (see sameValue). The rest of the key must be
  // plain unit words - not "PI", "SQRT 2", "X" or anything with a digit,
  // where dropping it changes the answer.
  const NOT_UNIT_WORDS = new Set(['PI', 'SQRT', 'CBRT', 'I', 'E', 'X', 'Y', 'Z', 'N', 'K', 'T', 'TIMES', 'OVER', 'PLUS', 'MINUS']);
  function bareValueMatchesKey(raw, key) {
    const pr = pureNumber(raw), lk = leadingValue(key);
    if (!pr || !lk || !lk.rest || pr.digits === lk.digits) return false;
    const words = lk.rest.split(' ');
    if (!words.every((w) => /^[A-Z]{2,}$/.test(w) && !NOT_UNIT_WORDS.has(w))) return false;
    return sameValue(pr, lk);
  }

  function normEqual(a, b) {
    if (signConflict(a, b)) return false;
    const pa = pureNumber(a), pb = pureNumber(b);
    if (pa && pb) return sameValue(pa, pb);
    const na = normalize(a), nb = normalize(b);
    if (na === nb || leadingValueEqual(a, b)) return true;
    // A Greek letter becomes its name with spaces around it, a typed name
    // has only the spaces that were typed ("Rω^2" is "R OMEGA 2", "R
    // omega^2" is "R OMEGA2"): with one in the answer, spacing doesn't count.
    return GREEK_TEST.test((String(a) + String(b)).toUpperCase()) && na.length > 0 && na.replace(/ /g, '') === nb.replace(/ /g, '');
  }
  // Only whitespace is dropped (punctuation is kept, so "1.5" never meets
  // "15"), and only for answers containing a letter, since spacing is
  // meaningful inside bare numbers ("1 2" vs "12").
  function compact(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/['’‘]/g, "'")
      .replace(/\^\(([^()]*)\)/g, '$1').replace(/[\^_]/g, '').replace(/\s+/g, '');
  }
  function compactEqual(a, b) {
    if (signConflict(a, b)) return false;
    const ca = compact(a);
    return ca.length >= 2 && /[A-Z]/.test(ca) && ca === compact(b);
  }

  // A plain substring check for the containment helpers would let an answer match
  // inside a completely different, sometimes opposite-meaning word - "STABLE"
  // is literally a substring of "UNSTABLE" (the "UN" prefix aside), so
  // without a word-boundary requirement "stable unstable" would fuzzy-match
  // a choice reading "Unstable; unstable" even though they mean opposite
  // things. Requires `needle` to appear bounded by the string's edges or a
  // space on both sides, i.e. as whole word(s), not embedded in a larger one.
  function containsWholeRun(haystack, needle) {
    let start = 0;
    while (true) {
      const idx = haystack.indexOf(needle, start);
      if (idx === -1) return false;
      const before = idx === 0 ? ' ' : haystack[idx - 1];
      const endIdx = idx + needle.length;
      const after = endIdx >= haystack.length ? ' ' : haystack[endIdx];
      if (before === ' ' && after === ' ') return true;
      start = idx + 1;
    }
  }

  // The typed answer contains the whole key plus more ("sodium chloride" for
  // "SODIUM", "full moon" for "FULL"). That's sometimes the right answer said
  // with extra words and sometimes a different answer, so checkAnswer only
  // ever reports it as "close" for the player to confirm. The other direction
  // (typing only part of the key, "carbon" for "CARBON DIOXIDE") is an
  // incomplete answer and never matches.
  // Naming items from the question's own numbered list is looser: there are
  // only a few candidates on screen, so "diatoms" may pick out an item that
  // reads "Diatoms (marine)" and the reverse.
  function eitherContains(a, b) {
    if (signConflict(a, b)) return false;
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return (na.length >= 4 && containsWholeRun(nb, na)) || (nb.length >= 4 && containsWholeRun(na, nb));
  }

  function typedContainsKey(typed, key) {
    if (signConflict(typed, key)) return false;
    const nt = normalize(typed);
    const nk = normalize(key);
    if (!nt || !nk || nt === nk) return false;
    return nk.length >= 4 && containsWholeRun(nt, nk);
  }

  // ---- Word-order-independent + typo-tolerant matching ----
  // Handles two common near-misses that a strict string comparison marks
  // wrong: answering a multi-word answer's words in a different order
  // ("jupiter saturn" for "Saturn and Jupiter"), and small typos in a word
  // ("deuterosomes" for "deuterostomes"). Never used for the reject list,
  // which stays a strict match.
  const STOPWORDS = new Set(['AND', 'OR', 'THE', 'A', 'AN', 'OF']);
  function tokenize(s) {
    // ("A" after a number is amperes, not the article: "5 A" is not "5";
    // and a last "A" is a letter, never the article: "VITAMIN A", "TYPE A")
    return normalize(s).split(' ').filter((w, i, all) => w && (!STOPWORDS.has(w)
      || (w === 'A' && (/\d$/.test(all[i - 1] || '') || (i > 0 && i === all.length - 1)))));
  }
  // Small words are left alone (a 1-2 letter difference between short words
  // can flip to a totally different, wrong word - e.g. "RNA" vs "DNA" - so
  // no tolerance there); tolerance grows slowly with word length.
  function typoTolerance(len) {
    if (len <= 4) return 0;
    if (len <= 7) return 1;
    if (len <= 12) return 2;
    return 3;
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[n];
  }
  // Word pairs one or two letters apart that name different things, so a
  // "typo" between them is really a different answer: HYPERTONIC/HYPOTONIC,
  // ALKANE/ALKENE, NITRATE/NITRITE, TRIPHOSPHATE/DIPHOSPHATE, ... Each pair
  // is a swap of one piece of the word for the other.
  const CONTRAST_SWAPS = [
    ['HYPER', 'HYPO'], ['ENDO', 'EXO'], ['ENDO', 'ECTO'], ['EXO', 'ECTO'],
    ['INTER', 'INTRA'], ['HOMO', 'HETERO'], ['MICRO', 'MACRO'], ['SUB', 'SUPER'],
    ['PRO', 'EU'], ['AFF', 'EFF'], ['MONO', 'DI'], ['DI', 'TRI'], ['MONO', 'TRI'],
    ['TRI', 'TETRA'], ['ANE', 'ENE'], ['ANE', 'YNE'], ['ENE', 'YNE'],
    ['ATE', 'ITE'], ['IDE', 'ATE'], ['IDE', 'ITE'], ['OUS', 'IC'],
  ];
  // Prefixes that negate the word they're on: AEROBIC/ANAEROBIC, BIOTIC/ABIOTIC.
  const NEGATING_PREFIXES = ['A', 'AN', 'UN', 'NON', 'IN', 'IM', 'IR', 'IL', 'DIS', 'DE', 'ANTI'];
  function swapsTo(a, b, from, to) {
    for (let i = a.indexOf(from); i !== -1; i = a.indexOf(from, i + 1)) {
      if (a.slice(0, i) + to + a.slice(i + from.length) === b) return true;
    }
    return false;
  }
  function contrastingWords(a, b) {
    for (const [x, y] of CONTRAST_SWAPS) {
      if (swapsTo(a, b, x, y) || swapsTo(a, b, y, x)) return true;
    }
    return NEGATING_PREFIXES.some((p) => a === p + b || b === p + a);
  }

  // Singular and plural of the same word: PROTON/PROTONS,
  // MITOCHONDRION/MITOCHONDRIA, AXIS/AXES, NUCLEUS/NUCLEI.
  const INFLECTION_PAIRS = [['', 'S'], ['', 'ES'], ['S', 'ES'], ['ON', 'A'], ['UM', 'A'], ['US', 'I'], ['A', 'AE'], ['IS', 'ES'], ['Y', 'IES']];
  function inflectionOnly(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i < 3) return false;
    const ta = a.slice(i), tb = b.slice(i);
    return INFLECTION_PAIRS.some(([x, y]) => (ta === x && tb === y) || (ta === y && tb === x));
  }

  // One word written two ways: a possessive counts with or without its
  // ending (HOOKE'S / HOOKES / HOOKE). Nothing else: a British spelling
  // (SULPHUR, COLOUR) is a near miss like any other misspelling.
  // (One name is so often written with an A that both spellings count.)
  const NAME_SPELLINGS = { MICHAELSON: 'MICHELSON' };
  function spellingKey(w) {
    const bare = w.replace(/'S?$/, '').replace(/'/g, '');
    return NAME_SPELLINGS[bare] || bare;
  }
  function sameWord(a, b) {
    if (a === b || inflectionOnly(a, b)) return true;
    const ka = spellingKey(a), kb = spellingKey(b);
    return ka.length >= 2 && (ka === kb || inflectionOnly(ka, kb));
  }

  // Pairs up each word in `a` with a not-yet-used word in `b`, in any order.
  // Returns 'exact' when every word matches exactly (only the order, stop
  // words, singular/plural or the spelling variants of sameWord differ),
  // 'typo' when some pair is only within its length's
  // typo tolerance, or null. Requires the same word count on both sides, so
  // incomplete or padded answers never get here.
  function lenientWordMatch(a, b) {
    if (signConflict(a, b)) return null;
    const wa = tokenize(a);
    const wb = tokenize(b);
    if (!wa.length || wa.length !== wb.length) return null;
    // In math, order is meaning ("x^-2 √y" isn't "y^-2 √x"), and the
    // symbols are gone from these words, so a math answer is only matched
    // in another order when the expressions or inequalities are shown to be
    // the same ("-z+y+x" for "x+y-z", "17/15 > x" for "x < 17/15"), and
    // never with typos.
    if (isMathAnswer(a) || isMathAnswer(b)) return wa.join(' ') === wb.join(' ') || sameMath(a, b) ? 'exact' : null;
    const usedB = new Array(wb.length).fill(false);
    let typo = false;
    for (const w of wa) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < wb.length; j++) {
        if (usedB[j]) continue;
        if (sameWord(w, wb[j])) { bestIdx = j; bestDist = 0; break; }
        const tol = typoTolerance(Math.max(w.length, wb[j].length));
        // (a digit changed is a different number, never a typo: "24501" for 24500)
        if (!tol || contrastingWords(w, wb[j]) || /\d/.test(w + wb[j])) continue;
        const d = levenshtein(w, wb[j]);
        if (d <= tol && d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx === -1) return null;
      if (bestDist > 0) typo = true;
      usedB[bestIdx] = true;
    }
    return typo ? 'typo' : 'exact';
  }

  // ---- Multi-part answers ("FIRST QUARTER; FULL") ----
  // A packet answer with top-level ";" separators asks for several things at
  // once, and a student has to give every one of them, so each part is
  // matched on its own. Packets also list per-part alternates ("ACCEPT: CO2;
  // H2O", "ACCEPT: 1ST QUARTER | FULL MOON"), stored either as one
  // "|"-joined entry or as separate single-part accepts. A single-part
  // accept only ever stands in for its one part, so "LH" alone is not an
  // answer to "LUTEINIZING HORMONE; FOLLICLE STIMULATING HORMONE".

  // Splits on ";" (and a spaced " | ") outside any brackets, so "280 [W: OW.
  // E: SC; MDE]" (a transcriber note) stays one part and the absolute-value
  // bars in "LN|CSC +COT |+C" are left alone.
  function splitTopLevel(s) {
    const str = String(s);
    const out = [];
    let depth = 0, cur = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      const pipe = ch === '|' && /\s/.test(str[i - 1] || '') && /\s/.test(str[i + 1] || '');
      if (depth === 0 && (ch === ';' || pipe)) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  // "1) MAGNONS" / "2 - EUTHERIAN" / "3: BLUE" / "II) AMYGDALA" -> the part
  // without its number. Roman labels stop at IX: "X)" is a choice letter.
  const PART_NUMBER_RE = /^\s*\(?(?:[1-9]\s*[).:–-]|(?:IX|IV|V?I{1,3}|V)\s*[):])\s*/;
  function answerParts(text) {
    if (!text || !/;|\s\|\s/.test(text)) return null;
    const parts = splitTopLevel(text).map((p) => p.trim()).filter((p) => normalize(p.replace(PART_NUMBER_RE, '')));
    return parts.length >= 2 ? parts : null;
  }
  // The forms of one part a student might reasonably give: as written, without
  // its "1)" number, just the value of a "MEDIAN = 25" / "ANODE: ZINC" label,
  // with a parenthetical dropped or kept ("STRONG (FORCE)"), or any one entry
  // of a bracketed alternate list ("[POLYSACCHARIDE, STARCH]").
  function partVariants(part) {
    const out = [part];
    const noNum = part.replace(PART_NUMBER_RE, '');
    out.push(noNum);
    const label = noNum.match(/^[A-Za-z][A-Za-z .'’-]{0,30}?\s*[=:]\s*(.+)$/);
    if (label) out.push(label[1]);
    // a multiple-choice part keyed as its letter and choice ("W) DNA
    // GLYCOSYLASE", "W ((R)-METHYL 3-HYDROXYBUTANOATE)") takes either one
    const choice = noNum.match(/^([WXYZ])\)\s*(\S.*)$/) || noNum.match(/^([WXYZ])\s+\((.+)\)\s*$/);
    if (choice) out.push(choice[1], choice[2]);
    // a named law, effect, ... by its name alone ("DOPPLER EFFECT" -> "DOPPLER")
    const name = withoutKindWord(noNum);
    if (name) out.push(name);
    for (const v of out.slice()) {
      if (/\(/.test(v)) {
        // (not a bracket holding the value: "CENTER: (2, -3/2)" is not "CENTER:")
        if (!/\([^)]*\d[^)]*\)/.test(v)) out.push(v.replace(/\([^)]*\)/g, ' '));
        out.push(v.replace(/[()]/g, ' '));
      }
      const br = v.trim().match(/^\[(.*)\]$/);
      if (br) out.push(...br[1].split(','));
    }
    return [...new Set(out.map((v) => v.trim()).filter((v) => normalize(v)))];
  }

  // An accept entry that's a lone alternate for one part rather than a whole
  // answer: no separators of its own, and not a whole-answer shorthand like
  // "ALL BUT FROG" or "BOTH 10.5".
  function isPartFragment(acc) {
    return !/[;|,]/.test(acc)
      && !/\bAND\b/i.test(acc)
      && !/^\s*(ALL|BOTH|NONE|ANY|IN)\b/i.test(acc);
  }

  const NEGATORS = new Set(['NOT', 'NO', 'NON', 'NEVER', 'UN']);
  // 'exact' | 'fuzzy' | 'typo' | null. Fuzzy only lets the student say
  // slightly MORE than the part ("full moon" for "FULL", one extra word, never
  // a negation) - saying less ("quarter" for "FIRST QUARTER") is an
  // incomplete part. 'typo' is a part that's only a misspelling away, which
  // checkAnswer reports as close rather than correct.
  const MATCH_RANK = { exact: 3, fuzzy: 2, typo: 1 };
  function betterMatch(a, b) {
    return (MATCH_RANK[a] || 0) >= (MATCH_RANK[b] || 0) ? a : b;
  }
  function segMatch(seg, alts, wordCut) {
    let best = null;
    const ns = normalize(seg);
    if (!ns) return null;
    // not for a piece cut out of unseparated words: "4 meters 1/16" cut as
    // "4" + "meters 1/16" mustn't make "4" pass for "4 SECONDS"
    const segNums = wordCut ? null : extractPureNumbers(seg);
    for (const alt of alts) {
      if (normEqual(seg, alt) || compactEqual(seg, alt)) return 'exact';
      // a part that is math, written another way ("sqrt5" for "√5")
      if (!wordCut && /[\^√∛π*/()]|\b(?:pi|sqrt|cbrt)\b/i.test(seg + ' ' + alt) && mathEquivalent(seg, alt, '')) return 'exact';
      // a bare number for a part keyed as that number and a unit ("3.2 *
      // 10^23" for "3.2 × 10^23 J"), as for a single answer
      // (never against a part still carrying its label: "1" isn't "1) HALITE")
      if (segNums && !/^\s*\(?(?:[1-9]|IX|IV|V?I{1,3}|V)\s*[):]\s/.test(alt)) {
        const altNums = extractLeadingNumbers(alt);
        if (altNums.length && numsEqualAsSet(segNums, altNums) && !signConflict(seg, alt) && unitTail(alt)) return 'exact';
      }
      const lenient = lenientWordMatch(seg, alt);
      if (lenient === 'exact') return 'exact';
      if (lenient === 'typo') best = betterMatch(best, 'typo');
      const na = normalize(alt);
      if (na.length >= 3 && ns !== na && containsWholeRun(ns, na)) {
        const extra = ns.split(' ').length - na.split(' ').length;
        const extraWords = ns.replace(na, ' ').split(' ').filter(Boolean);
        if (extra === 1 && !extraWords.some((w) => NEGATORS.has(w))) best = betterMatch(best, 'fuzzy');
      }
    }
    return best;
  }

  // Does this multi-part question want its parts in a set order? "Respectively",
  // ranking/sequence wording, or labelled/numbered parts ("MEDIAN = 25") mean
  // yes; a packet note of "in either/any order" (stored as an accept) means no.
  function partsAreOrdered(question, parts, notes) {
    if (notes.some((n) => /\b(EITHER|ANY)\s+ORDER/i.test(n))) return false;
    if (notes.some((n) => /\bTHAT ORDER\b/i.test(n))) return true;
    const q = question.question || '';
    if (isRankingQuestion(q)) return true;
    if (/\b(respectively|order|rank|arrange|sequence|before and after|first|then|followed)\b/i.test(q)) return true;
    return parts.some((p) => PART_NUMBER_RE.test(p) || /^[A-Za-z][A-Za-z .'’-]{0,30}?\s*[=:]/.test(p));
  }

  // The items of a comma/"and" list key ("LEAD, ALUMINUM, WATER", "MAGNESIUM
  // AND IRON"), split outside brackets. Null when there aren't two.
  function listItems(key) {
    const items = [];
    let depth = 0, cur = '';
    const s = String(key);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const sep = s.slice(i).match(/^(?:\s*,\s*(?:AND\s+)?|\s+AND\s+)/i);
        // "40,000" is one number, not two items
        const thousands = sep && sep[0] === ',' && /\d/.test(s[i - 1] || '') && /^\d{3}(?!\d)/.test(s.slice(i + 1));
        if (sep && !thousands) { items.push(cur); cur = ''; i += sep[0].length - 1; continue; }
      }
      cur += ch;
    }
    items.push(cur);
    const out = items.map((t) => t.trim()).filter((t) => normalize(t));
    return out.length >= 2 ? out : null;
  }

  // Does a list key's question want its items in order: ranking wording,
  // "respectively", a matrix written in rows, an ordered pair or a point's
  // coordinates? Stricter than partsAreOrdered: "the first battery" or "first
  // generation fuel cells" in a stem doesn't make a list ordered.
  function listIsOrdered(question) {
    const q = question.question || '';
    // the packet's own order note, kept in the accept list, settles it
    const notes = (question.answer && question.answer.notes) || [];
    if (notes.some((n) => /\b(EITHER|ANY)\s+ORDER/i.test(n))) return false;
    if (notes.some((n) => /\b(?:THAT|THIS)\s+ORDER\b/i.test(n))) return true;
    return isRankingQuestion(q) || /\brespectively\b/i.test(q)
      || (/\bin (?:that|this) order\b/i.test(q) && !/\bnot necessarily in (?:that|this) order\b/i.test(q))
      || /\bin rows\b|\bwhat matrix\b|\bordered (?:pair|triple)\b|\b(?:cartesian|polar|rectangular) coordinates\b/i.test(q)
      || /\bcoordinates (?:of|for) (?:this|that|the) point\b/i.test(q);
  }

  // Chemical formulas or element symbols as the bank writes them: real
  // symbols, case-sensitive ("Fe", "CO2", "Na^+", "SO4^(2-)"). At least one
  // item needs a lowercase letter, a count or a charge unless all are one or
  // two letters ("C, N, O", "CO AND H"), so "NO AND ION" never passes for them.
  const ELEMENT_SYMBOL = '(?:He|Li|Be|Ne|Na|Mg|Al|Si|Cl|Ar|Ca|Sc|Ti|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn|Fr|Ra|Ac|Th|Pa|Np|Pu|Am|Cm|Bk|Cf|Es|Fm|Md|No|Lr|H|B|C|N|O|F|P|S|K|V|Y|I|W|U)';
  const FORMULA_ITEM_RE = new RegExp('^(?:' + ELEMENT_SYMBOL + '\\d*|\\(|\\)\\d*)+(?:\\^(?:\\(\\d*[+-]\\)|\\d*[+-]))?$');
  function areFormulas(items) {
    const ts = items.map((x) => x.replace(/\s+/g, ''));
    return ts.every((t) => FORMULA_ITEM_RE.test(t))
      && (ts.every((t) => t.length <= 2) || ts.some((t) => /[a-z\d^]/.test(t)));
  }

  // A list key matched item by item: "CO2 and nitrogen" or "co2 n" for
  // "CARBON DIOXIDE AND MOLECULAR NITROGEN". An accept with the key's item
  // count lends its items to the key items in their places when it's written
  // all in formulas ("CO2 AND N2") or renames just one item ("CARBON DIOXIDE
  // AND NITROGEN"), so names, formulas and alternates mix in any answer. A
  // second answer in words ("ALUMINUM AND SILICON") never mixes with the key.
  function listSpec(question) {
    const ans = question.answer;
    const items = listItems(ans.text);
    if (!items) return null;
    const alts = items.map(partVariants);
    for (const acc of ans.accept || []) {
      const ai = listItems(acc);
      if (!ai || ai.length !== items.length) continue;
      const differs = ai.map((x, i) => !normEqual(x, items[i]));
      if (areFormulas(ai) || differs.filter(Boolean).length === 1) {
        ai.forEach((x, i) => { if (differs[i]) alts[i].push(x); });
      }
    }
    // (a key that numbers its items answers them in turn: "1) Semidiurnal, 2) Diurnal, 3) Mixed")
    const numbered = items.every((x, i) => new RegExp('^\\s*\\(?' + (i + 1) + '\\s*[).:]').test(x));
    return { n: items.length, alts, floating: [], ordered: numbered || listIsOrdered(question), noSlash: true };
  }

  // Cutting a typed answer into pieces, one per part. First by the
  // separators a student would use (";", ",", "and", "then", ...):
  // separatorCuts. Then, for "first quarter full moon" with no separator at
  // all, any cut of the words into consecutive runs (a connecting
  // "and"/"then"/"or" at a cut is dropped): bestWordCut. Those cuts are
  // searched, not listed one by one: 24 words make hundreds of thousands of
  // cuts, and listing them froze the page for seconds to minutes on a long
  // answer to a five- or six-part key (and, in Multiplayer, froze the whole
  // room, since whoever runs the game grades everyone's answers).
  function separatorCuts(raw, n, noSlash) {
    const seps = [/\s*(?:;|\s\|\s)\s*/, /\s*(?:[;,]|\s\|\s)\s*/,
      noSlash ? /\s*(?:[;,&]|\s\|\s|\band\b|\bthen\b)\s*/i : /\s*(?:[;,&/]|\s\|\s|\band\b|\bthen\b)\s*/i];
    const seen = new Set();
    const out = [];
    for (const re of seps) {
      const segs = raw.split(re).map((s) => s.trim().replace(/^(?:and|then)\s+/i, '')).filter(Boolean);
      const key = segs.join('\u0000');
      if (segs.length === n && !seen.has(key)) { seen.add(key); out.push(segs); }
    }
    return out;
  }
  // The typed words, not normalize()d ones, so a sign or decimal point
  // survives (a lone "−" before a number is kept as part of the next word).
  function typedWords(raw) {
    return raw.replace(/(^|[\s,;([])([-\u2212\u2013\u2010])\s+(?=\d)/g, '$1$2')
      .split(/[\s;,|]+/).filter((w) => normalize(w));
  }
  const MAX_CUT_WORDS = 24;
  // A ceiling on the search's steps, so no answer can take long to grade.
  // Real answers use a few thousand at most.
  const WORD_CUT_STEPS = 200000;
  const JOIN_WORDS = new Set(['AND', 'THEN', 'OR']);
  function bitCount(x) { let n = 0; for (; x; x &= x - 1) n++; return n; }
  // The best way to cut `words` into `pieces` consecutive runs, each matched
  // to a different one of `parts` parts: rankOf(runText, part) is 0 (no
  // match) to 3 (exact). In order, run i goes to part i; otherwise any part
  // may take any run. Returns the best cut's weakest rank, 0 when none works.
  // It's a dynamic program over (words used, parts used) that only visits
  // states some cut can reach, and each run's match is worked out once.
  function bestWordCut(words, pieces, parts, ordered, rankOf) {
    const W = words.length;
    if (W < pieces || W > MAX_CUT_WORDS || (!ordered && parts > 30)) return 0;
    const join = words.map((w) => JOIN_WORDS.has(normalize(w)));
    const runText = (i, j) => {
      while (i < j && join[i]) i++;
      while (j > i && join[j - 1]) j--;
      return i < j ? words.slice(i, j).join(' ') : null;
    };
    // at[i]: parts used (a count in order, else a bit set) -> best weakest rank
    const at = Array.from({ length: W + 1 }, () => new Map());
    at[0].set(0, 3);
    let steps = WORD_CUT_STEPS;
    for (let i = 0; i < W; i++) {
      for (const [used, v] of at[i]) {
        const n = ordered ? used : bitCount(used);
        if (n === pieces) continue;
        const last = W - (pieces - n - 1);
        for (let j = i + 1; j <= last; j++) {
          const text = runText(i, j);
          if (text === null) continue;
          for (let k = ordered ? n : 0; k < (ordered ? Math.min(n + 1, parts) : parts); k++) {
            if (!ordered && (used & (1 << k))) continue;
            if (--steps < 0) return 0;
            const r = rankOf(text, k);
            if (!r) continue;
            const next = ordered ? n + 1 : used | (1 << k);
            const nv = Math.min(v, r);
            if ((at[j].get(next) || 0) < nv) at[j].set(next, nv);
          }
        }
      }
    }
    let best = 0;
    for (const [used, v] of at[W]) if ((ordered ? used : bitCount(used)) === pieces) best = Math.max(best, v);
    return best;
  }
  // Gives each of `count` pieces a different one of `parts` parts (piece i
  // to part i, in order): the best assignment's weakest rank, 0 if none.
  // rankAt(piece, part) is 0 to 3.
  function assignPieces(count, parts, ordered, rankAt) {
    if (ordered) {
      if (count !== parts) return 0;
      let weakest = 3;
      for (let i = 0; i < count && weakest; i++) weakest = Math.min(weakest, rankAt(i, i));
      return weakest;
    }
    if (count > parts || parts > 30) return 0;
    let states = new Map([[0, 3]]);
    for (let i = 0; i < count && states.size; i++) {
      const next = new Map();
      for (const [used, v] of states) {
        for (let k = 0; k < parts; k++) {
          if (used & (1 << k)) continue;
          const r = rankAt(i, k);
          if (!r) continue;
          const key = used | (1 << k);
          const nv = Math.min(v, r);
          if ((next.get(key) || 0) < nv) next.set(key, nv);
        }
      }
      states = next;
    }
    let best = 0;
    for (const v of states.values()) best = Math.max(best, v);
    return best;
  }

  // Builds the per-part alternate lists for a multi-part question, and splits
  // the accept list into whole answers vs lone per-part fragments.
  function multiPartSpec(question) {
    const ans = question.answer;
    const parts = answerParts(ans.text);
    if (!parts) return null;
    const n = parts.length;
    const alts = parts.map(partVariants);
    const wholeAccepts = [];
    const fragments = [];
    const notes = [...(ans.notes || [])];
    for (const acc of ans.accept || []) {
      if (/\bORDER\b/i.test(acc) && !answerParts(acc)) { notes.push(acc); continue; }
      const accParts = answerParts(acc);
      if (accParts && accParts.length === n) {
        accParts.forEach((p, i) => alts[i].push(...partVariants(p)));
        wholeAccepts.push(acc);
      } else if (isPartFragment(acc)) {
        fragments.push(acc);
      } else {
        wholeAccepts.push(acc);
      }
    }
    let ordered = partsAreOrdered(question, parts, notes);
    // Fragments that are just the main parts again ("OXYGEN", "COPPER" for
    // "COPPER; OXYGEN") are the packet's way of saying "either order".
    const isPermutation = fragments.length === n
      && fragments.every((f) => alts.some((a) => segMatch(f, a) === 'exact'));
    let floating = [];
    if (isPermutation) {
      ordered = false;
    } else if (fragments.length === n) {
      // one alternate per part, in part order ("CO2", "H2O")
      fragments.forEach((f, i) => alts[i].push(...partVariants(f)));
    } else {
      floating = fragments;
    }
    return { n, alts, floating, ordered, wholeAccepts, notes };
  }

  // How well a typed piece matches part k of a multi-part spec, 0 to 3
  // (see MATCH_RANK), worked out once per piece. A floating fragment can
  // fill in for any one part, but never for a part whose own text it doesn't
  // match when it IS another part's answer - so "copper; copper" can't pass
  // "ZINC; COPPER" through an ACCEPT of "COPPER".
  const RANK_NAME = [null, 'typo', 'fuzzy', 'exact'];
  function partRanker(spec) {
    const { alts, floating } = spec;
    const usable = new Map();
    const usableFor = (k) => {
      if (!usable.has(k)) usable.set(k, floating.filter((f) => !alts.some((b, j) => j !== k && segMatch(f, b) === 'exact')));
      return usable.get(k);
    };
    const memo = new Map();
    return (seg, k, wordCut) => {
      const key = (wordCut ? 'w' : 's') + k + '\u0000' + seg;
      let r = memo.get(key);
      if (r === undefined) {
        let m = segMatch(seg, alts[k], wordCut);
        if (m !== 'exact' && floating.length) m = betterMatch(segMatch(seg, usableFor(k)), m);
        r = MATCH_RANK[m] || 0;
        memo.set(key, r);
      }
      return r;
    };
  }

  // "Name any N of these" keys: "ANY TWO OF: EARTH, TITAN, PLUTO",
  // "(ACCEPT 3) DRY, STATIC, ...", "{ANY 2} A; B; C", "Accept any four of the
  // following five: ...", "Pluto, Ceres, Eris (any 3)". Returns { n, alts }
  // when the key lists more items than it asks for, else null.
  const NUMBER_WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };
  function anyOfSpec(key) {
    if (!key) return null;
    const N = '(\\d|ONE|TWO|THREE|FOUR|FIVE|SIX)';
    const forms = [
      new RegExp('^\\s*(?:ACCEPT\\s+)?ANY\\s+' + N + '(?:\\s+OF)?(?:\\s+THE\\s+FOLLOWING(?:\\s+\\w+)?)?\\s*:?\\s*(.+)$', 'i'),
      new RegExp('^\\s*[({]\\s*(?:ACCEPT|ANY)\\s+' + N + '\\s*[)}]\\s*(.+)$', 'i'),
      new RegExp('^\\s*ACCEPT\\s+' + N + '\\s+OF\\s+THE\\s+FOLLOWING(?:\\s+\\w+)?\\s*:?\\s*(.+)$', 'i'),
    ];
    let n = null, list = null;
    for (const re of forms) {
      const m = key.match(re);
      if (m) { n = m[1]; list = m[2]; break; }
    }
    if (!list) {
      const m = key.match(new RegExp('^(.+?)\\s*\\(\\s*ANY\\s+' + N + '\\s*\\)\\s*$', 'i'));
      if (m) { list = m[1]; n = m[2]; }
    }
    if (!list) return null;
    n = /\d/.test(n) ? parseInt(n, 10) : NUMBER_WORDS[n.toUpperCase()];
    const items = list.split(/\s*(?:[;,]|\bAND\b|\bOR\b)\s*(?![^()]*\))/i)
      .map((s) => s.trim().replace(/\.$/, '')).filter((s) => normalize(s));
    if (!n || items.length <= n) return null;
    // a parenthetical in a listed item is another name for it ("HEXAHEDRON (CUBE)")
    return { n, alts: items.map((it) => [...partVariants(it), ...[...it.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].trim())]) };
  }
  // Every typed item names a different listed one, and there are at least n.
  function checkAnyOf(raw, spec) {
    const parts = spec.alts.length;
    const memo = new Map();
    const ok = (seg, k, wordCut) => {
      const key = (wordCut ? 'w' : 's') + k + '\u0000' + seg;
      if (!memo.has(key)) {
        const m = segMatch(seg, spec.alts[k], wordCut);
        memo.set(key, m === 'exact' || m === 'fuzzy' ? 1 : 0);
      }
      return memo.get(key);
    };
    const tries = [raw.split(/\s*(?:[;,]|\band\b|\bor\b|&)\s*/i).map((s) => s.trim()).filter(Boolean)]
      .concat(separatorCuts(raw, spec.n, true));
    for (const segs of tries) {
      if (segs.length < spec.n || segs.length > parts) continue;
      if (assignPieces(segs.length, parts, false, (i, k) => ok(segs[i], k, false))) return true;
    }
    return bestWordCut(typedWords(raw), spec.n, parts, false, (text, k) => ok(text, k, true)) > 0;
  }

  // A multi-part (or list) key, part by part: the best cut's weakest part
  // match ('exact' | 'fuzzy' | 'typo') or null.
  function checkMultiPart(raw, spec) {
    const rank = partRanker(spec);
    let best = 0;
    for (const segs of separatorCuts(raw, spec.n, spec.noSlash)) {
      best = Math.max(best, assignPieces(segs.length, spec.n, spec.ordered, (i, k) => rank(segs[i], k, false)));
      if (best === 3) return 'exact';
    }
    best = Math.max(best, bestWordCut(typedWords(raw), spec.n, spec.n, spec.ordered, (text, k) => rank(text, k, true)));
    return RANK_NAME[best];
  }

  // A key and the alternates written inside it. Splits on ACCEPT and on a
  // top-level " OR " (not one inside parentheses), and drops a trailing
  // parenthetical note that starts after a space and holds a word - never
  // math like "2x*e^(x^2)" or "(0, 3, 0)".
  function keyVariants(text) {
    const out = [text];
    // "X, DO NOT ACCEPT: Y" names a wrong answer, not an alternate
    if (/\bNOT\s+ACCEPT/i.test(text)) return out;
    const pieces = [];
    let depth = 0;
    let start = 0;
    const re = /\s*,?\s*\bACCEPT\b:?\s*|\s+OR\s+|[()[\]]/gi;
    let m;
    while ((m = re.exec(text))) {
      const tok = m[0];
      if (tok === '(' || tok === '[') { depth++; continue; }
      if (tok === ')' || tok === ']') { depth = Math.max(0, depth - 1); continue; }
      if (depth) continue;
      pieces.push(text.slice(start, m.index));
      start = m.index + tok.length;
    }
    if (pieces.length) {
      pieces.push(text.slice(start));
      // An "OR" between two equations, inequalities or roots ("x = 0 or
      // x = 9", "MUST GIVE BOTH ANSWERS") joins halves of one answer, not
      // alternates. Only split when a piece is words.
      const splitsOk = !/\bBOTH\b|[=<>≤≥]/i.test(text) && pieces.some((p) => /[A-Za-z]{2,}/.test(p));
      if (splitsOk) out.push(...pieces);
    }
    // "(RICHARD) FEYNMAN", "(NUCLEAR) FUSION": a word in brackets at the
    // start is one the answer can do without (never in math: "(pi)r^2")
    for (const v of out.slice()) {
      const lead = v.match(/^\(\s*([A-Za-z][A-Za-z '’.\-]*?)\s*\)\s*([A-Za-z].*)$/);
      if (lead && !/[\d^=*+/<>]/.test(lead[2])) out.push(lead[2], lead[1] + ' ' + lead[2]);
    }
    for (const v of out.slice()) {
      const stripped = v.replace(/\s+\([^()]*[A-Za-z]{2,}[^()]*\)\s*$/, '');
      if (stripped !== v) out.push(stripped);
    }
    // "SN2 ONLY", "TYPE VI ONLY": the answer with or without the "only"
    for (const v of out.slice()) {
      const bare = v.replace(/(\S)\s+ONLY\s*$/i, '$1');
      if (bare !== v) out.push(bare);
    }
    return [...new Set(out.map((v) => v.trim()).filter((v) => normalize(v)))];
  }

  // A law, effect, experiment, relation, ... is answered without that last
  // word when the words before it already say which one is meant:
  // "Michelson-Morley" for "MICHELSON-MORLEY EXPERIMENT", "Doppler" for
  // "DOPPLER EFFECT", "Hooke's" for "HOOKE'S LAW", "de Broglie" for "DE
  // BROGLIE RELATION", "photoelectric" for "PHOTOELECTRIC EFFECT", "ideal
  // gas" for "IDEAL GAS LAW". They do when they hold a name (a word in
  // KIND_NAMES, or any possessive), are two words or more, or are one word
  // that is a describing word or a long one ("PHOTOELECTRIC", "GREENHOUSE",
  // "PYTHAGOREAN"). They don't when what's left is a short everyday noun or a
  // substance, which would be a different answer by itself: "rock" isn't
  // "ROCK CYCLE", nor "skin" "SKIN EFFECT", "carbon" "CARBON CYCLE" or
  // "first" "FIRST LAW". Returns the key without its last word, or null.
  // What's left must be given in full ("PAULI EXCLUSION", "QUANTUM HALL").
  // KIND_NAMES is every name before one of these words in the bank's keys;
  // a new set's names go here (a possessive needs no entry).
  const KIND_WORD_RE = /^(.*\S)[\s-]+(?:EXPERIMENT|EFFECT|LAW|PRINCIPLE|THEOREM|EQUATION|RULE|PROCESS|CYCLE|RELATION|RELATIONSHIP|HYPOTHESIS|PARADOX|CONJECTURE|POSTULATE|INEQUALITY|APPROXIMATION|PHENOMENON|LIMIT)S?\s*$/i;
  // One word left that names a thing of its own, however long.
  const KIND_NOT_ALONE = new Set(['CARBON', 'NITROGEN', 'PHOSPHORUS', 'SULFUR', 'OXYGEN', 'HYDROGEN', 'WATER', 'FIRST', 'SECOND', 'THIRD', 'ZEROTH',
    'CHEMICAL', 'NUCLEAR', 'PHYSICAL', 'NATURAL', 'GENERAL', 'SPECIAL', 'NORMAL', 'CENTRAL', 'INTERNAL', 'EXTERNAL', 'ORIGINAL', 'CRITICAL', 'ELECTRIC', 'MAGNETIC']);
  const KIND_NAMES = new Set(`
    ABEL ABNEY AHARONOV ALBRECHT ALFVEN ALLEE AMAGAT AMONTON AMPERE ANDERSON APOLLONIUS ARCHIMEDES ARHENNIUS
    ARNOLD ARRHENIUS AUFBAU AUGER AVERY AVOGADRO BABINET BACHARACH BAHCALL BALDWIN BALLOT BALMER BANACH BAPPU
    BARKHAUSEN BASSHAM BAYER BAYES BENSON BERGERON BERGIUS BERNOUILLI BERNOULLI BESSEMER BETHE BETZ BIEFELD BIOT
    BLANDFORD BLAZHKO BLOCH BODE BOHM BOHR BOLTZMAN BOLTZMANN BOREL BORN BORSUK BOSCH BOSCHE BOSE BOSH BOYLE
    BOYLES BRAGG BRAYTON BREDT BREWSTER BRIGGS BRILLOUIN BROGLIE BUCKINGHAM BUTLER BUYS CAHN CALVIN CANTOR
    CARNOT CAROTHERS CARTY CASIMIR CASTNER CAUCHY CAYLEY CEVA CHAIKOFF CHARGAFF CHARLES CHASE CHASLES CHATELIER
    CHERENKOV CHINESE CLAPEYRON CLASIUS CLAUS CLAUSIUS CLAYPERON COLEMAN COMPTON CONDON COOLEO CORI CORIOLIS
    COULOMB COWAN CRAM CRAMER CURIE CURTIN CUSHING DALEMBERT DALTON DARBOUX DARCY DAVIES DAVIS DAVISSON DEBYE
    DEEMTER DEMORGAN DENNARD DESCARTES DEWAR DIELS DIETERICI DILWORTH DIRAC DOLAN DOLE DOOB DOPPLER DOW DRAGO
    DRAKE DUHEM DUHRING DULONG DZHANIBEKOV EARNSHAW ECKART ECKMAN EDISON EINSTEIN EKMAN ELITZUR EMDEN ENGELMANN
    ERDOS EULER EVANS EXNER EYRING FAJANS FARADAY FERMAT FERMI FICK FIESER FINDEISEN FISCHER FISHER FLORY
    FORCHHAMMER FOURIER FRANCIS FRANCK FRANK FRASCH FRESNEL FRIEDMANN FUBINI FUJISHIMA FUJITA FUJIWHARA GAUSE
    GAUSS GAY GEIGER GERLACH GERMER GIBBS GLASSER GLEN GLOGER GOLDMAN GOOS GOUY GRAHAM GRIFFITH GRUNDY
    GULLSTRAND GUTENBERG HAASE HABER HAFELE HAGEN HALDANE HALL HAMILTON HAMILTONIAN HAMMETT HANER HARDY HARKINS
    HASSE HASSELBACH HASSELBALCH HAWKING HEBB HEEZEN HEINE HEISENBERG HELMHOLTZ HENDERSON HENRY HERAULT HEROULT
    HERSHEY HERTZ HESS HESSE HIGGS HILL HIRE HODGKIN HOFF HOFFMAN HOFFMANN HOMESTAKE HONDA HOOKE HOPKINSON
    HOUWINK HUBBLE HUCKEL HUCKLE HUGGINS HUND HUYGENS INGOLD IVES JAHN JEANS JEFIMENKO JORDAN JOSEPHSON JOULE
    JURIN KARAMAN KARRICK KASHA KATZ KEATING KELLNER KELVIN KEPLER KERR KIRCHHOFF KIRCHOFF KLEIN KLINKENBERG
    KOBAYASHI KOHLRAUSCH KONDO KOPP KOPPEN KREBS KROLL KURATOWSKI LAGRANGE LAMBERT LAMPA LANDAUER LANDOW
    LANGMUIR LAPLACE LAPORTE LECHATELIER LEIBNIZ LEIDENFROST LENZ LEWIS LHOPITAL LIOUVILLE LORENTZ LORENZ LOTKA
    LUSSAC LYDERSON LYELL MACLEOD MADDEN MADELUNG MAGNUS MALUS MANDULA MARANGONI MARCET MARKONIKOV MARKOV
    MARKOVNIKOV MARSDEN MAXWELL MAYER MCLAUGHLIN MECKEL MEISSNER MEITNER MENELAUS MENTEN MERMIN MESELSON METONIC
    MICHAELIS MICHELSON MIHAILESCU MILANKOVITCH MILLER MILLIKAN MINGOS MINKOWSKI MOIVRE MOND MONGE MOORE MORGAN
    MORLEY MOSELEY MOSER MOSLEY MOSSBAUER MPEMBA NAPOLEON NASH NAVIER NEEL NERNST NEWTON NICOMACHU NISHINA
    NOETHER NORTON NOVIKOV NYE NYQUIST OBERTH OCHSENFELD OCHSENFIELD ODDO OERSTED OHM OKEEFE ONNES OSTWALD OTTO
    OVERHAUSER PADDACK PAPPUS PARETO PASCAL PASCHEN PAULI PELL PELTIER PENROSE PETCH PETIT PLANCHEREL PLANCK
    POCKELS POISEUILLE POISSON POLANYI POLYA POMERANCHUK POYNTING PRELOG PRIMAKOFF PROUST PTOLEMY PYTHAGOREAN
    RADZIEVSKII RALL RANKINE RAOULT RASHBA RAYLEIGH REBKA REINES RENNER RICHTER RIEMANN RIESZ ROBERTSON ROLLE
    ROSSI ROSSITER ROULT ROWLAND RUCHARDT RUFFINI RUTHERFORD RYDBERG SABATIER SACHS SAGNAC SAHA SAROS SAVART
    SAYTZEFF SCHMIDT SCHRODINGER SCHUR SCHWARTZCHILD SCHWINGER SEABORG SEEBECK SELLMEIER SERRES SEWALL SHANNON
    SIMPSON SITTER SLATER SNELL SOKOLOV SOTHIC SPRAGUE STAHL STARK STARLING STEFAN STEWART STILWELL STIRLING
    STODOLA STOKES STURM SUNYAEV SYLOW SZEKERES TAFEL TAYLOR TELLER TERNOV TERRELL THEVENIN THIRRING THOMPSON
    THOMSON THORPE TITIUS TOLMAN TORICELLI TORRICELLI TROPSCH TROUTON TSIOLKOVSKY TULLEY TWOMEY TYCHONOFF TYNDAL
    TYNDALL ULAM UNRUH URCA UREY VAIDMAN VAUCOULEUR VOLMER VOLTA VOLTERRA WAALS WADE WAGNER WAHLUND WALTHER
    WARBURG WEGENER WEINBERG WEIZSACKER WERKMAN WIEN WIGNER WILSON WOLFE WOLFF WOODWARD WRIGHT YANG YARKOVSKY
    YORP ZAITSEV ZANSTRA ZAREMBAS ZECKENDORF ZEEMAN ZELDOVICH ZENO ZNAJEK ZSIGMONDY ZWALLY
  `.split(/\s+/).filter(Boolean));
  // Possessives that aren't a person's ("THE OBSERVER'S EFFECT").
  const NOT_NAMES = new Set(['OBSERVER', 'LENSMAKER', 'EARTH', 'MOON', 'SUN']);
  function withoutKindWord(key) {
    const m = String(key).match(KIND_WORD_RE);
    if (!m || /\d/.test(m[1])) return null;
    const name = m[1].replace(/^\s*THE\s+/i, '');
    const words = tokenize(name);
    const named = words.some((w) => {
      const bare = w.replace(/'S?$/, '').replace(/'/g, '');
      if (KIND_NAMES.has(bare) || KIND_NAMES.has(bare.replace(/S$/, ''))) return true;
      return /'S?$/.test(w) && bare.length >= 2 && !NOT_NAMES.has(bare);
    });
    if (named) return name;
    if (words.some((w) => NOT_NAMES.has(w.replace(/'S?$/, '')))) return null;
    if (words.length >= 2) return words.every((w) => KIND_NOT_ALONE.has(w)) ? null : name;
    const w = words[0] || '';
    if (KIND_NOT_ALONE.has(w)) return null;
    // a describing word ("PHOTOELECTRIC", "INDUCTIVE", "VIRIAL"), or a long one
    return w.length >= 9 || (w.length >= 6 && /(?:IC|AL|AN|AR|ARY|IVE|OUS|OID)$/.test(w)) ? name : null;
  }

  // "The other one", "the last one", "the remaining one": what a player says
  // for the one thing left when every other one has been named. Returns the
  // answer around the phrase when it's there exactly once.
  const OTHER_ONE_RE = /\b(?:the\s+)?(?:(?:other|last|remaining|final|left\s?over)\s+(?:one|1)|other|one\s+left)\b/gi;
  function otherOneSlot(raw) {
    const found = [...raw.matchAll(OTHER_ONE_RE)];
    if (found.length !== 1) return null;
    const m = found[0];
    const fill = (text) => `${raw.slice(0, m.index)} ${text} ${raw.slice(m.index + m[0].length)}`.trim();
    fill.before = raw.slice(0, m.index);
    fill.after = raw.slice(m.index + m[0].length);
    return fill;
  }
  // Only where it can't be a guess: the question is an ordering of things it
  // lists itself, so the key holds every one of them and "the other one" is
  // whichever the rest of the answer leaves. Each part of the key is tried
  // in the phrase's place, and the usual check decides (a part named twice,
  // or in the wrong place, still fails).
  function partsListedInQuestion(spec, questionText) {
    const nq = ` ${normalize(questionText)} `;
    return spec.alts.every((alts) => alts.some((a) => { const na = normalize(a); return na && nq.includes(` ${na} `); }));
  }
  function checkWithOtherOne(raw, spec, question) {
    const fill = otherOneSlot(raw);
    if (!fill || spec.n < 2 || !isRankingQuestion(question.question) || !partsListedInQuestion(spec, question.question)) return null;
    let best = null;
    for (let k = 0; k < spec.n && best !== 'exact'; k++) best = betterMatch(best, checkMultiPart(fill(spec.alts[k][0]), spec));
    return best;
  }
  // The same for a ranking of numbered items ("3, 1, the other one", or the
  // item names): the digits of the full ordering, or null.
  // What's said before and after the phrase is read by itself, as numbers
  // ("1 3", "13") or names with or without commas ("ceres pluto"), and the
  // phrase stands where it was said for the one item not named.
  function rankedWithOtherOne(raw, itemCount, itemTexts) {
    const slot = otherOneSlot(raw);
    if (!slot) return null;
    const side = (text) => {
      const t = text.replace(/\b(?:and\s+then|then|and)\b/gi, ',').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/\s*[,;][\s,;]*/g, ', ');
      if (!t) return [];
      const byNumber = canonicalizeRanked(t, itemCount, true);
      if (byNumber) return byNumber.split('').map(Number);
      return itemTexts ? resolveTermsToNumbers(t, itemTexts) : null;
    };
    const before = side(slot.before);
    const after = side(slot.after);
    if (!before || !after) return null;
    const named = [...before, ...after];
    if (named.length !== itemCount - 1 || new Set(named).size !== named.length) return null;
    const left = range(1, itemCount).find((d) => !named.includes(d));
    return [...before, left, ...after].join('');
  }

  /**
   * Grade a free-typed answer against a question.
   * Returns { correct, matched: 'main'|'accept'|'lenient'|'fuzzy'|null, rejected, close? }
   * `close` marks a wrong answer that's a near miss (a typo, or the key plus
   * extra words); the pages ask the player to override it if they meant it.
   */
  // A choice with its bracketed reading guide removed: "[nice]", "[VAN der
  // VALLS]", "(“one hex-why-ne”)", "(read as …)", "(pronounced …)".
  function choiceWithoutGuide(text) {
    if (!text) return null;
    const out = String(text)
      .replace(/\s*\[[^\]]*\]/g, '')
      .replace(/\s*\((?:[“"][^)]*|read[^)]*|pron[^)]*)\)/gi, '')
      .replace(/\s+/g, ' ').trim();
    return out || null;
  }

  // "Only" or "just" around an answer adds nothing to it: "1 only", "gap
  // junctions only", "just 2", "only the mantle".
  function withoutOnly(raw) {
    const out = String(raw).trim().replace(/^(?:only|just)\s+(?=\S)/i, '').replace(/(?<=\S)[\s,]+(?:only|alone)$/i, '').trim();
    return out || String(raw).trim();
  }

  // The Mohorovičić discontinuity goes by "Moho" as often as by its name, so
  // a key that is any one of its forms takes them all.
  const MOHO_RE = /^(?:THE\s+)?MOHO(?:ROVI\S{3})?(?:\s+DISCONTINUITY)?$/i;
  const MOHO_FORMS = ['MOHO', 'MOHO DISCONTINUITY', 'MOHOROVICIC', 'MOHOROVICIC DISCONTINUITY'];

  const AVOGADRO_RE = /^(?:THE )?AVOGADRO(?:'?S)? (?:NUMBER|CONSTANT)$/;
  const AVOGADRO_FORMS = ["AVOGADRO'S NUMBER", "AVOGADRO'S CONSTANT"];

  // The kind of thing a question asks for, in its own words: "particle" in
  // "What type of nuclear particle …", "group" in "What functional group
  // …", "constant" in "… by what constant?". Saying that word or leaving it
  // out changes nothing: "alpha particle" for ALPHA, "phosphate" for
  // PHOSPHATE GROUP. Returns the words (with their plurals), from the few
  // words after each what / which / name the / identify the / give the.
  const ASK_SKIP = new Set(['IS', 'ARE', 'WAS', 'WERE', 'THE', 'A', 'AN', 'OF', 'NAME', 'TERM', 'TYPE', 'TYPES', 'KIND', 'KINDS', 'CLASS', 'SORT',
    'GENERAL', 'SPECIFIC', 'OTHER', 'SINGLE', 'COMMON', 'FOLLOWING', 'CORRECT', 'PROPER', 'SCIENTIFIC', 'EXACT']);
  const ASK_STOP = new Set(['IS', 'ARE', 'WAS', 'WERE', 'DOES', 'DO', 'DID', 'CAN', 'COULD', 'WILL', 'WOULD', 'SHOULD', 'MUST', 'HAS', 'HAVE', 'HAD', 'MAY',
    'MIGHT', 'THAT', 'WHICH', 'WHO', 'WHOSE', 'OF', 'IN', 'ON', 'FOR', 'TO', 'FROM', 'WITH', 'BY', 'AT', 'AS', 'AND', 'OR', 'IF', 'WHEN', 'THIS', 'THESE',
    'THE', 'A', 'AN', 'NOT', 'BEST', 'MOST', 'MORE', 'LESS', 'ALSO', 'BE', 'IT', 'ITS', 'THEIR', 'USED', 'CALLED', 'KNOWN', 'FOUND']);
  function askedKindWords(questionText) {
    const out = new Set();
    const re = /\b(?:what|which|name the|identify the|give the|state the)\b([^,.;:?!()]*)/gi;
    let m;
    while ((m = re.exec(questionText || ''))) {
      const words = normalize(m[1]).split(' ').filter(Boolean);
      let i = 0;
      while (i < words.length && ASK_SKIP.has(words[i])) i++;
      for (let n = 0; i < words.length && n < 3 && !ASK_STOP.has(words[i]); i++, n++) {
        const w = words[i];
        if (w.length < 3 || /\d/.test(w)) break;
        out.add(w); out.add(w + 'S'); if (w.endsWith('S')) out.add(w.slice(0, -1));
      }
    }
    return out;
  }
  // The typed answer and the key are the same once those words are left out
  // of both (and something is left of each).
  // A chemical class names what the compound is: "osmium" isn't "osmium
  // oxide", whatever the question asks by.
  const CHEMICAL_CLASS_RE = /^(?:(?:MON|DI|TRI|TETR|PENT|HEX|PER|SUPER)?OXIDES?|HYDROXIDES?|PEROXIDES?|(?:HYDRO)?(?:CHLOR|FLUOR|BROM|IOD|SULF|NITR|PHOSPH|CARB|HYDR|CYAN|AZ)IDES?|(?:SULF|NITR|CHLOR|PHOSPH|CARBON|CHROM|MANGAN|PERMANGAN|BICARBON|ACET|SILIC|BOR|OXAL|CYAN)(?:ATE|ITE)S?|ACIDS?|IONS?|SALTS?|ESTERS?|ALCOHOLS?|ALDEHYDES?|KETONES?|ALK[AEY]NES?|ETHERS?|AMINES?|AMIDES?|POLYMERS?|ISOTOPES?|ALLOYS?|ORES?|MINERALS?)$/;
  function sameWithoutKind(raw, key, kinds) {
    // (never for numbers or expressions, whose labels and signs matter)
    if (!kinds.size || /[\d=<>]/.test(String(raw) + key)) return false;
    if (tokenize(key).some((w) => kinds.has(w) && CHEMICAL_CLASS_RE.test(w))) return false;
    const all = (t) => tokenize(t);
    const rest = (t) => all(t).filter((w) => !kinds.has(w));
    const a = rest(raw), b = rest(key);
    if (!a.length || !b.length || (a.length === all(raw).length && b.length === all(key).length)) return false;
    if (!a.some((w) => /[A-Z]{3,}/.test(w)) || isMathAnswer(raw) || isMathAnswer(key)) return false;
    return a.join(' ') === b.join(' ') || lenientWordMatch(a.join(' '), b.join(' ')) === 'exact';
  }

  // A list key that labels its items with the question's own words, on a
  // question that asks for them in order: "Zinc anode, Manganese dioxide
  // cathode" for "What are the cathode and anode, respectively, …". The
  // order asked for is the question's, whatever order the key was written
  // in, and the labels needn't be typed: "manganese dioxide and zinc".
  // Typed with their labels, the items can come in any order. Returns the
  // two specs for checkMultiPart, or null.
  // Does every item hold a word of the question that no other item holds,
  // beside the rest of its answer?
  function selfLabelled(questionText, items) {
    const qWords = new Set(tokenize(questionText).flatMap((w) => [w, w.replace(/S$/, '')]));
    const toks = items.map((t) => tokenize(t));
    return toks.every((ws, i) => ws.length >= 2 && ws.some((w) => w.length >= 3 && !/\d/.test(w)
      && (qWords.has(w) || qWords.has(w.replace(/S$/, '')))
      && toks.every((o, j) => j === i || !o.includes(w))));
  }
  function labelledListSpecs(question) {
    const items = listItems(question.answer.text);
    // The labels are looked for in the words leading up to "respectively".
    const lead = String(question.question || '').match(/^(.*)\brespectively\b/is);
    if (!items || !lead || items.some((t) => /[\d=<>+\-−–^]/.test(t))) return null;
    const qWords = normalize(lead[1]).split(' ').slice(-12);
    const at = (w) => { const i = qWords.indexOf(w); return i >= 0 ? i : qWords.indexOf(w + 'S'); };
    const parts = [];
    for (const item of items) {
      const words = tokenize(item);
      const labels = words.filter((w) => w.length >= 4 && at(w) >= 0);
      if (labels.length !== 1 || words.length < 2) return null;
      parts.push({ full: item, bare: words.filter((w) => w !== labels[0]).join(' '), label: labels[0], pos: at(labels[0]) });
    }
    if (new Set(parts.map((x) => x.label)).size !== parts.length) return null;
    parts.sort((x, y) => x.pos - y.pos);
    const base = { n: parts.length, floating: [], noSlash: true };
    return [
      { ...base, alts: parts.map((x) => [x.bare, x.full]), ordered: true },
      { ...base, alts: parts.map((x) => [x.full]), ordered: false },
    ];
  }

  // A choice's text with only spacing, dashes and exponent markup evened
  // out: what is left (signs, slashes, stars, brackets, capitals) can be
  // all that tells two choices apart.
  // (with `markup`, "^" and "_" are kept: "Tλmax" isn't "T^(λmax)")
  function mcSymbols(t, markup) {
    const s = String(t == null ? '' : t).normalize('NFC').replace(/[−–‐—]/g, '-').replace(/['’‘]/g, "'");
    return (markup ? s.replace(/([\^_])\(([^()]*)\)/g, '$1$2') : s.replace(/[\^_]\(([^()]*)\)/g, '$1').replace(/[\^_]/g, '')).replace(/\s+/g, '').replace(/\.$/, '');
  }

  function gradeAnswer(question, userInput) {
    const raw = (userInput || '').trim();
    if (!raw) return { correct: false, matched: null, rejected: false, empty: true };

    const ans = question.answer;
    const itemCount = detectItemCount(question.question);
    // For a multi-part answer, lone per-part accepts are not whole answers.
    const multi = question.format === 'MC' ? null : multiPartSpec(question);
    let accepts = multi ? multi.wholeAccepts : (ans.accept || []);
    if (!multi && question.format !== 'MC' && [ans.text, ...accepts].some((k) => MOHO_RE.test(String(k).trim()))) {
      const rejected = (ans.reject || []).map(normalize);
      accepts = [...accepts, ...MOHO_FORMS.filter((f) => !rejected.includes(normalize(f)))];
    }
    // Avogadro's number and Avogadro's constant are one thing.
    if (!multi && question.format !== 'MC' && [ans.text, ...accepts].some((k) => AVOGADRO_RE.test(normalize(k)))) {
      const rejected = (ans.reject || []).map(normalize);
      accepts = [...accepts, ...AVOGADRO_FORMS.filter((f) => !rejected.includes(normalize(f)))];
    }

    // ---- Multiple choice ----
    // Graded strictly: the answer must be exactly the correct letter, the
    // exact text of the correct choice, or both ("W) Proton pump"). Only
    // case, whitespace and punctuation are ignored (via normalize, plus
    // compactEqual so "MgCl2" matches a PDF-spaced "MgCl 2") - no
    // fuzzy/substring/typo matching, and no falling through to the
    // free-text answer-key checks, since with the choices on screen a
    // "close" answer is simply a different choice (or none of them).
    if (question.format === 'MC' && question.choices) {
      const correctLetter = ans.letter;
      const correctText = correctLetter ? question.choices[correctLetter] : null;
      const wrong = { correct: false, matched: null, rejected: false };
      if (!correctLetter) return wrong;
      const right = { correct: true, matched: 'main', rejected: false };

      // just a letter, in brackets or with a mark after it ("Y", "(Y)", "y.",
      // "Y!"), maybe after "choice" / "option" / "answer"
      const lead = raw.replace(/^(?:choice|option|answer|letter)\s*[:\-]?\s*/i, '');
      const letterOnly = lead.match(/^[([{]?\s*([WXYZwxyz])\s*[)\]}]?\s*[.!:]?$/);
      if (letterOnly) return letterOnly[1].toUpperCase() === correctLetter ? right : wrong;

      // The text of a choice. Compared first as normalize() reads it, but
      // when that can't tell two choices apart ("F/√2" and "F √2", "BB" and
      // "Bb", "x = 6" and "x > 6", "σ*2p" and "σ2p") the symbols and then
      // the capitals decide; if they still don't, it is no choice at all.
      const choiceOf = (typed) => {
        const entries = Object.entries(question.choices).filter(([, t]) => t != null && String(t).trim());
        const tiers = [
          (a, b) => normEqual(a, b) || compactEqual(a, b),
          (a, b) => mcSymbols(a).toUpperCase() === mcSymbols(b).toUpperCase(),
          (a, b) => mcSymbols(a, true).toUpperCase() === mcSymbols(b, true).toUpperCase(),
          (a, b) => mcSymbols(a, true) === mcSymbols(b, true),
        ];
        let pool = entries;
        for (const same of tiers) {
          const hits = pool.filter(([, t]) => same(typed, t) || same(typed, choiceWithoutGuide(t) || t));
          if (hits.length <= 1 || new Set(hits.map(([, t]) => mcSymbols(t, true))).size === 1) {
            return hits.length && hits.some(([L]) => L === correctLetter) ? correctLetter : (hits.length ? hits[0][0] : null);
          }
          pool = hits;
        }
        return null;
      };
      const whole = correctText ? choiceOf(raw) : null;
      if (whole) return whole === correctLetter ? right : wrong;

      // "W) text" / "W. text" / "W: text" / "W - text" - the letter AND the
      // text must both be the correct choice's.
      const letterPrefix = lead.match(/^[([]?([WXYZwxyz])\s*[)\].:-]?\s+(.+)$/) || lead.match(/^[([]?([WXYZwxyz])\s*[)\].:-]\s*(.+)$/);
      if (letterPrefix && letterPrefix[1].toUpperCase() === correctLetter
          && correctText && choiceOf(letterPrefix[2]) === correctLetter) {
        return right;
      }
      return wrong;
    }

    // ---- The key or an accept typed character for character ----
    // Checked before the reject list, which normalize() can't always tell
    // apart from the key: "+6" vs a rejected "6", "W+ BOSON" vs "W BOSON".
    // Exponent markup is dropped here too, so "W+ boson" is the key "W^+ BOSON".
    const literal = (t) => String(t).toUpperCase().replace(/[\u2212\u2013\u2010]/g, '-').replace(/[\^_]\(([^()]*)\)/g, '$1')
      .replace(/[\^_]/g, '').replace(/\s+/g, ' ').trim();
    if (literal(raw) === literal(ans.text)) return { correct: true, matched: 'main', rejected: false };
    if (accepts.some((acc) => literal(raw) === literal(acc))) return { correct: true, matched: 'accept', rejected: false };

    // ---- Reject list: an explicit "do not accept" match is always wrong ----
    for (const rej of ans.reject || []) {
      if (normEqual(raw, rej) || compactEqual(raw, rej)) {
        return { correct: false, matched: null, rejected: true };
      }
    }

    // ---- "Name any N of these" keys: any N distinct listed items pass ----
    if (question.format !== 'MC') {
      for (const k of [ans.text, ...(ans.accept || [])]) {
        const spec = anyOfSpec(k);
        if (spec && checkAnyOf(raw, spec)) return { correct: true, matched: k === ans.text ? 'main' : 'accept', rejected: false };
      }
    }

    // ---- "All" said another way: "all" for "ALL OF THEM", "all of them"
    // or "all of the above" for "ALL", with or without numbered items. A
    // count ("all three") must be the count the key or the stem gives. ----
    const typedAll = allPhrase(normalize(raw));
    if (typedAll) {
      const listed = itemCount || statedCount(question.question);
      for (const k of [ans.text, ...accepts].flatMap(multi ? (x) => [x] : keyVariants)) {
        const keyAll = allPhrase(normalize(withoutEndNote(k)));
        if (!keyAll) continue;
        const count = keyAll.n != null ? keyAll.n : listed;
        if (typedAll.n == null || count == null || typedAll.n === count) {
          return { correct: true, matched: k === ans.text ? 'main' : 'accept', rejected: false };
        }
      }
    }

    // ---- List-style answers ("1 and 2", "all", "3 only", "312" ranking,
    // the item names themselves, or "all but <item>") ----
    if (itemCount) {
      const ranking = isRankingQuestion(question.question);
      const canonFn = ranking ? canonicalizeRanked : canonicalizeList;
      let userCanon = canonFn(raw, itemCount, true);
      if (userCanon === null && ranking) {
        // A ranking can be typed with the item names themselves, in order
        // ("SA node, AV node, bundle of His"). Every item must be named once,
        // and the names must stay distinct once normalized ("NO2^-" and
        // "NO2^+" don't), or the order couldn't be told from the names.
        const itemTexts = extractItemTexts(question.question, itemCount);
        const distinct = itemTexts && new Set(itemTexts.map((s) => normalize(s))).size === itemTexts.length;
        const nums = distinct ? resolveTermsToNumbers(raw, itemTexts) : null;
        if (nums && nums.length === itemCount && new Set(nums).size === itemCount) userCanon = nums.join('');
        // ... or with "the other one" for the one item left
        if (userCanon === null) userCanon = rankedWithOtherOne(raw, itemCount, distinct ? itemTexts : null);
      }
      if (userCanon === null && !ranking) {
        // Not a number/ALL/NONE-style answer - a set-selection question (not
        // a ranking one, where order is the point and term-matching doesn't
        // apply) can still be answered with the item names themselves, or
        // "all but <item>".
        const itemTexts = extractItemTexts(question.question, itemCount);
        const allBut = tryAllButCanonical(raw, itemCount, itemTexts);
        if (allBut !== null) {
          userCanon = allBut;
        } else if (itemTexts) {
          // "just 2", "gap junctions only", "only the first one's name"
          const bare = withoutOnly(raw);
          if (bare !== raw) userCanon = canonicalizeList(bare, itemCount);
          // one item given with its own number: "1) gap junctions", "1 gap junctions"
          const numbered = userCanon === null && bare.match(/^([1-9])\s*[).:]?\s+(?:only\s+)?(\S.*)$/i);
          if (numbered && parseInt(numbered[1], 10) <= itemCount) {
            const named = resolveTermsToNumbers(numbered[2], itemTexts);
            if (named && named.length === 1 && named[0] === parseInt(numbered[1], 10)) userCanon = numbered[1];
          }
          if (userCanon === null) {
            const nums = resolveTermsToNumbers(bare, itemTexts);
            if (nums && nums.length) userCanon = digitsToCanonical(nums);
          }
        }
      }
      if (userCanon !== null) {
        // A key that labels its own parts ("1: RIGHT; 2: LEFT", "1) + 2) -")
        // answers each item in turn; it isn't a choice of items, so its
        // numbers mustn't be read as one ("all" or "123" would pass). Those
        // keys are left to the multi-part checks below.
        // (A note in brackets at the key's end isn't part of it: "ALL (1, 2, 3)".)
        // A set question's key may name its items instead ("COBALT" for item
        // 1, "GAP JUNCTIONS ONLY"), and then stands for their numbers.
        const keyItems = ranking ? null : extractItemTexts(question.question, itemCount);
        const namedKey = (k) => {
          const nums = keyItems ? resolveTermsToNumbers(withoutOnly(withoutEndNote(k)), keyItems, true) : null;
          return nums && nums.length ? digitsToCanonical(nums) : null;
        };
        const canonKey = (k) => (keyLabelsParts(k, question.question, itemCount) ? null
          : canonFn(k, itemCount) ?? canonFn(withoutEndNote(k), itemCount) ?? namedKey(k));
        const mainCanon = canonKey(ans.text);
        if (mainCanon !== null && userCanon === mainCanon) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of accepts) {
          const accCanon = canonKey(acc);
          if (accCanon !== null && userCanon === accCanon) {
            return { correct: true, matched: 'accept', rejected: false };
          }
        }
        // A ranking typed as item numbers in the wrong order is wrong. Without
        // this, the any-order number checks below would accept "1, 2, 3" for
        // a key of "1, 3, 2".
        const isOrdering = (c) => c !== null && c.length === itemCount && new Set(c).size === itemCount;
        if (ranking && [ans.text, ...accepts].some((k) => isOrdering(canonKey(k)))) {
          return { correct: false, matched: null, rejected: false };
        }
      }
    }

    // ---- Bare number(s) against a "NUMBER UNIT-WORD(S)" answer key, e.g.
    // "8" for "8 FACTORS", "120 130" for "120 AND 130 DEGREES". Compared as
    // a set, so a multi-part key (where order can matter) is left to the
    // part-by-part check. ----
    {
      const rawPureNums = multi ? null : extractPureNumbers(raw);
      // (in order, for a question that asks for an order; and never when
      // the "unit" is a letter the question uses as a variable: "2" for
      // "2k^2" on a circle "of radius k")
      const ordered = isRankingQuestion(question.question) || listIsOrdered(question);
      const sameNums = (a, b) => (ordered ? a.length === b.length && a.every((x, j) => x === b[j]) : numsEqualAsSet(a, b));
      const variableTail = (k) => {
        const m = String(k).match(/^\s*[+\-−–]?[\d.,]+\s*([A-Za-z])(?![A-Za-z])/);
        if (!m) return false;
        // the letter on its own in the question, not as a unit after a
        // number ("12 m/s") or inside a unit ("m/s")
        const re = new RegExp('(^|[^A-Za-z/])' + m[1] + '(?![A-Za-z/])', 'gi');
        const qt = question.question || '';
        let hit;
        while ((hit = re.exec(qt))) {
          const before = qt.slice(0, hit.index + hit[1].length);
          if (!/\d\s*$/.test(before)) return true;
        }
        return false;
      };
      if (rawPureNums) {
        const mainNums = extractLeadingNumbers(ans.text);
        if (mainNums.length && sameNums(rawPureNums, mainNums) && !signConflict(raw, ans.text) && unitTail(ans.text) && !variableTail(ans.text)) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of accepts) {
          const accNums = extractLeadingNumbers(acc);
          if (accNums.length && sameNums(rawPureNums, accNums) && !signConflict(raw, acc) && unitTail(acc) && !variableTail(acc)) {
            return { correct: true, matched: 'accept', rejected: false };
          }
        }
      }
      // The same idea by value: "0.5" for "1/2 METERS", "3/4" for "0.75 LITERS".
      if (!multi && bareValueMatchesKey(raw, ans.text)) {
        return { correct: true, matched: 'main', rejected: false };
      }
      for (const acc of accepts) {
        if (!multi && bareValueMatchesKey(raw, acc)) {
          return { correct: true, matched: 'accept', rejected: false };
        }
      }
    }

    // ---- Exact normalized match ----
    if (normEqual(raw, ans.text)) {
      return { correct: true, matched: 'main', rejected: false };
    }
    for (const acc of accepts) {
      if (normEqual(raw, acc)) {
        return { correct: true, matched: 'accept', rejected: false };
      }
    }

    // ---- Spacing-insensitive match ----
    // PDF extraction scattered spaces through chemical formulas and other
    // compact answers ("SI O2", "C 3 H 7 NO 2", "MgCl 2"), so a student who
    // types "SiO2" would fail the exact match above on spacing alone. Two
    // answers that are identical once every space is removed are the same
    // answer.
    if (compactEqual(raw, ans.text)) {
      return { correct: true, matched: 'main', rejected: false };
    }
    for (const acc of accepts) {
      if (compactEqual(raw, acc)) {
        return { correct: true, matched: 'accept', rejected: false };
      }
    }

    // ---- Alternates written into the key itself ----
    // "ITCZ OR INTERTROPICAL CONVERGENCE ZONE", "GREEN ACCEPT: EMERALD",
    // "TORRICELLI'S THEOREM (OR LAW)": each listed alternate, and the key
    // without its trailing parenthetical note, is a whole answer.
    const keys = multi ? [ans.text, ...accepts] : [ans.text, ...accepts].flatMap(keyVariants);
    for (const key of keys) {
      if (normEqual(raw, key) || compactEqual(raw, key)) {
        return { correct: true, matched: 'accept', rejected: false };
      }
    }

    // A near miss the player is asked to confirm (see `close` below) rather
    // than one that's scored as correct.
    let close = false;

    // ---- Multi-part: every part given, each matched on its own ----
    if (multi) {
      let m = checkMultiPart(raw, multi);
      if (m !== 'exact') m = betterMatch(m, checkWithOtherOne(raw, multi, question));
      if (m === 'exact' || m === 'fuzzy') return { correct: true, matched: m === 'exact' ? 'main' : 'fuzzy', rejected: false };
      if (m === 'typo') close = true;
    }

    // ---- Word-order-independent match ----
    // "jupiter saturn" counts for "Saturn and Jupiter". A small typo
    // ("deuterosomes" for "deuterostomes") is only close: too many one- or
    // two-letter differences are a different term (see CONTRAST_SWAPS for
    // the ones that never even count as close). A multi-part key was
    // already matched part by part above, where part order is enforced
    // when it matters ("zinc; copper" vs "copper; zinc"). A list key is
    // matched item by item too (see listSpec), and on an ordered question
    // ("respectively", "order the following") only in its order.
    const labelled = multi ? null : labelledListSpecs(question);
    if (labelled) {
      if (labelled.some((spec) => checkMultiPart(raw, spec) === 'exact')) return { correct: true, matched: 'lenient', rejected: false };
      // (the key's own order isn't the one asked for, so the plain list
      // check below, which would take it, is skipped)
      return { correct: false, matched: null, rejected: false };
    }
    const list = multi ? null : listSpec(question);
    if (list) {
      let m = checkMultiPart(raw, list);
      if (m !== 'exact') m = betterMatch(m, checkWithOtherOne(raw, list, question));
      if (m === 'exact') return { correct: true, matched: 'lenient', rejected: false };
      if (m) close = true;
    }
    for (const key of keys) {
      if (multi && answerParts(key)) continue;
      // (an accept written with ";" is the same list, held to the same order)
      // (and so is a whole-answer accept of an ordered multi-part key: "ZINC
      // AND MANGANESE OXIDE" for "ANODE: ZINC; CATHODE: MANGANESE OXIDE")
      const items = (list && list.ordered) || (multi && multi.ordered) ? (listItems(key) || answerParts(key)) : null;
      let m = items
        ? checkMultiPart(raw, { n: items.length, alts: items.map(partVariants), floating: [], ordered: true, noSlash: true })
        : lenientWordMatch(raw, key);
      // items that each carry their own word from the question ("ICELANDIC
      // LOW, AZORES HIGH" for "what low and high pressure systems,
      // respectively") say which is which, so typed whole they can come in
      // any order; a bare "stokes drag, sand" can't
      if (m !== 'exact' && items && selfLabelled(question.question, items)) {
        m = betterMatch(m, checkMultiPart(raw, { n: items.length, alts: items.map((x) => [x]), floating: [], ordered: false, noSlash: true }));
      }
      if (m === 'exact') return { correct: true, matched: 'lenient', rejected: false };
      if (m) close = true;
    }

    // ---- A named law, effect, experiment, ... by its name alone ----
    // ("michelson-morley" for "MICHELSON-MORLEY EXPERIMENT"; see
    // withoutKindWord). A typo in the name is close, as anywhere else.
    if (!multi) {
      for (const key of keys) {
        const name = withoutKindWord(key);
        if (!name) continue;
        if (normEqual(raw, name) || compactEqual(raw, name)) return { correct: true, matched: 'lenient', rejected: false };
        const m = lenientWordMatch(raw, name);
        if (m === 'exact') return { correct: true, matched: 'lenient', rejected: false };
        if (m) close = true;
      }
    }

    // ---- With or without the word the question asks by ----
    // ("alpha particle" for ALPHA on "What type of nuclear particle …",
    // "phosphate" for PHOSPHATE GROUP on "What functional group …")
    // (not on an ordered list, where the word match would take any order)
    if (!multi && !(list && list.ordered)) {
      const kinds = askedKindWords(question.question);
      const refused = (ans.reject || []).some((rej) => sameWithoutKind(raw, rej, kinds));
      if (!refused && keys.some((key) => sameWithoutKind(raw, key, kinds))) return { correct: true, matched: 'lenient', rejected: false };
    }

    // ---- Typed answer contains the whole key plus more: close ----
    if (!close && keys.some((key) => typedContainsKey(raw, key))) close = true;

    if (close) return { correct: false, matched: null, rejected: false, close: true };
    return { correct: false, matched: null, rejected: false };
  }


  // ---- Units (short answer only) ----
  // A unit written out or abbreviated is the same unit: "3.2 × 10^23 JOULES"
  // = "3.2 × 10^23 J", "9.8 meters per second squared" = "9.8 m/s^2". Only a
  // unit right after a number is touched, so a bare "C" (carbon or coulomb?)
  // or "N" (nitrogen or newton?) is never rewritten. Multiple choice never
  // gets here: its answer must be the exact letter or choice.
  const UNIT_NAMES = [
    ['KILOELECTRON VOLTS?|KILOELECTRONVOLTS?', 'KEV'], ['MEGAELECTRON VOLTS?|MEGAELECTRONVOLTS?', 'MEV'],
    ['ELECTRON VOLTS?|ELECTRONVOLTS?|ELECTRON-VOLTS?', 'EV'],
    ['KILOWATT[ -]HOURS?', 'KWH'], ['LIGHT[ -]YEARS?', 'LY'], ['ASTRONOMICAL UNITS?', 'AU'],
    ['KILOJOULES?', 'KJ'], ['MEGAJOULES?', 'MJ'], ['JOULES?', 'J'],
    ['KILONEWTONS?', 'KN'], ['NEWTONS?', 'N'],
    ['KILOWATTS?', 'KW'], ['MEGAWATTS?', 'MW'], ['GIGAWATTS?', 'GW'], ['WATTS?', 'W'],
    ['KILOVOLTS?', 'KV'], ['MILLIVOLTS?', 'MV'], ['VOLTS?', 'V'],
    ['MILLIAMPERES?|MILLIAMPS?', 'MA'], ['AMPERES?|AMPS?', 'A'],
    ['KILOHMS?|KILOOHMS?|KILO-OHMS?|KOHMS?|KΩ', 'KOHM'], ['MEGOHMS?|MEGAOHMS?|MEGA-OHMS?|MOHMS?|MΩ', 'MEGOHM'],
    ['ANGSTROMS?|ÅNGSTRÖMS?|Å', 'ANGSTROM'],
    ['MICROMETERS?|MICROMETRES?|MICRONS?|[ΜU]M', 'UM'], ['MICROSECONDS?|[ΜU]S', 'US'], ['MICROGRAMS?|MCG|[ΜU]G', 'UG'],
    ['MICROFARADS?|[ΜU]F', 'UF'], ['MICROAMPERES?|MICROAMPS?|[ΜU]A', 'UA'], ['MICROLITERS?|MICROLITRES?|[ΜU]L', 'UL'],
    ['MICROVOLTS?|[ΜU]V', 'UV'], ['MICROCOULOMBS?|[ΜU]C', 'UC'], ['MICROMOLES?|[ΜU]MOL', 'UMOL'], ['MICROTESLAS?|[ΜU]T', 'UT'],
    ['NANOSECONDS?', 'NS'], ['NANOGRAMS?', 'NG'], ['NANOFARADS?', 'NF'], ['PICOFARADS?', 'PF'], ['PICOMETERS?|PICOMETRES?', 'PM'],
    ['OHMS?|Ω', 'OHM'], ['COULOMBS?', 'C'], ['FARADS?', 'F'], ['HENRIES|HENRYS?', 'H'], ['TESLAS?', 'T'],
    ['KILOHERTZ', 'KHZ'], ['MEGAHERTZ', 'MHZ'], ['GIGAHERTZ', 'GHZ'], ['HERTZ', 'HZ'],
    ['KILOPASCALS?', 'KPA'], ['PASCALS?', 'PA'], ['ATMOSPHERES?', 'ATM'],
    ['KELVINS?', 'K'], ['DEGC', 'DEGC'], ['DEGF', 'DEGF'], ['DEGREES?|°', 'DEG'],
    ['KILOMETERS?|KILOMETRES?', 'KM'], ['CENTIMETERS?|CENTIMETRES?', 'CM'], ['MILLIMETERS?|MILLIMETRES?', 'MM'],
    ['NANOMETERS?|NANOMETRES?', 'NM'], ['METERS?|METRES?', 'M'],
    ['KILOGRAMS?', 'KG'], ['MILLIGRAMS?', 'MG'], ['GRAMS?', 'G'],
    ['MILLISECONDS?', 'MS'], ['SECONDS?|SECS?', 'S'], ['MINUTES?|MINS?', 'MIN'], ['HOURS?|HRS?', 'HR'],
    ['MILLILITERS?|MILLILITRES?', 'ML'], ['LITERS?|LITRES?', 'L'],
    ['MOLES?', 'MOL'], ['KILOCALORIES?', 'KCAL'], ['CALORIES?', 'CAL'], ['PARSECS?', 'PC'],
    ['DECIBELS?', 'DB'], ['WEBERS?', 'WB'], ['LUX', 'LX'], ['GRAYS?', 'GY'], ['BECQUERELS?', 'BQ'],
    ['MILLISIEVERTS?', 'MSV'], ['SIEVERTS?', 'SV'], ['RADIANS?', 'RAD'],
  ];
  const UNIT_SYMBOLS = new Set(UNIT_NAMES.map(([, s]) => s));
  function unitSymbol(word) {
    for (const [n, s] of UNIT_NAMES) if (new RegExp('^(?:' + n + ')$').test(word)) return s;
    return UNIT_SYMBOLS.has(word) ? word : null;
  }
  // After a number, rewrite the run of unit words that follows ("JOULES PER
  // MOLE", "METERS PER SECOND SQUARED", "M/S^2") into symbols ("J/MOL",
  // "M/S^2"); anything else ends the run.
  function canonicalUnits(text) {
    if (text == null) return text;
    // temperatures get their own symbols, so Celsius never meets coulombs (C)
    // or Fahrenheit farads (F)
    const s = String(text).toUpperCase()
      // a prefix typed apart from its unit: "micro meters", "kilo ohms"
      .replace(/(\d\s*)(PICO|NANO|MICRO|MILLI|CENTI|KILO|MEGA|GIGA)\s+(?=[A-Z])/g, '$1$2')
      .replace(/(?:°\s*|\bDEG(?:REE)?S?\s+)C(?:ELSIUS)?(?![A-Z])|\bCELSIUS\b/g, ' DEGC ')
      .replace(/(?:°\s*|\bDEG(?:REE)?S?\s+)F(?:AHRENHEIT)?(?![A-Z])|\bFAHRENHEIT\b/g, ' DEGF ')
      .replace(/\bDEG(?:REE)?S?\s+K(?:ELVINS?)?(?![A-Z])/g, ' K ');
    const NUM = /(\d+(?:\.\d+)?(?:\s*(?:[X×*·]|TIMES)\s*10\s*\^\s*\(?[+\-−–]?\d+\)?|E[+\-]?\d+)?)/y;
    let out = '', i = 0;
    while (i < s.length) {
      NUM.lastIndex = i;
      const m = (i === 0 || !/[A-Z0-9.]/.test(s[i - 1])) && /\d/.test(s[i]) ? NUM.exec(s) : null;
      if (!m) { out += s[i++]; continue; }
      out += m[1];
      let j = NUM.lastIndex, units = [], sep = '';
      for (;;) {
        const rest = s.slice(j);
        const per = rest.match(/^\s*(?:PER\b|\/)\s*/);
        if (units.length && per) { sep = '/'; j += per[0].length; continue; }
        const pow = rest.match(/^\s*(SQUARED|CUBED|\^\s*\(?[23]\)?)/);
        if (units.length && pow) { units[units.length - 1] += pow[1].startsWith('S') ? '^2' : pow[1].startsWith('C') ? '^3' : '^' + pow[1].replace(/\D/g, ''); j += pow[0].length; continue; }
        const w = rest.match(/^\s*([A-ZΩ°ΜÅ]+)(?![A-Z0-9])/) || rest.match(/^\s*(ELECTRON VOLTS?|KILOWATT[ -]HOURS?|LIGHT[ -]YEARS?|ASTRONOMICAL UNITS?)/);
        const two = rest.match(/^\s*(ELECTRON VOLTS?|KILOWATT[ -]HOURS?|LIGHT[ -]YEARS?|ASTRONOMICAL UNITS?)(?![A-Z])/);
        const word = two ? two[1] : w && w[1];
        const sym = word && unitSymbol(word.replace(/-/g, ' '));
        if (!sym) break;
        // (per "H" is per hour: no one asks for anything per henry)
        units.push((units.length ? (sep || ' ') : ' ') + (sep === '/' && sym === 'H' ? 'HR' : sym));
        sep = '';
        j += (two ? two[0] : w[0]).length;
      }
      out += units.join('').replace(/^ /, ' ');
      i = j;
      if (units.length && i < s.length && !/\s/.test(s[i])) out += ' ';
    }
    return out;
  }
  // The last word on any match: an answer whose operators, comparison or
  // charges contradict the key and every accept (see operatorConflict) is
  // wrong, however it matched (unit rewriting, word order, typo tolerance
  // and the part-by-part checks all compare text with the symbols gone).
  // One-character fractions written out ("½" -> "1/2", "2½" -> "2 1/2") in
  // the typed answer and the key, so the number checks, which read the text
  // as written, see a fraction they know.
  const slashFractions = (t) => (t == null ? t : String(t).replace(VULGAR_RE, (m, digit, f) => (digit ? digit + ' ' : '') + VULGAR[f]));
  // A sign on a particle's or letter's name reads the same written as a
  // word or a symbol: "W minus boson" is "W- boson" (and "W⁻", "W^-"),
  // "pi plus" is "π+", "beta-minus decay" is "β- decay". Both the typed
  // answer and the key are rewritten with the symbol, so the sign is then
  // checked like any other charge (a "W+" for "W MINUS" is wrong, see
  // operatorConflict). Only after a single letter or a Greek letter's name,
  // and not before a number or another lone letter ("x minus 2", "a plus b"
  // are arithmetic)
  const SIGN_NAME = '(?:[A-Za-z]|[\u0391-\u03a9\u03b1-\u03c9]|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)';
  // (nor before a spelled number or a math word: "a minus absolute value of b")
  const SIGN_MATH_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|half|the|absolute|square|cube|sqrt|root|log|ln|sin|cos|tan|pi|infinity|negative';
  const SIGN_WORD_RE = new RegExp('(^|[^A-Za-z0-9\u0391-\u03c9])(' + SIGN_NAME + ')(?:\\s+|-)(minus|plus)(?![A-Za-z0-9])(?!\\s*(?:\\d|[A-Za-z](?![A-Za-z])|(?:' + SIGN_MATH_WORDS + ')(?![A-Za-z])))', 'gi');
  function signWords(t) {
    if (t == null) return t;
    return String(t).replace(/\u207b/g, '-').replace(/\u207a/g, '+')
      .replace(SIGN_WORD_RE, (m, pre, name, word) => pre + name + (/^m/i.test(word) ? '-' : '+'));
  }
  const SIGN_WORD_TEST = /\b(?:minus|plus)\b|[\u207a\u207b]/i;
  // ---- A charge left out ----
  // "OH" for OH^-, "W boson" for W- boson, "beta decay" for beta- decay
  // read the same once normalize() drops the symbols, but the charge is
  // part of the answer: they pass only when the question says it isn't
  // needed (see chargeExcused), or an accept without it matches.
  // A charge is a + or - after a letter, a Greek letter or a bracket, maybe
  // with its count ("Fe2+", "Fe^(2+)", "SO4^2-", "B(OH)4^-", "W-", "β+"),
  // ending the word: not a hyphen ("X-ray"), an operation ("x-1", "a+b") or a leading sign ("-2").
  function chargesOf(raw) {
    const str = String(raw == null ? '' : raw)
      .replace(/[−–‐—⁻]/g, '-').replace(/⁺/g, '+')
      .replace(/[\^_]\(([^()]*)\)/g, '$1').replace(/[\^_]/g, '');
    const out = { '+': 0, '-': 0 };
    const re = /[A-Za-zΑ-Ωα-ω)\]]\d*([+-])(?=$|[\s,;.()\]/])/g;
    let m;
    while ((m = re.exec(str))) out[m[1]]++;
    // a charge written by itself after a separator: "SiO4; 4-"
    const bare = /(?:^|[;,]\s*)\d+([+-])(?=$|[\s,;.)])/g;
    while ((m = bare.exec(str))) out[m[1]]++;
    return out;
  }
  // The charges the key has and the typed answer hasn't ([] for none).
  function droppedCharges(typed, key) {
    const t = chargesOf(typed), k = chargesOf(key);
    return ['+', '-'].filter((c) => k[c] > t[c]);
  }
  // The question makes the charge plain, or says it can be left out:
  // "charge not required", "you need not give the charge", "ignoring
  // charge"; or it names the sign itself ("What negatively charged ion …",
  // "this cation", "with a charge of +2"), so the sign left out is the one
  // the question already gave. A sign word inside another name ("beta-minus
  // decay" in the question, for a W- boson) doesn't count.
  const CHARGE_OPTIONAL_RE = /\bcharges?\s+(?:is\s+|are\s+)?(?:not\s+(?:necessary|needed|required)|optional|unnecessary)|\b(?:do\s+not|don't|need\s+not|needn't|no\s+need\s+to)\s+(?:need\s+to\s+)?(?:give|include|state|specify|write|provide|indicate)\s+(?:the\s+|its\s+|their\s+|any\s+)?(?:charges?|signs?)|\b(?:without|ignoring|ignore|disregard(?:ing)?|regardless\s+of)\s+(?:the\s+|its\s+|their\s+|any\s+)?charges?\b/i;
  // A question that asks for the charge never excuses it: "including
  // charge", "indicating charge", "the formula and charge".
  const CHARGE_ASKED_RE = /\b(?:includ(?:e|ing)|indicat(?:e|ing)|with|show(?:ing)?|giv(?:e|ing)|stat(?:e|ing)|specify(?:ing)?)\s+(?:the\s+|its\s+|their\s+|any\s+)?(?:ionic\s+)?charges?\b|\b(?:formula|symbol|identity|name)s?\s+and\s+(?:the\s+|its\s+|their\s+)?charges?\b/i;
  function chargeExcused(questionText, dropped) {
    const q = String(questionText || '');
    if (CHARGE_ASKED_RE.test(q)) return false;
    if (CHARGE_OPTIONAL_RE.test(q)) return true;
    const given = new Set();
    if (/\bnegative\s+charges?\b|\bnegatively[\s-]+charged\b|\bnegative(?:ly)?\s+(?:charged\s+)?ions?\b|\banions?\b|\bcharge\s+of\s*(?:negative|minus|[\-−–])|(?:^|\s)[\-−–]\d?\s*charge\b/i.test(q)) given.add('-');
    if (/\bpositive\s+charges?\b|\bpositively[\s-]+charged\b|\bpositive(?:ly)?\s+(?:charged\s+)?ions?\b|\bcations?\b|\bcharge\s+of\s*(?:positive|plus|\+)|(?:^|\s)\+\d?\s*charge\b/i.test(q)) given.add('+');
    return dropped.every((c) => given.has(c));
  }
  function chargeLeftOut(question, userInput, result) {
    const a = question.answer;
    const keys = [a.text, ...(a.accept || [])].filter(Boolean);
    const charged = keys.filter((k) => droppedCharges(userInput, k).length);
    if (!charged.length) return result;
    if (charged.every((k) => chargeExcused(question.question, droppedCharges(userInput, k)))) return result;
    // Right by an accept that has no such charge ("W BOSON" accepted for
    // "W- BOSON") is right.
    const plain = keys.filter((k) => !charged.includes(k) || chargeExcused(question.question, droppedCharges(userInput, k)));
    if (plain.length) {
      const again = checkWithAskedUnits({ ...question, answer: { ...a, text: plain[0], accept: plain.slice(1) } }, userInput,
        checkAnswerInner({ ...question, answer: { ...a, text: plain[0], accept: plain.slice(1) } }, userInput));
      if (again.correct) return result;
    }
    // A near miss, like a typo: the pages mark it "Close" and the player
    // can claim it with "I was right".
    return { correct: false, matched: null, rejected: false, close: true, chargeMissing: true };
  }
  // ---- What a player types for a symbol their keyboard lacks ----
  // Applied to the typed answer only, before grading. Comparisons in words
  // ("x less than or equal to 5", "not equal to"), "+/-" and "plus or
  // minus" become the symbols; a whole answer of "one half", "a third" ...
  // is the fraction; and with a charged key, a charge typed after the
  // formula ("Fe+3", "Fe 3+", "SO4 2-") is a superscript charge.
  const SPELLED_FRACTIONS = [[/^(?:one|a)\s+half$|^half$/i, '1/2'], [/^(?:one|a)\s+third$/i, '1/3'], [/^two\s+thirds$/i, '2/3'],
    [/^(?:one|a)\s+(?:quarter|fourth)$/i, '1/4'], [/^three\s+(?:quarters|fourths)$/i, '3/4'], [/^(?:one|a)\s+fifth$/i, '1/5']];
  const CHARGED_KEY_RE = /\^\(\d*[+\-−]\)|\^[+\-−](?=$|[\s,;)])|[A-Za-z)\]]\d*[+\-−](?=$|[,;)])/;
  function plusMinus(t) { return String(t).replace(/\+\s*\/\s*-|\+-(?=\s*[\d(a-z])|\bplus\s+or\s+minus\b/gi, '±'); }
  function typedStandIns(userInput, keys) {
    let t = String(userInput == null ? '' : userInput);
    t = t.replace(/\s*\b(?:is\s+)?less\s+than\s+or\s+equal\s+to\b\s*/gi, ' <= ')
      .replace(/\s*\b(?:is\s+)?greater\s+than\s+or\s+equal\s+to\b\s*/gi, ' >= ')
      .replace(/\s*\b(?:is\s+not\s+equal\s+to|not\s+equal\s+to|does\s+not\s+equal)\b\s*/gi, ' ≠ ')
      .replace(/!=|=\/=/g, ' ≠ ');
    t = plusMinus(t);
    // ("less than" alone only between two things, so "less than 5" stays words)
    t = t.replace(/(\S)\s+(?:is\s+)?less\s+than\s+(?=\S)/gi, '$1 < ').replace(/(\S)\s+(?:is\s+)?greater\s+than\s+(?=\S)/gi, '$1 > ');
    // "the answer is X", "answer: X", "it's X", "I think it is X"
    t = t.replace(/^\s*(?:(?:i\s+think|i\s+believe|my\s+answer\s+is|the\s+answer\s+is|answer\s*[:=\-]|ans\s*[:=\-])\s*)?(?:(?:it'?s|it\s+is|is|that'?s|that\s+is)\s+)?/i, (m) => (/\S/.test(m) ? '' : m));
    for (const [re, v] of SPELLED_FRACTIONS) if (re.test(t.trim())) t = v;
    // a reaction's arrow typed as "-->", "==>" or "yields"
    if (keys.some((k) => /[→⟶⇌⇄]|->|=>/.test(k))) t = t.replace(/\s*(?:-{2,}>|={2,}>|\byields\b|\bproduces\b|\bgives\b)\s*/gi, ' → ');
    // "u" for μ ("u0" for μ0) when the key has a μ and no u
    if (keys.some((k) => /[μµ]/.test(k)) && !keys.some((k) => /(^|[^A-Za-z])u([^A-Za-z]|$)/i.test(k))) t = t.replace(/(^|[^A-Za-z])u(?=[\s_]*0|[^A-Za-z]|$)/g, '$1μ');
    if (keys.some((k) => CHARGED_KEY_RE.test(k) && /[A-Za-z]/.test(k))) {
      t = t.replace(/([A-Za-z)\]])([+\-−])(\d)(?=$|[,;)])/g, '$1^($3$2)')
        .replace(/([A-Za-z\d)\]])\s+(\d*[+\-−])(?=$|[,;)])/g, '$1^($2)');
    }
    return t;
  }

  // "3 and -3", "-3, 3" or "+/-3" for a key of "±3"
  function samePlusMinus(typed, key) {
    const m = String(key).trim().match(/^±\s*(.+)$/);
    if (!m) return false;
    const items = String(typed).split(/\s*(?:,|;|\band\b|\bor\b)\s*/i).map((x) => x.trim()).filter(Boolean);
    if (items.length !== 2) return false;
    const pos = items.find((x) => !/^[-−–]/.test(x)), neg = items.find((x) => /^[-−–]/.test(x));
    if (!pos || !neg) return false;
    const eq = (a, b) => normEqual(a, b) || compactEqual(a, b);
    return eq(pos.replace(/^\+/, ''), m[1]) && eq(neg.replace(/^[-−–]\s*/, ''), m[1]);
  }

  // An isotope however it's written: "^(14)C", "C-14", "carbon-14",
  // "carbon 14", "14C", "C14" (for a key written as an isotope).
  const ELEMENT_NAMES = ('H hydrogen,He helium,Li lithium,Be beryllium,B boron,C carbon,N nitrogen,O oxygen,F fluorine,Ne neon,Na sodium,Mg magnesium,'
    + 'Al aluminum,Si silicon,P phosphorus,S sulfur,Cl chlorine,Ar argon,K potassium,Ca calcium,Sc scandium,Ti titanium,V vanadium,Cr chromium,'
    + 'Mn manganese,Fe iron,Co cobalt,Ni nickel,Cu copper,Zn zinc,Ga gallium,Ge germanium,As arsenic,Se selenium,Br bromine,Kr krypton,Rb rubidium,'
    + 'Sr strontium,Y yttrium,Zr zirconium,Nb niobium,Mo molybdenum,Tc technetium,Ru ruthenium,Rh rhodium,Pd palladium,Ag silver,Cd cadmium,In indium,'
    + 'Sn tin,Sb antimony,Te tellurium,I iodine,Xe xenon,Cs cesium,Ba barium,La lanthanum,Ce cerium,Pr praseodymium,Nd neodymium,Pm promethium,'
    + 'Sm samarium,Eu europium,Gd gadolinium,Tb terbium,Dy dysprosium,Ho holmium,Er erbium,Tm thulium,Yb ytterbium,Lu lutetium,Hf hafnium,'
    + 'Ta tantalum,W tungsten,Re rhenium,Os osmium,Ir iridium,Pt platinum,Au gold,Hg mercury,Tl thallium,Pb lead,Bi bismuth,Po polonium,'
    + 'At astatine,Rn radon,Fr francium,Ra radium,Ac actinium,Th thorium,Pa protactinium,U uranium,Np neptunium,Pu plutonium,Am americium,'
    + 'Cm curium,Bk berkelium,Cf californium,Es einsteinium,Fm fermium,Md mendelevium,No nobelium,Lr lawrencium').split(',')
    .reduce((o, x) => { const [sym, name] = x.split(' '); o.bySym[sym.toUpperCase()] = sym; o.byName[name.toUpperCase()] = sym; return o; },
      { bySym: {}, byName: { ALUMINIUM: 'Al', SULPHUR: 'S', CAESIUM: 'Cs' } });
  const ELEMENT_SYMBOL_NAMES = Object.fromEntries(Object.entries(ELEMENT_NAMES.byName).filter(([n]) => !/^(?:ALUMINIUM|SULPHUR|CAESIUM)$/.test(n)).map(([n, sym]) => [sym, n.slice(0, 5)]));
  function isotopeOf(raw) {
    const s = String(raw == null ? '' : raw).trim().replace(/\s+(?:isotope|nucleus|atom)s?$/i, '');
    let m;
    const sym = (x) => (ELEMENT_NAMES.bySym[x.toUpperCase()] && (x.length === 1 || /^[A-Z][a-z]$/.test(x)) ? ELEMENT_NAMES.bySym[x.toUpperCase()] : null);
    if ((m = s.match(/^\^?\(?(\d{1,3})\)?\s*([A-Za-z]{1,2})$/))) { const e = sym(m[2]); return e && { e, a: +m[1] }; }
    if ((m = s.match(/^([A-Za-z]{1,2})\s*-?\s*(\d{1,3})$/))) { const e = sym(m[1]); return e && { e, a: +m[2] }; }
    if ((m = s.match(/^([A-Za-z]{3,})\s*-?\s*(\d{1,3})$/))) { const e = ELEMENT_NAMES.byName[m[1].toUpperCase()]; return e && { e, a: +m[2] }; }
    return null;
  }
  function sameIsotope(typed, key) {
    const k = isotopeOf(key);
    // the key must read as an isotope ("^(14)C", "C-14", "CARBON-14"), not
    // as a formula ("C14", "N2")
    if (!k || !/^\s*\^|-\s*\d|^[A-Za-z]{3,}/.test(String(key))) return false;
    const t = isotopeOf(typed);
    return !!t && t.e === k.e && t.a === k.a;
  }

  // ---- Round 3: answers whose capital letters are the answer ----
  // The grader compares in capitals, which is right for words but not for
  // genotypes ("Aa" isn't "AA"), chemical symbols and formulas ("Co" isn't
  // "CO", "Hf" isn't "HF") or a milli/mega prefix ("10 mW" isn't "10 MW").
  // Where the typed answer's capitals say something else, or could, it's
  // marked wrong but Close: a player who meant it claims it with "I was
  // right", and in Multiplayer a doubtful answer never ends the question.
  const GENETICS_RE = /\b(?:genotypes?|alleles?|homozygous|heterozygous|dominant|recessive|punnett|offspring|progeny|crossed|a cross|test ?cross|dihybrid|monohybrid|x-linked|sex-linked|carriers?|hardy-weinberg)\b/i;
  function letterTokens(s) {
    return String(s).replace(/[\^_()[\]{}]/g, '').split(/[\s,;/&]+|\band\b|\bor\b/i).map((x) => x.trim()).filter(Boolean);
  }
  // Every token a gene pair or a run of them ("Aa", "BbCc", "XHXh", "ii").
  function genotypeKey(key, questionText) {
    if (!GENETICS_RE.test(questionText || '')) return null;
    const toks = letterTokens(key);
    if (!toks.length || !toks.every((t) => /^[A-Za-z]{2,8}$/.test(t))) return null;
    if (!toks.every((t) => /[a-z]/.test(t) || /^([A-Z])\1+$/.test(t) || /^X[A-Z]?X[A-Z]?$|^X[A-Z]?Y$/i.test(t))) return null;
    // a gene is two of one letter ("Aa", "BbCc", "Bbee", "ii"), or X-linked:
    // "None", "Malate" or "Biotin" on a genetics question is a word
    const genes = (t) => t.length % 2 === 0 && /^(?:([A-Za-z])(?=[A-Za-z]))/.test(t)
      && [...t.matchAll(/(.)(.)/g)].every((m) => m[1].toUpperCase() === m[2].toUpperCase());
    if (!toks.every((t) => genes(t) || /^X[A-Z]?X[A-Z]?$|^X[A-Z]?Y$/i.test(t))) return null;
    return toks;
  }
  function geneCanon(x) {
    return [...x].sort((p, q) => (p.toUpperCase() === q.toUpperCase() ? (p < q ? -1 : p > q ? 1 : 0) : p.toUpperCase() < q.toUpperCase() ? -1 : 1)).join('');
  }
  // The same genotype with its genes or letters in another order: "BbAa"
  // or "aABb" for "AaBb" (the capitals must match).
  function sameGenotype(typed, key, questionText) {
    const k = genotypeKey(key, questionText);
    if (!k) return false;
    const t = letterTokens(typed);
    return t.length === k.length && t.map(geneCanon).sort().join(' ') === k.map(geneCanon).sort().join(' ');
  }
  function genotypeCaseConflict(typed, key, questionText) {
    const k = genotypeKey(key, questionText);
    if (!k) return false;
    const t = letterTokens(typed);
    if (t.length !== k.length) return false;
    const up = (a) => a.map((x) => x.toUpperCase()).sort().join(' ');
    if (up(t) !== up(k)) return false;
    // a gene's letters in either order ("aA" is "Aa", "bBee" is "Bbee")
    return t.map(geneCanon).sort().join(' ') !== k.map(geneCanon).sort().join(' ');
  }
  // A key that is one chemical symbol or formula, written with real symbols.
  const SYMBOL_RE = new RegExp('^' + ELEMENT_SYMBOL + '$');
  function formulaKey(key) {
    // (a word in capitals, "W BOSON", isn't a formula however its letters read)
    if (!/[a-z]/.test(String(key)) && String(key).split(/\s+/).some((w) => /^[A-Z]{4,}$/.test(w))) return null;
    // a packet's "SI O2": a two-capital symbol set apart before the next
    // symbol is that symbol
    key = String(key).replace(/\b([A-Z])([A-Z])\s+(?=[A-Z])/g, (m, a, b) => (SYMBOL_RE.test(a + b.toLowerCase()) ? a + b.toLowerCase() : m));
    const k = String(key).trim().replace(/\^\(?\d*[+\-−]\)?$/, '').replace(/[\s^_]/g, '');
    if (!/^[A-Z]/.test(k) || !FORMULA_ITEM_RE.test(k)) return null;
    // something case can change: a two-letter symbol, or two capitals in a row
    return /[A-Z][a-z]|[A-Z][A-Z]/.test(k) ? k : null;
  }
  // The ways a run of letters can be read as element symbols, any case.
  function symbolReadings(letters, limit) {
    const out = [];
    (function walk(i, acc) {
      if (out.length > limit) return;
      if (i === letters.length) { out.push(acc); return; }
      const one = letters[i].toUpperCase();
      if (SYMBOL_RE.test(one)) walk(i + 1, acc + one);
      if (i + 1 < letters.length) {
        const two = letters[i].toUpperCase() + letters[i + 1].toLowerCase();
        if (SYMBOL_RE.test(two)) walk(i + 2, acc + two);
      }
    })(0, '');
    return out;
  }
  function formulaCaseConflict(typed, key, questionText) {
    // ("No" answers a yes-or-no question unless the question is about nobelium)
    if (/^\s*no\s*$/i.test(key) && !/nobelium|symbol/i.test(questionText || '')) return false;
    const k = formulaKey(key);
    if (!k) return false;
    const t = String(typed).trim().replace(/\^\(?\d*[+\-−]\)?$/, '').replace(/[\s^_]/g, '');
    if (t.toUpperCase() !== k.toUpperCase() || t === k) return false;
    if (k === k.toUpperCase()) {
      // A key in capitals only (as many packets print them: "SI O2", "CO")
      // says nothing about case. Typed in one case, it's fine; typed with
      // capitals on purpose, it clashes when it names an element (a
      // two-letter symbol) the question doesn't: "Co" for CO on a carbon
      // monoxide question.
      if (t === t.toLowerCase() || t === t.toUpperCase()) return false;
      const named = normalize(questionText || '');
      const pairs = t.match(/[A-Z][a-z]/g) || [];
      if (pairs.some((sym) => !SYMBOL_RE.test(sym))) return false; // not a formula as typed
      return pairs.some((sym) => {
        const name = ELEMENT_SYMBOL_NAMES[sym];
        return !name || !new RegExp('\\b' + name).test(named);
      });
    }
    // typed in one case only: fine when that can only be read one way
    if (t === t.toLowerCase() || t === t.toUpperCase()) {
      const runs = t.split(/[\d()[\]]+/).filter(Boolean);
      const keyRuns = k.split(/[\d()[\]]+/).filter(Boolean);
      return !runs.every((r, i) => { const rd = symbolReadings(r, 3); return rd.length === 1 && rd[0] === keyRuns[i]; });
    }
    return true; // capitals typed on purpose, and different
  }
  // "10 mW" for "10 MW": a milli/mega (or other case-told) prefix flipped.
  const PREFIX_UNIT_RE = /(\d)\s*([mM])(W|V|A|Hz|J|Pa|eV|g|s|m|pc|L|bps|Ω|ohms?)\b/;
  function prefixCaseConflict(typed, key) {
    const k = String(key).match(PREFIX_UNIT_RE);
    if (!k) return false;
    const t = String(typed).replace(/\bmega\s*/gi, 'M').replace(/\bmilli\s*/gi, 'm').match(/(\d)\s*([mM])([A-Za-zΩ]+)\b/);
    if (!t || t[3].toUpperCase().replace(/S$/, '') !== k[3].toUpperCase().replace(/S$/, '')) return false;
    // a unit like L, g or s has no mega in use: "50 ML" is a typo for mL, but
    // capitals can't be trusted either way, so it's Close
    return t[2] !== k[2];
  }
  function caseConflict(typed, keys, questionText) {
    return keys.some((k) => genotypeCaseConflict(typed, k, questionText) || formulaCaseConflict(typed, k, questionText) || prefixCaseConflict(typed, k));
  }

  // ---- Electron configurations ----
  // "[Ar] 4s^1 3d^5" for "1s^2 2s^2 2p^6 3s^2 3p^6 4s^1 3d^5", the orbitals
  // in any order; but where the question asks for the full configuration,
  // the noble-gas shorthand is Close.
  const NOBLE_CORE = { HE: '1s2', NE: '1s2 2s2 2p6', AR: '1s2 2s2 2p6 3s2 3p6', KR: '1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6',
    XE: '1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6', RN: '1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 4f14 5d10 6p6' };
  function configOf(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\^()]/g, '').replace(/,/g, ' ').trim();
    let shorthand = false;
    s = s.replace(/\[\s*(He|Ne|Ar|Kr|Xe|Rn)\s*\]/i, (m, g) => { shorthand = true; return ' ' + NOBLE_CORE[g.toUpperCase()] + ' '; });
    const toks = s.split(/\s+/).filter(Boolean);
    if (!toks.length) return null;
    const map = {};
    for (const t of toks) {
      const m = t.match(/^([1-7])([spdf])(\d{1,2})$/i);
      if (!m) return null;
      const orb = m[1] + m[2].toLowerCase();
      if (map[orb]) return null;
      map[orb] = +m[3];
    }
    return { key: Object.keys(map).sort().map((o) => o + map[o]).join(' '), shorthand };
  }
  const FULL_CONFIG_RE = /\b(?:full|complete|entire|unabbreviated|long[- ]hand|without (?:using )?(?:the )?(?:noble|shorthand|abbreviat))/i;
  // 'exact', 'close' or null
  function sameElectronConfig(typed, key, questionText) {
    const k = configOf(key), t = configOf(typed);
    if (!k || !t || k.key !== t.key) return null;
    return t.shorthand && FULL_CONFIG_RE.test(questionText || '') ? 'close' : 'exact';
  }

  // ---- Small whole-answer equivalences ----
  // True/false questions take T or F; a yes/no question Y or N.
  function sameTrueFalse(typed, key, questionText) {
    const t = String(typed).trim().toUpperCase().replace(/[.!]$/, '');
    const k = String(key).trim().toUpperCase();
    if (/^(TRUE|FALSE)$/.test(k) && /\btrue or false\b/i.test(questionText || '')) return t === k[0];
    if (/^(YES|NO)$/.test(k)) return t === k[0];
    return false;
  }
  // A ratio as "a to b", "a/b" or "a : b" when the question asks for a ratio.
  function ratioOf(s) {
    const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*(?::|\/|\bto\b)\s*(\d+(?:\.\d+)?)$/i);
    return m ? [m[1], m[2]] : null;
  }
  function sameRatio(typed, key, questionText) {
    if (!/\b(?:ratios?|odds|proportion)\b/i.test(questionText || '') || !/:/.test(String(key))) return false;
    const k = ratioOf(key), t = ratioOf(typed);
    return !!(k && t && k[0] === t[0] && k[1] === t[1]);
  }
  // "1st", "1", "first order" for a key of "FIRST" or "FIRST ORDER".
  const ORDINAL_NUM = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10, ZEROTH: 0 };
  function ordinalOf(s) {
    const m = normalize(s).match(/^(?:(\d+)(?:ST|ND|RD|TH)?|(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ZEROTH))(?: (ORDER|DEGREE|GENERATION|CLASS|TROPHIC LEVEL|LAW))?$/);
    if (!m) return null;
    return { n: m[1] != null ? +m[1] : ORDINAL_NUM[m[2]], word: m[3] || '' };
  }
  const ORDINAL_SUFFIX = (n) => n + ([, 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'TH');
  function ordinalWords(s) {
    return normalize(s).replace(/\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\b/g, (m) => ORDINAL_SUFFIX(ORDINAL_NUM[m]));
  }
  function sameOrdinal(typed, key) {
    // "Newton's 2nd law" for "NEWTON'S SECOND LAW"
    if (!/[+\-−–]/.test(String(typed) + key) && /\d(?:ST|ND|RD|TH)\b|\b(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\b/i.test(typed + ' ' + key)
      && normalize(typed) !== normalize(key) && ordinalWords(typed) === ordinalWords(key)) return true;
    // the key has to be an ordinal ("THIRD", "3RD ORDER"), not a number, and
    // neither side signed ("-3" is not "third")
    if (!/\d(?:st|nd|rd|th)\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|zeroth)\b/i.test(String(key))) return false;
    if (/[+\-−–]|\b(?:negative|minus|positive|plus)\b/i.test(String(typed) + ' ' + key)) return false;
    const k = ordinalOf(key), t = ordinalOf(typed);
    if (!k || !t || k.n !== t.n) return false;
    // a bare ordinal key ("THIRD") or one with its word: the word may be left out
    // "first order" for FIRST and "first" for FIRST ORDER; any other word must match
    return t.word === k.word || (!t.word && (!k.word || /^(?:ORDER|DEGREE)$/.test(k.word))) || (!k.word && /^(?:ORDER|DEGREE)$/.test(t.word));
  }
  // A hyphenated key typed as one word: "nonpolar", "xray", "lightyear".
  function sameJoined(typed, key) {
    if (!/[A-Za-z]-[A-Za-z]/.test(String(key)) || !/^[A-Za-z' -]+$/.test(String(key).trim()) || !/^[A-Za-z' -]+$/.test(String(typed).trim())) return false;
    const j = (s) => normalize(String(s).replace(/([A-Za-z])-(?=[A-Za-z])/g, '$1')).replace(/ /g, '');
    return j(key).length >= 4 && j(typed) === j(key);
  }
  // Standard abbreviations, either way round: "DNA" for "DEOXYRIBONUCLEIC
  // ACID" and the reverse.
  const STANDARD_ABBREVIATIONS = {
    DNA: 'DEOXYRIBONUCLEIC ACID', RNA: 'RIBONUCLEIC ACID', MRNA: 'MESSENGER RNA', TRNA: 'TRANSFER RNA', RRNA: 'RIBOSOMAL RNA',
    ATP: 'ADENOSINE TRIPHOSPHATE', ADP: 'ADENOSINE DIPHOSPHATE', AMP: 'ADENOSINE MONOPHOSPHATE', GTP: 'GUANOSINE TRIPHOSPHATE',
    CAMP: 'CYCLIC AMP', NAD: 'NICOTINAMIDE ADENINE DINUCLEOTIDE', FAD: 'FLAVIN ADENINE DINUCLEOTIDE',
    PCR: 'POLYMERASE CHAIN REACTION', CNS: 'CENTRAL NERVOUS SYSTEM', PNS: 'PERIPHERAL NERVOUS SYSTEM',
    HIV: 'HUMAN IMMUNODEFICIENCY VIRUS', LDL: 'LOW DENSITY LIPOPROTEIN', HDL: 'HIGH DENSITY LIPOPROTEIN',
    MRI: 'MAGNETIC RESONANCE IMAGING', NMR: 'NUCLEAR MAGNETIC RESONANCE', EEG: 'ELECTROENCEPHALOGRAM', ECG: 'ELECTROCARDIOGRAM', EKG: 'ELECTROCARDIOGRAM',
    LED: 'LIGHT EMITTING DIODE', CFC: 'CHLOROFLUOROCARBON', CFCS: 'CHLOROFLUOROCARBONS', HFC: 'HYDROFLUOROCARBON', HFCS: 'HYDROFLUOROCARBONS',
    GMO: 'GENETICALLY MODIFIED ORGANISM', UV: 'ULTRAVIOLET', CPU: 'CENTRAL PROCESSING UNIT', RAM: 'RANDOM ACCESS MEMORY', ROM: 'READ ONLY MEMORY',
    LCD: 'LIQUID CRYSTAL DISPLAY', STP: 'STANDARD TEMPERATURE AND PRESSURE', VSEPR: 'VALENCE SHELL ELECTRON PAIR REPULSION',
    ADH: 'ANTIDIURETIC HORMONE', FSH: 'FOLLICLE STIMULATING HORMONE', LH: 'LUTEINIZING HORMONE', TSH: 'THYROID STIMULATING HORMONE',
    ACTH: 'ADRENOCORTICOTROPIC HORMONE', HGH: 'HUMAN GROWTH HORMONE', CMB: 'COSMIC MICROWAVE BACKGROUND', CMBR: 'COSMIC MICROWAVE BACKGROUND RADIATION',
    AGN: 'ACTIVE GALACTIC NUCLEUS', GPS: 'GLOBAL POSITIONING SYSTEM', EMF: 'ELECTROMOTIVE FORCE', SONAR: 'SOUND NAVIGATION AND RANGING',
    LASER: 'LIGHT AMPLIFICATION BY STIMULATED EMISSION OF RADIATION', SNP: 'SINGLE NUCLEOTIDE POLYMORPHISM', MHC: 'MAJOR HISTOCOMPATIBILITY COMPLEX',
    SA: 'SINOATRIAL', AV: 'ATRIOVENTRICULAR', PKU: 'PHENYLKETONURIA', ALS: 'AMYOTROPHIC LATERAL SCLEROSIS',
    ACH: 'ACETYLCHOLINE', IR: 'INFRARED', GABA: 'GAMMA AMINOBUTYRIC ACID', CSF: 'CEREBROSPINAL FLUID', ECM: 'EXTRACELLULAR MATRIX',
    ETC: 'ELECTRON TRANSPORT CHAIN', GFP: 'GREEN FLUORESCENT PROTEIN', RBC: 'RED BLOOD CELL', RBCS: 'RED BLOOD CELLS', WBC: 'WHITE BLOOD CELL',
    WBCS: 'WHITE BLOOD CELLS', PEP: 'PHOSPHOENOLPYRUVATE', ROS: 'REACTIVE OXYGEN SPECIES', BMR: 'BASAL METABOLIC RATE',
    CAM: 'CRASSULACEAN ACID METABOLISM', ELISA: 'ENZYME LINKED IMMUNOSORBENT ASSAY', ITCZ: 'INTERTROPICAL CONVERGENCE ZONE',
    ENSO: 'EL NINO SOUTHERN OSCILLATION', ISM: 'INTERSTELLAR MEDIUM', JWST: 'JAMES WEBB SPACE TELESCOPE', HST: 'HUBBLE SPACE TELESCOPE',
    LHC: 'LARGE HADRON COLLIDER', QED: 'QUANTUM ELECTRODYNAMICS', QCD: 'QUANTUM CHROMODYNAMICS', BEC: 'BOSE EINSTEIN CONDENSATE',
    SHM: 'SIMPLE HARMONIC MOTION', AC: 'ALTERNATING CURRENT', DC: 'DIRECT CURRENT', TNT: 'TRINITROTOLUENE', PVC: 'POLYVINYL CHLORIDE',
    THF: 'TETRAHYDROFURAN', DMSO: 'DIMETHYL SULFOXIDE', BOD: 'BIOCHEMICAL OXYGEN DEMAND', APC: 'ANTIGEN PRESENTING CELL',
    SEM: 'SCANNING ELECTRON MICROSCOPE', TEM: 'TRANSMISSION ELECTRON MICROSCOPE', BAO: 'BARYON ACOUSTIC OSCILLATIONS',
    RFID: 'RADIO FREQUENCY IDENTIFICATION', FISH: 'FLUORESCENCE IN SITU HYBRIDIZATION', IVF: 'IN VITRO FERTILIZATION',
    TCA: 'TRICARBOXYLIC ACID', SSRI: 'SELECTIVE SEROTONIN REUPTAKE INHIBITOR', GERD: 'GASTROESOPHAGEAL REFLUX DISEASE',
  };
  const ABBR_TEST = new RegExp('\\b(?:' + Object.keys(STANDARD_ABBREVIATIONS).join('|') + ')\\b');
  const ABBR_EXPAND_RE = new RegExp('\\b(?:' + Object.keys(STANDARD_ABBREVIATIONS).join('|') + ')\\b', 'g');
  const ABBR_FULL = Object.entries(STANDARD_ABBREVIATIONS).sort((a, b) => b[1].length - a[1].length);
  function abbrCanon(s) {
    let n = normalize(String(s).replace(/-/g, ' ')).replace(ABBR_EXPAND_RE, (m) => STANDARD_ABBREVIATIONS[m]);
    // the short form of an expansion inside a longer one ("MESSENGER RNA")
    n = n.replace(ABBR_EXPAND_RE, (m) => STANDARD_ABBREVIATIONS[m]);
    return n;
  }
  function sameAbbreviation(typed, key) {
    // only when one side has an abbreviation in it, and neither is math
    if (!ABBR_TEST.test(normalize(typed) + ' ' + normalize(key)) || /[\d=<>+*/^]/.test(String(typed) + key)) return false;
    const a = abbrCanon(typed), b = abbrCanon(key);
    return a === b || lenientWordMatch(a, b) === 'exact';
  }
  // An element's symbol for its name, when the key is the element; the
  // name for the symbol, unless the question asks for the symbol (then Close).
  function elementSymbolName(typed, key, questionText) {
    const t = String(typed).trim(), k = String(key).trim().replace(/\s+element$/i, '');
    const kName = ELEMENT_NAMES.byName[k.toUpperCase()];
    if (kName) {
      const sym = ELEMENT_NAMES.bySym[t.toUpperCase()];
      // a symbol typed with its own capitals, or in one case when it's 2 letters
      if (sym === kName && (t === sym || (t.length === 2 && (t === t.toUpperCase() || t === t.toLowerCase())) || (t.length === 1 && /^[a-z]$/i.test(t)))) return 'exact';
      return null;
    }
    const kSym = /^[A-Z][a-z]?$/.test(k) ? ELEMENT_NAMES.bySym[k.toUpperCase()] : null;
    if (kSym && ELEMENT_NAMES.byName[t.toUpperCase()] === kSym) return /\bsymbol\b/i.test(questionText || '') ? 'close' : 'exact';
    return null;
  }

  // ---- The same answer written another way ----
  // Run after every other check has failed, on short answers only.

  // Math that's equal in value: "pi^2/6" or "pi*pi/6" for "π^2/6", "sqrt3/2"
  // for "√3/2", "e^7 sqrt(pi)" for "e^7 √π", "1.4x - 5.2" for "(7/5)x −
  // 26/5", "(12+5i)/13" for "12/13 + (5/13)i", "I/(pt)" for "r = I/(pt)".
  // Both sides are evaluated at the same random points (i and every letter
  // a variable, π and e constants) and must agree everywhere, including
  // where neither is defined. Guards, so equal value isn't enough to pass:
  //  - the typed answer may not use more numbers and letters than the key,
  //    so working the question out ("692 - 312" for 380, "(x+1)^2" for
  //    x^2 + 2x + 1) never passes for its result;
  //  - a question that asks for a form (expand, factor, simplify, simplest,
  //    lowest terms, rationalize, complete the square) is left to the
  //    form-by-form checks above;
  //  - plain numbers, and expressions of plain numbers with nothing
  //    irrational in them, are left to the existing rules (unreduced
  //    fractions and dropped significant figures stay wrong);
  //  - a fraction of two whole numbers must be in lowest terms.
  const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  const FUNC_NAMES = 'arcsin|arccos|arctan|sinh|cosh|tanh|sech|csch|coth|sin|cos|tan|sec|csc|cot|ln|log';
  // (a letter stuck to the name only when it's x, y, z, t or θ: "SINE" and
  // "LOGS" are words)
  const FUNC_ARG = '(?:\\d+(?:\\.\\d+)?(?![\\d.A-Za-z(^])|\\d*LETTER(?![A-Za-z0-9(^_])|\\d*LETTER(?=(?:' + FUNC_NAMES + ')))';
  const FUNC_ARG_RE = new RegExp('(?<![A-Za-z])(' + FUNC_NAMES + ')(\\^\\(?-?\\d+\\)?)?'
    + '(?:\\s+(' + FUNC_ARG.replace(/LETTER/g, '[a-zθ]') + ')|(' + FUNC_ARG.replace(/LETTER/g, '[xyztθ]') + '))', 'gi');
  // (again until nothing changes, so the second of "sinxcosx" is seen once
  // the first has become "sin(x)")
  function funcArgs(text) {
    let prev = null, out = text;
    for (let k = 0; k < 6 && out !== prev; k++) {
      prev = out;
      out = out.replace(FUNC_ARG_RE, (m, f, pow, spaced, glued) => f + (pow || '') + '(' + (spaced || glued) + ')');
    }
    return out;
  }
  function mathText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^(' + [...m].map((c) => SUPERSCRIPTS[c]).join('') + ')')
      .replace(/\*\*/g, '^')
      .replace(/[πΠ]/g, ' pi ')
      // "2pir^2", "pie^4": pi written straight before a variable
      .replace(/(^|[^A-Za-z])pi(?=[a-z])/gi, '$1pi ')
      // "sqrt3", "sqrt 3", "sqrt(3)", "cbrt 2": a radical sign
      .replace(/\bsqrt\b\s*|sqrt(?=[\d(])/gi, '√').replace(/\bcbrt\b\s*|cbrt(?=[\d(])/gi, '∛')
      .replace(/\binfinity\b/gi, '∞')
      // a function's simple argument typed without brackets: "sin x" is
      // sin(x), "2 sin x cos x" is 2 sin(x) cos(x), "ln 2" is ln(2), "cos 5x"
      // is cos(5x), "sin^2 x" is sin^2(x) and "sinxcosx" is sin(x)cos(x)
      .replace(/[^]*/, funcArgs)
      // a letter with a number stuck to it is a subscripted symbol: "ε0",
      // "μ0", "H0", "v1" (not ε·0)
      .replace(/(^|[^A-Za-z_^])([A-Za-zα-ωΑ-Ω])(\d+)(?![A-Za-z0-9.])/g, (m, pre, l, d) => (/\d$/.test(pre) && /e/i.test(l) ? m : pre + l + '_' + d));
  }
  const FORM_ASKED_RE = /\b(?:expand|expanded|factor|factored|factorization|factorise|factorize|simplif\w*|simplest|lowest terms|rationaliz\w*|complete the square|distribute|multiply out|combine like)\b/i;
  const EVAL_CONSTANTS = { PI: Math.PI, E: Math.E };
  // Each letter of a run of letters is its own variable ("PT" is p·t),
  // except names (Greek letters, hbar) and subscripted symbols.
  function exprVars(sides) {
    const vars = new Set();
    const walk = (n) => {
      if (!n) return;
      if (n.t === 'leaf') {
        if (/^\d/.test(n.v) || n.v in EVAL_CONSTANTS) return;
        if (EXPR_NAMES.has(n.v) || n.v.includes('_')) vars.add(n.v);
        else [...n.v].forEach((c) => vars.add(c));
      } else { walk(n.a); walk(n.b); walk(n.x); }
    };
    sides.forEach(walk);
    return vars;
  }
  function leafCount(n) {
    if (!n) return 0;
    if (n.t === 'leaf') return /^\d/.test(n.v) || n.v in EVAL_CONSTANTS || EXPR_NAMES.has(n.v) || n.v.includes('_') ? 1 : n.v.length;
    // a power of 1/2 or 1/3 counts as its root sign, so "2^(1/3)" may stand
    // for "∛2"
    if (n.t === 'pow' && n.b.t === 'div' && n.b.a.t === 'leaf' && n.b.a.v === '1' && n.b.b.t === 'leaf' && /^[23]$/.test(n.b.b.v)) return leafCount(n.a);
    return leafCount(n.a) + leafCount(n.b) + leafCount(n.x);
  }
  function hasIrrational(n) {
    if (!n) return false;
    if (n.t === 'leaf') return !/^\d/.test(n.v);
    if (n.t === 'fn') return true;
    if (n.t === 'pow') {
      // a whole-number power (10^-14, x^3) is still rational
      const e = n.b && n.b.t === 'neg' ? n.b.x : n.b;
      if (!e || e.t !== 'leaf' || !/^\d+$/.test(e.v)) return true;
      return hasIrrational(n.a);
    }
    return hasIrrational(n.a) || hasIrrational(n.b) || hasIrrational(n.x);
  }
  function unreducedFraction(n) {
    if (!n) return false;
    if (n.t === 'div' && n.a.t === 'leaf' && n.b.t === 'leaf' && /^\d+$/.test(n.a.v) && /^\d+$/.test(n.b.v)) {
      return gcd(BigInt(n.a.v), BigInt(n.b.v)) !== 1n;
    }
    return unreducedFraction(n.a) || unreducedFraction(n.b) || unreducedFraction(n.x);
  }
  const FN_EVAL = {
    SIN: Math.sin, COS: Math.cos, TAN: Math.tan, SEC: (x) => 1 / Math.cos(x), CSC: (x) => 1 / Math.sin(x), COT: (x) => 1 / Math.tan(x),
    ARCSIN: Math.asin, ARCCOS: Math.acos, ARCTAN: Math.atan, SINH: Math.sinh, COSH: Math.cosh, TANH: Math.tanh,
    LN: Math.log, LOG: Math.log10, EXP: Math.exp, SQRT: Math.sqrt, CBRT: Math.cbrt, ABS: Math.abs,
  };
  function evalNode(n, env) {
    switch (n.t) {
      case 'leaf': {
        if (/^\d/.test(n.v)) return parseFloat(n.v);
        if (n.v in EVAL_CONSTANTS) return EVAL_CONSTANTS[n.v];
        if (EXPR_NAMES.has(n.v) || n.v.includes('_')) return env[n.v];
        return [...n.v].reduce((acc, c) => acc * env[c], 1);
      }
      case 'add': return evalNode(n.a, env) + evalNode(n.b, env);
      case 'sub': return evalNode(n.a, env) - evalNode(n.b, env);
      case 'mul': return evalNode(n.a, env) * evalNode(n.b, env);
      case 'div': return evalNode(n.a, env) / evalNode(n.b, env);
      case 'neg': return -evalNode(n.x, env);
      case 'pow': return Math.pow(evalNode(n.a, env), evalNode(n.b, env));
      case 'fn': return FN_EVAL[n.name] ? FN_EVAL[n.name](evalNode(n.x, env)) : NaN;
      default: return NaN;
    }
  }
  // A seeded generator, so a grade never changes from one try to the next.
  function seededRandom(seed) {
    let x = seed >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  // f and g (functions of env) agree wherever either is defined; with
  // `ratio`, g is a nonzero constant multiple of f (two equations).
  function sameValues(f, g, vars, ratio) {
    const rnd = seededRandom(0x5eed);
    let compared = 0, k = null, nonzero = false;
    for (let t = 0; t < 24; t++) {
      const env = {};
      vars.forEach((v) => { let x; do { x = (rnd() * 6 - 3); } while (Math.abs(x) < 0.3); env[v] = x; });
      const a = f(env), b = g(env);
      const okA = Number.isFinite(a), okB = Number.isFinite(b);
      if (okA !== okB) return false;
      if (!okA) continue;
      const tol = 1e-9 * Math.max(Math.abs(a), Math.abs(b));
      if (ratio) {
        if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) continue;
        if (Math.abs(a) < 1e-12 || Math.abs(b) < 1e-12) return false;
        const r = b / a;
        if (k === null) k = r;
        else if (Math.abs(r - k) > 1e-9 * Math.max(1, Math.abs(k))) return false;
      } else if (Math.abs(a - b) > tol) return false;
      if (Math.abs(a) > 1e-12 || Math.abs(b) > 1e-12) nonzero = true;
      compared++;
    }
    // (two things that are 0 everywhere, "0 m/s" and "0 m*s", aren't shown equal)
    return compared >= 4 && nonzero;
  }
  function sameSet(a, b) { return a.size === b.size && [...a].every((x) => b.has(x)); }
  // "y = expr" or "f(x) = expr" with a lone letter (or call) on the left:
  // the expression it names.
  function namedValue(sides) {
    if (sides.length !== 2) return null;
    const [l, r] = sides;
    if (l.t === 'leaf' && /^[A-Z]$/.test(l.v)) return { name: l.v, expr: r };
    return null;
  }
  function mathEquivalent(typed, key, questionText) {
    // the same expression in other notation ("sqrt(42)/3" for "√42/3"),
    // which is fine even when a form is asked for
    // (not numbers alone: "3 1 2" is a ranking, "1.0" not "1")
    if (/^[\s\d.,;:+\-−–]*$/.test(typed) || /^[\s\d.,;:+\-−–]*$/.test(key)) {
      const named = String(key).match(/^\s*[A-Za-z]\s*=\s*([^=]+)$/);
      return !!(named && pureNumber(named[1]) && pureNumber(typed) && normEqual(typed, named[1]));
    }
    const ct = parseExpression(mathText(typed)), ck = parseExpression(mathText(key));
    if (ct && ck && (ct.length > 1 || ct[0].t !== 'leaf') && ct.length === ck.length && canonExpression(ct) === canonExpression(ck)) return true;
    if (FORM_ASKED_RE.test(questionText || '')) return false;
    // a long decimal is an approximation ("e^7*1.7724538509" for "e^7 √π")
    if ((String(typed).match(/\d*\.\d+/g) || []).some((d) => d.replace(/^0*\.?0*/, '').replace('.', '').length > 6)) return false;
    // "4" for "y = 4", "x = -2"
    const named = String(key).match(/^\s*[A-Za-z]\s*=\s*([^=]+)$/);
    if (named && pureNumber(named[1]) && pureNumber(typed)) return normEqual(typed, named[1]);
    if (pureNumber(typed) || pureNumber(key)) return false;
    const ta = parseExpression(mathText(typed)), kb = parseExpression(mathText(key));
    if (!ta || !kb) return false;
    let tExpr, kExpr;
    if (ta.length === 1 && kb.length === 1) { tExpr = ta[0]; kExpr = kb[0]; }
    else if (ta.length === 2 && kb.length === 2) {
      // Two equations: the same relation, sides in any order, scaled or moved.
      const nt = namedValue(ta), nk = namedValue(kb);
      if (nt && nk && nt.name === nk.name) { tExpr = nt.expr; kExpr = nk.expr; }
      else {
        const diff = (s) => ({ t: 'sub', a: s[0], b: s[1] });
        const vt = exprVars(ta), vk = exprVars(kb);
        const sideLeaves = (sd) => sd.reduce((acc, x) => acc + (x.t === 'leaf' && x.v === '0' ? 0 : leafCount(x)), 0);
        if (!sameSet(vt, vk) || sideLeaves(ta) > sideLeaves(kb) || unreducedFraction(diff(ta))) return false;
        return sameValues((env) => evalNode(diff(kb), env), (env) => evalNode(diff(ta), env), vk, true);
      }
    } else {
      // "I/(pt)" for "r = I/(pt)", and the other way round
      const nt = ta.length === 2 ? namedValue(ta) : null, nk = kb.length === 2 ? namedValue(kb) : null;
      if (nk && ta.length === 1) { tExpr = ta[0]; kExpr = nk.expr; }
      else if (nt && kb.length === 1) { tExpr = nt.expr; kExpr = kb[0]; }
      else return false;
    }
    if (tExpr.t === 'leaf' && kExpr.t === 'leaf') return false;
    const vt = exprVars([tExpr]), vk = exprVars([kExpr]);
    if (!sameSet(vt, vk)) return false;
    if (!vk.size && !hasIrrational(kExpr)) return false;
    if (leafCount(tExpr) > leafCount(kExpr) || unreducedFraction(tExpr)) return false;
    return sameValues((env) => evalNode(kExpr, env), (env) => evalNode(tExpr, env), vk, false);
  }

  // A vector or point with its parts in any brackets, or none: "(1/9, 4/9,
  // 8/9)" or "1/9, 4/9, 8/9" for "[1/9, 4/9, 8/9]". Only when the question
  // is about a vector, point or coordinates; an interval's brackets are its
  // answer (see bracketConflict).
  const TUPLE_QUESTION_RE = /\b(?:vectors?|points?|coordinates?|ordered (?:pair|triple)|tuple)\b/i;
  const INTERVAL_QUESTION_RE = /\b(?:intervals?|range|domain|interval notation)\b/i;
  function tupleParts(raw) {
    let s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^([([<⟨])(.*)([)\]>⟩])$/s);
    const open = m ? m[1] : '', close = m ? m[3] : '';
    if (m) s = m[2];
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur.trim());
    return parts.length >= 2 && parts.every(Boolean) ? { open, close, parts } : null;
  }
  function sameTuple(typed, key, questionText) {
    if (!TUPLE_QUESTION_RE.test(questionText || '') || INTERVAL_QUESTION_RE.test(questionText || '')) return false;
    const t = tupleParts(typed), k = tupleParts(key);
    if (!t || !k || !k.open || t.parts.length !== k.parts.length) return false;
    // a stray bracket ("<-1, 2, -2" or ">-1,2,-2>") isn't a vector typed another way
    if (!t.open && /^[([<⟨)\]>⟩]|[([<⟨)\]>⟩]$/.test(String(typed).trim())) return false;
    return k.parts.every((kp, i) => normEqual(t.parts[i], kp) || compactEqual(t.parts[i], kp) || mathEquivalent(t.parts[i], kp, ''));
  }
  // An interval typed with other brackets is another interval: "(−π/2,
  // π/2)" is not "[−π/2, π/2]".
  function bracketConflict(typed, key, questionText) {
    if (!INTERVAL_QUESTION_RE.test(questionText || '')) return false;
    const t = tupleParts(typed), k = tupleParts(key);
    return !!(t && k && k.open && k.parts.length === 2 && t.parts.length === 2 && (t.open !== k.open || t.close !== k.close));
  }

  // A key that numbers its answers ("1 VENUS, 2 MARS, 3 MERCURY", "I)
  // ADENINE; II) GUANINE") answered in that order without the numbers:
  // "venus, mars, mercury".
  const LABEL_RE = /^\s*\(?((?:IX|IV|V?I{1,3}|V)|[1-9])\s*[).:\-–]?\s+(?=\S)/i;
  function labelledKeySpec(key) {
    const items = answerParts(key) || listItems(key);
    if (!items || items.length < 2) return null;
    const stripped = [];
    for (let i = 0; i < items.length; i++) {
      const m = items[i].match(LABEL_RE);
      if (!m) return null;
      const lab = m[1].toUpperCase();
      const n = /^\d$/.test(lab) ? +lab : ROMAN_VALUE[lab];
      if (n !== i + 1) return null;
      stripped.push(items[i].slice(m[0].length).trim());
    }
    if (stripped.some((x) => !/[A-Z]/i.test(x))) return null;
    return { n: stripped.length, alts: stripped.map(partVariants), floating: [], ordered: true, noSlash: true };
  }

  // A key that is only roman item numerals ("I, III, II", "II ONLY", "I
  // AND III") read with digits, and the typed answer too, for a question
  // whose items aren't marked in a way the list checks find.
  const ROMAN_LIST_RE = /^\s*(?:(?:IX|IV|V?I{1,3}|V)\b[\s,;&]*(?:\b(?:AND|ONLY|OR|THEN)\b[\s,;&]*)?)+$/i;
  function romanListDigits(s) {
    return String(s).replace(/\b(IX|IV|V?I{1,3}|V)\b/gi, (m) => String(ROMAN_VALUE[m.toUpperCase()]));
  }
  function sameRomanList(typed, key, questionText) {
    // and the other way round: "I, III, II" for a key of "1, 3, 2"
    if (/^\s*\d\s*(?:(?:[,;&]|\b(?:AND|THEN)\b)\s*\d\s*)+$/i.test(key) && ROMAN_LIST_RE.test(typed)) {
      return sameRomanList(key, typed, questionText);
    }
    if (!ROMAN_LIST_RE.test(key)) return false;
    // a lone "I" may be iodine, the imaginary unit or a pronoun: only when
    // the question numbers its items with roman numerals
    if ((key.match(/\b(?:IX|IV|V?I{1,3}|V)\b/gi) || []).length < 2 && !/\bII\b/.test(questionText || '')) return false;
    const t = /^[\s\dIVXivx,;&]*(?:\b(?:and|only|or|then)\b[\s\dIVXivx,;&]*)*$/i.test(typed) ? romanListDigits(typed) : null;
    if (!t) return false;
    const k = romanListDigits(key);
    const bare = (x) => normalize(String(x).replace(/\bONLY\b/gi, ' ').replace(/\b(?:AND|THEN)\b|[,;&]/gi, ' '));
    return bare(t) === bare(k);
  }

  function sameAnswerOtherForm(question, userInput) {
    const a = question.answer;
    const typed = String(userInput || '').trim();
    if (!typed) return false;
    // (a lone accept for one part of a multi-part key is not a whole answer)
    const multiKey = !!answerParts(a.text);
    const keys = [a.text, ...(a.accept || []).filter((x) => !multiKey || !isPartFragment(x))].filter(Boolean);
    const rejects = (a.reject || []).filter(Boolean);
    const q = question.question || '';
    let close = false;
    const hit = (k) => {
      const ec = sameElectronConfig(typed, k, q) || elementSymbolName(typed, k, q);
      if (ec === 'close') { close = true; return false; }
      if (ec === 'exact') return true;
      return mathEquivalent(typed, k, q) || sameTuple(typed, k, q) || sameRomanList(typed, k, q)
        || samePlusMinus(typed, k) || sameIsotope(typed, k) || sameTrueFalse(typed, k, q) || sameRatio(typed, k, q)
        || sameOrdinal(typed, k) || sameJoined(typed, k) || sameAbbreviation(typed, k) || sameGenotype(typed, k, q)
        || (() => { const spec = labelledKeySpec(k); return !!spec && checkMultiPart(typed, spec) === 'exact'; })();
    };
    if (!keys.some(hit)) return close ? 'close' : false;
    // a "do not accept" form said another way is still not accepted
    return rejects.some((r) => normEqual(typed, r) || mathEquivalent(typed, r, '')) ? false : 'exact';
  }

  // An accept entry that is a note about answers rather than an answer: an
  // order note ("in any order", "in that order"), which the order checks
  // read, or a range or class for the player to override on ("ANYTHING
  // BETWEEN 90 AND 95", "Anything metallic"). Typed as is, it is no answer.
  const NOTE_RE = new RegExp([
    '^\\s*(?:(?:in|either)\\s+)?(?:either|any|that|this)\\s+order\\s*$',
    '^\\s*anything\\b',
    '^\\s*any\\s+(?:value|answer|number|indication|variant|subset|other|switching|cyclic|ordering|common\\s+name)\\b',
    '^\\s*accept\\s+answers?\\s+within\\b',
  ].join('|'), 'i');
  const isNote = (x) => NOTE_RE.test(String(x == null ? '' : x));
  function checkAnswerCore(question, userInput) {
    if (String(userInput || '').length > MAX_ANSWER_LENGTH) return { correct: false, matched: null, rejected: false };
    if (question && question.answer && (question.answer.accept || []).some(isNote)) {
      const a = question.answer;
      question = { ...question, answer: { ...a, accept: a.accept.filter((x) => !isNote(x)), notes: [...(a.notes || []), ...a.accept.filter(isNote)] } };
    }
    // (never on multiple choice, whose answer is the choice exactly as
    // printed: "Beta-minus decay" is typed as it reads, not as "beta- decay")
    if (question && question.answer && question.format !== 'MC' && SIGN_WORD_TEST.test(String(userInput || '') + ' ' + question.answer.text + ' ' + (question.answer.accept || []).join(' ') + ' ' + (question.answer.reject || []).join(' '))) {
      const a = question.answer;
      question = { ...question, answer: { ...a, text: signWords(a.text), accept: (a.accept || []).map(signWords), reject: (a.reject || []).map(signWords) } };
      userInput = signWords(userInput);
    }
    if (question && question.answer && question.format !== 'MC' && VULGAR_TEST.test(String(userInput || '') + question.answer.text + (question.answer.accept || []).join('') + (question.answer.reject || []).join(''))) {
      const a = question.answer;
      question = { ...question, answer: { ...a, text: slashFractions(a.text), accept: (a.accept || []).map(slashFractions), reject: (a.reject || []).map(slashFractions) } };
      userInput = slashFractions(userInput);
    }
    if (question && question.answer && question.format !== 'MC') {
      // "+/-" and "plus or minus" are "±" on both sides
      // (only when the player wrote one of them: "-/-" stays a different answer)
      if (/\+\s*\/\s*-|\+-|plus\s+or\s+minus|±/i.test(String(userInput || '')) && /\+\s*\/\s*-|\+-|plus\s+or\s+minus|±/i.test([question.answer.text, ...(question.answer.accept || []), ...(question.answer.reject || [])].join(' '))) {
        const a = question.answer;
        question = { ...question, answer: { ...a, text: plusMinus(a.text), accept: (a.accept || []).map(plusMinus), reject: (a.reject || []).map(plusMinus) } };
        userInput = plusMinus(userInput);
      }
      // the answer as typed first; then with keyboard stand-ins read as symbols
      const swapped = typedStandIns(userInput, [question.answer.text, ...(question.answer.accept || [])].filter(Boolean));
      if (swapped !== String(userInput == null ? '' : userInput)) {
        const first = gradeTyped(question, userInput);
        if (first.correct || first.rejected) return first;
        const second = gradeTyped(question, swapped);
        return second.correct ? second : first;
      }
    }
    return gradeTyped(question, userInput);
  }
  // ---- A second look, the way a moderator would give one ----
  // Run only when everything above has failed (and the answer isn't on the
  // reject list), on short answers. Each step rewrites the typed answer or
  // the key into a form the checks above already understand and grades
  // again; a form on the reject list stays rejected.
  const SPELLED_VALUE = Object.fromEntries(SPELLED_NUMBERS.map((w, i) => [w, i]));
  // Does the question ask for a precision? Then trailing zeros are part of it.
  const SIGFIG_RE = /\bsignificant\s+(?:figures?|digits?)\b|\bsig\.?\s*figs?\b|\bdecimal\s+places?\b|\bnearest\s+(?:tenth|hundredth|thousandth|cent)\b|\bdecimal\s+point\b/i;
  function trimZeros(s) {
    return String(s).replace(/(\d+)\.(\d*?)0+(?![\d])/g, (m, a, b) => (b ? a + '.' + b : a)).replace(/\$\s*(?=\d)/g, '');
  }
  const NONE_TYPED_RE = /^(?:none|neither|no\s+one|not\s+any)(?:\s+of\s+(?:them|these|those|the\s+above|the\s+following|the\s+(?:\w+\s+)?\w+))?(?:\s+(?:are|is|apply|applies|do|does|would|will|were|was)(?:\s+\w+){0,3})?$/i;
  const NONE_KEY_RE = /^(?:NONE|NEITHER)(?: OF (?:THEM|THESE|THOSE|THE ABOVE|THE FOLLOWING))?$/;
  // Formulas a player types for a common substance (and the reverse).
  const COMPOUND_NAMES = Object.fromEntries(('H2O water,CO2 carbon dioxide,CO carbon monoxide,N2 nitrogen,O2 oxygen,H2 hydrogen,O3 ozone,Cl2 chlorine,'
    + 'F2 fluorine,Br2 bromine,I2 iodine,CH4 methane,NH3 ammonia,NaCl sodium chloride,HCl hydrochloric acid,H2SO4 sulfuric acid,HNO3 nitric acid,'
    + 'NaOH sodium hydroxide,KOH potassium hydroxide,CaCO3 calcium carbonate,SiO2 silicon dioxide,NO2 nitrogen dioxide,SO2 sulfur dioxide,'
    + 'SO3 sulfur trioxide,N2O nitrous oxide,NO nitric oxide,H2O2 hydrogen peroxide,C6H12O6 glucose,KCl potassium chloride,H2S hydrogen sulfide,'
    + 'CaO calcium oxide,MgO magnesium oxide,C2H5OH ethanol,CH3OH methanol,C2H6 ethane,C3H8 propane,C2H4 ethene,C2H2 ethyne,C6H6 benzene,'
    + 'H3PO4 phosphoric acid,H2CO3 carbonic acid,HF hydrofluoric acid,NaHCO3 sodium bicarbonate,CaSO4 calcium sulfate,Al2O3 aluminum oxide,'
    + 'Fe2O3 iron(III) oxide,TiO2 titanium dioxide,ZnO zinc oxide,CS2 carbon disulfide,CCl4 carbon tetrachloride,HCN hydrogen cyanide,'
    + 'SOx sulfur oxides,NOx nitrogen oxides').split(',').map((x) => { const i = x.indexOf(' '); return [x.slice(0, i), x.slice(i + 1).toUpperCase()]; }));
  const ION_NAMES = { NO3: ['NITRATE', '1-'], SO4: ['SULFATE', '2-'], PO4: ['PHOSPHATE', '3-'], CO3: ['CARBONATE', '2-'], OH: ['HYDROXIDE', '1-'],
    NH4: ['AMMONIUM', '1+'], HCO3: ['BICARBONATE', '1-'], MNO4: ['PERMANGANATE', '1-'], CLO4: ['PERCHLORATE', '1-'], CLO3: ['CHLORATE', '1-'],
    NO2: ['NITRITE', '1-'], SO3: ['SULFITE', '2-'], CN: ['CYANIDE', '1-'], H3O: ['HYDRONIUM', '1+'], CRO4: ['CHROMATE', '2-'],
    CR2O7: ['DICHROMATE', '2-'], C2O4: ['OXALATE', '2-'], CH3COO: ['ACETATE', '1-'], C2H3O2: ['ACETATE', '1-'] };
  const AMINO_ACIDS = { ALA: 'ALANINE', ARG: 'ARGININE', ASN: 'ASPARAGINE', ASP: 'ASPARTATE', CYS: 'CYSTEINE', GLN: 'GLUTAMINE', GLU: 'GLUTAMATE',
    GLY: 'GLYCINE', HIS: 'HISTIDINE', ILE: 'ISOLEUCINE', LEU: 'LEUCINE', LYS: 'LYSINE', MET: 'METHIONINE', PHE: 'PHENYLALANINE', PRO: 'PROLINE',
    SER: 'SERINE', THR: 'THREONINE', TRP: 'TRYPTOPHAN', TYR: 'TYROSINE', VAL: 'VALINE' };
  const COMPOUND_ALT = { HCl: 'HYDROGEN CHLORIDE', HF: 'HYDROGEN FLUORIDE', C2H4: 'ETHYLENE', C2H2: 'ACETYLENE', SiO2: 'SILICA', NaCl: 'TABLE SALT', N2O: 'DINITROGEN MONOXIDE', H2O: 'DIHYDROGEN MONOXIDE' };
  const COMPOUND_BY_UPPER = Object.fromEntries(Object.keys(COMPOUND_NAMES).map((f) => [f.toUpperCase(), f]));
  const LIST_SPLIT_RE = /(\s*(?:,|;|&|\band\b)\s*)/i;
  // Each formula or element symbol in a list, as its name. A formula with a
  // digit is read in any case ("co2"); one without only in its own capitals
  // ("CO" is carbon monoxide, "Co" cobalt, "co" neither).
  function formulasToNames(text) {
    let changed = false;
    const out = String(text).split(LIST_SPLIT_RE).map((seg, i) => {
      if (i % 2) return seg;
      const t = seg.trim().replace(/\s+(?:gas|molecules?)$/i, '');
      if (!t || /\s/.test(t)) return seg;
      const f = COMPOUND_NAMES[t] ? t : (/\d/.test(t) ? COMPOUND_BY_UPPER[t.toUpperCase()] : null);
      if (f) { changed = true; return COMPOUND_NAMES[f]; }
      // an ion with its charge: "NO3-", "SO4 2-", "NH4+", "SO4^(2-)"
      for (const re of [/^([A-Za-z0-9]+)\s*\^?\(?()([+\-−])\)?$/, /^([A-Za-z0-9]+?)\s*\^?\(?(\d*)([+\-−])\)?$/]) {
        const ion = seg.trim().match(re);
        const known = ion && ION_NAMES[ion[1].toUpperCase()];
        if (known && (ion[2] || '1') + (ion[3] === '+' ? '+' : '-') === known[1]) { changed = true; return known[0]; }
      }
      if (/^[A-Za-z]{3}$/.test(t) && AMINO_ACIDS[t.toUpperCase()]) { changed = true; return AMINO_ACIDS[t.toUpperCase()]; }
      const sym = ELEMENT_NAMES.bySym[t.toUpperCase()];
      if (sym && (t === sym || (t.length === 2 && t === t.toLowerCase()))) {
        const name = Object.keys(ELEMENT_NAMES.byName).find((n) => ELEMENT_NAMES.byName[n] === sym && !/^(?:ALUMINIUM|SULPHUR|CAESIUM)$/.test(n));
        if (name) { changed = true; return name; }
      }
      return seg;
    });
    return { text: out.join(''), changed };
  }
  function numberValue(s) {
    const m = String(s).trim().match(/^([+\-−–]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const v = parseFloat(m[2].replace(/,/g, '')) / (m[3] ? parseFloat(m[3]) : 1);
    return Number.isFinite(v) ? (m[1] && m[1] !== '+' ? -v : v) : null;
  }
  // A quantity with an SI prefix, as a value in the base unit: "1.2 kPa",
  // "0.13 nm", "360 kJ", "1.7 milliohms", "2.07 x 10^2 J".
  const SI_BASE = { M: 'm', G: 'g', S: 's', J: 'J', W: 'W', V: 'V', A: 'A', N: 'N', PA: 'Pa', HZ: 'Hz', L: 'L', MOL: 'mol', K: 'K', OHM: 'ohm', 'Ω': 'ohm',
    F: 'F', C: 'C', T: 'T', EV: 'eV', CAL: 'cal' };
  const SI_BASE_NAME = { METER: 'm', METRE: 'm', GRAM: 'g', SECOND: 's', JOULE: 'J', WATT: 'W', VOLT: 'V', AMP: 'A', AMPERE: 'A', NEWTON: 'N', PASCAL: 'Pa',
    HERTZ: 'Hz', LITER: 'L', LITRE: 'L', MOLE: 'mol', KELVIN: 'K', OHM: 'ohm', FARAD: 'F', COULOMB: 'C', TESLA: 'T', ELECTRONVOLT: 'eV', CALORIE: 'cal' };
  const SI_PREFIX_SYM = { p: 1e-12, n: 1e-9, u: 1e-6, 'μ': 1e-6, 'µ': 1e-6, m: 1e-3, c: 1e-2, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  const SI_PREFIX_NAME = { PICO: 1e-12, NANO: 1e-9, MICRO: 1e-6, MILLI: 1e-3, CENTI: 1e-2, KILO: 1e3, MEGA: 1e6, GIGA: 1e9, TERA: 1e12 };
  function siUnit(u) {
    const raw = String(u).trim();
    const up = raw.toUpperCase().replace(/\s+/g, '');
    const nm = up.match(/^(PICO|NANO|MICRO|MILLI|CENTI|KILO|MEGA|GIGA|TERA)?-?(METER|METRE|GRAM|SECOND|JOULE|WATT|VOLT|AMPERE|AMP|NEWTON|PASCAL|HERTZ|LITER|LITRE|MOLE|KELVIN|OHM|FARAD|COULOMB|TESLA|ELECTRONVOLT|CALORIE)S?$/);
    if (nm) return { base: SI_BASE_NAME[nm[2]], factor: nm[1] ? SI_PREFIX_NAME[nm[1]] : 1 };
    if (/\s/.test(raw)) return null;
    if (SI_BASE[up]) return { base: SI_BASE[up], factor: 1 };
    const pre = SI_PREFIX_SYM[raw[0]], rest = raw.slice(1).toUpperCase();
    if (pre && SI_BASE[rest]) return { base: SI_BASE[rest], factor: pre };
    return null;
  }
  function plainNumber(t) {
    const x = String(t).trim().replace(/[−–]/g, '-').replace(/,(?=\d{3})/g, '');
    let m = x.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:[x×*·]|times)\s*10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?$/i);
    if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
    m = x.match(/^10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?$/);
    if (m) return Math.pow(10, parseInt(m[1], 10));
    if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(x)) return parseFloat(x);
    return null;
  }
  function siQuantity(text) {
    const t = String(text).trim();
    const m = t.match(/^(.*?[\d)])\s*([A-Za-zΩμµ][A-Za-zΩμµ -]*)$/);
    if (!m) { const v = plainNumber(t); return v == null ? null : { value: v, base: null, factor: 1 }; }
    const v = plainNumber(m[1]);
    const u = siUnit(m[2]);
    if (v == null || !u) return null;
    return { value: v * u.factor, base: u.base, factor: u.factor, raw: v };
  }
  const PERCENT_RE = /^(.*?\d)\s*(?:%|percent|per\s+cent)$/i;
  // The question's words, with simple endings folded, for "does the question
  // itself say this word?"
  function questionWordSet(questionText) {
    const out = new Set();
    for (const w of tokenize(questionText || '')) {
      out.add(w);
      for (const end of ['S', 'ES', 'ING', 'ED', 'IC', 'AL']) if (w.length > end.length + 3 && w.endsWith(end)) out.add(w.slice(0, -end.length));
    }
    return out;
  }
  function inQuestion(w, qWords) {
    if (qWords.has(w)) return true;
    for (const end of ['S', 'ES', 'ING', 'ED']) if (w.length > end.length + 3 && w.endsWith(end) && qWords.has(w.slice(0, -end.length))) return true;
    return qWords.has(w + 'S') || qWords.has(w + 'ING') || qWords.has(w + 'ES');
  }
  const UNIT_PREFIX = { T: 'TERA', G: 'GIGA', M: 'MEGA', K: 'KILO', C: 'CENTI', N: 'NANO', U: 'MICRO', P: 'PICO' };
  // Is this unit (a word or symbol the player typed after a number) one the
  // question itself names?
  function unitAsked(w, q, qWords) {
    if (inQuestion(w, qWords) && (unitSymbol(w) || /^(?:GIGA|MEGA|KILO|MILLI|MICRO|NANO|CENTI|TERA|PICO)[A-Z]+$/.test(w) || /^(?:HOURS?|MINUTES?|SECONDS?|DAYS?|YEARS?|GRAMS?|LITERS?|METERS?|MOLES?)$/.test(w))) return true;
    const Q = String(q || '').toUpperCase();
    if (/^(?:H|HR|HRS)$/.test(w)) return /\bHOURS?\b/.test(Q);
    if (/^(?:MIN|MINS)$/.test(w)) return /\bMINUTES?\b/.test(Q);
    if (/^(?:S|SEC|SECS)$/.test(w)) return /\bSECONDS?\b/.test(Q);
    const named = (sym) => UNIT_NAMES.filter(([, s2]) => s2 === sym).some(([n]) => new RegExp('\\b(?:' + n + ')\\b').test(Q));
    const sym = unitSymbol(w) || w;
    if (named(sym)) return true;
    // a prefixed symbol: "GJ" for "gigajoules"
    if (w.length >= 2 && UNIT_PREFIX[w[0]]) {
      return UNIT_NAMES.filter(([, s2]) => s2 === w.slice(1)).some(([n]) => new RegExp('\\b' + UNIT_PREFIX[w[0]] + '(?:' + n + ')\\b').test(Q));
    }
    return false;
  }
  const PERSON_ASKED_RE = /\b(?:scientist|physicist|chemist|biologist|astronomer|mathematician|geologist|naturalist|engineer|inventor|botanist|physician|astrophysicist|geneticist|zoologist|microbiologist|paleontologist|meteorologist|cosmologist|philosopher|monk|researcher|nobel\s+laureate)s?\b|^\s*who\b|\bwho\s+(?:was|is|first|discovered|invented|proposed|developed|formulated|coined|introduced|showed|demonstrated|published|won|received)\b|\bby\s+whom\b|\bnamed\s+(?:after|for)\s+(?:what|which|whom)\b/i;
  function secondChance(question, userInput) {
    const a = question.answer;
    const typed = String(userInput || '').trim();
    if (!typed || !a || !a.text) return null;
    const q = question.question || '';
    const keys = [a.text, ...(a.accept || [])].filter((k) => k && !isNote(k));
    const RIGHT = { correct: true, matched: 'lenient', rejected: false };
    const CLOSE = { correct: false, matched: null, rejected: false, close: true };
    const withKeys = (fn, extra) => ({ ...question, answer: { ...a, text: fn(a.text), accept: [...(a.accept || []).map((x) => (isNote(x) ? x : fn(x))), ...(extra || [])] } });
    const same = (x) => x;
    // grade a rewritten answer; null when it changes nothing
    const tries = [];
    const attempt = (t2, q2, verdict) => { tries.push([t2, q2, verdict || RIGHT]); };

    // "none of them", "none are true" for NONE; a bare 0 is Close
    if (keys.some((k) => NONE_KEY_RE.test(normalize(withoutEndNote(k))))) {
      if (NONE_TYPED_RE.test(typed)) return RIGHT;
      if (/^(?:0|zero)$/i.test(typed)) return CLOSE;
    }

    // trailing zeros and a currency sign: "1.5" for "1.50 L", "100,000" for
    // "$100,000.00" (Close when the question asks for a precision)
    {
      const t2 = trimZeros(typed);
      if (t2 !== typed || keys.some((k) => trimZeros(k) !== k)) attempt(t2, withKeys(trimZeros), SIGFIG_RE.test(q) ? CLOSE : RIGHT);
    }

    // a constant of integration, given or left out
    if (/\bintegra|\bantiderivative/i.test(q)) {
      const strip = (x) => String(x).replace(/\s*\+\s*(?:c|k|constant)\s*$/i, '');
      // (given where the key has none it is right; left out where the key has one, Close)
      if (strip(typed) !== typed) attempt(strip(typed), withKeys(strip));
      else if (keys.some((k) => strip(k) !== k) && !/(^|[^A-Za-z])[ck]($|[^A-Za-z])/i.test(typed)) attempt(typed, withKeys(strip), CLOSE);
    }

    // "f(x) = sin x" answered "sin x"; "x^2 - 6x + 13 = 0" answered without "= 0"
    {
      const extra = [];
      for (const k of keys) {
        let m = String(k).match(/^\s*(?:[A-Za-z]'{0,2}\s*\(\s*[A-Za-z]\s*\)|d[a-z]\s*\/\s*d[a-z]|[a-z]'{1,2})\s*=\s*([^=]+)$/);
        if (m) extra.push(m[1].trim());
        m = String(k).match(/^([^=]*[+\-−–][^=]*?)\s*=\s*0\s*$/);
        if (m && !/=/.test(typed) && /\bequation\b/i.test(q)) extra.push(m[1].trim());
      }
      if (extra.length) attempt(typed, withKeys(same, extra));
    }

    // a number with a unit the question names, "units", or the thing counted
    // ("9 times" on "how many times …"), for a key that is the bare number
    const numericKeys = keys.map((k) => (SPELLED_VALUE[normalize(k)] != null ? String(SPELLED_VALUE[normalize(k)]) : k)).filter((k) => !/[A-Za-z]/.test(k) && /\d/.test(k));
    if (numericKeys.length && keys.every((k) => !/[A-Za-z]/.test(k) || SPELLED_VALUE[normalize(k)] != null || numericKeys.length)) {
      const numQ = { ...question, answer: { ...a, text: numericKeys[0], accept: numericKeys.slice(1) } };
      const words = typed.split(/\s+/);
      for (let n = 1; n <= 2 && n < words.length; n++) {
        const head = words.slice(0, -n).join(' '), tail = words.slice(-n).map((w) => w.toUpperCase());
        if (!/\d/.test(head) || tail.some((w) => !/^[A-Z]+$/.test(w))) continue;
        const qWords = questionWordSet(q);
        const counted = new Set();
        const re = /\bhow\s+many\s+((?:[A-Za-z'’-]+\s+){0,3}[A-Za-z'’-]+)/gi;
        let m;
        while ((m = re.exec(q))) tokenize(m[1]).forEach((w) => { counted.add(w); counted.add(w.replace(/S$/, '')); counted.add(w + 'S'); });
        const ok = tail.every((w) => /^(?:UNITS?|SQUARE|CUBIC|SQUARED|CUBED)$/.test(w))
          || tail.every((w) => counted.has(w))
          || tail.every((w) => unitAsked(w, q, qWords));
        if (ok) attempt(head, numQ);
      }
      // "6h", "14V": a unit symbol stuck to the number
      const glued = typed.match(/^([+\-−–]?[\d.,]+)([A-Za-z]{1,3})$/);
      if (glued && unitAsked(glued[2].toUpperCase(), q, questionWordSet(q))) attempt(glued[1], numQ);
    }
    // small stand-ins: "x 10^" for "× 10^", "pi squared", a ratio as "11:10"
    {
      let t2 = typed.replace(/\s+x\s+(?=10\s*\^)/i, ' × ').replace(/(\S)\s+squared\b/gi, '$1^2').replace(/(\S)\s+cubed\b/gi, '$1^3');
      if (/\bratios?\b|\bodds\b/i.test(q)) t2 = t2.replace(/^(\d+)\s*(?::|\bto\b)\s*(\d+)$/i, '$1/$2');
      if (t2 !== typed) attempt(t2, question);
    }

    // a unit after an expression: "sqrt(k)/7" for "(√k / 7) HERTZ"
    {
      const extra = [];
      let t2 = typed;
      for (const k of keys) {
        const m = String(k).trim().match(/^(.*[^A-Za-z\s*\/^·+\-−–=])\s*([A-Za-zΩ°]+(?:\s+PER\s+[A-Za-z]+)?)$/i);
        if (!m || !/[√π()^]|sqrt|pi/i.test(m[1])) continue;
        const sym = unitSymbol(m[2].toUpperCase());
        if (!sym) continue;
        let body = m[1].trim();
        if (/^\(.*\)$/.test(body) && !/\).*\(/.test(body.slice(1, -1))) body = body.slice(1, -1).trim();
        extra.push(body);
        const tm = typed.match(/^(.*[^A-Za-z\s])\s*([A-Za-zΩ°]+)$/);
        if (tm && unitSymbol(tm[2].toUpperCase()) === sym) t2 = tm[1].trim();
      }
      if (extra.length) attempt(t2, withKeys(same, extra));
    }

    // one quantity with another SI prefix or in scientific notation: "1.2 kPa"
    // for "1200" on a question in pascals, "0.025 kg" for "25 GRAMS",
    // "360000 joules" for "360 KJ"
    {
      const tq = siQuantity(typed);
      if (tq && !SIGFIG_RE.test(q)) {
        const eq = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y)) && (x !== 0 || y === 0);
        for (const k of keys) {
          const kq = siQuantity(k);
          if (!kq) continue;
          if (tq.base && kq.base === tq.base && eq(tq.value, kq.value) && (tq.factor !== kq.factor || String(tq.raw) !== String(kq.raw))) return RIGHT;
          if (tq.base && !kq.base && tq.factor !== 1) {
            // the unit the question asks in
            const Q = String(q);
            const re = /([A-Za-zΩμµ]+)/g;
            let m;
            while ((m = re.exec(Q))) {
              const u = m[1].length >= 4 ? siUnit(m[1]) : null;
              if (u && u.base === tq.base && eq(tq.value, kq.value * u.factor)) return RIGHT;
            }
          }
          if (!tq.base && !kq.base && eq(tq.value, kq.value) && /\^|e/i.test(typed + k) && trimZeros(typed) !== trimZeros(k)) return RIGHT;
        }
      }
    }

    // percent, fraction and decimal of one value
    {
      const tp = typed.match(PERCENT_RE);
      const tv = tp ? numberValue(tp[1]) : numberValue(typed);
      if (tv != null) {
        for (const k of keys) {
          const kp = String(k).trim().match(PERCENT_RE);
          const kv = kp ? numberValue(kp[1]) : numberValue(k);
          if (kv == null) continue;
          const eq = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
          const asksPercent = /\bpercent|%/i.test(q);
          if (tp && !kp && !asksPercent && kv > 0 && kv <= 1 && eq(tv / 100, kv)) {
            return /\b(?:as\s+a|in)\s+(?:reduced\s+|simplest\s+|common\s+)?(?:fraction|decimal)|\bwhat\s+fraction\b/i.test(q) ? CLOSE : RIGHT;
          }
          if (!tp && tv > 0 && tv <= 1 && (kp || asksPercent) && kv > 1 && eq(tv * 100, kv)) return asksPercent ? CLOSE : RIGHT;
        }
      }
    }

    // a fraction not in lowest terms is Close
    {
      const f = typed.match(/^([+\-−–]?)\s*(\d+)\s*\/\s*(\d+)$/);
      if (f && +f[3] !== 0 && gcd(BigInt(f[2]), BigInt(f[3])) !== 1n) {
        const tv = numberValue(typed);
        if (keys.some((k) => { const kv = numberValue(k); return kv != null && Math.abs(kv - tv) < 1e-12; })) return CLOSE;
      }
    }

    // a hyphen the key doesn't have: "counter-current" for COUNTERCURRENT
    if (/[A-Za-z]-[A-Za-z]/.test(typed) && /^[A-Za-z' -]+$/.test(typed)) {
      attempt(typed.replace(/([A-Za-z])-(?=[A-Za-z])/g, '$1'), question);
    }

    // signs said or placed another way: "negative one", "1-" for a charge,
    // "2" for "+2"
    {
      const m = typed.match(/^(negative|minus|positive|plus)\s+([a-z]+)$/i);
      if (m && SPELLED_VALUE[m[2].toUpperCase()] != null) attempt((/^(?:negative|minus)$/i.test(m[1]) ? '-' : '+') + SPELLED_VALUE[m[2].toUpperCase()], question);
      const tail = typed.match(/^(\d+(?:\.\d+)?)\s*([+\-−])$/);
      if (tail && /\bcharges?\b|\boxidation\b|\bions?\b|\bvalenc/i.test(q)) attempt(tail[2] + tail[1], question);
      if (/^\d/.test(typed) && keys.some((k) => /^\s*\+\s*\d/.test(k))) attempt('+' + typed, question);
      const sci = typed.match(/^1(?:\.0+)?\s*(?:e|(?:x|×|\*)\s*10\s*\^)\s*\(?([+\-−]?\d+)\)?$/i);
      if (sci) attempt('10^' + sci[1], question);
    }

    // the abbreviation a key gives in brackets: "RFID" for "Radio Frequency
    // Identification Device (RFID)"
    for (const k of keys) {
      const m = String(k).match(/^(.+?)\s*\(([A-Za-z]{2,7})\)\s*$/);
      if (!m || normalize(typed) !== m[2].toUpperCase()) continue;
      const initials = m[1].split(/[\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('');
      if (initials.startsWith(m[2].toUpperCase()) || m[2] === m[2].toUpperCase()) return RIGHT;
    }

    // formulas and symbols for names, or names for formulas, also in a list
    {
      const t2 = formulasToNames(typed);
      const keyChanged = keys.some((k) => formulasToNames(k).changed);
      if (t2.changed || keyChanged) {
        attempt(t2.text, withKeys((k) => formulasToNames(k).text), !t2.changed && /\b(?:formula|symbol)s?\b/i.test(q) ? CLOSE : RIGHT);
      }
    }

    // a person by last name
    if (PERSON_ASKED_RE.test(q) && !/\b(?:full|first|given)\s+name\b/i.test(q) && /^[A-Za-z'’.-]+$/.test(typed) && typed.length >= 4) {
      for (const k of keys) {
        const w = String(k).trim().split(/\s+/);
        if (w.length < 2 || w.length > 4 || !w.every((x) => /^[A-Za-z'’.-]+$/.test(x))) continue;
        if (answerParts(k) || listItems(k)) continue;
        if (normEqual(typed, w[w.length - 1]) && !inQuestion(normalize(w[w.length - 1]), questionWordSet(q))) return RIGHT;
      }
    }

    // words the question itself supplies, added to the key or left off its end
    if (!isMathAnswer(typed) && !/\d/.test(typed)) {
      const qWords = questionWordSet(q);
      const tt = tokenize(typed);
      const plain = (w) => w.length >= 3 && !/\d/.test(w) && !CHEMICAL_CLASS_RE.test(w) && !NEGATORS.has(w) && inQuestion(w, qWords);
      // what the question asks by, and what that is "of": "law" and
      // "thermodynamics" in "Which law of thermodynamics …"
      const kinds = new Set(askedKindWords(q));
      {
        const qt = normalize(q).split(' ');
        qt.forEach((w, i) => {
          if (!kinds.has(w) || qt[i + 1] !== 'OF') return;
          let j = i + 2;
          while (j < qt.length && /^(?:THE|A|AN)$/.test(qt[j])) j++;
          if (qt[j] && qt[j].length >= 4) kinds.add('OF:' + qt[j]);
        });
      }
      const fold = (w) => [w, w + 'S', w + 'ING', w.replace(/S$/, ''), w.replace(/ING$/, ''), w.replace(/ES$/, '')];
      const asked = (w) => w.length >= 3 && !CHEMICAL_CLASS_RE.test(w) && fold(w).some((x) => kinds.has(x) || kinds.has('OF:' + x));
      const listQuestion = !!detectItemCount(q) || /,|;|\band\b/i.test(typed);
      for (const k of keys) {
        if (isMathAnswer(k) || /\d/.test(k) || answerParts(k) || listItems(k)) continue;
        const kt = tokenize(k);
        if (!kt.length || !tt.length || kt.length === tt.length) continue;
        if (tt.length > kt.length && tt.length - kt.length <= 3) {
          // the key with more around it
          const nk = kt.join(' ');
          for (let i = 0; i + kt.length <= tt.length; i++) {
            if (tt.slice(i, i + kt.length).join(' ') !== nk) continue;
            const extras = [...tt.slice(0, i), ...tt.slice(i + kt.length)];
            const near = (w) => kt.some((x) => x !== w && x.length >= 4 && w.length >= 4 && levenshtein(x, w) <= 2);
            if (!listQuestion && extras.every((w) => asked(w) && !near(w)) && kt.some((w) => w.length >= 3)) return RIGHT;
          }
        } else if (kt.length > tt.length && kt.length - tt.length <= 3) {
          // the key without its last words
          const head = kt.slice(0, tt.length), dropped = kt.slice(tt.length);
          if (listQuestion || !dropped.every(plain)) continue;
          const solid = head.some((w) => w.length >= 4) || dropped.every((w) => kinds.has(w));
          if (solid && (head.join(' ') === tt.join(' ') || (head.some((w) => w.length >= 4) && lenientWordMatch(tt.join(' '), head.join(' ')) === 'exact'))) return RIGHT;
        }
      }
    }

    for (const [t2, q2, verdict] of tries) {
      if (t2 === typed && q2 === question) continue;
      const r = checkAnswerCore(q2, t2);
      if (r.rejected) return null;
      if (r.correct) return verdict;
    }
    return null;
  }
  function checkAnswer(question, userInput) {
    const first = checkAnswerCore(question, userInput);
    if (first.correct || first.empty || !question || !question.answer || question.format === 'MC') return first;
    if (String(userInput || '').length > MAX_ANSWER_LENGTH) return first;
    if (first.rejected) {
      // "2+" for a key of "+2" (where a bare "2" is refused)
      const tail = String(userInput || '').trim().match(/^(\d+(?:\.\d+)?)\s*([+\-−])$/);
      if (!tail) return first;
      const again = checkAnswerCore(question, tail[2] + tail[1]);
      return again.correct ? again : first;
    }
    const second = secondChance(question, userInput);
    if (!second) return first;
    // (a Close from the first look isn't lowered by the second)
    return second.correct || !first.close ? second : first;
  }
  // Longer than any real answer: not graded (a huge paste would hold up the
  // grader, and in Multiplayer the coordinator grades everyone's answers).
  const MAX_ANSWER_LENGTH = 500;
  function gradeTyped(question, userInput) {
    if (String(userInput || '').length > MAX_ANSWER_LENGTH) return { correct: false, matched: null, rejected: false };
    const graded = gradeTypedInner(question, userInput);
    // capitals that say something other than the key's (see caseConflict)
    if (graded.correct && question && question.answer && question.format !== 'MC') {
      const keys = [question.answer.text, ...(question.answer.accept || [])].filter(Boolean);
      const exact = keys.some((k) => String(k).replace(/[\s^_()]/g, '') === String(userInput || '').replace(/[\s^_()]/g, ''));
      const typedText = String(userInput || '');
      // A key that answers each numbered item ("1 – METAMORPHIC, 2 –
      // IGNEOUS") isn't answered by numbers alone.
      const lspec = /[A-Za-z]/.test(typedText) ? null : labelledKeySpec(question.answer.text);
      if (lspec && lspec.alts.every((a) => !/\d/.test(a[0]))) return { correct: false, matched: null, rejected: false };
      // Item numbers don't take a sign: "-2" for "2 ONLY" is Close at best.
      if (detectItemCount(question.question) && /(?:^|[\s,;(])[-−–]\s*\d/.test(typedText) && !keys.some((k) => /(?:^|[\s,;(])[-−–]\s*\d/.test(k))) {
        return { correct: false, matched: null, rejected: false, close: true };
      }
      // (an element's own symbol for its name is never a clash: "Cs" for CESIUM)
      const symbolForName = keys.some((k) => elementSymbolName(userInput, k, question.question) === 'exact');
      if (!exact && !symbolForName && caseConflict(userInput, keys, question.question)) return { correct: false, matched: null, rejected: false, close: true };
    }
    // A ± in every form of the key is part of the answer: "3" leaves out
    // the -3 of "±3" (both roots, "3 and -3", still pass).
    if (graded.correct && question && question.answer && question.format !== 'MC') {
      const keys = [question.answer.text, ...(question.answer.accept || [])].filter(Boolean);
      const typed = String(userInput || '');
      if (keys.length && keys.every((k) => /±/.test(k)) && !/±/.test(typed) && !keys.some((k) => samePlusMinus(typed, k))) {
        return { correct: false, matched: null, rejected: false, close: true };
      }
    }
    return graded;
  }
  function gradeTypedInner(question, userInput) {
    // superscript digits typed straight ("18⁹", "x²") and "**" are exponents
    if (/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]|\*\*/.test(String(userInput || ''))) {
      userInput = String(userInput).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^(' + [...m].map((c) => SUPERSCRIPTS[c]).join('') + ')').replace(/\*\*/g, '^');
    }
    let result = checkWithAskedUnits(question, userInput, checkAnswerInner(question, userInput));
    if (question && question.answer && question.format !== 'MC') {
      const keys = [question.answer.text, ...(question.answer.accept || [])].filter(Boolean);
      const tupleKeys = keys.filter((k) => tupleParts(k));
      if (result.correct && tupleKeys.length && /[()[\]]/.test(String(userInput || '')) && tupleKeys.every((k) => bracketConflict(userInput, k, question.question))) {
        return { correct: false, matched: null, rejected: false };
      }
      // (equal by value or form, so the symbol checks below don't apply)
      if (!result.correct && !result.rejected) {
        const other = sameAnswerOtherForm(question, userInput);
        if (other === 'exact') return { correct: true, matched: 'lenient', rejected: false };
        if (other === 'close') return { correct: false, matched: null, rejected: false, close: true };
      }
    }
    if (!result.correct || !question.answer || question.format === 'MC') return result;
    // Only the forms that write symbols count: "NITRATE AND SODIUM" says
    // nothing about "NO3^(+)".
    const keys = [question.answer.text, ...(question.answer.accept || [])].filter((k) => k && operatorsOf(k).size);
    if (keys.length && keys.every((k) => operatorConflict(userInput, k))) return { correct: false, matched: null, rejected: false };
    return chargeLeftOut(question, userInput, result);
  }
  function checkAnswerInner(question, userInput) {
    const graded = gradeWithUnits(question, userInput);
    if (graded.correct || graded.rejected || question.format === 'MC' || !question.answer) return graded;
    // "gap junctions only" for a key of "GAP JUNCTIONS"
    const bare = withoutOnly(userInput || '');
    if (bare === String(userInput || '').trim()) return graded;
    const again = gradeWithUnits(question, bare);
    return again.correct || again.rejected ? again : graded;
  }
  // The units a question asks for ("in moles per liter", "in meters per
  // second") needn't be typed, and typing them isn't wrong: "10 mol/L",
  // "10 M" or "10 moles per liter" for a key of "10". Returns the number
  // alone when the typed answer is a number followed by units the question
  // names, or null.
  function withoutAskedUnits(question, userInput) {
    const typed = canonicalUnits(String(userInput || '')).trim();
    const m = typed.match(/^([+\-−–]?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(?:[X×*·]|TIMES)\s*10\s*\^\s*\(?[+\-−–]?\d+\)?|E[+\-]?\d+)?)\s*([A-Z][A-Z0-9^/ ]*)$/);
    if (!m) return null;
    const qText = canonicalUnits(question.question || '');
    const asked = new Set();
    qText.split(/[^A-ZΩ°]+/).forEach((w) => { const sym = w.length >= 2 ? unitSymbol(w) : null; if (sym) asked.add(sym); });
    const molar = /\bMOLAR(?:ITY)?\b|\bMOL(?:E|ES)? PER LIT|\bMOL\/L\b/.test(qText);
    const tail = m[2].trim();
    if (molar && /^(?:M|MOLAR)$/.test(tail)) return m[1];
    const units = tail.split(/[/ ]+/).map((u) => u.replace(/\^\d+$/, '')).filter(Boolean);
    return units.length && units.every((u) => asked.has(u)) ? m[1] : null;
  }
  function checkWithAskedUnits(question, userInput, graded) {
    if (graded.correct || graded.rejected || question.format === 'MC' || !question.answer || !/\d/.test(question.answer.text)) return graded;
    const number = withoutAskedUnits(question, userInput);
    if (!number) return graded;
    const again = checkAnswerInner(question, number);
    return again.correct ? again : graded;
  }
  function gradeWithUnits(question, userInput) {
    const first = gradeAnswer(question, userInput);
    if (first.correct || question.format === 'MC' || !question.answer) return first;
    const ans = question.answer;
    const u = {
      ...question,
      answer: { ...ans, text: canonicalUnits(ans.text), accept: (ans.accept || []).map(canonicalUnits), reject: (ans.reject || []).map(canonicalUnits) },
    };
    const raw = canonicalUnits(userInput || '');
    const changed = raw !== String(userInput || '').toUpperCase() || u.answer.text !== String(ans.text).toUpperCase()
      || u.answer.accept.some((a, k) => a !== String(ans.accept[k]).toUpperCase());
    if (!changed) return first;
    const second = gradeAnswer(u, raw);
    return second.correct || second.rejected ? second : first;
  }

  global.SBAnswer = {
    normalize,
    detectItemCount,
    canonicalizeList,
    canonicalizeRanked,
    isRankingQuestion,
    extractItemTexts,
    resolveTermsToNumbers,
    tryAllButCanonical,
    extractPureNumbers,
    extractLeadingNumbers,
    checkAnswer,
    canonicalUnits,
    isNote,
  };
})(typeof window !== 'undefined' ? window : globalThis);
