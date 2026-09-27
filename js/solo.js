(function () {
  const QTYPE_LABELS = { tossup: 'Tossup', bonus: 'Bonus' };
  const FORMAT_LABELS = { SA: 'Short Answer', MC: 'Multiple Choice' };
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];

  const filterState = { subjects: new Set(), qtypes: new Set(), formats: new Set(), levels: new Set(), tournaments: new Set(), roundRange: null, includeUnlabeled: true, bookmarkedOnly: false };
  let subjectItems, qtypeItems, formatItems, levelItems, roundSliderApi;
  // The in-session settings panel (opened mid-game) reuses this exact same
  // filterState object rather than a separate copy - solo has only one
  // local source of truth, unlike multiplayer where a settings panel edits
  // a draft that's broadcast and reconciled across clients. It gets its own
  // parallel set of chip/select DOM elements below (soloSettings*) so both
  // the setup screen and the mid-game panel can show/edit the same state.
  let soloSettingsSubjectItems, soloSettingsQtypeItems, soloSettingsFormatItems, soloSettingsLevelItems, soloSettingsRoundSliderApi;

  function buildChips(container, items, key, labelFn, onToggle) {
    container.innerHTML = '';
    items.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      if (item.subjectAttr) chip.dataset.subject = item.subjectAttr;
      chip.textContent = labelFn(item);
      chip.addEventListener('click', () => {
        if (filterState[key].has(item.value)) filterState[key].delete(item.value);
        else filterState[key].add(item.value);
        chip.classList.toggle('active', filterState[key].has(item.value));
        updateMatchCount();
        if (onToggle) onToggle();
      });
      container.appendChild(chip);
      item._el = chip;
    });
  }

  // Keeps a chip group's active/inactive visuals in sync with filterState -
  // used to mirror a toggle made in one chip set (setup screen or the
  // mid-game settings panel) onto the other, since they're two different
  // sets of DOM elements bound to the same underlying Sets.
  function resyncChipGroup(items, key) {
    if (!items) return;
    items.forEach((i) => { if (i._el) i._el.classList.toggle('active', filterState[key].has(i.value)); });
  }

  function getFiltered() {
    if (filterState.bookmarkedOnly) {
      // Bookmarked-practice mode (arrived via the bookmarks page's
      // "Practice these" button): every bookmarked question should be in
      // play, regardless of subject/format/round - those filters are for
      // narrowing down the whole catalog, not for silently dropping some of
      // someone's own saved questions (e.g. ones tagged "Other", which are
      // excluded from the default subject selection).
      return SBData.filterQuestions({ bookmarkedOnly: true });
    }
    return SBData.filterQuestions({
      subjects: filterState.subjects,
      roundRange: filterState.roundRange,
      includeUnlabeled: filterState.includeUnlabeled,
      qtypes: filterState.qtypes,
      formats: filterState.formats,
      levels: filterState.levels,
      tournaments: filterState.tournaments,
      bookmarkedOnly: filterState.bookmarkedOnly,
    });
  }

  function updateMatchCount() {
    document.getElementById('matchCount').textContent = `${getFiltered().length.toLocaleString()} questions match your filters`;
  }

  function initSetup() {
    subjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
    // Default to every subject selected.
    subjectItems.forEach((i) => { filterState.subjects.add(i.value); });
    buildChips(document.getElementById('subjectChips'), subjectItems, 'subjects', (i) => i.label, () => resyncChipGroup(soloSettingsSubjectItems, 'subjects'));
    subjectItems.forEach((i) => { i._el.classList.toggle('active', filterState.subjects.has(i.value)); });

    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    roundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('roundMin'),
      maxInput: document.getElementById('roundMax'),
      fillEl: document.getElementById('roundSliderFill'),
      labelEl: document.getElementById('roundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { filterState.roundRange = [lo, hi]; updateMatchCount(); },
    });
    document.getElementById('includeUnlabeledRounds').addEventListener('change', (e) => {
      filterState.includeUnlabeled = e.target.checked;
      updateMatchCount();
    });

    qtypeItems = SBData.meta.qtypes.map((q) => ({ value: q, label: QTYPE_LABELS[q] || q }));
    buildChips(document.getElementById('qtypeChips'), qtypeItems, 'qtypes', (i) => i.label, () => resyncChipGroup(soloSettingsQtypeItems, 'qtypes'));

    formatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
    buildChips(document.getElementById('formatChips'), formatItems, 'formats', (i) => i.label, () => resyncChipGroup(soloSettingsFormatItems, 'formats'));

    levelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));
    buildChips(document.getElementById('levelChips'), levelItems, 'levels', (i) => i.label, () => resyncChipGroup(soloSettingsLevelItems, 'levels'));

    const tSelect = document.getElementById('tournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug;
      opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => {
      filterState.tournaments = new Set(tSelect.getMultiValues());
      updateMatchCount();
      const sSelect = document.getElementById('soloSettingsTournamentSelect');
      if (sSelect && sSelect.setMultiValues) sSelect.setMultiValues(tSelect.getMultiValues());
    });
    SBData.enhanceMultiSelect(tSelect);

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      [[subjectItems, 'subjects'], [qtypeItems, 'qtypes'], [formatItems, 'formats'], [levelItems, 'levels']].forEach(([items, key]) => {
        filterState[key].clear();
        items.forEach((i) => i._el.classList.remove('active'));
      });
      resyncChipGroup(soloSettingsSubjectItems, 'subjects');
      resyncChipGroup(soloSettingsQtypeItems, 'qtypes');
      resyncChipGroup(soloSettingsFormatItems, 'formats');
      resyncChipGroup(soloSettingsLevelItems, 'levels');
      filterState.tournaments.clear();
      tSelect.setMultiValues([]);
      const sSelect = document.getElementById('soloSettingsTournamentSelect');
      if (sSelect && sSelect.setMultiValues) sSelect.setMultiValues([]);
      filterState.bookmarkedOnly = false;
      if (roundSliderApi) roundSliderApi.reset();
      if (soloSettingsRoundSliderApi) soloSettingsRoundSliderApi.reset();
      filterState.roundRange = null;
      document.getElementById('includeUnlabeledRounds').checked = true;
      const sUnlabeled = document.getElementById('soloSettingsIncludeUnlabeledRounds');
      if (sUnlabeled) sUnlabeled.checked = true;
      filterState.includeUnlabeled = true;
      updateMatchCount();
    });

    const rateSlider = document.getElementById('rateSlider');
    const savedRate = parseFloat(localStorage.getItem('sb_rate') || '1');
    rateSlider.value = isNaN(savedRate) ? 1 : savedRate;
    document.getElementById('rateValue').textContent = parseFloat(rateSlider.value).toFixed(1) + '×';
    SBData.wireRangeFill(rateSlider);
    rateSlider.addEventListener('input', () => {
      document.getElementById('rateValue').textContent = parseFloat(rateSlider.value).toFixed(1) + '×';
      try { localStorage.setItem('sb_rate', rateSlider.value); } catch (e) {}
    });

    document.getElementById('startBtn').addEventListener('click', startSession);
    updateMatchCount();

    // Arrived from the bookmarks page "Practice these" button — jump straight
    // in. The <head> boot script already hid the setup screen synchronously
    // (see solo.html) so it never flashes; if it turns out there's nothing
    // to practice after all (e.g. every bookmark got filtered out), reveal
    // the normal setup screen instead of leaving the loading state stuck.
    if (new URLSearchParams(location.search).get('bookmarked') === '1') {
      filterState.bookmarkedOnly = true;
      if (getFiltered().length) startSession();
      else document.documentElement.classList.remove('sb-boot-hide-setup');
    }
  }

  /* ================= IN-SESSION SETTINGS PANEL ================= */
  // Lets solo mode change its filters and reading speed mid-session,
  // matching multiplayer's mid-game room-settings panel but simplified for
  // a single local player: no networking, no broadcast/echo-suppression -
  // a change just rebuilds the remaining ("not yet asked") tail of the
  // question queue in place, live, the moment it's made.
  function updateSoloSettingsMatchCount() {
    document.getElementById('soloSettingsMatchCount').textContent = `${getFiltered().length.toLocaleString()} questions match your filters`;
  }

  function applySoloSettingsChange() {
    updateSoloSettingsMatchCount();
    updateMatchCount();
    // The settings panel is only ever reachable while a non-bookmarked
    // session is in progress (see the Settings button's visibility in
    // startSession()/showSessionDone()), so a live session.queue to rebuild
    // is guaranteed here - no phase guard needed.
    let pool = getFiltered();
    if (pool.length) {
      const askedIds = new Set(session.queue.slice(0, session.index + 1).map((q) => q.id));
      pool = SBData.stratifiedQueue(pool.filter((q) => !askedIds.has(q.id)), (q) => q.subject);
      const usedPrefix = session.queue.slice(0, session.index + 1);
      session.queue = usedPrefix.concat(pool);
    }
    // A silent no-op when the new filters match nothing yet-to-be-asked:
    // the session just keeps going on its existing (now-stale) tail rather
    // than being interrupted, same as multiplayer's host-side behavior.
  }

  function initSoloSettings() {
    soloSettingsSubjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
    buildChips(document.getElementById('soloSettingsSubjectChips'), soloSettingsSubjectItems, 'subjects', (i) => i.label, () => { resyncChipGroup(subjectItems, 'subjects'); applySoloSettingsChange(); });
    resyncChipGroup(soloSettingsSubjectItems, 'subjects');

    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    soloSettingsRoundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('soloSettingsRoundMin'),
      maxInput: document.getElementById('soloSettingsRoundMax'),
      fillEl: document.getElementById('soloSettingsRoundSliderFill'),
      labelEl: document.getElementById('soloSettingsRoundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => {
        filterState.roundRange = [lo, hi];
        if (roundSliderApi) roundSliderApi.setRange(lo, hi);
        applySoloSettingsChange();
      },
    });

    document.getElementById('soloSettingsIncludeUnlabeledRounds').addEventListener('change', (e) => {
      filterState.includeUnlabeled = e.target.checked;
      document.getElementById('includeUnlabeledRounds').checked = e.target.checked;
      applySoloSettingsChange();
    });

    soloSettingsQtypeItems = SBData.meta.qtypes.map((q) => ({ value: q, label: QTYPE_LABELS[q] || q }));
    buildChips(document.getElementById('soloSettingsQtypeChips'), soloSettingsQtypeItems, 'qtypes', (i) => i.label, () => { resyncChipGroup(qtypeItems, 'qtypes'); applySoloSettingsChange(); });
    resyncChipGroup(soloSettingsQtypeItems, 'qtypes');

    soloSettingsFormatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
    buildChips(document.getElementById('soloSettingsFormatChips'), soloSettingsFormatItems, 'formats', (i) => i.label, () => { resyncChipGroup(formatItems, 'formats'); applySoloSettingsChange(); });
    resyncChipGroup(soloSettingsFormatItems, 'formats');

    soloSettingsLevelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));
    buildChips(document.getElementById('soloSettingsLevelChips'), soloSettingsLevelItems, 'levels', (i) => i.label, () => { resyncChipGroup(levelItems, 'levels'); applySoloSettingsChange(); });
    resyncChipGroup(soloSettingsLevelItems, 'levels');

    const sSelect = document.getElementById('soloSettingsTournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug;
      opt.textContent = `${t.name} (${t.count})`;
      sSelect.appendChild(opt);
    });
    sSelect.addEventListener('change', () => {
      filterState.tournaments = new Set(sSelect.getMultiValues());
      const mainSelect = document.getElementById('tournamentSelect');
      if (mainSelect.setMultiValues) mainSelect.setMultiValues(sSelect.getMultiValues());
      applySoloSettingsChange();
    });
    SBData.enhanceMultiSelect(sSelect);

    document.getElementById('soloSettingsClearBtn').addEventListener('click', () => {
      [[soloSettingsSubjectItems, 'subjects'], [soloSettingsQtypeItems, 'qtypes'], [soloSettingsFormatItems, 'formats'], [soloSettingsLevelItems, 'levels']].forEach(([, key]) => {
        filterState[key].clear();
      });
      resyncChipGroup(subjectItems, 'subjects'); resyncChipGroup(soloSettingsSubjectItems, 'subjects');
      resyncChipGroup(qtypeItems, 'qtypes'); resyncChipGroup(soloSettingsQtypeItems, 'qtypes');
      resyncChipGroup(formatItems, 'formats'); resyncChipGroup(soloSettingsFormatItems, 'formats');
      resyncChipGroup(levelItems, 'levels'); resyncChipGroup(soloSettingsLevelItems, 'levels');
      filterState.tournaments.clear();
      sSelect.setMultiValues([]);
      document.getElementById('tournamentSelect').setMultiValues([]);
      if (soloSettingsRoundSliderApi) soloSettingsRoundSliderApi.reset();
      if (roundSliderApi) roundSliderApi.reset();
      filterState.roundRange = null;
      document.getElementById('soloSettingsIncludeUnlabeledRounds').checked = true;
      document.getElementById('includeUnlabeledRounds').checked = true;
      filterState.includeUnlabeled = true;
      applySoloSettingsChange();
    });

    const settingsRateSlider = document.getElementById('soloSettingsRateSlider');
    SBData.wireRangeFill(settingsRateSlider);
    settingsRateSlider.addEventListener('input', () => {
      document.getElementById('soloSettingsRateValue').textContent = parseFloat(settingsRateSlider.value).toFixed(1) + '×';
      session.rate = parseFloat(settingsRateSlider.value) || 1;
      try { localStorage.setItem('sb_rate', session.rate); } catch (e) {}
      // Live-apply to whatever's currently typing itself onto the screen,
      // not just the next question, so "change speed mid-question" works.
      if (runtime.revealCtl && !runtime.revealCtl.isDone()) runtime.revealCtl.setRate(session.rate);
      const mainRateSlider = document.getElementById('rateSlider');
      mainRateSlider.value = settingsRateSlider.value;
      document.getElementById('rateValue').textContent = parseFloat(mainRateSlider.value).toFixed(1) + '×';
      if (mainRateSlider.refreshRangeFill) mainRateSlider.refreshRangeFill();
    });

    document.getElementById('soloSettingsCloseBtn').addEventListener('click', closeSettingsPanel);
    document.getElementById('soloSettingsDoneBtn').addEventListener('click', closeSettingsPanel);
    document.getElementById('soloSettingsOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'soloSettingsOverlay') closeSettingsPanel();
    });
    document.getElementById('soloSettingsBtn').addEventListener('click', openSettingsPanel);

    updateSoloSettingsMatchCount();
  }

  function openSettingsPanel() {
    // Seed the rate slider's DOM value from the session's actual current
    // rate before showing the panel (rather than relying on some earlier
    // 'input' listener to have done it) - avoids ever flashing a stale or
    // default 1.0x value on first open.
    const settingsRateSlider = document.getElementById('soloSettingsRateSlider');
    settingsRateSlider.value = session.rate;
    document.getElementById('soloSettingsRateValue').textContent = parseFloat(session.rate).toFixed(1) + '×';
    if (settingsRateSlider.refreshRangeFill) settingsRateSlider.refreshRangeFill();
    updateSoloSettingsMatchCount();
    document.getElementById('soloSettingsOverlay').style.display = 'flex';
  }
  function closeSettingsPanel() {
    // If every subject got toggled off, leaving nothing that will ever
    // match, don't let that empty selection persist silently - reset back
    // to "all subjects" so the panel reopens in a useful state next time
    // instead of looking broken (0 questions match, no subject chip lit).
    if (filterState.subjects.size === 0 && soloSettingsSubjectItems && soloSettingsSubjectItems.length) {
      soloSettingsSubjectItems.forEach((i) => filterState.subjects.add(i.value));
      resyncChipGroup(soloSettingsSubjectItems, 'subjects');
      resyncChipGroup(subjectItems, 'subjects');
      applySoloSettingsChange();
    }
    document.getElementById('soloSettingsOverlay').style.display = 'none';
  }

  /* ================= GAME STATE ================= */
  const session = {
    queue: [], index: -1,
    correct: 0, incorrect: 0, skipped: 0,
    rate: 1,
    log: [],
    bookmarkedMode: false,
  };
  const runtime = {
    phase: 'revealing', // revealing | buzzwindow | answering | reveal | done
    revealCtl: null,
    buzzedDuringReading: false,
    lastOutcome: null,
    timer: null, remainingMs: 0, totalMs: 0, timerKind: null, onExpire: null,
    paused: false,
    pausedTimerRemaining: null,
  };

  function startSession() {
    let pool = getFiltered();
    if (!pool.length) { alert('No questions match your filters.'); return; }
    // Stratify by subject so every selected subject gets equal turns over
    // the course of the session, regardless of how many questions exist per
    // subject - matches multiplayer's queue building.
    pool = SBData.stratifiedQueue(pool, (q) => q.subject);

    session.queue = pool;
    session.index = -1;
    session.correct = 0; session.incorrect = 0; session.skipped = 0;
    session.rate = parseFloat(document.getElementById('rateSlider').value) || 1;
    session.log = [];
    session.bookmarkedMode = filterState.bookmarkedOnly;

    document.documentElement.classList.remove('sb-boot-hide-setup');
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    document.getElementById('questionLog').innerHTML = '';
    // Filters don't apply in bookmarked-practice mode (see getFiltered()),
    // so changing them mid-session wouldn't do anything there - only show
    // the settings button for a normal filtered session.
    document.getElementById('soloSettingsBtn').style.display = session.bookmarkedMode ? 'none' : 'inline-flex';
    updateCounters();
    nextQuestion();
  }

  function updateCounters() {
    document.getElementById('correctCount').textContent = session.correct;
    document.getElementById('incorrectCount').textContent = session.incorrect;
    document.getElementById('totalCount').textContent = session.correct + session.incorrect;
  }

  function currentQ() { return session.queue[session.index]; }

  // A small fade/slide-in on the whole question panel each time a new
  // question comes up, so advancing feels like a deliberate transition
  // instead of the text just snapping to something new. Re-triggering the
  // same CSS class doesn't restart its animation on its own - removing the
  // class, forcing a reflow (reading offsetWidth), then re-adding it is
  // what makes it replay on every question instead of only the first time.
  function playQuestionTransition() {
    const panel = document.querySelector('.question-panel');
    if (!panel) return;
    panel.classList.remove('q-panel-enter');
    void panel.offsetWidth;
    panel.classList.add('q-panel-enter');
  }

  function nextQuestion() {
    clearRuntimeTimer();
    if (runtime.revealCtl) runtime.revealCtl.stop();
    runtime.paused = false;
    document.getElementById('pauseBadge').style.display = 'none';
    document.getElementById('pauseBtn').textContent = 'Pause (P)';

    session.index++;
    if (session.index >= session.queue.length) {
      if (session.bookmarkedMode) {
        // Practicing bookmarks loops indefinitely instead of stopping -
        // re-fetch the live bookmark set (the user may have starred/
        // unstarred questions mid-session) and keep going for as long as
        // there's at least one bookmarked question left.
        const pool = getFiltered();
        if (!pool.length) { showSessionDone(); return; }
        session.queue = SBData.stratifiedQueue(pool, (q2) => q2.subject);
        session.index = 0;
      } else {
        showSessionDone();
        return;
      }
    }
    const q = currentQ();
    runtime.phase = 'revealing';
    runtime.buzzedDuringReading = false;
    runtime.lastOutcome = null;

    playQuestionTransition();
    hidePill();
    document.getElementById('revealBox').style.display = 'none';
    document.getElementById('answerRow').style.display = 'none';
    document.getElementById('overrideBtn').style.display = 'none';
    hideTimer();
    setNextButtonMode('skip');
    updateBookmarkBtn();
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => {
      el.classList.remove('reveal-correct');
      el.classList.remove('clickable');
    });

    const buzzBtn = document.getElementById('buzzBtn');
    buzzBtn.style.display = 'inline-flex';

    const qDisplay = document.getElementById('qDisplay');
    const subjectTag = document.getElementById('revealSubjectTag');
    const formatTag = document.getElementById('revealFormatTag');
    const qtypeTag = document.getElementById('revealQtypeTag');
    const levelTag = document.getElementById('revealLevelTag');
    levelTag.className = 'tag level-' + q.level;
    subjectTag.className = 'tag subject-' + q.subject;
    formatTag.className = 'tag fmt fmt-' + (q.format || '').toLowerCase();
    qtypeTag.className = 'tag qtype-' + q.qtype;
    const tagSegments = [
      { text: labelFor(q.subject).toUpperCase(), el: subjectTag },
      { text: (FORMAT_LABELS[q.format] || q.format).toUpperCase(), el: formatTag },
      { text: (QTYPE_LABELS[q.qtype] || q.qtype).toUpperCase(), el: qtypeTag },
      { text: (SBData.LEVEL_LABELS[q.level] || q.level).toUpperCase(), el: levelTag },
    ];
    const boxSegments = [{ text: q.question, el: qDisplay }];
    const choicesDisplay = document.getElementById('choicesDisplay');
    if (q.choices) {
      choicesDisplay.style.display = 'grid';
      LETTERS.forEach((L) => {
        boxSegments.push({ text: q.choices[L] || '', el: document.getElementById('choiceText' + L) });
      });
    } else {
      choicesDisplay.style.display = 'none';
    }

    reserveRevealHeight(boxSegments);
    runtime.revealCtl = SBReveal.startReveal(tagSegments.concat(boxSegments), session.rate, {
      // The reveal types out plain text letter by letter - only once a
      // segment's full text is in place (here, at completion) do we swap
      // it for the math-rendered HTML (real superscript/subscript for
      // well-formed "^"/"_" notation), so mid-reveal carets/underscores
      // just appear as normal typed characters instead of popping into
      // <sup>/<sub> tags partway through.
      onComplete: () => {
        boxSegments.forEach((s) => { s.el.innerHTML = SBData.renderMathHTML(s.text); });
        startBuzzWindow();
      },
    });
  }

  // Reserve the final height of the question+choices area before the reveal
  // starts, so the buttons below it don't creep downward as the text fills
  // in letter by letter.
  function reserveRevealHeight(boxSegments) {
    const wrap = document.getElementById('revealMeasureWrap');
    wrap.style.minHeight = '';
    boxSegments.forEach((s) => { s.el.textContent = s.text; });
    const h = wrap.scrollHeight;
    wrap.style.minHeight = h + 'px';
    boxSegments.forEach((s) => { s.el.textContent = ''; });
  }

  function startBuzzWindow() {
    if (runtime.phase === 'answering' || runtime.phase === 'reveal') return;
    runtime.phase = 'buzzwindow';
    const q = currentQ();
    const ms = q.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
    runTimer(ms, 'buzz', () => { resolveQuestion({ attempted: false }); });
  }

  function buzzIn() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    if (runtime.paused) return;
    runtime.buzzedDuringReading = runtime.phase === 'revealing';
    if (runtime.revealCtl) runtime.revealCtl.stop();
    clearRuntimeTimer();
    runtime.phase = 'answering';
    hidePill();
    document.getElementById('buzzBtn').style.display = 'none';
    setNextButtonMode('hidden');
    const answerRow = document.getElementById('answerRow');
    answerRow.style.display = 'flex';
    const input = document.getElementById('answerInput');
    input.value = '';
    input.focus();

    const q = currentQ();
    if (q.format === 'MC' && q.choices) {
      document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => el.classList.add('clickable'));
    }
    runTimer(ANSWER_MS, 'answer', () => submitAnswer(document.getElementById('answerInput').value));
  }

  function submitAnswer(text) {
    if (runtime.phase !== 'answering') return;
    clearRuntimeTimer();
    const q = currentQ();
    const result = text.trim() ? SBAnswer.checkAnswer(q, text) : { correct: false };
    resolveQuestion({ attempted: true, correct: result.correct, userText: text });
  }

  function resolveQuestion(outcome) {
    clearRuntimeTimer();
    // Phase must flip to 'reveal' BEFORE skipToEnd() runs: skipToEnd() can
    // synchronously fire the reveal's onComplete callback (startBuzzWindow),
    // and that callback only bails out once the phase says we're past
    // reading. Doing this in the old order left a stray buzz-window timer
    // running in the background whenever a question was skipped mid-reveal
    // (before the buzz window had naturally opened) - it would silently
    // fire minutes later and resolve whatever question happened to be
    // current at that point, which is the "timer goes off" bug.
    runtime.phase = 'reveal';
    runtime.lastOutcome = outcome;
    if (runtime.revealCtl) runtime.revealCtl.skipToEnd();

    // A skip still LOGS as "Skipped" (that's what actually happened to the
    // question), but counts toward the Incorrect stat - you didn't get it,
    // same as answering wrong.
    let category;
    if (!outcome.attempted) { category = 'skipped'; session.skipped++; session.incorrect++; }
    else if (outcome.correct) { category = 'correct'; session.correct++; }
    else { category = 'incorrect'; session.incorrect++; }
    updateCounters();

    const q = currentQ();
    session.log.unshift({ q, category, userText: outcome.userText || '' });
    renderQuestionLog();

    document.getElementById('buzzBtn').style.display = 'none';
    document.getElementById('answerRow').style.display = 'none';
    document.getElementById('overrideBtn').style.display = outcome.attempted ? 'inline-flex' : 'none';
    hideTimer();
    setNextButtonMode('next');
    showReveal();
  }

  function showReveal() {
    const q = currentQ();
    const box = document.getElementById('revealBox');
    const outcome = runtime.lastOutcome;
    let category = 'skipped';
    if (outcome && outcome.attempted) category = outcome.correct ? 'correct' : 'incorrect';
    const badgeText = category === 'correct' ? 'Correct' : category === 'incorrect' ? 'Incorrect' : 'Skipped';
    let html = `<div class="grade-badge ${category}">${badgeText}</div>`;
    if (outcome && outcome.attempted && outcome.userText) {
      html += `<div class="who-line">You answered: "${escapeHtml(outcome.userText)}"</div>`;
    }
    html += `<div class="ans-line">${SBData.answerLineHTML(SBData.answerDisplayText(q), q.answer.letter, q.answer.accept)}</div>`;
    if (q.answer.reject.length) html += `<div class="alt-line">Do not accept: ${SBData.renderMathHTML(q.answer.reject.join('; '))}</div>`;
    const roundPart = SBData.roundLabelFor(q);
    html += `<div class="src-line">${escapeHtml(q.tournament)}${roundPart ? ' · ' + escapeHtml(roundPart) : ''}</div>`;
    box.innerHTML = html;
    box.style.display = 'block';
    if (q.choices && q.answer.letter) {
      const el = document.querySelector(`.choice-box[data-letter="${q.answer.letter}"]`);
      if (el) el.classList.add('reveal-correct');
    }
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => el.classList.remove('clickable'));
  }

  function skipQuestion() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow') return;
    resolveQuestion({ attempted: false });
  }

  function overrideGrading() {
    if (runtime.phase !== 'reveal' || !runtime.lastOutcome || !runtime.lastOutcome.attempted) return;
    const wasCorrect = runtime.lastOutcome.correct;
    if (wasCorrect) { session.correct--; session.incorrect++; }
    else { session.incorrect--; session.correct++; }
    runtime.lastOutcome.correct = !wasCorrect;
    updateCounters();
    if (session.log.length) session.log[0].category = runtime.lastOutcome.correct ? 'correct' : 'incorrect';
    showReveal();
    renderQuestionLog();
  }

  function toggleBookmark() {
    const q = currentQ();
    if (!q) return;
    SBData.bookmarks.toggle(q.id);
    updateBookmarkBtn();
  }
  function updateBookmarkBtn() {
    const q = currentQ();
    const btn = document.getElementById('bookmarkBtn');
    if (!q) return;
    const isBm = SBData.bookmarks.isBookmarked(q.id);
    btn.textContent = isBm ? '★' : '☆';
    btn.classList.toggle('active', isBm);
    btn.title = isBm ? 'Unbookmark (B)' : 'Bookmark (B)';
    syncLogBookmarkStar(q.id, isBm);
  }
  // Keep a logged question's own star in sync with the main bookmark button,
  // in case the question is still on screen (its log entry already exists)
  // when the star gets toggled from up top instead of from the log itself.
  function syncLogBookmarkStar(qId, isBm) {
    document.querySelectorAll('.q-log-entry').forEach((card) => {
      if (card.dataset.qid !== String(qId)) return;
      const btn = card.querySelector('.icon-btn');
      if (!btn) return;
      btn.textContent = isBm ? '★' : '☆';
      btn.classList.toggle('active', isBm);
      btn.title = isBm ? 'Unbookmark' : 'Bookmark';
    });
  }

  function setNextButtonMode(mode) {
    const btn = document.getElementById('nextBtn');
    if (mode === 'skip') { btn.style.display = 'inline-flex'; btn.textContent = 'Skip (N)'; btn.dataset.mode = 'skip'; btn.classList.remove('primary'); }
    else if (mode === 'next') { btn.style.display = 'inline-flex'; btn.textContent = 'Next question (N)'; btn.dataset.mode = 'next'; btn.classList.add('primary'); }
    else { btn.style.display = 'none'; btn.dataset.mode = ''; }
  }
  function handleNextButton() {
    const mode = document.getElementById('nextBtn').dataset.mode;
    if (mode === 'skip') skipQuestion();
    else if (mode === 'next') nextQuestion();
  }

  function setPill(text, cls) {
    const el = document.getElementById('statusPill');
    el.textContent = text;
    el.className = 'status-pill ' + (cls || '');
    el.style.display = 'inline-flex';
  }
  function hidePill() {
    document.getElementById('statusPill').style.display = 'none';
  }

  function runTimer(ms, kind, onExpire) {
    clearRuntimeTimer();
    runtime.totalMs = ms; runtime.remainingMs = ms; runtime.timerKind = kind; runtime.onExpire = onExpire;
    renderTick(ms, ms, kind);
    runtime.timer = setInterval(() => {
      if (runtime.paused) return;
      runtime.remainingMs -= 100;
      if (runtime.remainingMs <= 0) {
        renderTick(0, runtime.totalMs, kind);
        clearInterval(runtime.timer); runtime.timer = null;
        const fn = runtime.onExpire; runtime.onExpire = null;
        if (fn) fn();
        return;
      }
      renderTick(runtime.remainingMs, runtime.totalMs, kind);
    }, 100);
  }
  function clearRuntimeTimer() {
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null; runtime.onExpire = null;
  }
  function renderTick(remainingMs, totalMs, kind) {
    const row = document.getElementById('timerRow');
    row.style.display = 'flex';
    const fill = document.getElementById('timerFill');
    fill.className = 'timer-bar-fill' + (kind === 'answer' ? ' answer' : '');
    fill.style.width = Math.max(0, (remainingMs / totalMs) * 100) + '%';
    document.getElementById('timerLabel').textContent = (remainingMs / 1000).toFixed(1) + 's';
  }
  function hideTimer() { document.getElementById('timerRow').style.display = 'none'; }

  function togglePause() {
    if (runtime.phase === 'reveal' || runtime.phase === 'done') return;
    runtime.paused = !runtime.paused;
    document.getElementById('pauseBadge').style.display = runtime.paused ? 'inline-flex' : 'none';
    document.getElementById('pauseBtn').textContent = runtime.paused ? 'Resume (P)' : 'Pause (P)';
    if (runtime.revealCtl && runtime.phase === 'revealing') {
      if (runtime.paused) runtime.revealCtl.pause(); else runtime.revealCtl.resume();
    }
    // the setInterval-based countdown timer already checks runtime.paused each tick
  }

  function renderQuestionLog() {
    const el = document.getElementById('questionLog');
    el.innerHTML = '';
    if (!session.log.length) {
      el.innerHTML = '<div class="q-log-empty">Questions you\'ve gone through this session will show up here.</div>';
      return;
    }
    session.log.forEach((entry) => {
      el.appendChild(renderLogEntry(entry));
    });
  }

  function renderLogEntry(entry) {
    const q = entry.q;
    const card = document.createElement('div');
    card.className = 'q-log-entry';
    card.dataset.qid = q.id;

    const badgeText = entry.category === 'correct' ? 'Correct' : entry.category === 'incorrect' ? 'Incorrect' : 'Skipped';
    const roundPart = SBData.roundLabelFor(q);
    const meta = document.createElement('div');
    meta.className = 'meta-row';
    meta.innerHTML = `
      <span class="grade-badge ${entry.category}">${badgeText}</span>
      <span class="tag subject-${q.subject}">${labelFor(q.subject)}</span>
      <span class="tag qtype-${q.qtype}">${QTYPE_LABELS[q.qtype] || q.qtype}</span>
      <span class="tag fmt fmt-${(q.format || '').toLowerCase()}">${FORMAT_LABELS[q.format] || q.format}</span>
      ${SBData.levelTagHTML(q)}
      <span class="small-note">${escapeHtml(q.tournament)}${roundPart ? ' · ' + escapeHtml(roundPart) : ''}</span>
    `;
    const isBm = SBData.bookmarks.isBookmarked(q.id);
    const bmBtn = document.createElement('button');
    bmBtn.className = 'btn small icon-btn' + (isBm ? ' active' : '');
    bmBtn.style.marginLeft = 'auto';
    bmBtn.textContent = isBm ? '★' : '☆';
    bmBtn.title = isBm ? 'Unbookmark' : 'Bookmark';
    bmBtn.onclick = () => {
      const nowBm = SBData.bookmarks.toggle(q.id);
      bmBtn.textContent = nowBm ? '★' : '☆';
      bmBtn.classList.toggle('active', nowBm);
      bmBtn.title = nowBm ? 'Unbookmark' : 'Bookmark';
      // The main bookmark button (up by the question) shows the star for
      // whichever question is currently displayed, which can be this exact
      // logged question (its reveal box is still on screen) - keep the two
      // stars in sync instead of leaving the main one stale.
      const cur = currentQ();
      if (cur && cur.id === q.id) updateBookmarkBtn();
    };
    meta.appendChild(bmBtn);
    card.appendChild(meta);

    const qText = document.createElement('div');
    qText.className = 'q-text';
    qText.innerHTML = SBData.renderMathHTML(q.question);
    card.appendChild(qText);

    if (q.choices) {
      const ch = document.createElement('div');
      ch.className = 'choices';
      ch.innerHTML = ['W', 'X', 'Y', 'Z'].map((L) => `${L}) ${SBData.renderMathHTML(q.choices[L])}`).join('   ');
      card.appendChild(ch);
    }

    const aText = document.createElement('div');
    aText.className = 'a-text';
    aText.innerHTML = 'Answer: ' + (q.answer.letter ? `${q.answer.letter}) ` : '') + SBData.renderMathHTML(SBData.answerDisplayText(q));
    card.appendChild(aText);

    if (entry.userText) {
      const you = document.createElement('div');
      you.className = 'small-note';
      you.style.marginTop = '4px';
      you.textContent = `You answered: "${entry.userText}"`;
      card.appendChild(you);
    }

    return card;
  }

  function showSessionDone() {
    runtime.phase = 'done';
    // Bookmarked-practice sessions loop indefinitely and end here only when
    // every bookmark got un-starred mid-session - the "done" box below
    // already says so, so the status pill above it is redundant there and
    // was asked to go away; a normal filtered session still gets the pill.
    if (session.bookmarkedMode) hidePill();
    else setPill('Session complete', 'revealed');
    document.getElementById('qDisplay').textContent = '';
    document.getElementById('choicesDisplay').style.display = 'none';
    // reserveRevealHeight() left the measure-wrap's min-height pinned to
    // the last real question's height (so the buttons below it didn't
    // creep upward while that question's text was still filling in) -
    // with no question showing anymore, that just reserves a tall empty
    // gap above the "session complete" box instead.
    document.getElementById('revealMeasureWrap').style.minHeight = '';
    document.getElementById('buzzBtn').style.display = 'none';
    document.getElementById('answerRow').style.display = 'none';
    document.getElementById('overrideBtn').style.display = 'none';
    document.getElementById('soloSettingsBtn').style.display = 'none';
    closeSettingsPanel();
    hideTimer();
    setNextButtonMode('hidden');
    const box = document.getElementById('revealBox');
    // Bookmarked-practice sessions loop indefinitely (see nextQuestion()),
    // so this only shows if every bookmark got un-starred mid-session -
    // there's nothing left to "practice again" with, so send them to a
    // fresh, normal solo-practice setup instead.
    const doneMsg = session.bookmarkedMode
      ? 'Session complete.'
      : "You've gone through every question that matched your filters.";
    const leftBtnLabel = session.bookmarkedMode ? 'Practice more' : 'Practice again';
    box.innerHTML = `
      <div class="ans-line">${doneMsg}</div>
      <div class="alt-line">${session.correct} correct · ${session.incorrect} incorrect (${session.skipped} skipped) · ${session.correct + session.incorrect} total</div>
      <div style="margin-top:14px; display:flex; gap:10px;">
        <button class="btn primary" id="playAgainBtn">${leftBtnLabel}</button>
        <a class="btn ghost" href="catalog.html">Browse catalog</a>
      </div>
    `;
    box.style.display = 'block';
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      if (session.bookmarkedMode) {
        // Their bookmark set is what's exhausted, not the normal catalog
        // filters - land on a clean, non-bookmarked setup screen.
        location.href = 'solo.html';
        return;
      }
      document.getElementById('gameScreen').style.display = 'none';
      document.getElementById('setupScreen').style.display = 'block';
      updateMatchCount();
    });
  }

  function labelFor(subjectKey) {
    const found = (SBData.meta.subjects || []).find((s) => s.key === subjectKey);
    return found ? found.label : subjectKey;
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function wireGameControls() {
    document.getElementById('buzzBtn').addEventListener('click', buzzIn);
    document.getElementById('nextBtn').addEventListener('click', handleNextButton);
    document.getElementById('overrideBtn').addEventListener('click', overrideGrading);
    document.getElementById('bookmarkBtn').addEventListener('click', toggleBookmark);
    document.getElementById('pauseBtn').addEventListener('click', togglePause);
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

    document.addEventListener('keydown', (e) => {
      if (document.getElementById('gameScreen').style.display === 'none') return;
      if (document.getElementById('soloSettingsOverlay').style.display !== 'none') {
        // While the settings modal is open, the only shortcuts that apply
        // are Escape (always) and S (unless typing in a field, e.g. the
        // tournament search box) to close it - every other in-game
        // shortcut stays disabled so it can't fire behind the modal's back.
        if (e.key === 'Escape') { closeSettingsPanel(); return; }
        const settingsTag = (e.target && e.target.tagName) || '';
        if ((e.key === 's' || e.key === 'S') && settingsTag !== 'INPUT' && settingsTag !== 'TEXTAREA') {
          closeSettingsPanel();
        }
        return;
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); buzzIn(); return; }
      if (e.key === 'n' || e.key === 'N') { handleNextButton(); return; }
      if (e.key === 'q' || e.key === 'Q') { overrideGrading(); return; }
      if (e.key === 'b' || e.key === 'B') { toggleBookmark(); return; }
      if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
      // Mirrors the settings button's own visibility - it's hidden during a
      // bookmarked-questions review session, where mid-session filter
      // changes don't apply, so the shortcut shouldn't open it either.
      if ((e.key === 's' || e.key === 'S') && !session.bookmarkedMode) { openSettingsPanel(); return; }
    });
  }

  SBData.load().then(() => {
    initSetup();
    initSoloSettings();
    wireGameControls();
  }).catch((err) => {
    document.documentElement.classList.remove('sb-boot-hide-setup');
    document.getElementById('setupScreen').innerHTML = '<p>Failed to load question data: ' + err.message + '</p>';
  });
})();
