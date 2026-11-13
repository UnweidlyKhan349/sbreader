/* SB Reader - shared reveal engine.
   Replaces text-to-speech: instead of being read aloud, the question (and
   its answer choices) appear on screen word by word, timed the way QB
   Reader reads: after each word it waits
     (ln(word length) + 1, plus 2.5 at the end of a sentence or 1.5 after a
      comma) x 0.9 x (140 - reading speed) ms,
   with the reading speed from 0 to 100 (50 by default). "Buzzing before
   it's fully read" means buzzing before the reveal finishes.

   Position is driven by wall-clock elapsed time rather than by counting
   ticks. This matters for backgrounded browser tabs: Chrome (and others)
   throttle a *chain* of short setTimeout calls down to roughly once a
   second once a tab is hidden. Because every tick recomputes "which words
   should be showing right now" from Date.now(), a throttled tick just jumps
   straight to the correct position instead of falling further behind, and
   completion is scheduled with a single timer for the remaining duration,
   so it fires close to on time even in a background tab. */
(function (global) {
  const DEFAULT_SPEED = 50;
  const TICK_MS = 16;
  // ms per unit of word time at a reading speed (QB Reader's formula).
  // A saved or typed speed as a whole number from 0 to 100 (50 if unset).
  function normalizeSpeed(v) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v == null ? NaN : v);
    return isFinite(n) ? Math.round(Math.max(0, Math.min(100, n))) : DEFAULT_SPEED;
  }
  function msPerUnit(speed) { return 0.9 * (140 - normalizeSpeed(speed)); }
  // How long to wait after a word, in units (QB Reader's TossupRoom).
  function wordUnits(word) {
    let t = Math.log(word.length) + 1;
    const prev = word.charCodeAt(word.length - 2);
    if ((word.endsWith('.') && prev > 96 && prev < 123)
      || word.slice(-2) === '.\u201d' || word.slice(-2) === '!\u201d' || word.slice(-2) === '?\u201d') t += 2.5;
    else if (word.endsWith(',') || word.slice(-2) === ',\u201d') t += 1.5;
    return t;
  }

  // Segments can be given as rendered HTML ({ html, el }) instead of plain
  // text, so math types in already formatted: "3t^2" shows 3, t, then a
  // raised 2, never a caret. The HTML is the small subset renderMathHTML
  // produces - text with entities and <sup>/<sub> tags - and is typed by
  // visible character: a tag takes no time, an entity counts as one.
  const TOKEN_RE = /<\/?[a-z]+(?:\s[^<>]*)?>|&(?:#\d+|#x[0-9a-f]+|[a-z]+);|[\s\S]/gi;
  function tokens(html) { return html.match(TOKEN_RE) || []; }
  function isTag(t) { return t.length > 2 && t[0] === '<' && t[t.length - 1] === '>'; }
  function visibleLength(html) {
    let n = 0;
    for (const t of tokens(html)) if (!isTag(t)) n++;
    return n;
  }
  // The first n visible characters of html, with any tags still open
  // closed again, so the result is always well formed.
  function visibleTruncate(html, n) {
    let out = '';
    let shown = 0;
    const open = [];
    for (const t of tokens(html)) {
      if (isTag(t)) {
        if (shown >= n && t[1] !== '/') break;
        out += t;
        if (t[1] === '/') open.pop(); else open.push(t.slice(1).match(/^[a-z]+/i)[0]);
        continue;
      }
      if (shown >= n) break;
      out += t;
      shown++;
    }
    for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
    return out;
  }
  // html with `extra` put in after its first n visible characters (after
  // any tags that close there, so a mark never lands inside a superscript
  // that has just ended).
  function insertAtVisible(html, n, extra) {
    let out = '';
    let shown = 0;
    let placed = false;
    for (const t of tokens(html)) {
      const closing = isTag(t) && t[1] === '/';
      if (!placed && shown >= n && !closing) { out += extra; placed = true; }
      out += t;
      if (!isTag(t)) shown++;
    }
    return placed ? out : out + extra;
  }
  function segLength(s) { return s.html != null ? visibleLength(s.html) : s.text.length; }
  // A segment's visible text, one character per visible character (an
  // entity stands in as one non-space character).
  function visibleText(s) {
    if (s.html == null) return s.text;
    let out = '';
    for (const t of tokens(s.html)) {
      if (isTag(t)) continue;
      out += t.length > 1 && t[0] === '&' ? (t === '&nbsp;' ? ' ' : 'x') : t;
    }
    return out;
  }
  // The words of all segments in order: where each ends (in visible
  // characters, counted across segments) and when it appears (in units).
  // The last segment's end is when reading finishes.
  function schedule(segments) {
    const words = [];
    let base = 0;
    let t = 0;
    segments.forEach((s) => {
      const text = visibleText(s);
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text))) {
        words.push({ end: base + m.index + m[0].length, at: t });
        t += wordUnits(m[0]);
      }
      base += text.length;
    });
    return { words, totalUnits: t };
  }

  // segments: [{ text, el }] or [{ html, el }] - each rendered into el in
  // sequence, word by word. speed: QB Reader's reading speed, 0 to 100.
  // callbacks: { onComplete, onProgress, startUnits }. Returns a controller.
  // The first segment may carry `lead`: how many of its visible characters
  // are a heading before the question itself ("TOSS-UP Earth and Space
  // Multiple Choice"). They're read out like the rest but don't count
  // towards progress(), so celerity measures the question alone.
  function startReveal(segments, speed, callbacks) {
    callbacks = callbacks || {};
    let msUnit = msPerUnit(speed);
    const lengths = segments.map(segLength);
    const totalChars = lengths.reduce((sum, n) => sum + n, 0);
    const leadChars = Math.max(0, Math.min(totalChars, Number(segments[0] && segments[0].lead) || 0));
    const { words, totalUnits } = schedule(segments);

    let stopped = false;
    let done = false;
    let paused = false;
    let shownChars = 0;
    let unitsBanked = 0; // progress (in units) from before the current run
    let runStart = null; // Date.now() when the current (unpaused) run started
    let tickTimer = null;
    let completeTimer = null;

    segments.forEach((s) => { s.el.textContent = ''; s._shown = 0; });

    function elapsedUnits() {
      if (paused || runStart == null) return unitsBanked;
      return unitsBanked + (Date.now() - runStart) / msUnit;
    }
    // Characters showing at a point in time: up to the end of the last word
    // that has appeared.
    function charsAt(units) {
      let lo = 0; let hi = words.length - 1; let k = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].at <= units) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return k < 0 ? 0 : words[k].end;
    }

    function applyProgress(chars) {
      chars = Math.max(0, Math.min(totalChars, chars));
      if (chars === shownChars) return;
      shownChars = chars;
      let remaining = chars;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const n = Math.min(remaining, lengths[i]);
        if (s._shown !== n) {
          s._shown = n;
          if (s.html != null) s.el.innerHTML = n >= lengths[i] ? s.html : visibleTruncate(s.html, n);
          else s.el.textContent = s.text.slice(0, n);
        }
        remaining -= n;
      }
      if (callbacks.onProgress) callbacks.onProgress();
    }

    function clearTimers() {
      if (tickTimer) clearTimeout(tickTimer);
      if (completeTimer) clearTimeout(completeTimer);
      tickTimer = null; completeTimer = null;
    }

    function finish() {
      if (done) return;
      done = true;
      clearTimers();
      segments.forEach((s, i) => {
        if (s.html != null) s.el.innerHTML = s.html; else s.el.textContent = s.text;
        s._shown = lengths[i];
      });
      shownChars = totalChars;
      if (callbacks.onComplete) callbacks.onComplete();
    }

    function scheduleCompletion() {
      if (completeTimer) clearTimeout(completeTimer);
      const remainMs = Math.max(0, (totalUnits - elapsedUnits()) * msUnit);
      completeTimer = setTimeout(() => { if (!stopped && !done) finish(); }, remainMs);
    }

    function tick() {
      if (stopped || done || paused) return;
      const units = elapsedUnits();
      if (units >= totalUnits) { finish(); return; }
      applyProgress(charsAt(units));
      tickTimer = setTimeout(tick, TICK_MS);
    }

    // startUnits: start part-way through (a player joining a room mid-
    // question picks up where the room's reading is).
    unitsBanked = Math.max(0, Number(callbacks.startUnits) || 0);
    if (segments.length && words.length && unitsBanked >= totalUnits) {
      finish();
    } else if (segments.length && words.length) {
      runStart = Date.now();
      applyProgress(charsAt(unitsBanked));
      tickTimer = setTimeout(tick, TICK_MS);
      scheduleCompletion();
    } else {
      finish();
    }

    return {
      pause() {
        if (done || stopped || paused) return;
        // Bank progress-so-far BEFORE flipping `paused` (elapsedUnits only
        // counts the running time while paused is false).
        unitsBanked = elapsedUnits();
        paused = true;
        runStart = null;
        clearTimers();
      },
      resume() {
        if (done || stopped || !paused) return;
        paused = false;
        runStart = Date.now();
        tickTimer = setTimeout(tick, TICK_MS);
        scheduleCompletion();
      },
      stop() {
        stopped = true;
        clearTimers();
      },
      skipToEnd() {
        if (done) return;
        stopped = true;
        finish();
      },
      isDone() { return done; },
      // How much of the question is showing, 0 to 1, not counting the
      // heading (celerity is 1 minus this, as on QB Reader).
      progress() { return done || totalChars <= leadChars ? 1 : Math.max(0, shownChars - leadChars) / (totalChars - leadChars); },
      isPaused() { return paused; },
      // How far the reading has got, in timing units (pass it back as
      // startUnits to resume another reveal of the same text there).
      units() { return done ? totalUnits : elapsedUnits(); },
      // A new reading speed mid-question: what's shown stays put and only
      // the rest reads faster or slower (progress is kept in units).
      setRate(newSpeed) {
        if (done || stopped) return;
        unitsBanked = elapsedUnits();
        msUnit = msPerUnit(newSpeed);
        if (paused) return; // resume() picks up the new pace
        runStart = Date.now();
        clearTimers();
        tickTimer = setTimeout(tick, TICK_MS);
        scheduleCompletion();
      },
    };
  }

  global.SBReveal = { startReveal, visibleTruncate, visibleLength, insertAtVisible, msPerUnit, wordUnits, schedule, normalizeSpeed, DEFAULT_SPEED };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SBReveal;
})(typeof window !== 'undefined' ? window : globalThis);
