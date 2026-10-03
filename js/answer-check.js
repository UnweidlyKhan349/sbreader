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
      // exponent markup is ignored, so "x^2" = "x2" and "e^(-x)" = "e-x"
      .replace(/\^\(([^()]*)\)/g, '$1')
      .replace(/\^/g, '')
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
      .trim()
      // standard abbreviations become the full term, so "ER" and "rough ER"
      // match "endoplasmic reticulum" and "rough endoplasmic reticulum" (and
      // the full term still gets the usual typo tolerance)
      .replace(ABBREVIATION_RE, (m) => ABBREVIATIONS[m]);
  }
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
          if (eitherContains(seg, itemTexts[i])) { bestIdx = i; break; }
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
    const la = String(a).match(LEADING_NUMBER_RE), lb = String(b).match(LEADING_NUMBER_RE);
    if (la && lb && signOf(la) !== signOf(lb)) return true;
    return termSignConflict(a, b);
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
    return normalize(a) === normalize(b) || leadingValueEqual(a, b);
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

  // Pairs up each word in `a` with a not-yet-used word in `b`, in any order.
  // Returns 'exact' when every word matches exactly (only the order, stop
  // words or singular/plural differ), 'typo' when some pair is only within its length's
  // typo tolerance, or null. Requires the same word count on both sides, so
  // incomplete or padded answers never get here.
  function lenientWordMatch(a, b) {
    if (signConflict(a, b)) return null;
    const wa = tokenize(a);
    const wb = tokenize(b);
    if (!wa.length || wa.length !== wb.length) return null;
    const usedB = new Array(wb.length).fill(false);
    let typo = false;
    for (const w of wa) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < wb.length; j++) {
        if (usedB[j]) continue;
        if (w === wb[j] || inflectionOnly(w, wb[j])) { bestIdx = j; bestDist = 0; break; }
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
  // 'exact' | 'fuzzy' | 'typo' | null. Fuzzy only lets the student say
  // slightly MORE than the part ("full moon" for "FULL", one extra word, never
  // a negation) - saying less ("quarter" for "FIRST QUARTER") is an
  // incomplete part. 'typo' is a part that's only a misspelling away, which
  // checkAnswer reports as close rather than correct.
  const MATCH_RANK = { exact: 3, fuzzy: 2, typo: 1 };
  function betterMatch(a, b) {
    return (MATCH_RANK[a] || 0) >= (MATCH_RANK[b] || 0) ? a : b;
  }
  function segMatch(seg, alts) {
    let best = null;
    const ns = normalize(seg);
    if (!ns) return null;
    for (const alt of alts) {
      if (normEqual(seg, alt) || compactEqual(seg, alt)) return 'exact';
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

  // Matches n typed segments to the n parts. Returns the best assignment's
  // weakest part match ('exact' | 'fuzzy' | 'typo') or null. A floating
  // fragment can fill in for any one part, but never for a part whose own
  // text it doesn't match when it IS another part's answer - so
  // "copper; copper" can't pass "ZINC; COPPER" through an ACCEPT of "COPPER".
  function matchSegments(segs, spec) {
    const { n, alts, floating, ordered } = spec;
    const table = segs.map((seg) => alts.map((a, k) => {
      const m = segMatch(seg, a);
      if (m === 'exact') return m;
      const usable = floating.filter((f) => !alts.some((b, j) => j !== k && segMatch(f, b) === 'exact'));
      return betterMatch(segMatch(seg, usable), m);
    }));
    let best = null;
    const used = new Array(n).fill(false);
    function go(i, weakest) {
      if (best === 'exact') return;
      if (i === n) { best = betterMatch(best, weakest); return; }
      for (let k = 0; k < n; k++) {
        if (used[k] || (ordered && k !== i)) continue;
        const m = table[i][k];
        if (!m) continue;
        used[k] = true;
        go(i + 1, MATCH_RANK[m] < MATCH_RANK[weakest] ? m : weakest);
        used[k] = false;
      }
    }
    go(0, 'exact');
    return best;
  }

  function checkMultiPart(raw, spec) {
    let best = null;
    for (const segs of segmentations(raw, spec.n)) {
      const m = matchSegments(segs, spec);
      if (m === 'exact') return m;
      best = betterMatch(best, m);
    }
    return best;
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
    return [...new Set(out.map((v) => v.trim()).filter((v) => normalize(v)))];
  }

  /**
   * Grade a free-typed answer against a question.
   * Returns { correct, matched: 'main'|'accept'|'lenient'|'fuzzy'|null, rejected, close? }
   * `close` marks a wrong answer that's a near miss (a typo, or the key plus
   * extra words); the pages ask the player to override it if they meant it.
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
    const literal = (t) => String(t).toUpperCase().replace(/\s+/g, ' ').trim();
    if (literal(raw) === literal(ans.text)) return { correct: true, matched: 'main', rejected: false };
    if (accepts.some((acc) => literal(raw) === literal(acc))) return { correct: true, matched: 'accept', rejected: false };

    // ---- Reject list: an explicit "do not accept" match is always wrong ----
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
      const m = checkMultiPart(raw, multi);
      if (m === 'exact' || m === 'fuzzy') return { correct: true, matched: m === 'exact' ? 'main' : 'fuzzy', rejected: false };
      if (m === 'typo') close = true;
    }

    // ---- Word-order-independent match ----
    // "jupiter saturn" counts for "Saturn and Jupiter". A small typo
    // ("deuterosomes" for "deuterostomes") is only close: too many one- or
    // two-letter differences are a different term (see CONTRAST_SWAPS for
    // the ones that never even count as close). A multi-part key was
    // already matched part by part above, where part order is enforced
    // when it matters ("zinc; copper" vs "copper; zinc").
    for (const key of keys) {
      if (multi && answerParts(key)) continue;
      const m = lenientWordMatch(raw, key);
      if (m === 'exact') return { correct: true, matched: 'lenient', rejected: false };
      if (m === 'typo') close = true;
    }

    // ---- Typed answer contains the whole key plus more: close ----
    if (!close && keys.some((key) => typedContainsKey(raw, key))) close = true;

    if (close) return { correct: false, matched: null, rejected: false, close: true };
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
