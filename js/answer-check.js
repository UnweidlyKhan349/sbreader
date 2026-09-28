/* SciBowl Practice - answer checking logic
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
      .toUpperCase()
      .replace(/['’‘]/g, "'")
      .replace(/√/g, ' SQRT ') // so a typed "sqrt" matches a displayed "√" and vice versa
      .replace(/∛/g, ' CBRT ') // same idea for a cube-root radical
      // matched as [πΠ] (not just π) because .toUpperCase() above already
      // ran and turns lowercase π into capital Π - a bare /π/ here would
      // silently never match and the symbol would just get stripped as
      // punctuation below instead of becoming "PI".
      .replace(/[πΠ]/g, ' PI ') // so a typed "pi" matches a displayed "π" and vice versa
      // spelled-out "square/cube root of X" (however the packet phrased the
      // answer key) collapses to the same "SQRT X"/"CBRT X" form a student
      // typing the shorthand would produce, so either way of writing it
      // matches the other.
      .replace(/\bSQUARE\s+ROOTS?\s+OF\b/g, ' SQRT ')
      .replace(/\bCUBE\s+ROOTS?\s+OF\b/g, ' CBRT ')
      .replace(/[^A-Z0-9'\s]/g, ' ') // strip punctuation except apostrophe
      .replace(/\s+/g, ' ')
      .trim();
  }

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
  // so the item count is the length of the longest such run starting at 1 -
  // this fixed both 153 real enumerations the old paren-only, any-order
  // check missed (all newer packets use "1." not "1)") and 213 coordinate/
  // matrix questions it wrongly flagged as list-style, checked by hand
  // against the corpus.
  const ITEM_MARKER_RE = /(?:^|[\s;,:])([1-9])(?:\)|\.\s)/g;
  function detectItemCount(questionText) {
    if (!questionText) return null;
    const nums = [...questionText.matchAll(ITEM_MARKER_RE)].map((m) => parseInt(m[1], 10));
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
    return /\b(order|rank|arrange)\b(?:[^.?!]{0,20}\b(the following|these|below)\b)/i.test(questionText)
      || /\bin order (from|of)\b[^.?!]{0,60}\bto\b/i.test(questionText)
      || /\bfrom\b[^.?!]{0,30}\bto\b[^.?!]{0,10}\b(order|arrange|rank)\b/i.test(questionText);
  }

  // Canonicalize a ranking-style answer ("3, 1, 2" / "312") to its digit
  // sequence AS TYPED - order is preserved, not sorted.
  function canonicalizeRanked(raw, itemCount) {
    if (!itemCount) return null;
    const up = normalize(raw);
    if (!up) return null;
    const digits = (up.match(/[1-9]/g) || []).map(Number).filter((d) => d <= itemCount);
    if (!digits.length) return null;
    return digits.join('');
  }

  // Try to interpret a string as a "list of item numbers" answer, e.g.
  // "1 AND 3", "1, 3", "13", "ALL", "3 ONLY", "NONE" -> canonical sorted-digit string like "13".
  // Returns null if it doesn't look like a list-style answer.
  function canonicalizeList(raw, itemCount) {
    if (!itemCount) return null;
    const up = normalize(raw);
    if (!up) return null;

    if (/^ALL( OF THE ABOVE| THREE| FOUR| FIVE| SIX)?$/.test(up)) {
      return digitsToCanonical(range(1, itemCount));
    }
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
    const re = /(?:^|[\s;,:])([1-9])(?:\)|\.\s)/g;
    const markers = [];
    let m;
    while ((m = re.exec(questionText))) {
      markers.push({ num: parseInt(m[1], 10), index: m.index, end: re.lastIndex });
    }
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
  function resolveTermsToNumbers(raw, itemTexts) {
    if (!itemTexts || !itemTexts.length || !raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let segments = trimmed.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) {
      const wsSplit = trimmed.split(/\s+/).filter(Boolean);
      if (wsSplit.length >= 2) segments = wsSplit;
    }
    if (!segments.length) return null;

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
          if (lenientWordMatch(seg, itemTexts[i])) { bestIdx = i; break; }
        }
      }
      if (bestIdx === -1 && normalize(seg).length >= 4) {
        for (let i = 0; i < itemTexts.length; i++) {
          if (used[i]) continue;
          if (fuzzyContains(seg, itemTexts[i])) { bestIdx = i; break; }
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
  function extractPureNumbers(text) {
    const tokens = normalize(text).split(' ').filter(Boolean);
    const nums = [];
    for (const t of tokens) {
      if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) { nums.push(t); continue; }
      if (t === 'AND' || t === 'OR') continue;
      return null;
    }
    return nums.length ? nums : null;
  }
  function extractLeadingNumbers(text) {
    const tokens = normalize(text).split(' ').filter(Boolean);
    const nums = [];
    for (const t of tokens) {
      if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) { nums.push(t); continue; }
      if (t === 'AND' || t === 'OR') continue;
      break;
    }
    return nums;
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
    const la = String(a).match(LEADING_NUMBER_RE), lb = String(b).match(LEADING_NUMBER_RE);
    if (la && lb && signOf(la) !== signOf(lb)) return true;
    return termSignConflict(a, b);
  }

  function normEqual(a, b) {
    if (signConflict(a, b)) return false;
    const pa = pureNumber(a), pb = pureNumber(b);
    if (pa && pb) return pa.sign === pb.sign && pa.digits === pb.digits;
    return normalize(a) === normalize(b);
  }
  // Only whitespace is dropped (punctuation is kept, so "1.5" never meets
  // "15"), and only for answers containing a letter, since spacing is
  // meaningful inside bare numbers ("1 2" vs "12").
  function compact(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/['’‘]/g, "'").replace(/\s+/g, '');
  }
  function compactEqual(a, b) {
    if (signConflict(a, b)) return false;
    const ca = compact(a);
    return ca.length >= 2 && /[A-Z]/.test(ca) && ca === compact(b);
  }

  // A plain substring check for fuzzyContains would let an answer match
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

  // Lenient fallback: one normalized string contains the other (helps with minor
  // wording differences) - only used as a soft signal, never for reject-list checks.
  function fuzzyContains(a, b) {
    if (signConflict(a, b)) return false;
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 4 && containsWholeRun(nb, na)) return true;
    if (nb.length >= 4 && containsWholeRun(na, nb)) return true;
    return false;
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
  // Greedily pairs up each word in `a` with the closest not-yet-used word in
  // `b` (order-independent), requiring every word to find a match within its
  // length's typo tolerance. Requires the same word count on both sides, so
  // it only kicks in for genuine word-order/typo cases, not answers that are
  // simply incomplete or padded with extra words.
  function lenientWordMatch(a, b) {
    if (signConflict(a, b)) return false;
    const wa = tokenize(a);
    const wb = tokenize(b);
    if (!wa.length || wa.length !== wb.length) return false;
    const usedB = new Array(wb.length).fill(false);
    for (const w of wa) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < wb.length; j++) {
        if (usedB[j]) continue;
        if (w === wb[j]) { bestIdx = j; bestDist = 0; break; }
        const tol = typoTolerance(Math.max(w.length, wb[j].length));
        if (!tol) continue;
        const d = levenshtein(w, wb[j]);
        if (d <= tol && d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx === -1) return false;
      usedB[bestIdx] = true;
    }
    return true;
  }

  // ---- Multi-part answers ("FIRST QUARTER; FULL") ----
  // A packet answer with top-level ";" separators asks for several things at
  // once, and a student has to give every one of them. Before this, the
  // whole-string checks below were the only route: "first quarter and full
  // moon" failed (the "and" and the extra "moon" broke every comparison),
  // while "full moon" on its own passed as "fuzzy" because "FULL" is a
  // substring of it - an incomplete answer graded correct. Scraping made it
  // worse: many packets list per-part alternates ("ACCEPT: CO2; H2O",
  // "ACCEPT: 1ST QUARTER | FULL MOON") and those were stored either as one
  // "|"-joined entry or as separate single-part accepts, so "LH" alone was a
  // correct answer to "LUTEINIZING HORMONE; FOLLICLE STIMULATING HORMONE".
  // Here each part is matched on its own, and single-part accepts only ever
  // stand in for one part, never for the whole answer.

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
  // "1) MAGNONS" / "2 - EUTHERIAN" / "3: BLUE" -> the part without its number.
  const PART_NUMBER_RE = /^\s*\(?[1-9]\s*[).:–-]\s*/;
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
  // 'exact' | 'fuzzy' | null. Fuzzy only lets the student say slightly MORE
  // than the part ("full moon" for "FULL", one extra word, never a negation) -
  // saying less ("quarter" for "FIRST QUARTER") is an incomplete part.
  function segMatch(seg, alts) {
    let fuzzy = false;
    const ns = normalize(seg);
    if (!ns) return null;
    for (const alt of alts) {
      if (normEqual(seg, alt) || compactEqual(seg, alt) || lenientWordMatch(seg, alt)) return 'exact';
      const na = normalize(alt);
      if (na.length >= 3 && ns !== na && containsWholeRun(ns, na)) {
        const extra = ns.split(' ').length - na.split(' ').length;
        const extraWords = ns.replace(na, ' ').split(' ').filter(Boolean);
        if (extra === 1 && !extraWords.some((w) => NEGATORS.has(w))) fuzzy = true;
      }
    }
    return fuzzy ? 'fuzzy' : null;
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

  // Candidate ways to cut a typed answer into exactly n pieces: first by the
  // separators a student would use (";", ",", "and", "then", ...), then - for
  // "first quarter full moon" with no separator at all - every way of cutting
  // the words into n consecutive runs (a connecting "and"/"then" at a cut is
  // dropped).
  function* segmentations(raw, n) {
    const seps = [/\s*(?:;|\s\|\s)\s*/, /\s*(?:[;,]|\s\|\s)\s*/, /\s*(?:[;,&/]|\s\|\s|\band\b|\bthen\b)\s*/i];
    const seen = new Set();
    for (const re of seps) {
      const segs = raw.split(re).map((s) => s.trim().replace(/^(?:and|then)\s+/i, '')).filter(Boolean);
      const key = segs.join('\u0000');
      if (segs.length === n && !seen.has(key)) { seen.add(key); yield segs; }
    }
    // raw words, not normalize()d ones, so a sign or decimal point survives
    // (a lone "−" before a number is kept as part of the next word)
    const words = raw.replace(/(^|[\s,;([])([-\u2212\u2013\u2010])\s+(?=\d)/g, '$1$2')
      .split(/[\s;,|]+/).filter((w) => normalize(w));
    if (words.length < n || words.length > 24) return;
    const JOIN = new Set(['AND', 'THEN', 'OR']);
    const cuts = [];
    function* rec(start, left) {
      if (left === 1) {
        const segs = [];
        let prev = 0;
        for (const c of [...cuts, words.length]) {
          let chunk = words.slice(prev, c);
          while (chunk.length && JOIN.has(normalize(chunk[0]))) chunk = chunk.slice(1);
          while (chunk.length && JOIN.has(normalize(chunk[chunk.length - 1]))) chunk = chunk.slice(0, -1);
          if (!chunk.length) return;
          segs.push(chunk.join(' '));
          prev = c;
        }
        yield segs;
        return;
      }
      for (let c = start + 1; c <= words.length - left + 1; c++) {
        cuts.push(c);
        yield* rec(c, left - 1);
        cuts.pop();
      }
    }
    yield* rec(0, n);
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

  // Matches n typed segments to the n parts ('exact' | 'fuzzy' | null). A
  // floating fragment can fill in for any one part, but never for a part
  // whose own text it doesn't match when it IS another part's answer - so
  // "copper; copper" can't pass "ZINC; COPPER" through an ACCEPT of "COPPER".
  function matchSegments(segs, spec) {
    const { n, alts, floating, ordered } = spec;
    const table = segs.map((seg) => alts.map((a, k) => {
      const m = segMatch(seg, a);
      if (m === 'exact') return m;
      const usable = floating.filter((f) => !alts.some((b, j) => j !== k && segMatch(f, b) === 'exact'));
      return segMatch(seg, usable) || m;
    }));
    let best = null;
    const used = new Array(n).fill(false);
    function go(i, fuzzy) {
      if (best === 'exact') return;
      if (i === n) { best = fuzzy ? (best || 'fuzzy') : 'exact'; return; }
      for (let k = 0; k < n; k++) {
        if (used[k] || (ordered && k !== i)) continue;
        const m = table[i][k];
        if (!m) continue;
        used[k] = true;
        go(i + 1, fuzzy || m === 'fuzzy');
        used[k] = false;
      }
    }
    go(0, false);
    return best;
  }

  function checkMultiPart(raw, spec) {
    let best = null;
    for (const segs of segmentations(raw, spec.n)) {
      const m = matchSegments(segs, spec);
      if (m === 'exact') return m;
      if (m) best = m;
    }
    return best;
  }

  /**
   * Grade a free-typed answer against a question.
   * Returns { correct: true|false, matched: 'main'|'accept'|'fuzzy'|null, rejected: bool }
   */
  function checkAnswer(question, userInput) {
    const raw = (userInput || '').trim();
    if (!raw) return { correct: false, matched: null, rejected: false, empty: true };

    const ans = question.answer;
    const itemCount = detectItemCount(question.question);
    // For a multi-part answer, lone per-part accepts are not whole answers.
    const multi = question.format === 'MC' ? null : multiPartSpec(question);
    const accepts = multi ? multi.wholeAccepts : (ans.accept || []);

    // ---- Multiple choice ----
    // Graded strictly: the answer must be exactly the correct letter, the
    // exact text of the correct choice, or both ("W) Proton pump"). Only
    // case, whitespace and punctuation are ignored (via normalize) - no
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
      if (correctText && normEqual(raw, correctText)) return right;

      // "W) text" / "W. text" / "W: text" / "W - text" - the letter AND the
      // text must both be the correct choice's.
      const letterPrefix = raw.match(/^([WXYZwxyz])\s*[).:-]\s*(.+)$/);
      if (letterPrefix && letterPrefix[1].toUpperCase() === correctLetter
          && correctText && normEqual(letterPrefix[2], correctText)) {
        return right;
      }
      return wrong;
    }

    // ---- Reject list first: an explicit "do not accept" match is always wrong ----
    for (const rej of ans.reject || []) {
      if (normEqual(raw, rej) || compactEqual(raw, rej)) {
        return { correct: false, matched: null, rejected: true };
      }
    }

    // ---- List-style answers ("1 and 2", "all", "3 only", "312" ranking,
    // the item names themselves, or "all but <item>") ----
    if (itemCount) {
      const ranking = isRankingQuestion(question.question);
      const canonFn = ranking ? canonicalizeRanked : canonicalizeList;
      let userCanon = canonFn(raw, itemCount);
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
          const nums = resolveTermsToNumbers(raw, itemTexts);
          if (nums && nums.length) userCanon = digitsToCanonical(nums);
        }
      }
      if (userCanon !== null) {
        const mainCanon = canonFn(ans.text, itemCount);
        if (mainCanon !== null && userCanon === mainCanon) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of accepts) {
          const accCanon = canonFn(acc, itemCount);
          if (accCanon !== null && userCanon === accCanon) {
            return { correct: true, matched: 'accept', rejected: false };
          }
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
        if (mainNums.length && numsEqualAsSet(rawPureNums, mainNums) && !signConflict(raw, ans.text)) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of accepts) {
          const accNums = extractLeadingNumbers(acc);
          if (accNums.length && numsEqualAsSet(rawPureNums, accNums) && !signConflict(raw, acc)) {
            return { correct: true, matched: 'accept', rejected: false };
          }
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

    // ---- Multi-part: every part given, each matched on its own ----
    if (multi) {
      const m = checkMultiPart(raw, multi);
      if (m) return { correct: true, matched: m === 'exact' ? 'main' : 'fuzzy', rejected: false };
    }

    // ---- Word-order-independent + typo-tolerant match ----
    // "jupiter saturn" should still count for "Saturn and Jupiter", and a
    // small typo like "deuterosomes" should still count for
    // "deuterostomes" - neither is a meaningfully different answer. A
    // multi-part key was already matched part by part above, where part
    // order is enforced when it matters ("zinc; copper" vs "copper; zinc").
    const lenientOk = (key) => !(multi && answerParts(key)) && lenientWordMatch(raw, key);
    if (lenientOk(ans.text)) {
      return { correct: true, matched: 'lenient', rejected: false };
    }
    for (const acc of accepts) {
      if (lenientOk(acc)) {
        return { correct: true, matched: 'lenient', rejected: false };
      }
    }

    // ---- Lenient fuzzy fallback (flagged distinctly so the UI can hint "close?") ----
    // Against a multi-part key, a typed answer that's only a piece of it is
    // an incomplete answer, not a "close" one - only the say-more direction
    // is left.
    const fuzzyOk = (key) => (answerParts(key)
      ? !signConflict(raw, key) && containsWholeRun(normalize(raw), normalize(key))
      : fuzzyContains(raw, key));
    if (fuzzyOk(ans.text)) {
      return { correct: true, matched: 'fuzzy', rejected: false };
    }
    for (const acc of accepts) {
      if (fuzzyOk(acc)) {
        return { correct: true, matched: 'fuzzy', rejected: false };
      }
    }

    return { correct: false, matched: null, rejected: false };
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
