// Play (solo.html), laid out and behaving like QB Reader's play page: a mode
// (Select by Set Name, Random Questions, Starred Questions), subject toggles,
// rebuzz / history / set name / timer switches, and finished questions
// collapsed into cards under the current one (k opens the latest, t stars it).
(function () {
  const { escapeHtml } = SBData;
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];
  const SETTINGS_KEY = 'sb_solo_settings';

  // Everything the sidebar sets, saved per device.
  const settings = SBPlay.loadSettings(SETTINGS_KEY, {
    mode: 'random',
    setName: '',
    packetNumbers: '',
    subjects: null, // null = every subject
    tournaments: [],
    roundRange: null,
    rebuzz: false,
    showHistory: true,
    showSetName: true,
    timer: true,
  });
  function save() { SBPlay.saveSettings(SETTINGS_KEY, { ...settings, subjects: [...subjects] }); }
  let subjects; // Set of subject keys
  let roundSliderApi;
  let categories;
  let packetPicker;

  /* ================= QUESTIONS FOR THE CURRENT SETTINGS ================= */
  function setTournament() {
    const name = settings.setName.trim().toLowerCase();
    if (!name) return null;
    return SBData.meta.tournaments.find((t) => t.name.toLowerCase() === name || t.slug === name) || null;
  }
  // The questions to read, in order: the chosen packets of the chosen set
  // (packet order), the starred questions, or random questions matching the
  // filters (mixed evenly across subjects).
  function buildPool() {
    if (settings.mode === 'starred') {
      return SBData.stratifiedQueue(SBData.filterQuestions({ bookmarkedOnly: true }), (q) => q.subject);
    }
    if (settings.mode === 'set') {
      const t = setTournament();
      if (!t) return [];
      const packets = SBPlay.packetsOf(t.slug);
      const chosen = SBPlay.parsePacketNumbers(settings.packetNumbers, packets.length);
      return [].concat(...chosen.map((n) => packets[n - 1].questions)).filter((q) => subjects.has(q.subject));
    }
    return SBData.stratifiedQueue(SBData.filterQuestions({
      subjects,
      tournaments: settings.tournaments.length ? new Set(settings.tournaments) : null,
      roundRange: settings.roundRange,
      includeUnlabeled: true,
    }), (q) => q.subject);
  }

  function updateMatchCount() {
    const n = buildPool().length;
    const el = document.getElementById('matchCount');
    if (settings.mode === 'starred') {
      el.textContent = '';
      document.getElementById('starredInfo').textContent = n ? '' : 'No starred questions.';
    } else {
      el.textContent = `${n.toLocaleString()} question${n === 1 ? '' : 's'} match your settings`;
    }
  }

  // A settings change applies from the next question: the not-yet-asked part
  // of the queue is rebuilt (without anything already asked).
  function onSettingsChange() {
    save();
    updateMatchCount();
    if (!sessionActive()) return;
    const asked = new Set(session.queue.slice(0, session.index + 1).map((q) => q.id));
    const rest = buildPool().filter((q) => !asked.has(q.id));
    session.queue = session.queue.slice(0, session.index + 1).concat(rest);
  }

  /* ================= SIDEBAR ================= */
  function showModeSettings() {
    document.getElementById('setSettings').classList.toggle('d-none', settings.mode !== 'set');
    document.getElementById('randomSettings').classList.toggle('d-none', settings.mode !== 'random');
    document.getElementById('starredSettings').classList.toggle('d-none', settings.mode !== 'starred');
    // Starred mode plays your starred questions whatever their subject, so
    // the subject tiles are hidden there.
    document.getElementById('subjectButtons').classList.toggle('d-none', settings.mode === 'starred');
  }

  function describeSet() {
    const input = document.getElementById('setName');
    const info = document.getElementById('setInfo');
    const t = setTournament();
    input.classList.toggle('is-invalid', !!settings.setName.trim() && !t);
    info.textContent = !t && settings.setName.trim() ? 'No set with that name.' : '';
    // The packet dropdown lists this set's packets.
    packetPicker.setPackets(t ? SBPlay.packetsOf(t.slug) : [], settings.packetNumbers);
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

    // Select by Set Name.
    const list = document.getElementById('setNameList');
    SBData.meta.tournaments.forEach((t) => { const o = document.createElement('option'); o.value = t.name; list.appendChild(o); });
    const setName = document.getElementById('setName');
    setName.value = settings.setName;
    packetPicker = SBPlay.packetSelect(document.getElementById('packetSelect'), (text) => { settings.packetNumbers = text; onSettingsChange(); });
    setName.addEventListener('change', () => { settings.setName = setName.value; settings.packetNumbers = ''; describeSet(); onSettingsChange(); });
    describeSet();

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
    scopeRounds();

    // Switches.
    const switches = { toggleRebuzz: 'rebuzz', toggleShowHistory: 'showHistory', toggleShowSetName: 'showSetName', toggleTimer: 'timer' };
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
  function scopeRounds() {
    const moved = roundSliderApi && roundSliderApi.setMax(SBData.maxRoundFor(new Set(settings.tournaments)));
    if (moved) settings.roundRange = moved;
  }

  // Show question history, Show set name, Enable timer.
  function applySwitches() {
    document.getElementById('questionLog').classList.toggle('d-none', !settings.showHistory);
    document.getElementById('questionInfo').classList.toggle('d-none', !settings.showSetName);
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
    if (WIDE.matches) el.classList.toggle('collapsed'); else el.classList.toggle('show');
  }

  /* ================= GAME STATE ================= */
  const session = {
    queue: [], index: -1,
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
    if (session.index + 1 >= session.queue.length && settings.mode !== 'starred') {
      // As on QB Reader: an alert, and the last question stays where it is.
      window.alert(settings.mode === 'set' ? 'You have reached the end of the set' : 'You have reached the end of the questions that match your settings');
      return;
    }
    clearRuntimeTimer();
    if (runtime.revealCtl) runtime.revealCtl.stop();
    setPaused(false);
    cardPending();

    session.index++;
    if (session.index >= session.queue.length) {
      // Starred questions loop, re-reading the live set of stars.
      const pool = buildPool();
      if (!pool.length) { showSessionDone(); return; }
      session.queue = pool;
      session.index = 0;
    }
    const q = currentQ();
    runtime.phase = 'revealing';
    runtime.readingDone = false;
    runtime.buzzedDuringReading = false;
    runtime.attempts = [];
    runtime.buzzFraction = null;
    runtime.lastOutcome = null;
    runtime.buzzwindowLeftMs = null;

    hidePill();
    document.getElementById('revealBox').style.display = 'none';
    document.getElementById('answerRow').classList.add('d-none');
    document.getElementById('overrideBtn').classList.add('d-none');
    resetTimer();
    setNextButtonMode('skip');
    setBuzzEnabled(true);
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('questionInfo').textContent = SBData.sourceLabelFor(q);
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => {
      el.classList.remove('reveal-correct');
      el.classList.remove('clickable');
    });

    const qDisplay = document.getElementById('qDisplay');
    // Read out as a moderator would: "TOSS-UP Physics Short Answer ...".
    const boxSegments = [{ html: SBData.readoutHTML(q), el: qDisplay }];
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
    const ms = runtime.buzzwindowLeftMs != null ? runtime.buzzwindowLeftMs : full;
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
    hidePill();
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

  function submitAnswer(text) {
    if (runtime.phase !== 'answering') return;
    clearRuntimeTimer();
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
      setPill(`Incorrect: ${text.trim() ? `"${text.trim()}"` : '(blank)'}. Buzz again or press Next.`, 'incorrect');
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
      ? { attempted: true, correct: true, userText: win.userText }
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
    if (window.SBAccount) SBAccount.recordAnswer(q, category, 'solo');

    setBuzzEnabled(false);
    hidePill();
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('answerRow').classList.add('d-none');
    resetTimer();
    setNextButtonMode('next');
    showReveal();
  }

  // Science Bowl scoring: +4 right; −4 for a wrong answer buzzed in before
  // the question finished (an interrupt), at most once per question.
  function pointsFor(outcome) {
    if (outcome.correct) return 4;
    return runtime.attempts.some((a) => a.early) ? -4 : 0;
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
      html += '<div class="close-hint">Close. If you meant the answer above, press <kbd>q</kbd> or "I was right" to count it.</div>';
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
    session.points -= pointsFor(o);
    // Celerity follows the override: a correct answer counts toward it.
    const f = runtime.buzzFraction == null ? 1 : runtime.buzzFraction;
    if (o.correct) { session.correct--; session.incorrect++; session.celeritySum -= f; session.celerityCount--; } else { session.incorrect--; session.correct++; session.celeritySum += f; session.celerityCount++; }
    o.correct = !o.correct;
    session.points += pointsFor(o);
    updateCounters();
    if (runtime.pendingCard) runtime.pendingCard.category = o.correct ? 'correct' : 'incorrect';
    if (window.SBAccount) SBAccount.updateLastAnswer(o.correct ? 'correct' : 'incorrect');
    showReveal();
  }

  // Next skips while a question is being read, goes on once it's answered,
  // starts a session before there is one, and waits while you answer.
  function setNextButtonMode(mode) {
    const btn = document.getElementById('nextBtn');
    btn.dataset.mode = mode;
    btn.disabled = mode === 'disabled';
    btn.textContent = mode === 'skip' ? 'Skip' : 'Next';
  }
  function handleNextButton() {
    const mode = document.getElementById('nextBtn').dataset.mode;
    if (mode === 'skip') skipQuestion();
    else if (mode === 'next') nextQuestion();
    else if (mode === 'start') startSession();
  }
  function setBuzzEnabled(on) { document.getElementById('buzzBtn').disabled = !on; }

  function setPill(text, cls) {
    const el = document.getElementById('statusPill');
    el.textContent = text;
    el.className = 'status-pill ' + (cls || '');
    el.style.display = 'inline-flex';
  }
  function hidePill() { document.getElementById('statusPill').style.display = 'none'; }

  function runTimer(ms, kind, onExpire) {
    clearRuntimeTimer();
    runtime.totalMs = ms; runtime.remainingMs = ms; runtime.timerKind = kind; runtime.onExpire = onExpire;
    renderTick(ms);
    runtime.timer = setInterval(() => {
      if (runtime.paused) return;
      runtime.remainingMs -= 100;
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

  function showSessionDone() {
    runtime.phase = 'done';
    clearRuntimeTimer();
    document.getElementById('qDisplay').textContent = '';
    document.getElementById('choicesDisplay').style.display = 'none';
    document.getElementById('qFigures').style.display = 'none';
    document.getElementById('questionInfo').textContent = '';
    document.getElementById('answerRow').classList.add('d-none');
    document.getElementById('overrideBtn').classList.add('d-none');
    setBuzzEnabled(false);
    document.getElementById('pauseBtn').disabled = true;
    resetTimer();
    setNextButtonMode('start');
    const box = document.getElementById('revealBox');
    parkOverride();
    const msg = settings.mode === 'set' ? 'End of the set.'
      : settings.mode === 'starred' ? 'No starred questions left.'
        : "You've gone through every question that matches your settings.";
    box.innerHTML = `<p class="mb-1">${msg} Press Next to start again.</p>`
      + `<div class="alt-line">${session.correct} correct · ${session.incorrect} incorrect (${session.skipped} skipped)</div>`;
    box.style.display = 'block';
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

    // QB Reader's keys: space buzz, n/s next, p pause, e settings, k show/hide
    // the last question, t star/unstar it; plus q for I was wrong/right.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (window.SBSite && SBSite.modalOpen()) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const log = document.getElementById('questionLog');
      switch ((e.key || '').toLowerCase()) {
        case ' ': e.preventDefault(); buzzIn(); return;
        case 'n': case 's': handleNextButton(); return;
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

  SBData.load().then(() => {
    initSettings();
    wireGameControls();
    setNextButtonMode('start');
    // Arriving for starred questions (e.g. an old bookmarks link) starts at once.
    const p = new URLSearchParams(location.search);
    if (settings.mode === 'starred' && (p.has('mode') || p.get('bookmarked') === '1')) startSession();
  }).catch((err) => {
    document.getElementById('qDisplay').textContent = 'Failed to load question data: ' + err.message;
  });
})();
