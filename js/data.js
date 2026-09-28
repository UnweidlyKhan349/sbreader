/* SciBowl Practice - shared data layer */
(function (global) {
  const SBData = {
    meta: null,
    questions: null,
    _readyPromise: null,
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
  // ®" - verified against the full corpus (28/35947 answers affected, every
  // one of them in those two packets, zero false positives elsewhere):
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

  // meta.json's `subjects` field is a flat array of short subject keys
  // ("bio", "chem", "ess", ...) - every filter-chip builder (solo.js,
  // catalog.js, multiplayer.js) expects `SBData.meta.subjects` to instead be
  // a list of {key, label} objects (so it can show a real subject name on
  // the chip while filtering by the short key), which meant every subject
  // chip site-wide was rendering with no text at all (`item.label` was
  // undefined on a plain string). Expanding it here, once, at load time
  // fixes every call site without duplicating a label map three times.
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
  // "chi - square", a negative number like "-3" became "- 3". Verified
  // against the full corpus (3692/35947 questions affected): collapsing any
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

  function cleanText(s) {
    return fixSpacedApostrophes(fixSpacedHyphens(stripPronunciation(s)));
  }

  // There's no real LaTeX markup anywhere in this corpus (verified by
  // searching the full 35,947-question set for \frac, $...$, \sqrt, and
  // similar LaTeX command syntax - none exists). What questions DO
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
  // produces no over-long or space-containing captures.
  const MATH_SUP_PAREN_RE = /(?<!\^)\^\(([^()]*)\)/g;
  const MATH_SUB_PAREN_RE = /(?<!_)_\(([^()]*)\)/g;
  const MATH_SUP_BARE_RE = /(?<!\^)\^([+-]?[A-Za-z0-9]+)/g;
  const MATH_SUB_BARE_RE = /(?<!_)_([+-]?[A-Za-z0-9]+)/g;
  function escapeHtmlForMath(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
  function renderMathHTML(s) {
    if (!s) return '';
    let out = escapeHtmlForMath(s);
    out = out.replace(MATH_SUP_PAREN_RE, '<sup>$1</sup>');
    out = out.replace(MATH_SUB_PAREN_RE, '<sub>$1</sub>');
    out = out.replace(MATH_SUP_BARE_RE, '<sup>$1</sup>');
    out = out.replace(MATH_SUB_BARE_RE, '<sub>$1</sub>');
    return out;
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

  // Builds the "Answer: ..." line's inner HTML, with any accept-list
  // alternates folded inline as "(also accept: ...)" rather than shown as
  // their own separate line - keeps the primary and alternate answers
  // visually tied together instead of reading as two unrelated facts.
  function answerLineHTML(mainText, letter, acceptList) {
    let s = 'Answer: ' + (letter ? `${letter}) ` : '') + renderMathHTML(mainText);
    if (acceptList && acceptList.length) {
      s += ' <span class="also-accept">(also accept: ' + renderMathHTML(acceptList.join('; ')) + ')</span>';
    }
    return s;
  }
  SBData.answerLineHTML = answerLineHTML;

  SBData.load = function () {
    if (SBData._readyPromise) return SBData._readyPromise;
    SBData._readyPromise = Promise.all([
      fetch('data/meta.json').then((r) => r.json()),
      fetch('data/questions.json').then((r) => r.json()),
    ]).then(([meta, qs]) => {
      SBData.meta = meta;
      // Expand the raw string keys into {key, label} objects - see
      // subjectLabel() above for why.
      if (Array.isArray(meta.subjects) && meta.subjects.length && typeof meta.subjects[0] === 'string') {
        meta.subjects = meta.subjects.map((key) => ({ key, label: subjectLabel(key) }));
      }
      // meta.json's subjects/qtypes arrays are alphabetical (an artifact of
      // how the Python insertion scripts built them, e.g. sorted(set(...)))
      // rather than a deliberately chosen display order - reorder both here,
      // once, so every chip row site-wide (solo/catalog/multiplayer, plus
      // solo's in-session settings and multiplayer's mid-game filters, which
      // all build their chips straight from these two arrays) shows subjects
      // as Math/Physics/Biology/Chemistry/Earth & Space/Energy and always
      // puts the Toss-Up chip before Bonus, without editing every call site.
      const SUBJECT_ORDER = ['math', 'phys', 'bio', 'chem', 'earth', 'ess', 'energy'];
      const QTYPE_ORDER = ['tossup', 'bonus'];
      function byFixedOrder(order, keyOf) {
        return (a, b) => {
          const ai = order.indexOf(keyOf(a));
          const bi = order.indexOf(keyOf(b));
          return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
        };
      }
      if (Array.isArray(meta.subjects)) {
        meta.subjects.sort(byFixedOrder(SUBJECT_ORDER, (s) => s.key));
      }
      if (Array.isArray(meta.qtypes)) {
        meta.qtypes.sort(byFixedOrder(QTYPE_ORDER, (q) => q));
      }
      const levelBySlug = new Map((meta.tournaments || []).map((t) => [t.slug, t.level || 'hs']));
      if (!Array.isArray(meta.levels)) meta.levels = ['hs', 'ms'];
      // expand compact keys into a friendlier shape used throughout the app
      SBData.questions = qs.map((q) => ({
        id: q.i,
        tournament: q.t,
        tSlug: q.ts,
        level: levelBySlug.get(q.ts) || 'hs',
        round: q.r,
        roundLabel: q.rl,
        subject: q.s,
        format: q.f,
        qtype: q.qt,
        num: q.n,
        question: cleanText(q.q),
        choices: q.c ? {
          W: cleanText(q.c.W), X: cleanText(q.c.X),
          Y: cleanText(q.c.Y), Z: cleanText(q.c.Z),
        } : null,
        visual: !!q.v,
        answer: {
          text: stripTrailingWatermark(stripAuthorTag(cleanText(q.a.t))),
          letter: q.a.l || null,
          accept: (q.a.ac || []).map(cleanText),
          reject: (q.a.rj || []).map(cleanText),
        },
        sourceUrl: q.u,
      }));
      SBData.byId = new Map(SBData.questions.map((q) => [q.id, q]));
      return SBData;
    });
    return SBData._readyPromise;
  };

  /* ---------------- Bookmarks (localStorage) ---------------- */
  const BOOKMARK_KEY = 'sb_bookmarks_v1';

  function readBookmarks() {
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }
  function writeBookmarks(set) {
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  SBData.bookmarks = {
    getAll() {
      return readBookmarks();
    },
    isBookmarked(id) {
      return readBookmarks().has(id);
    },
    toggle(id) {
      const set = readBookmarks();
      if (set.has(id)) set.delete(id);
      else set.add(id);
      writeBookmarks(set);
      return set.has(id);
    },
    add(id) {
      const set = readBookmarks();
      set.add(id);
      writeBookmarks(set);
    },
    remove(id) {
      const set = readBookmarks();
      set.delete(id);
      writeBookmarks(set);
    },
    clear() {
      writeBookmarks(new Set());
    },
    count() {
      return readBookmarks().size;
    },
  };

  /* ---------------- Filtering ---------------- */
  // opts: { subjects, roundRange:[min,max], includeUnlabeled, tournaments, formats, qtypes, levels, bookmarkedOnly, search, includeVisual }
  // each of subjects/tournaments/formats/qtypes/levels is either null/empty (= all) or a Set/array of allowed values
  SBData.filterQuestions = function (opts) {
    opts = opts || {};
    const subjects = toSetOrNull(opts.subjects);
    const tournaments = toSetOrNull(opts.tournaments);
    const formats = toSetOrNull(opts.formats);
    const qtypes = toSetOrNull(opts.qtypes);
    const levels = toSetOrNull(opts.levels);
    const bookmarkedOnly = !!opts.bookmarkedOnly;
    const bookmarks = bookmarkedOnly ? readBookmarks() : null;
    const search = (opts.search || '').trim().toLowerCase();
    const includeVisual = opts.includeVisual !== false;
    const roundRange = opts.roundRange || null; // [min, max] inclusive
    const includeUnlabeled = opts.includeUnlabeled !== false;

    let out = SBData.questions.filter((q) => {
      if (subjects && !subjects.has(q.subject)) return false;
      if (roundRange) {
        if (q.round == null) { if (!includeUnlabeled) return false; }
        else if (q.round < roundRange[0] || q.round > roundRange[1]) return false;
      }
      if (tournaments && !tournaments.has(q.tSlug)) return false;
      if (formats && !formats.has(q.format)) return false;
      if (qtypes && !qtypes.has(q.qtype)) return false;
      if (levels && !levels.has(q.level)) return false;
      if (bookmarkedOnly && !bookmarks.has(q.id)) return false;
      if (!includeVisual && q.visual) return false;
      return true;
    });

    if (search) {
      out = out.filter((q) => {
        return (
          q.question.toLowerCase().includes(search) ||
          q.answer.text.toLowerCase().includes(search) ||
          q.tournament.toLowerCase().includes(search)
        );
      });
    }
    return out;
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
  SBData.roundLabelFor = function (q) {
    return cleanRoundLabel(q.tournament, q.roundLabel) || (q.round ? 'Round ' + q.round : null);
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

  // True round-robin-with-cycling version: guarantees every selected group
  // gets equal turns across the WHOLE returned array, not just until the
  // smallest group's own supply runs dry. plain stratifiedShuffle() above
  // lets a group drop out of rotation once it's exhausted, so if e.g. Math
  // only has 16 questions after filtering and Physics has hundreds, the
  // back half of the result is 100% Physics - exactly the "60% phys over 40
  // questions" skew this was reported to produce. Here, a group that runs
  // out mid-way is reshuffled and keeps taking its turn (repeating its own
  // questions) instead of dropping out, so the ratio between subjects stays
  // even for the entire length requested. length defaults to arr.length so
  // the "total questions" callers display doesn't change.
  function stratifiedQueue(arr, keyFn, length) {
    const groups = new Map();
    arr.forEach((item) => {
      const k = keyFn(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    });
    const keys = Array.from(groups.keys());
    if (!keys.length) return [];
    const targetLength = length == null ? arr.length : length;
    const bags = new Map();
    keys.forEach((k) => bags.set(k, []));
    let order = shuffle(keys);
    let pos = 0;
    const result = [];
    while (result.length < targetLength) {
      if (pos >= order.length) { order = shuffle(keys); pos = 0; }
      const k = order[pos++];
      let bag = bags.get(k);
      if (!bag.length) { bag = shuffle(groups.get(k)); bags.set(k, bag); }
      result.push(bag.pop());
    }
    return result;
  }
  SBData.stratifiedQueue = stratifiedQueue;

  /* ---------------- Shared dual-handle round-range slider wiring ---------------- */
  // opts: { minInput, maxInput, fillEl, labelEl, maxRound, onChange(lo, hi) }
  SBData.wireRoundRangeSlider = function (opts) {
    const { minInput, maxInput, fillEl, labelEl, maxRound, onChange } = opts;
    minInput.min = maxInput.min = 1;
    minInput.max = maxInput.max = maxRound;
    minInput.value = 1;
    maxInput.value = maxRound;

    function render() {
      const lo = parseInt(minInput.value, 10);
      const hi = parseInt(maxInput.value, 10);
      const span = Math.max(1, maxRound - 1);
      const pctLo = ((lo - 1) / span) * 100;
      const pctHi = ((hi - 1) / span) * 100;
      if (fillEl) { fillEl.style.left = pctLo + '%'; fillEl.style.width = Math.max(0, pctHi - pctLo) + '%'; }
      if (labelEl) labelEl.textContent = lo === hi ? `Round ${lo}` : `Rounds ${lo}–${hi}`;
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
      const pad = 8; // matches .track's left/right inset
      const usable = Math.max(1, rect.width - pad * 2);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - pad) / usable));
      return Math.min(maxRound, Math.max(1, Math.round(1 + ratio * (maxRound - 1))));
    }
    function pickHandle(val, lo, hi) {
      if (lo === hi) return val < lo ? 'min' : val > hi ? 'max' : 'min';
      return Math.abs(val - lo) <= Math.abs(val - hi) ? 'min' : 'max';
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
    container.addEventListener('pointerdown', (e) => {
      const val = valueFromClientX(e.clientX);
      const lo = parseInt(minInput.value, 10);
      const hi = parseInt(maxInput.value, 10);
      pressVal = val;
      if (lo === hi && val === lo) {
        dragHandle = 'pending';
      } else {
        dragHandle = pickHandle(val, lo, hi);
        minInput.style.zIndex = dragHandle === 'min' ? '3' : '2';
        maxInput.style.zIndex = dragHandle === 'min' ? '2' : '3';
        setHandleValue(dragHandle, val);
        render();
      }
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    container.addEventListener('pointermove', (e) => {
      if (!dragHandle) return;
      const val = valueFromClientX(e.clientX);
      if (dragHandle === 'pending') {
        if (val === pressVal) return; // no directional movement yet
        dragHandle = val > pressVal ? 'max' : 'min';
        minInput.style.zIndex = dragHandle === 'min' ? '3' : '2';
        maxInput.style.zIndex = dragHandle === 'min' ? '2' : '3';
      }
      setHandleValue(dragHandle, val);
      render();
    });
    function endDrag(e) {
      if (!dragHandle) return;
      dragHandle = null;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    }
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    render();
    return {
      reset() { minInput.value = 1; maxInput.value = maxRound; render(); },
      getRange() { return [parseInt(minInput.value, 10), parseInt(maxInput.value, 10)]; },
      setRange(lo, hi) { minInput.value = lo; maxInput.value = hi; render(); },
    };
  };

  /* ---------------- Custom-styled <select> dropdown ---------------- */
  // Native <select> popups are rendered by the OS/browser chrome, outside
  // the page - there's no way to style their scrollbar (or anything else
  // about them) with CSS. This progressively enhances a <select> that's
  // already been populated with <option>s into a button + absolutely
  // positioned panel built from plain divs, so the panel's scrollbar picks
  // up the site's normal custom scrollbar styling like any other element.
  // The original <select> stays in the DOM (hidden) as the source of truth:
  // existing code that reads `.value` or listens for 'change' on it keeps
  // working untouched. Code that sets `.value` on it programmatically
  // (e.g. a "Clear all" handler) should call `selectEl.refreshCustomDropdown()`
  // afterward (a no-op if the select was never enhanced) so the visible
  // label stays in sync.
  function enhanceSelect(selectEl) {
    if (!selectEl || selectEl._sbEnhanced) return;
    selectEl._sbEnhanced = true;

    const originalStyle = selectEl.getAttribute('style') || '';
    const wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    if (originalStyle) wrap.setAttribute('style', originalStyle);
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('sb-native-select-hidden');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'custom-select-trigger-label';
    const caret = document.createElement('span');
    caret.className = 'custom-select-caret';
    caret.textContent = '▾';
    trigger.appendChild(triggerLabel);
    trigger.appendChild(caret);
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.display = 'none';

    // A search box pinned above the scrollable option list - useful once a
    // select has more than a handful of options (e.g. dozens of
    // tournaments), where scrolling to find one by eye is slow.
    const searchWrap = document.createElement('div');
    searchWrap.className = 'custom-select-search-wrap';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'custom-select-search';
    search.placeholder = 'Search…';
    search.autocomplete = 'off';
    searchWrap.appendChild(search);
    panel.appendChild(searchWrap);

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-select-options';
    panel.appendChild(optionsList);

    wrap.appendChild(panel);

    function buildOptions() {
      optionsList.innerHTML = '';
      Array.from(selectEl.options).forEach((opt) => {
        const row = document.createElement('div');
        row.className = 'custom-select-option';
        row.textContent = opt.textContent;
        row.dataset.value = opt.value;
        row.dataset.search = opt.textContent.toLowerCase();
        if (opt.value === selectEl.value) row.classList.add('active');
        row.addEventListener('click', () => {
          selectEl.value = opt.value;
          syncLabel();
          closePanel();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        optionsList.appendChild(row);
      });
    }

    function applySearch() {
      const q = search.value.trim().toLowerCase();
      let anyVisible = false;
      Array.from(optionsList.querySelectorAll('.custom-select-option')).forEach((row) => {
        const match = !q || row.dataset.search.indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      });
      let empty = optionsList.querySelector('.custom-select-empty');
      if (!anyVisible) {
        if (!empty) {
          empty = document.createElement('div');
          empty.className = 'custom-select-empty';
          empty.textContent = 'No matches';
          optionsList.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
    }

    function syncLabel() {
      const opt = selectEl.options[selectEl.selectedIndex];
      triggerLabel.textContent = opt ? opt.textContent : '';
      Array.from(optionsList.children).forEach((row) => {
        if (row.dataset.value !== undefined) row.classList.toggle('active', row.dataset.value === selectEl.value);
      });
    }

    function openPanel() {
      buildOptions();
      search.value = '';
      applySearch();
      panel.style.display = 'block';
      wrap.classList.add('open');
      setTimeout(() => search.focus(), 0);
    }
    function closePanel() {
      panel.style.display = 'none';
      wrap.classList.remove('open');
    }

    trigger.addEventListener('click', () => {
      if (panel.style.display === 'none') openPanel(); else closePanel();
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closePanel();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
    search.addEventListener('input', applySearch);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePanel(); trigger.focus(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const firstVisible = Array.from(optionsList.querySelectorAll('.custom-select-option'))
          .find((row) => row.style.display !== 'none');
        if (firstVisible) firstVisible.click();
      }
    });

    buildOptions();
    syncLabel();
    selectEl.refreshCustomDropdown = syncLabel;
  }
  SBData.enhanceSelect = enhanceSelect;

  // Multi-select sibling of enhanceSelect, for filters where more than one
  // choice should be pickable at once (currently: tournaments). Shares the
  // same panel/search/scrollbar markup and CSS classes, but clicking a row
  // toggles it in a Set instead of picking one value and closing the
  // panel, and the trigger label summarizes the selection instead of
  // showing a single option's text. The backing <select> is still used
  // purely as the option source (its own .value/.selectedIndex are never
  // read) - callers use selectEl.getMultiValues()/setMultiValues() instead
  // of .value, and still get a 'change' event on user interaction.
  function enhanceMultiSelect(selectEl) {
    if (!selectEl || selectEl._sbEnhanced) return;
    selectEl._sbEnhanced = true;
    selectEl._sbMultiValues = new Set();

    const originalStyle = selectEl.getAttribute('style') || '';
    const wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    if (originalStyle) wrap.setAttribute('style', originalStyle);
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('sb-native-select-hidden');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'custom-select-trigger-label';
    const caret = document.createElement('span');
    caret.className = 'custom-select-caret';
    caret.textContent = '▾';
    trigger.appendChild(triggerLabel);
    trigger.appendChild(caret);
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.display = 'none';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'custom-select-search-wrap custom-select-search-wrap-multi';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'custom-select-search';
    search.placeholder = 'Search…';
    search.autocomplete = 'off';
    searchWrap.appendChild(search);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'custom-select-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      selectEl._sbMultiValues.clear();
      syncLabel();
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    searchWrap.appendChild(clearBtn);
    panel.appendChild(searchWrap);

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-select-options';
    panel.appendChild(optionsList);

    wrap.appendChild(panel);

    function buildOptions() {
      optionsList.innerHTML = '';
      Array.from(selectEl.options).forEach((opt) => {
        const row = document.createElement('div');
        row.className = 'custom-select-option custom-select-option-multi';
        row.dataset.value = opt.value;
        row.dataset.search = opt.textContent.toLowerCase();
        const check = document.createElement('span');
        check.className = 'custom-select-option-check';
        const label = document.createElement('span');
        label.textContent = opt.textContent;
        row.appendChild(check);
        row.appendChild(label);
        if (selectEl._sbMultiValues.has(opt.value)) row.classList.add('active');
        row.addEventListener('click', () => {
          if (selectEl._sbMultiValues.has(opt.value)) selectEl._sbMultiValues.delete(opt.value);
          else selectEl._sbMultiValues.add(opt.value);
          row.classList.toggle('active', selectEl._sbMultiValues.has(opt.value));
          syncLabel();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        optionsList.appendChild(row);
      });
    }

    function applySearch() {
      const q = search.value.trim().toLowerCase();
      let anyVisible = false;
      Array.from(optionsList.querySelectorAll('.custom-select-option')).forEach((row) => {
        const match = !q || row.dataset.search.indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      });
      let empty = optionsList.querySelector('.custom-select-empty');
      if (!anyVisible) {
        if (!empty) {
          empty = document.createElement('div');
          empty.className = 'custom-select-empty';
          empty.textContent = 'No matches';
          optionsList.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
    }

    function syncLabel() {
      const n = selectEl._sbMultiValues.size;
      if (n === 0) {
        triggerLabel.textContent = 'All tournaments';
      } else if (n === 1) {
        const [onlyVal] = selectEl._sbMultiValues;
        const opt = Array.from(selectEl.options).find((o) => o.value === onlyVal);
        triggerLabel.textContent = opt ? opt.textContent : '1 tournament selected';
      } else {
        triggerLabel.textContent = `${n} tournaments selected`;
      }
      Array.from(optionsList.children).forEach((row) => {
        if (row.dataset.value !== undefined) row.classList.toggle('active', selectEl._sbMultiValues.has(row.dataset.value));
      });
    }

    function openPanel() {
      buildOptions();
      search.value = '';
      applySearch();
      panel.style.display = 'block';
      wrap.classList.add('open');
      setTimeout(() => search.focus(), 0);
    }
    function closePanel() {
      panel.style.display = 'none';
      wrap.classList.remove('open');
    }

    trigger.addEventListener('click', () => {
      if (panel.style.display === 'none') openPanel(); else closePanel();
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closePanel();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
    search.addEventListener('input', applySearch);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePanel(); trigger.focus(); }
    });

    buildOptions();
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
})(window);
