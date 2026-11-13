// Play (solo.html), laid out and behaving like QB Reader's play page: a mode
// (Random Questions, Starred Questions), subject toggles,
// type-to-answer / rebuzz / timer switches, and finished questions
// collapsed into cards under the current one (k opens the latest, t stars it).
(function () {
  const { escapeHtml } = SBData;
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  // After a wrong answer (with rebuzzes on), the time left to buzz once the
  // question has been read through is never under this.
  const AFTER_BUZZ_MS = 5000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];
  const SETTINGS_KEY = 'sb_solo_settings';

  // Everything the sidebar sets, saved per device.
  const settings = SBPlay.loadSettings(SETTINGS_KEY, {
    mode: 'random',
    subjects: null, // null = every subject
    tournaments: [],
    roundRange: null,
    // [first, last] years, or null for every year.
    yearRange: null,
    includeUnlabeled: true,
    // Off, as QB Reader's "Type to answer": you buzz, reveal the answer and
    // grade yourself (counted right; "I was wrong" flips it).
    typeToAnswer: true,
    rebuzz: false,
    timer: true,
  });
  function save() { SBPlay.saveSettings(SETTINGS_KEY, { ...settings, subjects: [...subjects] }); }
  let subjects; // Set of subject keys
  let roundSliderApi;
  let yearSliderApi;
  let categories;

  /* ================= QUESTIONS FOR THE CURRENT SETTINGS ================= */
  // The questions the settings match, in no particular order.
  function matchingQuestions() {
    if (settings.mode === 'starred') return SBData.filterQuestions({ bookmarkedOnly: true });
    return SBData.filterQuestions({
      subjects,
      tournaments: settings.tournaments.length ? new Set(settings.tournaments) : null,
      roundRange: settings.roundRange,
      yearRange: settings.yearRange,
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
      el.textContent = `${n.toLocaleString()} question${n === 1 ? '' : 's'} match your settings`;
    }
  }

  // A settings change applies from the next question: the not-yet-asked part
  // of the queue is rebuilt then (without anything already asked). Only the
  // count is worked out now: a dragged slider changes the settings many
  // times a second, and filtering and shuffling the whole bank twice on each
  // made the sidebar lag.
  function onSettingsChange() {
    save();
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
    const all = SBData.meta.subjects.map((s) => s.key);
    subjects = new Set(Array.isArray(settings.subjects) && settings.subjects.length ? settings.subjects.filter((k) => all.includes(k)) : all);
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
    if (settings.tournaments.length) tSelect.setMultiValues(settings.tournaments);
    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    roundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('roundMin'),
      maxInput: document.getElementById('roundMax'),
      fillEl: document.getElementById('roundSliderFill'),
      labelEl: document.getElementById('roundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { settings.roundRange = [lo, hi]; onSettingsChange(); },
    });
    if (settings.roundRange) roundSliderApi.setRange(settings.roundRange[0], settings.roundRange[1]);
    // Year range, as on QB Reader: the tournaments' years.
    const [firstYear, lastYear] = SBData.yearSpan();
    yearSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('yearMin'),
      maxInput: document.getElementById('yearMax'),
      fillEl: document.getElementById('yearSliderFill'),
      labelEl: document.getElementById('yearRangeLabel'),
      min: firstYear,
      maxRound: lastYear,
      label: SBPlay.yearLabel,
      onChange: (lo, hi) => { settings.yearRange = lo === firstYear && hi === lastYear ? null : [lo, hi]; onSettingsChange(); },
    });
    if (settings.yearRange) yearSliderApi.setRange(Math.max(firstYear, settings.yearRange[0]), Math.min(lastYear, settings.yearRange[1]));
    const unlabeled = document.getElementById('toggleUnlabeled');
    unlabeled.checked = settings.includeUnlabeled !== false;
    unlabeled.addEventListener('change', () => { settings.includeUnlabeled = unlabeled.checked; unlabeled.blur(); onSettingsChange(); });
    scopeRounds();

    // Switches.
    const switches = { toggleTypeToAnswer: 'typeToAnswer', toggleRebuzz: 'rebuzz', toggleTimer: 'timer' };
    Object.entries(switches).forEach(([id, key]) => {
      const el = document.getElementById(id);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; el.blur(); applySwitches(); save(); });
    });
    applySwitches();

    const rateSlider = document.getElementById('rateSlider');
    // QB Reader's reading speed: 0 to 100, 50 by default.
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

    updateMatchCount();
  }

  // The round slider spans the picked tournaments' rounds only.
  // Clear all filters: every tournament, every round, every subject. The
  // mode stays.
  function clearFilters() {
    settings.tournaments = [];
    document.getElementById('tournamentSelect').setMultiValues([]);
    scopeRounds();
    subjects.clear();
    SBData.meta.subjects.forEach((s) => subjects.add(s.key));
    categories.sync();
    settings.includeUnlabeled = true;
    document.getElementById('toggleUnlabeled').checked = true;
    roundSliderApi.reset(); // reports the full range, which saves and recounts
    settings.roundRange = null;
    yearSliderApi.reset();
    settings.yearRange = null;
    onSettingsChange();
  }

  function scopeRounds() {
    const moved = roundSliderApi && roundSliderApi.setMax(SBData.maxRoundFor(new Set(settings.tournaments)));
    if (moved) settings.roundRange = moved;
  }

  // Enable timer.
  function applySwitches() {
    document.getElementById('timer').classList.toggle('d-none', !settings.timer);
    // Turning the timer off mid-countdown stops it; turning it on starts the
    // buzz window again if the question has finished reading.
    if (!settings.timer) clearRuntimeTimer();
    else if (runtime.phase === 'buzzwindow' && !runtime.timer) startBuzzWindow(true);
  }

  // On wide screens the sidebar starts open; on narrow ones it sits above the
  // question showing only the timer. The gear button (or e) toggles it.
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
    const seen = session.correct + session.incorrect;
    document.getElementById('statline').textContent =
      `${session.correct}/${session.incorrect} with ${seen} question${seen === 1 ? '' : 's'} seen (${session.points} pts, celerity: ${celerityText(session.celeritySum, session.celerityCount)})`;
  }

  // Clear stats, as on QB Reader: the session's counts, points and celerity
  // start again from zero; the questions and the history stay.
  function clearStats() {
    Object.assign(session, { correct: 0, incorrect: 0, skipped: 0, points: 0, celeritySum: 0, celerityCount: 0 });
    // The answer on screen was counted before the clear: overriding it now
    // changes its grade, not the fresh counts.
    if (runtime.lastOutcome) runtime.lastOutcome.uncounted = true;
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
    hideSettingsOnPhone();

    session.index++;
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
    document.getElementById('overrideBtn').classList.add('d-none');
    resetTimer();
    setNextButtonMode('skip');
    setBuzzEnabled(true);
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('questionInfo').textContent = SBData.sourceLabelFor(q, ' ');
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => {
      el.classList.remove('reveal-correct');
      el.classList.remove('clickable');
    });

    const qDisplay = document.getElementById('qDisplay');
    // Read out as a moderator would: "TOSS-UP Physics Short Answer ...".
    const boxSegments = [{ html: SBData.readoutHTML(q), el: qDisplay, lead: SBReveal.visibleLength(SBData.readoutHeaderHTML(q)) }];
    const choicesDisplay = document.getElementById('choicesDisplay');
    if (q.choices) {
      choicesDisplay.style.display = 'grid';
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
    // Self-graded (Type to answer off): the second press is Reveal.
    if (runtime.phase === 'answering' && runtime.selfGraded) { selfReveal(); return; }
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    if (runtime.paused) return;
    runtime.buzzedDuringReading = runtime.phase === 'revealing';
    runtime.buzzFraction = runtime.phase === 'revealing' && runtime.revealCtl ? runtime.revealCtl.progress() : 1;
    // Reading pauses (rather than stops) so a rebuzz can carry on from here.
    if (runtime.phase === 'revealing' && runtime.revealCtl) runtime.revealCtl.pause();
    if (runtime.phase === 'buzzwindow' && runtime.timer) runtime.buzzwindowLeftMs = runtime.remainingMs;
    clearRuntimeTimer();
    runtime.phase = 'answering';
    // (Kept for this buzz, whatever the switch does meanwhile.)
    runtime.selfGraded = !settings.typeToAnswer;
    if (runtime.selfGraded) {
      // As on QB Reader: Buzz turns into Reveal while the answer clock runs;
      // revealing (or running out of time) shows the answer.
      setNextButtonMode('disabled');
      setBuzzLabel('Reveal');
      setBuzzEnabled(true);
      if (settings.timer) runTimer(ANSWER_MS, 'answer', selfReveal);
      return;
    }
    setBuzzEnabled(false);
    setNextButtonMode('disabled');
    const answerRow = document.getElementById('answerRow');
    answerRow.classList.remove('d-none');
    const input = document.getElementById('answerInput');
    input.value = '';
    input.focus();

    const q = currentQ();
    if (q.format === 'MC' && q.choices) {
      document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => el.classList.add('clickable'));
    }
    if (settings.timer) runTimer(ANSWER_MS, 'answer', () => submitAnswer(document.getElementById('answerInput').value));
  }

  // Self-graded: the answer is shown and the buzz counts as right, unless
  // you then say "I was wrong" (q).
  function selfReveal() {
    if (runtime.phase !== 'answering' || !runtime.selfGraded) return;
    clearRuntimeTimer();
    resolveQuestion({ correct: true, userText: '' });
  }
  function setBuzzLabel(text) { document.getElementById('buzzBtn').textContent = text; }

  function submitAnswer(text) {
    if (runtime.phase !== 'answering') return;
    clearRuntimeTimer();
    // The answer clock is over: back to 0, not stopped on what was left of
    // it while the question reads on after a wrong interrupt.
    resetTimer();
    const q = currentQ();
    const result = text.trim() ? SBAnswer.checkAnswer(q, text) : { correct: false };
    document.getElementById('answerRow').classList.add('d-none');
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => el.classList.remove('clickable'));
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
        ? { attempted: true, correct: false, userText: last.userText, close: last.close }
        : { attempted: false };
    runtime.lastOutcome = outcome;

    // A skip counts toward Incorrect (you didn't get it) and is logged as such.
    let category;
    if (!outcome.attempted) { category = 'skipped'; session.skipped++; session.incorrect++; }
    else if (outcome.correct) {
      category = 'correct'; session.correct++;
      session.celeritySum += runtime.buzzFraction == null ? 1 : runtime.buzzFraction;
      session.celerityCount++;
    }
    else { category = 'incorrect'; session.incorrect++; }
    session.points += pointsFor(outcome);
    updateCounters();
    runtime.pendingCard = { q, category, userText: outcome.userText || '' };
    if (window.SBAccount) SBAccount.recordAnswer(q, category, 'solo', accountExtra(outcome));
    // For the question's community stats: how it went (a question skipped
    // before it was read through wasn't heard, so it isn't counted).
    if (window.SBQuestionStats && (outcome.attempted || runtime.readingDone)) {
      SBQuestionStats.track(q, 'solo', playResult(outcome), celerityOf(outcome));
    }

    setBuzzEnabled(false);
    setBuzzLabel('Buzz');
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
  function celerityOf(outcome) {
    return outcome.correct ? 1 - (runtime.buzzFraction == null ? 1 : runtime.buzzFraction) : null;
  }
  // For your account's stats: the points, and where you buzzed (right or
  // wrong; nothing for a question you didn't buzz on).
  function accountExtra(outcome) {
    return {
      points: pointsFor(outcome),
      celerity: outcome.attempted ? 1 - (runtime.buzzFraction == null ? 1 : runtime.buzzFraction) : null,
    };
  }

  // Science Bowl scoring: +4 right; −4 for a wrong answer buzzed in before
  // the question finished (an interrupt), at most once per question.
  function pointsFor(outcome) {
    if (outcome.correct) return 4;
    return outcome.early || runtime.attempts.some((a) => a.early) ? -4 : 0;
  }

  function showReveal() {
    const q = currentQ();
    const box = document.getElementById('revealBox');
    const outcome = runtime.lastOutcome;
    let category = 'skipped';
    if (outcome && outcome.attempted) category = outcome.correct ? 'correct' : 'incorrect';
    // The answer line first, then how you did: "Correct sqrt 137" (a
    // skipped question gets no chip, as on QB Reader).
    let html = `<p class="ans-line mb-1">ANSWER: ${SBData.answerLineHTML(SBData.answerDisplayText(q), q.answer.letter, q.answer.accept, q.answer.reject).replace(/^Answer: /, '')}</p>`;
    if (category !== 'skipped') {
      const badgeText = category === 'correct' ? 'Correct' : 'Incorrect';
      html += `<div class="mb-1 d-flex align-items-center gap-1 grade-row"><span class="grade-badge ${category}">${badgeText}</span>`;
      if (outcome.userText) html += ` <span class="user-answer">${escapeHtml(outcome.userText)}</span>`;
      html += '</div>';
    }
    if (category === 'incorrect' && outcome.close) {
      html += '<div class="close-hint">Close</div>';
    }
    parkOverride();
    box.innerHTML = html;
    // Once it's over, the label above the question links to the packet.
    SBPlay.linkQuestionInfo(document.getElementById('questionInfo'), q, q.sourceUrl);
    box.style.display = 'block';

    // "I was wrong" undoes a Correct; "I was right" undoes an Incorrect.
    const override = document.getElementById('overrideBtn');
    if (outcome && outcome.attempted) {
      override.textContent = outcome.correct ? 'I was wrong' : 'I was right';
      // On the same line as "Correct sqrt 137", at the right.
      box.querySelector('.grade-row').appendChild(override);
      override.classList.remove('d-none');
    } else {
      override.classList.add('d-none');
    }
    // Report at the right of the answer line, answered or skipped.
    if (window.SBReports) box.querySelector('.ans-line').prepend(SBPlay.answerReportLink(q));

    if (q.choices && q.answer.letter) {
      const el = document.querySelector(`.choice-box[data-letter="${q.answer.letter}"]`);
      if (el) el.classList.add('reveal-correct');
    }
  }

  // The override link lives in the reveal box's grade row while it shows;
  // it's moved back out before the box is rebuilt, so it isn't thrown away.
  function parkOverride() {
    const override = document.getElementById('overrideBtn');
    const box = document.getElementById('revealBox');
    if (box.contains(override)) box.before(override);
  }

  function skipQuestion() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    resolveQuestion();
  }

  function overrideGrading() {
    if (runtime.phase !== 'reveal' || !runtime.lastOutcome || !runtime.lastOutcome.attempted) return;
    const o = runtime.lastOutcome;
    if (!o.uncounted) {
      session.points -= pointsFor(o);
      // Celerity follows the override: a correct answer counts toward it.
      const f = runtime.buzzFraction == null ? 1 : runtime.buzzFraction;
      if (o.correct) { session.correct--; session.incorrect++; session.celeritySum -= f; session.celerityCount--; } else { session.incorrect--; session.correct++; session.celeritySum += f; session.celerityCount++; }
    }
    o.correct = !o.correct;
    if (!o.uncounted) session.points += pointsFor(o);
    updateCounters();
    if (runtime.pendingCard) runtime.pendingCard.category = o.correct ? 'correct' : 'incorrect';
    if (window.SBQuestionStats) SBQuestionStats.update(currentQ(), playResult(o), celerityOf(o));
    if (window.SBAccount) SBAccount.updateLastAnswer(o.correct ? 'correct' : 'incorrect', accountExtra(o));
    if (o.correct && window.SBReports) SBReports.logOverride(currentQ(), o.userText, 'solo');
    showReveal();
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
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => {
      el.addEventListener('click', () => {
        if (!el.classList.contains('clickable')) return;
        submitAnswer(el.dataset.letter);
      });
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
        case 't': SBPlay.starLatest(log); return;
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
    document.getElementById('qDisplay').textContent = 'Failed to load question data: ' + err.message;
  });
})();
