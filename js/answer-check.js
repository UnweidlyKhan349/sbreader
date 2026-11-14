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
      // "24pi", "2pi/3": pi written straight after its number, as "24π" is
      .replace(/(\d)PI(?![A-Z])/g, '$1 PI')
      // a times sign typed as the letter x between numbers: "67 x 101", "2x2x3"
      .replace(/(\d)\s*X\s*(?=[\d√(])/g, '$1 ')
      // "3.2 x 10^23" and "3.2e23" read as "3.2 × 10^23" (the × and * are
      // dropped as punctuation below)
      .replace(/(\d)\s*X\s*(?=10\s*\^)/g, '$1 ')
      .replace(/(^|[^A-Z\d.])(\d+(?:\.\d+)?)E([+\-]?\d+)(?![A-Z\d])/g, '$1$2 10 $3')
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
      .replace(/(^|[\s,;(=])(\d+)\s*\/\s*(\d+)(?=$|[\s,;)])/g, '$1$2\u0002$3')
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
  const ITEM_MARKER_RE = /(?:^|[\s;,:])([1-9])(?:\)|\.\s|:(?=\s))/g;
  const COLON_LABEL_RE = /\b(?:rows?|columns?|cols?|steps?|stages?|phases?|parts?|rounds?|sets?|levels?|questions?|problems?)\s*$/i;
  // Some packets label the items with Roman numerals instead ("I. Gravity
  // II. Normal force III. Friction", keyed "I ONLY" or "I AND III"). They
  // count the same way, as items 1, 2, 3, ..., when the stem has no run of
  // arabic ones; the labels are capitals (a lower-case "i." is more likely
  // the end of a sentence), and stop at IX ("X)" is a choice letter).
  const ROMAN_ITEM_RE = /(?:^|[\s;,:])(IX|IV|V?I{1,3}|V)(?:\)|\.\s|:(?=\s))/g;
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
      if (digits.every((d) => d >= 1 && d <= itemCount)) {
        return digitsToCanonical(digits);
      }
    }

    // "1 AND 3", "1, 3", "3 ONLY", "2 AND 3 ONLY" - must contain a real list
    // separator (comma) or list word (AND/OR/ONLY), never a bare number like
    // "144", which is not a list-style answer at all.
    const hasListWord = /\b(AND|OR|ONLY)\b/.test(up) || up.includes(',');
    if (hasListWord && /^[1-9OANDRLY,\s]+$/.test(up.replace(/ONLY/g, '').replace(/AND|OR/g, ''))) {
      const digits = (up.match(/[1-9]/g) || []).map(Number);
      if (digits.length && digits.every((dd) => dd <= itemCount)) {
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
  function unitTail(text) {
    const words = numberTokens(text);
    let i = 0;
    while (i < words.length && (NUMBER_TOKEN_RE.test(words[i]) || ['AND', 'OR', '&'].includes(words[i]))) i++;
    const tail = words.slice(i);
    if (!tail.length) return true;
    if (!/^[A-Z][A-Z0-9'./^*\-]*$/.test(tail[0]) || MATH_WORDS.has(tail[0])) return false;
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
  const ARROW_RE = /\s*(?:→|⟶|⇌|⇄|<=>|<->|->|=>)\s*/;
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
      .replace(/\^\(([^()]*)\)/g, '$1').replace(/\^/g, '').replace(/\s+/g, '');
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
    return normalize(s).split(' ').filter((w) => w && !STOPWORDS.has(w));
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
        if (!tol || contrastingWords(w, wb[j])) continue;
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
        out.push(v.replace(/\([^)]*\)/g, ' '));
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
    return { n: items.length, alts, floating: [], ordered: listIsOrdered(question), noSlash: true };
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
    const notes = [];
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
  function sameWithoutKind(raw, key, kinds) {
    // (never for numbers or expressions, whose labels and signs matter)
    if (!kinds.size || /[\d=<>]/.test(String(raw) + key)) return false;
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

      // just a letter, optionally with trailing ')'
      const letterOnly = raw.match(/^([WXYZwxyz])\s*\)?$/);
      if (letterOnly) return letterOnly[1].toUpperCase() === correctLetter ? right : wrong;

      // exact text of the correct choice
      if (correctText && (normEqual(raw, correctText) || compactEqual(raw, correctText))) return right;
      // the correct choice without its reading guide ("gneiss [nice]",
      // "1-hexyne (“one hex-why-ne”)"), as long as no other choice reads
      // the same once its own guide is gone
      const bare = choiceWithoutGuide(correctText);
      if (bare && bare !== correctText && (normEqual(raw, bare) || compactEqual(raw, bare))
          && !Object.entries(question.choices).some(([L, t]) => L !== correctLetter && normEqual(raw, choiceWithoutGuide(t) || t))) {
        return right;
      }

      // "W) text" / "W. text" / "W: text" / "W - text" - the letter AND the
      // text must both be the correct choice's.
      const letterPrefix = raw.match(/^([WXYZwxyz])\s*[).:-]\s*(.+)$/);
      if (letterPrefix && letterPrefix[1].toUpperCase() === correctLetter
          && correctText
          && (normEqual(letterPrefix[2], correctText) || compactEqual(letterPrefix[2], correctText))) {
        return right;
      }
      return wrong;
    }

    // ---- The key or an accept typed character for character ----
    // Checked before the reject list, which normalize() can't always tell
    // apart from the key: "+6" vs a rejected "6", "W+ BOSON" vs "W BOSON".
    // Exponent markup is dropped here too, so "W+ boson" is the key "W^+ BOSON".
    const literal = (t) => String(t).toUpperCase().replace(/[\^_]\(([^()]*)\)/g, '$1')
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
      if (rawPureNums) {
        const mainNums = extractLeadingNumbers(ans.text);
        if (mainNums.length && numsEqualAsSet(rawPureNums, mainNums) && !signConflict(raw, ans.text) && unitTail(ans.text)) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of accepts) {
          const accNums = extractLeadingNumbers(acc);
          if (accNums.length && numsEqualAsSet(rawPureNums, accNums) && !signConflict(raw, acc) && unitTail(acc)) {
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
      const items = list && list.ordered ? listItems(key) : null;
      const m = items
        ? checkMultiPart(raw, { n: items.length, alts: items.map(partVariants), floating: [], ordered: true, noSlash: true })
        : lenientWordMatch(raw, key);
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
    if (!multi) {
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
        const w = rest.match(/^\s*([A-ZΩ°]+)(?![A-Z])/) || rest.match(/^\s*(ELECTRON VOLTS?|KILOWATT[ -]HOURS?|LIGHT[ -]YEARS?|ASTRONOMICAL UNITS?)/);
        const two = rest.match(/^\s*(ELECTRON VOLTS?|KILOWATT[ -]HOURS?|LIGHT[ -]YEARS?|ASTRONOMICAL UNITS?)(?![A-Z])/);
        const word = two ? two[1] : w && w[1];
        const sym = word && unitSymbol(word.replace(/-/g, ' '));
        if (!sym) break;
        units.push((units.length ? (sep || ' ') : ' ') + sym);
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
  function checkAnswer(question, userInput) {
    if (question && question.answer && SIGN_WORD_TEST.test(String(userInput || '') + ' ' + question.answer.text + ' ' + (question.answer.accept || []).join(' ') + ' ' + (question.answer.reject || []).join(' '))) {
      const a = question.answer;
      question = { ...question, answer: { ...a, text: signWords(a.text), accept: (a.accept || []).map(signWords), reject: (a.reject || []).map(signWords) } };
      userInput = signWords(userInput);
    }
    if (question && question.answer && VULGAR_TEST.test(String(userInput || '') + question.answer.text + (question.answer.accept || []).join('') + (question.answer.reject || []).join(''))) {
      const a = question.answer;
      question = { ...question, answer: { ...a, text: slashFractions(a.text), accept: (a.accept || []).map(slashFractions), reject: (a.reject || []).map(slashFractions) } };
      userInput = slashFractions(userInput);
    }
    const result = checkWithAskedUnits(question, userInput, checkAnswerInner(question, userInput));
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
