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
  function normEqual(a, b) {
    return normalize(a) === normalize(b);
  }
  // Only whitespace is dropped (punctuation is kept, so "1.5" never meets
  // "15"), and only for answers containing a letter, since spacing is
  // meaningful inside bare numbers ("1 2" vs "12").
  function compact(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/['’‘]/g, "'").replace(/\s+/g, '');
  }
  function compactEqual(a, b) {
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

  /**
   * Grade a free-typed answer against a question.
   * Returns { correct: true|false, matched: 'main'|'accept'|'fuzzy'|null, rejected: bool }
   */
  function checkAnswer(question, userInput) {
    const raw = (userInput || '').trim();
    if (!raw) return { correct: false, matched: null, rejected: false, empty: true };

    const ans = question.answer;
    const itemCount = detectItemCount(question.question);

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
        for (const acc of ans.accept || []) {
          const accCanon = canonFn(acc, itemCount);
          if (accCanon !== null && userCanon === accCanon) {
            return { correct: true, matched: 'accept', rejected: false };
          }
        }
      }
    }

    // ---- Bare number(s) against a "NUMBER UNIT-WORD(S)" answer key, e.g.
    // "8" for "8 FACTORS", "120 130" for "120 AND 130 DEGREES" ----
    {
      const rawPureNums = extractPureNumbers(raw);
      if (rawPureNums) {
        const mainNums = extractLeadingNumbers(ans.text);
        if (mainNums.length && numsEqualAsSet(rawPureNums, mainNums)) {
          return { correct: true, matched: 'main', rejected: false };
        }
        for (const acc of ans.accept || []) {
          const accNums = extractLeadingNumbers(acc);
          if (accNums.length && numsEqualAsSet(rawPureNums, accNums)) {
            return { correct: true, matched: 'accept', rejected: false };
          }
        }
      }
    }

    // ---- Exact normalized match ----
    if (normEqual(raw, ans.text)) {
      return { correct: true, matched: 'main', rejected: false };
    }
    for (const acc of ans.accept || []) {
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
    for (const acc of ans.accept || []) {
      if (compactEqual(raw, acc)) {
        return { correct: true, matched: 'accept', rejected: false };
      }
    }

    // ---- Word-order-independent + typo-tolerant match ----
    // "jupiter saturn" should still count for "Saturn and Jupiter", and a
    // small typo like "deuterosomes" should still count for
    // "deuterostomes" - neither is a meaningfully different answer.
    if (lenientWordMatch(raw, ans.text)) {
      return { correct: true, matched: 'lenient', rejected: false };
    }
    for (const acc of ans.accept || []) {
      if (lenientWordMatch(raw, acc)) {
        return { correct: true, matched: 'lenient', rejected: false };
      }
    }

    // ---- Lenient fuzzy fallback (flagged distinctly so the UI can hint "close?") ----
    if (fuzzyContains(raw, ans.text)) {
      return { correct: true, matched: 'fuzzy', rejected: false };
    }
    for (const acc of ans.accept || []) {
      if (fuzzyContains(raw, acc)) {
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
