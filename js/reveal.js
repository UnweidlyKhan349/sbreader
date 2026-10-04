/* SB Reader - shared letter-by-letter reveal engine.
   Replaces text-to-speech: instead of being read aloud, the question
   (and its answer choices) type themselves onto the screen at an
   adjustable speed, and "buzzing before it's fully read" now means
   "buzzing before the reveal finishes".

   Position is driven by wall-clock elapsed time rather than by counting
   ticks. This matters for backgrounded browser tabs: Chrome (and others)
   throttle a *chain* of short setTimeout calls down to roughly once a
   second once a tab is hidden, which used to make a reveal that should
   take a few seconds take a minute or more once someone switched tabs.
   Because every tick recomputes "how many characters should be showing
   right now" from Date.now() instead of incrementing by one, a throttled
   tick just jumps straight to the correct position instead of falling
   further behind, and completion is scheduled with a single timer for the
   remaining duration (not a chain), so it fires close to on time even in a
   background tab. */
(function (global) {
  const BASE_CHARS_PER_SEC = 21; // speed at rate 1.0x
  // Visual refresh cadence (not the source of truth for position - that's
  // always recomputed from elapsed wall-clock time, see elapsedMs()). At
  // fast reveal rates multiple characters become due between ticks, which
  // looks like a choppy stutter if the tick is too coarse; 16ms (~60fps)
  // keeps each tick close to revealing just one character even at the
  // fastest rate, without materially increasing CPU use for plain text.
  const TICK_MS = 16;

  // segments: [{ text, el }] - each rendered into el.textContent in sequence,
  // in proportion to elapsed time. Returns a controller.
  function startReveal(segments, rate, callbacks) {
    callbacks = callbacks || {};
    let cps = Math.max(4, BASE_CHARS_PER_SEC * (rate || 1));
    let msPerChar = 1000 / cps;
    const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
    let totalMs = totalChars * msPerChar;

    let stopped = false;
    let done = false;
    let paused = false;
    let shownChars = 0;
    let elapsedBanked = 0; // ms of progress banked from before the current run
    let runStart = null; // Date.now() when the current (unpaused) run started
    let tickTimer = null;
    let completeTimer = null;

    segments.forEach((s) => { s.el.textContent = ''; });

    function elapsedMs() {
      if (paused || runStart == null) return elapsedBanked;
      return elapsedBanked + (Date.now() - runStart);
    }

    function applyProgress(chars) {
      chars = Math.max(0, Math.min(totalChars, chars));
      if (chars === shownChars) return;
      shownChars = chars;
      let remaining = chars;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const n = Math.min(remaining, s.text.length);
        const next = s.text.slice(0, n);
        if (s.el.textContent !== next) s.el.textContent = next;
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
      segments.forEach((s) => { s.el.textContent = s.text; });
      shownChars = totalChars;
      if (callbacks.onComplete) callbacks.onComplete();
    }

    function scheduleCompletion() {
      if (completeTimer) clearTimeout(completeTimer);
      const remainMs = Math.max(0, totalMs - elapsedMs());
      completeTimer = setTimeout(() => { if (!stopped && !done) finish(); }, remainMs);
    }

    function tick() {
      if (stopped || done || paused) return;
      const chars = totalMs > 0 ? Math.floor((elapsedMs() / totalMs) * totalChars) : totalChars;
      if (chars >= totalChars) { finish(); return; }
      applyProgress(chars);
      tickTimer = setTimeout(tick, TICK_MS);
    }

    if (segments.length && totalChars > 0) {
      runStart = Date.now();
      tickTimer = setTimeout(tick, TICK_MS);
      scheduleCompletion();
    } else {
      finish();
    }

    return {
      pause() {
        if (done || stopped || paused) return;
        // Bank progress-so-far BEFORE flipping `paused` - elapsedMs() only
        // computes the live (banked + running) value while paused is still
        // false; flip it first and elapsedMs() short-circuits to the OLD
        // banked value (0 on the very first pause), which made every resume
        // restart the reveal from scratch instead of continuing.
        elapsedBanked = elapsedMs();
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
      isPaused() { return paused; },
      setRate(newRate) {
        // Live speed change mid-reveal: recompute pace from here on, but
        // re-anchor elapsedBanked to the characters already shown so the
        // displayed text doesn't jump forward/backward when the pace
        // changes - only how fast the *remaining* text types out changes.
        if (done || stopped) return;
        cps = Math.max(4, BASE_CHARS_PER_SEC * (newRate || 1));
        msPerChar = 1000 / cps;
        totalMs = totalChars * msPerChar;
        elapsedBanked = shownChars * msPerChar;
        if (paused) return; // resume() will pick up the new pace naturally
        runStart = Date.now();
        clearTimers();
        tickTimer = setTimeout(tick, TICK_MS);
        scheduleCompletion();
      },
    };
  }

  global.SBReveal = { startReveal };
})(window);
