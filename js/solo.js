// Play (solo.html), laid out and behaving like QB Reader's play page: a mode
// (Random Questions, Starred Questions), subject toggles, rebuzz and timer
// switches, each answer you give logged under the question ("Correct
// neptune"), and finished questions collapsed into cards there too (k opens
// the latest, t stars it). You always type your answer.
(function () {
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  // After a wrong answer (with rebuzzes on), the time left to buzz once the
  // question has been read through is never under this.
  const AFTER_BUZZ_MS = 5000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];

  // Everything the sidebar sets. Nothing is saved but the reading speed:
  // Play always opens on the default filters and switches. (Earlier versions
  // saved them; that copy is dropped.) The reading speed is kept per device
  // as sb_reading_speed, and synced to the account when logged in.
  try { localStorage.removeItem('sb_solo_settings'); } catch (e) { /* nothing saved */ }
  const settings = {
    mode: 'random',
    tournaments: [],
    roundRange: null,
    includeUnlabeled: true,
    rebuzz: false,
    timer: true,
  };
  let subjects; // Set of subject keys
  let roundSliderApi;
  let categories;

  /* ================= QUESTIONS FOR THE CURRENT SETTINGS ================= */
  // The questions the settings match, in no particular order.
  function matchingQuestions() {
    if (settings.mode === 'starred') return SBData.filterQuestions({ bookmarkedOnly: true });
    return SBData.filterQuestions({
      subjects,
      tournaments: settings.tournaments.length ? new Set(settings.tournaments) : null,
      roundRange: settings.roundRange,
      includeUnlabeled: settings.includeUnlabeled !== false,
    });
  }
  // The questions to read, in order: the starred questions or random
  // questions matching the filters, mixed evenly across subjects.
  function buildPool(matches) {
    return SBData.stratifiedQueue(matches || matchingQuestions(), (q) => q.subject);
  }

  function updateMatchCount(matches) {
    const el = document.getElementById('matchCount');
    // The sidebar shows before the question bank has arrived.
    if (!SBData.questions) { el.textContent = 'Loading questions…'; return; }
    const n = (matches || matchingQuestions()).length;
    if (settings.mode === 'starred') {
      el.textContent = '';
      document.getElementById('starredInfo').textContent = n ? '' : 'No starred questions.';
    } else {
      el.textContent = `${n.toLocaleString()} question${n === 1 ? '' : 's'} match your settings${SBData.missingText()}`;
    }
  }

  // A settings change applies from the next question: the not-yet-asked part
  // of the queue is rebuilt then (without anything already asked). Only the
  // count is worked out now: a dragged slider changes the settings many
  // times a second, and filtering and shuffling the whole bank twice on each
  // made the sidebar lag.
  function onSettingsChange() {
    if (!SBData.questions) { updateMatchCount(); return; }
    updateMatchCount(matchingQuestions());
    if (sessionActive()) session.queueStale = true;
  }
  function rebuildQueue() {
    session.queueStale = false;
    const asked = new Set(session.queue.slice(0, session.index + 1).map((q) => q.id));
    const rest = buildPool().filter((q) => !asked.has(q.id));
    session.queue = session.queue.slice(0, session.index + 1).concat(rest);
  }

  /* ================= SIDEBAR ================= */
  function showModeSettings() {
    document.getElementById('randomSettings').classList.toggle('d-none', settings.mode !== 'random');
    document.getElementById('starredSettings').classList.toggle('d-none', settings.mode !== 'starred');
    // Starred mode plays your starred questions whatever their subject, so
    // the subject tiles are hidden there, as are the two "Clear" links.
    document.getElementById('subjectButtons').classList.toggle('d-none', settings.mode === 'starred');
    document.getElementById('clearFilters').classList.toggle('d-none', settings.mode === 'starred');
    document.getElementById('clearStats').classList.toggle('d-none', settings.mode === 'starred');
  }

  function initSettings() {
    subjects = new Set(SBData.meta.subjects.map((s) => s.key));
    categories = SBPlay.subjectButtons(document.getElementById('subjectButtons'), SBData.meta.subjects, subjects, onSettingsChange);

    // Mode.
    // Play always opens on Random Questions (as QB Reader does), unless the
    // link asks for starred questions.
    const params = new URLSearchParams(location.search);
    settings.mode = params.get('mode') === 'starred' || params.get('bookmarked') === '1' ? 'starred' : 'random';
    const mode = document.getElementById('setMode');
    mode.value = settings.mode;
    mode.addEventListener('change', () => { settings.mode = mode.value; showModeSettings(); onSettingsChange(); mode.blur(); });
    showModeSettings();

    document.getElementById('clearFilters').addEventListener('click', (e) => { e.currentTarget.blur(); clearFilters(); });
    document.getElementById('clearStats').addEventListener('click', (e) => { e.preventDefault(); e.currentTarget.blur(); clearStats(); });

    // Random Questions: tournaments and rounds.
    const tSelect = document.getElementById('tournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug;
      opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => { settings.tournaments = tSelect.getMultiValues(); scopeRounds(); onSettingsChange(); });
    SBData.enhanceMultiSelect(tSelect);
    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    roundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('roundMin'),
      maxInput: document.getElementById('roundMax'),
      fillEl: document.getElementById('roundSliderFill'),
      labelEl: document.getElementById('roundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { settings.roundRange = [lo, hi]; onSettingsChange(); },
    });
    const unlabeled = document.getElementById('toggleUnlabeled');
    unlabeled.checked = settings.includeUnlabeled !== false;
    unlabeled.addEventListener('change', () => { settings.includeUnlabeled = unlabeled.checked; unlabeled.blur(); onSettingsChange(); });
    scopeRounds();

    // Switches.
    const switches = { toggleRebuzz: 'rebuzz', toggleTimer: 'timer' };
    Object.entries(switches).forEach(([id, key]) => {
      const el = document.getElementById(id);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; el.blur(); applySwitches(); });
    });
    applySwitches();

    const rateSlider = document.getElementById('rateSlider');
    // QB Reader's reading speed: 0 to 100, 50 by default; your own saved one.
    let savedRate = null;
    try { savedRate = localStorage.getItem('sb_reading_speed'); } catch (e) { /* default */ }
    session.rate = SBReveal.normalizeSpeed(savedRate);
    rateSlider.value = session.rate;
    document.getElementById('rateValue').textContent = String(session.rate);
    rateSlider.addEventListener('input', () => {
      session.rate = SBReveal.normalizeSpeed(rateSlider.value);
      document.getElementById('rateValue').textContent = String(session.rate);
      try { localStorage.setItem('sb_reading_speed', String(session.rate)); } catch (e) { /* not saved */ }
      if (runtime.revealCtl && !runtime.revealCtl.isDone()) runtime.revealCtl.setRate(session.rate);
    });
    // Logging in can bring the account's reading speed.
    window.addEventListener('sb-settings-synced', () => {
      let v = null;
      try { v = localStorage.getItem('sb_reading_speed'); } catch (e) { return; }
      if (v == null) return;
      session.rate = SBReveal.normalizeSpeed(v);
      rateSlider.value = session.rate;
      document.getElementById('rateValue').textContent = String(session.rate);
      if (runtime.revealCtl && !runtime.revealCtl.isDone()) runtime.revealCtl.setRate(session.rate);
    });

    updateMatchCount();
  }

  // The round slider spans the picked tournaments' rounds only.
  // Clear all filters: every tournament, every round, and no subject picked
  // (which plays every subject). The mode stays.
  function clearFilters() {
    settings.tournaments = [];
    document.getElementById('tournamentSelect').setMultiValues([]);
    scopeRounds();
    subjects.clear();
    categories.sync();
    settings.includeUnlabeled = true;
    document.getElementById('toggleUnlabeled').checked = true;
    roundSliderApi.reset(); // reports the full range, which saves and recounts
    settings.roundRange = null;
    onSettingsChange();
  }

  function scopeRounds() {
    const moved = roundSliderApi && roundSliderApi.setMax(SBData.maxRoundFor(new Set(settings.tournaments)));
    if (moved) settings.roundRange = moved;
  }

  // Enable timer. Off, nothing is timed and nothing is read out: each
  // question shows in full at once, open for buzzing until you answer or
  // move on.
  function applySwitches() {
    document.getElementById('timer').classList.toggle('d-none', !settings.timer);
    // Turning the timer off mid-countdown stops it (and shows the rest of a
    // question being read); turning it on starts the buzz window again if
    // the question has finished reading.
    if (!settings.timer) {
      clearRuntimeTimer();
      if (runtime.phase === 'revealing' && runtime.revealCtl) runtime.revealCtl.skipToEnd();
    } else if (runtime.phase === 'buzzwindow' && !runtime.timer) startBuzzWindow(true);
  }

  // On wide screens the sidebar sits beside the question. On narrow ones it
  // sits above it, open until the first question starts (as on QB Reader, so
  // the subjects and other settings are there to see before playing), then
  // showing only the timer. The gear button (or e) toggles it. (Until
  // November 25, 2026 it started closed on a phone.)
  const WIDE = window.matchMedia('(min-width: 992px)');
  function toggleSidebar() {
    const el = document.getElementById('settings');
    if (WIDE.matches) {
      // As on QB Reader, the question and the button bar widen into the
      // space the sidebar leaves.
      el.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', el.classList.contains('collapsed'));
    } else el.classList.toggle('show');
  }
  // On a phone, as on QB Reader, a new question closes the settings.
  function hideSettingsOnPhone() {
    if (!WIDE.matches) document.getElementById('settings').classList.remove('show');
  }

  /* ================= GAME STATE ================= */
  const session = {
    queue: [], index: -1,
    // The settings changed since the queue was made (see onSettingsChange).
    queueStale: false,
    correct: 0, incorrect: 0, skipped: 0, points: 0,
    // Celerity: how much of each question had been read when you buzzed
    // and got it right, averaged (as a percentage).
    celeritySum: 0, celerityCount: 0,
    rate: 50,
  };
  const runtime = {
    phase: 'idle', // idle | revealing | buzzwindow | answering | reveal | done
    revealCtl: null,
    readingDone: false,
    buzzedDuringReading: false,
    attempts: [], // wrong answers given on this question (with rebuzzes on)
    lastOutcome: null,
    pendingCard: null, // the question just finished, carded when the next one starts
    timer: null, remainingMs: 0, totalMs: 0, timerKind: null, onExpire: null,
    buzzwindowLeftMs: null,
    paused: false,
    // Counts the questions played, so each one's lines in the history can be
    // told apart (an index repeats when starred questions start over).
    serial: 0,
  };
  function sessionActive() { return runtime.phase !== 'idle' && runtime.phase !== 'done'; }

  function startSession() {
    const pool = buildPool();
    if (!pool.length) {
      // As on QB Reader, an alert, and nothing starts.
      window.alert(settings.mode === 'starred' ? 'No starred questions.' : 'No questions found');
      return;
    }
    session.queue = pool;
    session.index = -1;
    session.queueStale = false;
    nextQuestion();
  }

  // Celerity, as QB Reader shows it: the average share of the question still
  // unread at your correct buzzes, 0 to 1 (higher = earlier), e.g. "0.805".
  function celerityText(sum, count) { return (count ? 1 - sum / count : 0).toFixed(3); }
  function updateCounters() {
    const seen = session.correct + session.incorrect + session.skipped;
    document.getElementById('statline').textContent =
      `${session.correct}/${session.incorrect} with ${seen} question${seen === 1 ? '' : 's'} seen (${session.points} pts, celerity: ${celerityText(session.celeritySum, session.celerityCount)})`;
  }

  // Clear stats, as on QB Reader: the session's counts, points and celerity
  // start again from zero; the questions and the history stay.
  function clearStats() {
    Object.assign(session, { correct: 0, incorrect: 0, skipped: 0, points: 0, celeritySum: 0, celerityCount: 0 });
    // The answer on screen was counted before the clear: overriding it now
    // changes its grade, not the fresh counts.
    played.forEach((o) => { o.uncounted = true; });
    updateCounters();
  }

  function currentQ() { return session.index >= 0 ? session.queue[session.index] : null; }

  // The question just played goes into the history, collapsed, as the next
  // one starts (as on QB Reader).
  function cardPending() {
    const p = runtime.pendingCard;
    if (!p) return;
    runtime.pendingCard = null;
    const card = SBPlay.historyCard(p.q, { grade: p.category });
    document.getElementById('questionLog').prepend(card);
  }

  function nextQuestion() {
    // The last question's play is final now: off to its community stats.
    if (window.SBQuestionStats) SBQuestionStats.flush();
    if (session.queueStale) rebuildQueue();
    if (settings.mode === 'starred') {
      // Starred questions loop, and a question unstarred since the queue was
      // made isn't read: on to the next one that still has its star, starting
      // over from the live set of stars at the end. With none left, an
      // alert, and the last question stays where it is.
      let next = session.index + 1;
      while (next < session.queue.length && !SBData.bookmarks.isBookmarked(session.queue[next].id)) next++;
      if (next >= session.queue.length) {
        const pool = buildPool();
        if (!pool.length) { window.alert('No starred questions.'); return; }
        session.queue = pool;
        next = 0;
      }
      session.index = next - 1;
    } else if (session.index + 1 >= session.queue.length) {
      // As on QB Reader: an alert, and the last question stays where it is.
      window.alert('You have reached the end of the questions that match your settings');
      return;
    }
    clearRuntimeTimer();
    if (runtime.revealCtl) runtime.revealCtl.stop();
    setPaused(false);
    cardPending();
    parkOverride();
    addPastOverride(runtime.lastOutcome);
    hideSettingsOnPhone();

    session.index++;
    runtime.serial++;
    const q = currentQ();
    runtime.phase = 'revealing';
    runtime.readingDone = false;
    runtime.buzzedDuringReading = false;
    runtime.attempts = [];
    runtime.buzzFraction = null;
    runtime.lastOutcome = null;
    runtime.buzzwindowLeftMs = null;

    document.getElementById('revealBox').style.display = 'none';
    document.getElementById('answerRow').classList.add('d-none');
    parkOverride();
    document.getElementById('overrideBtn').classList.add('d-none');
    resetTimer();
    setNextButtonMode('skip');
    setBuzzEnabled(true);
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('questionInfo').textContent = SBData.sourceLabelFor(q, ' ');

    const qDisplay = document.getElementById('qDisplay');
    // Read out as a moderator would: "TOSS-UP Physics Short Answer ...".
    const boxSegments = [{ html: SBData.readoutHTML(q), el: qDisplay, lead: SBReveal.visibleLength(SBData.readoutHeaderHTML(q)) }];
    const choicesDisplay = document.getElementById('choicesDisplay');
    if (q.choices) {
      choicesDisplay.style.display = '';
      LETTERS.forEach((L) => {
        boxSegments.push({ html: SBData.renderMathHTML(q.choices[L] || ''), el: document.getElementById('choiceText' + L) });
      });
    } else {
      choicesDisplay.style.display = 'none';
    }

    // A visual question shows its image(s) from the start, the way a
    // moderator puts the slide up before reading; only the text reveals.
    const figures = document.getElementById('qFigures');
    if (q.visual) {
      figures.replaceChildren(...SBData.questionFigures(q, { eager: true }).children);
      figures.style.display = '';
    } else {
      figures.replaceChildren();
      figures.style.display = 'none';
    }
    SBData.preloadImages(session.queue[session.index + 1]);

    // The question and choices are given as math-rendered HTML, so
    // superscripts and subscripts type in already formatted.
    runtime.revealCtl = SBReveal.startReveal(boxSegments, session.rate, {
      onComplete: () => { runtime.readingDone = true; startBuzzWindow(); },
    });
    // With the timer off, the whole question at once.
    if (!settings.timer) runtime.revealCtl.skipToEnd();
  }

  // After the question is read: the buzz window (4 s for a tossup, 20 s for a
  // bonus), or, with the timer off, no limit (Next moves on). `resume` picks
  // up where a rebuzz left off.
  function startBuzzWindow(resume) {
    if (runtime.phase !== 'revealing' && !(resume && runtime.phase === 'buzzwindow')) return;
    runtime.phase = 'buzzwindow';
    if (!settings.timer) return;
    const q = currentQ();
    const full = q.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
    let ms = runtime.buzzwindowLeftMs != null ? runtime.buzzwindowLeftMs : full;
    if (runtime.attempts.length) ms = Math.max(ms, AFTER_BUZZ_MS);
    runTimer(ms, 'buzz', () => { resolveQuestion(); });
  }

  function buzzIn() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    if (runtime.paused) return;
    runtime.buzzedDuringReading = runtime.phase === 'revealing';
    runtime.buzzFraction = runtime.phase === 'revealing' && runtime.revealCtl ? runtime.revealCtl.progress() : 1;
    // Reading pauses (rather than stops) so a rebuzz can carry on from here.
    if (runtime.phase === 'revealing' && runtime.revealCtl) runtime.revealCtl.pause();
    if (runtime.phase === 'buzzwindow' && runtime.timer) runtime.buzzwindowLeftMs = runtime.remainingMs;
    clearRuntimeTimer();
    runtime.phase = 'answering';
    setBuzzEnabled(false);
    setNextButtonMode('disabled');
    const answerRow = document.getElementById('answerRow');
    answerRow.classList.remove('d-none');
    const input = document.getElementById('answerInput');
    input.value = '';
    input.focus();

    if (settings.timer) runTimer(ANSWER_MS, 'answer', () => submitAnswer(document.getElementById('answerInput').value));
  }

  // Each answer you give goes into the history under the question as you
  // give it, as buzzes do in Multiplayer: "Correct neptune" or "Incorrect
  // mars" (with Close for a near miss), newest first. An override recolours
  // it, and the "I was wrong" / "I was right" link sits at its right.
  function logAnswer(correct, userText, close) {
    const li = document.createElement('li');
    li.className = 'answer-line';
    li.dataset.serial = String(runtime.serial);
    li.innerHTML = '<span class="badge text-white"></span> <span class="user-answer"></span>';
    li.querySelector('.user-answer').textContent = userText.trim() ? userText : '(blank)';
    paintAnswerLine(li, correct, close);
    document.getElementById('questionLog').prepend(li);
  }
  function paintAnswerLine(li, correct, close) {
    const badge = li.querySelector('.badge');
    badge.classList.toggle('bg-success', correct);
    badge.classList.toggle('bg-danger', !correct);
    badge.textContent = correct ? 'Correct' : 'Incorrect';
    const hint = li.querySelector('.close-hint');
    if (hint && (correct || !close)) hint.remove();
    if (!correct && close && !hint) {
      const h = document.createElement('span');
      h.className = 'close-hint ms-2';
      h.textContent = 'Close';
      li.querySelector('.user-answer').after(h);
    }
  }
  // This question's last answer line.
  function lastAnswerLine() {
    return [...document.querySelectorAll('#questionLog > li.answer-line')].find((li) => li.dataset.serial === String(runtime.serial)) || null;
  }

  function submitAnswer(text) {
    if (runtime.phase !== 'answering') return;
    clearRuntimeTimer();
    // The answer clock is over: back to 0, not stopped on what was left of
    // it while the question reads on after a wrong interrupt.
    resetTimer();
    const q = currentQ();
    const result = text.trim() ? SBAnswer.checkAnswer(q, text) : { correct: false };
    document.getElementById('answerRow').classList.add('d-none');
    logAnswer(!!result.correct, text, !!result.close);
    if (result.correct) {
      resolveQuestion({ correct: true, userText: text });
      return;
    }
    runtime.attempts.push({ userText: text, close: !!result.close, early: runtime.buzzedDuringReading });
    if (settings.rebuzz) {
      // Allow rebuzzes: the question carries on where it stopped.
      setBuzzEnabled(true);
      setNextButtonMode('skip');
      if (!runtime.readingDone) {
        runtime.phase = 'revealing';
        if (runtime.revealCtl) runtime.revealCtl.resume();
      } else {
        runtime.phase = 'buzzwindow';
        startBuzzWindow(true);
      }
      return;
    }
    resolveQuestion();
  }

  // The question ends: answered correctly ({ correct: true, userText }), or
  // not (wrong, skipped or out of time; any wrong attempts make it incorrect).
  function resolveQuestion(win) {
    clearRuntimeTimer();
    // Phase flips to 'reveal' BEFORE skipToEnd(), which can fire the reveal's
    // onComplete (startBuzzWindow) synchronously; that only bails out once
    // reading is over, or a stray buzz timer would outlive the question.
    runtime.phase = 'reveal';
    if (runtime.revealCtl) runtime.revealCtl.skipToEnd();
    const q = currentQ();
    const last = runtime.attempts[runtime.attempts.length - 1];
    const outcome = win
      // `early`: the winning buzz came before the question finished, so an
      // "I was wrong" makes it an interrupt (−4).
      ? { attempted: true, correct: true, userText: win.userText, early: runtime.buzzedDuringReading }
      : runtime.attempts.length
        ? { attempted: true, correct: false, userText: last.userText, close: last.close, early: last.early }
        : { attempted: false };
    // What an override needs later, on this question or a past one: the
    // question, where you buzzed, and how many of the wrong buzzes before
    // the deciding one (the win, or the last wrong answer) were interrupts.
    const before = win ? runtime.attempts : runtime.attempts.slice(0, -1);
    Object.assign(outcome, {
      q, serial: runtime.serial,
      fraction: runtime.buzzFraction,
      earlierInterrupts: before.filter((a) => a.early).length,
    });
    runtime.lastOutcome = outcome;

    // A question you didn't buzz on (skipped, or out of time) counts as
    // seen but not as incorrect, as on QB Reader. (Until November 25, 2026
    // it counted toward Incorrect too.)
    let category;
    if (!outcome.attempted) { category = 'skipped'; session.skipped++; }
    else if (outcome.correct) {
      category = 'correct'; session.correct++;
      session.celeritySum += runtime.buzzFraction == null ? 1 : runtime.buzzFraction;
      session.celerityCount++;
    }
    else { category = 'incorrect'; session.incorrect++; }
    session.points += pointsFor(outcome);
    updateCounters();
    runtime.pendingCard = { q, category, userText: outcome.userText || '' };
    // (the handle lets an override change this answer later)
    if (window.SBAccount) outcome.account = SBAccount.recordAnswer(q, category, 'solo', accountExtra(outcome));
    if (outcome.attempted) played.push(outcome);
    // For the question's community stats: how it went (a question skipped
    // before it was read through wasn't heard, so it isn't counted).
    if (window.SBQuestionStats && (outcome.attempted || runtime.readingDone)) {
      outcome.stats = SBQuestionStats.track(q, 'solo', playResult(outcome), celerityOf(outcome));
    }

    setBuzzEnabled(false);
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('answerRow').classList.add('d-none');
    resetTimer();
    setNextButtonMode('next');
    showReveal();
  }

  // A finished question as the community stats count it.
  function playResult(outcome) {
    if (!outcome.attempted) return 'unanswered';
    if (outcome.correct) return 'correct';
    return pointsFor(outcome) < 0 ? 'neg' : 'incorrect';
  }
  function fractionOf(outcome) { return outcome.fraction == null ? 1 : outcome.fraction; }
  function celerityOf(outcome) {
    return outcome.correct ? 1 - fractionOf(outcome) : null;
  }
  // For your account's stats: the points, and where you buzzed (right or
  // wrong; nothing for a question you didn't buzz on).
  function accountExtra(outcome) {
    return {
      points: pointsFor(outcome),
      celerity: outcome.attempted ? 1 - fractionOf(outcome) : null,
    };
  }

  // Science Bowl scoring, as Multiplayer keeps it: +4 for the right answer;
  // −4 for every wrong answer buzzed in while the question was still being
  // read (an interrupt; with rebuzzes on there can be several), and 0 for a
  // wrong answer after it was read. A right answer after interrupts still
  // carries their −4s (two interrupts then the answer: −4).
  function pointsFor(outcome) {
    if (!outcome.attempted) return 0;
    const deciding = outcome.correct ? 4 : (outcome.early ? -4 : 0);
    return deciding - 4 * (outcome.earlierInterrupts || 0);
  }

  function showReveal() {
    const q = currentQ();
    const box = document.getElementById('revealBox');
    const outcome = runtime.lastOutcome;
    // Just the answer line: how you did is on your answer's line in the
    // history below.
    const html = `<p class="ans-line mb-1">ANSWER: ${SBData.answerLineHTML(SBData.answerDisplayText(q), q.answer.letter, q.answer.accept, q.answer.reject).replace(/^Answer: /, '')}</p>`;
    parkOverride();
    box.innerHTML = html;
    // Once it's over, the label above the question links to the packet.
    SBPlay.linkQuestionInfo(document.getElementById('questionInfo'), q, q.sourceUrl);
    box.style.display = 'block';
    SBPlay.headerStar(document.getElementById('qDisplay'), q.id, () => SBPlay.repaintStars(document.getElementById('questionLog'), q.id));

    // "I was wrong" undoes a Correct; "I was right" undoes an Incorrect.
    const override = document.getElementById('overrideBtn');
    const line = outcome && outcome.attempted ? lastAnswerLine() : null;
    if (line) {
      paintAnswerLine(line, outcome.correct, outcome.close);
      override.textContent = outcome.correct ? 'I was wrong' : 'I was right';
      // On the same line as "Correct neptune", at the right.
      line.appendChild(override);
      override.classList.remove('d-none');
    } else {
      override.classList.add('d-none');
    }
    // Report at the right of the answer line, answered or skipped.
    if (window.SBReports) box.querySelector('.ans-line').prepend(SBPlay.answerReportLink(q));
  }

  // The override link lives on your answer's line in the history while the
  // answer shows; it's moved back out when the next question starts.
  function parkOverride() {
    const override = document.getElementById('overrideBtn');
    const box = document.getElementById('revealBox');
    if (override.parentElement !== box.parentElement) box.before(override);
  }

  function skipQuestion() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    // Skipping a paused question goes on unpaused.
    if (runtime.paused) setPaused(false);
    resolveQuestion();
  }

  // "I was wrong" / "I was right": flips a graded answer, this question's
  // or any earlier one's (from the link on its line in the history). The
  // counts, points and celerity follow (unless Clear stats came since), and
  // so does your account's record of it; a flip to right is logged for the
  // grader (SBReports), and the question's community stats follow too
  // (SBQuestionStats changes a play already sent).
  const played = []; // every graded answer this page has shown
  function flipOutcome(o) {
    if (!o.uncounted) {
      session.points -= pointsFor(o);
      // Celerity follows the override: a correct answer counts toward it.
      const f = fractionOf(o);
      if (o.correct) { session.correct--; session.incorrect++; session.celeritySum -= f; session.celerityCount--; } else { session.incorrect--; session.correct++; session.celeritySum += f; session.celerityCount++; }
    }
    o.correct = !o.correct;
    if (!o.uncounted) session.points += pointsFor(o);
    updateCounters();
    // (the community stats too: sent or not, the play's handle changes it)
    if (o.stats) o.stats.change(playResult(o), celerityOf(o));
    if (o.account) o.account.update(o.correct ? 'correct' : 'incorrect', accountExtra(o));
    if (o.correct && window.SBReports) SBReports.logOverride(o.q, o.userText, 'solo');
  }
  function overrideGrading() {
    if (runtime.phase !== 'reveal' || !runtime.lastOutcome || !runtime.lastOutcome.attempted) return;
    const o = runtime.lastOutcome;
    flipOutcome(o);
    if (runtime.pendingCard) runtime.pendingCard.category = o.correct ? 'correct' : 'incorrect';
    showReveal();
  }
  // Once the next question starts, a past answer's line keeps its own
  // "I was wrong" / "I was right" link.
  function addPastOverride(o) {
    if (!o || !o.attempted) return;
    const line = [...document.querySelectorAll('#questionLog > li.answer-line')].find((li) => li.dataset.serial === String(o.serial));
    if (!line || line.querySelector('.past-override')) return;
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'btn btn-link p-0 float-end past-override';
    link.setAttribute('role', 'button');
    const paint = () => { link.textContent = o.correct ? 'I was wrong' : 'I was right'; paintAnswerLine(line, o.correct, o.close); };
    link.addEventListener('click', (e) => { e.preventDefault(); link.blur(); flipOutcome(o); paint(); });
    paint();
    line.appendChild(link);
  }

  // The button skips while a question is being read, goes on once it's
  // answered, starts a session before there is one, and waits while you
  // answer. On the keyboard the two are separate keys: n starts or goes on
  // (never a skip, so it does nothing until the question is over), and s
  // only skips.
  function setNextButtonMode(mode) {
    const btn = document.getElementById('nextBtn');
    btn.dataset.mode = mode;
    btn.disabled = mode === 'disabled';
    btn.textContent = mode === 'skip' ? 'Skip' : 'Next';
    btn.title = mode === 'skip' ? 'Shortcut: s' : 'Shortcut: n';
  }
  function handleNextButton() {
    const mode = document.getElementById('nextBtn').dataset.mode;
    if (mode === 'skip') skipQuestion();
    else if (mode === 'next') nextQuestion();
    else if (mode === 'start') startSession();
  }
  function nextKey() {
    const mode = document.getElementById('nextBtn').dataset.mode;
    if (mode === 'next') nextQuestion();
    else if (mode === 'start') startSession();
  }
  function setBuzzEnabled(on) { document.getElementById('buzzBtn').disabled = !on; }


  function runTimer(ms, kind, onExpire) {
    clearRuntimeTimer();
    runtime.totalMs = ms; runtime.remainingMs = ms; runtime.timerKind = kind; runtime.onExpire = onExpire;
    renderTick(ms);
    // Counts the time that has really passed since the last firing, not a
    // fixed 100 ms: a background tab fires intervals as rarely as once a
    // second, which made the countdown run up to ten times slow there.
    // While paused, the time passing isn't counted.
    let last = Date.now();
    runtime.timer = setInterval(() => {
      const now = Date.now();
      const passed = now - last;
      last = now;
      if (runtime.paused) return;
      runtime.remainingMs -= passed;
      if (runtime.remainingMs <= 0) {
        renderTick(0);
        clearInterval(runtime.timer); runtime.timer = null;
        const fn = runtime.onExpire; runtime.onExpire = null;
        if (fn) fn();
        return;
      }
      renderTick(runtime.remainingMs);
    }, 100);
  }
  function clearRuntimeTimer() {
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null; runtime.onExpire = null;
  }
  // The big readout: whole seconds, then tenths in smaller type.
  function renderTick(remainingMs) {
    const tenths = Math.max(0, Math.round(remainingMs / 100));
    document.getElementById('timerFace').textContent = String(Math.floor(tenths / 10));
    document.getElementById('timerFraction').textContent = '.' + (tenths % 10);
  }
  function resetTimer() { renderTick(0); }

  function setPaused(on) {
    runtime.paused = on;
    const btn = document.getElementById('pauseBtn');
    btn.innerHTML = on ? SBIcons.play : SBIcons.pause;
    btn.setAttribute('aria-label', on ? 'Resume' : 'Pause');
  }
  function togglePause() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow' && runtime.phase !== 'answering') return;
    setPaused(!runtime.paused);
    if (runtime.revealCtl && runtime.phase === 'revealing') {
      if (runtime.paused) runtime.revealCtl.pause(); else runtime.revealCtl.resume();
    }
  }

  function wireGameControls() {
    document.getElementById('buzzBtn').addEventListener('click', function () { this.blur(); buzzIn(); });
    document.getElementById('nextBtn').addEventListener('click', function () { this.blur(); handleNextButton(); });
    document.getElementById('overrideBtn').addEventListener('click', (e) => { e.preventDefault(); overrideGrading(); });
    document.getElementById('pauseBtn').addEventListener('click', function () { this.blur(); togglePause(); });
    document.getElementById('settingsBtn').addEventListener('click', function () { this.blur(); toggleSidebar(); });
    document.getElementById('submitAnswerBtn').addEventListener('click', () => submitAnswer(document.getElementById('answerInput').value));
    document.getElementById('answerInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitAnswer(document.getElementById('answerInput').value); }
    });

    // The keys: space buzz, n next, s skip, p pause, e settings, k show/hide
    // the last question, t star/unstar it; plus q for I was wrong/right.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (window.SBSite && SBSite.modalOpen()) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const log = document.getElementById('questionLog');
      switch ((e.key || '').toLowerCase()) {
        case ' ':
          // Nothing focused (a history card, its star) acts on this Space too.
          e.preventDefault();
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
          buzzIn();
          return;
        case 'n': nextKey(); return;
        case 's': skipQuestion(); return;
        case 'p': togglePause(); return;
        case 'e': toggleSidebar(); return;
        case 'k': SBPlay.toggleLatest(log); return;
        case 't': SBPlay.starLatest(log, document.getElementById('qDisplay')); return;
        case 'q': overrideGrading(); return;
        default:
      }
    });
  }

  setPaused(false);
  document.getElementById('settingsBtn').innerHTML = SBIcons.gear;
  setNextButtonMode('disabled');
  updateCounters();

  // The sidebar needs only meta.json (76 KB), so it's drawn at once; Next
  // waits for the question bank (SBData.load, started from <head>).
  const metaReady = SBData.loadMeta().then(() => {
    initSettings();
    wireGameControls();
  });
  Promise.all([metaReady, SBData.load()]).then(() => {
    scopeRounds();
    updateMatchCount();
    setNextButtonMode('start');
    // Arriving for starred questions (e.g. an old bookmarks link) starts at once.
    const p = new URLSearchParams(location.search);
    if (settings.mode === 'starred' && (p.has('mode') || p.get('bookmarked') === '1')) startSession();
  }).catch((err) => {
    document.getElementById('qDisplay').textContent = SBData.loadErrorText(err);
    document.getElementById('matchCount').textContent = '';
  });
})();
