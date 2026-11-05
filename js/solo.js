(function () {
  const { QTYPE_LABELS, FORMAT_LABELS, escapeHtml } = SBData;
  const labelFor = SBData.subjectLabel;
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];

  // The play page has no separate setup screen: the filters live in the
  // settings sidebar, the first Next starts a session, and a filter change
  // mid-session rebuilds the part of the queue not yet asked.
  const filterState = { subjects: new Set(), qtypes: new Set(), formats: new Set(), levels: new Set(), visuals: new Set(), tournaments: new Set(), roundRange: null, includeUnlabeled: true, bookmarkedOnly: false };
  let subjectItems, qtypeItems, formatItems, levelItems, visualItems, roundSliderApi;

  function buildChips(container, items, key, labelFn) {
    container.innerHTML = '';
    items.forEach((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      if (item.subjectAttr) chip.dataset.subject = item.subjectAttr;
      chip.textContent = labelFn(item);
      chip.addEventListener('click', () => {
        if (filterState[key].has(item.value)) filterState[key].delete(item.value);
        else filterState[key].add(item.value);
        syncChips(items, key);
        onFilterChange();
      });
      container.appendChild(chip);
      item._el = chip;
    });
    syncChips(items, key);
  }

  function syncChips(items, key) {
    if (!items) return;
    items.forEach((i) => {
      const on = filterState[key].has(i.value);
      i._el.classList.toggle('active', on);
      i._el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function getFiltered() {
    if (filterState.bookmarkedOnly) {
      // Bookmarked-practice mode (arrived via the bookmarks page's
      // "Practice these" button): every bookmarked question is in play,
      // whatever the filters say - they're for narrowing the whole bank, not
      // for silently dropping some of someone's own saved questions.
      return SBData.filterQuestions({ bookmarkedOnly: true });
    }
    return SBData.filterQuestions({
      subjects: filterState.subjects,
      roundRange: filterState.roundRange,
      includeUnlabeled: filterState.includeUnlabeled,
      qtypes: filterState.qtypes,
      formats: filterState.formats,
      levels: filterState.levels,
      visuals: filterState.visuals,
      tournaments: filterState.tournaments,
    });
  }

  // The round slider spans the picked tournaments' rounds only.
  function scopeRoundSlider() {
    const moved = roundSliderApi && roundSliderApi.setMax(SBData.maxRoundFor(filterState.tournaments));
    if (moved) filterState.roundRange = moved;
  }

  function updateMatchCount() {
    scopeRoundSlider();
    const n = getFiltered().length;
    document.getElementById('matchCount').textContent = `${n.toLocaleString()} question${n === 1 ? '' : 's'} match your filters`;
  }

  // Any filter change: refresh the count and, mid-session, rebuild the
  // not-yet-asked tail of the queue so the change applies from the next
  // question on, without repeating anything already asked. When the new
  // filters match nothing new, the session carries on with its old tail.
  function onFilterChange() {
    updateMatchCount();
    if (!sessionActive() || session.bookmarkedMode) return;
    let pool = getFiltered();
    if (!pool.length) return;
    const usedPrefix = session.queue.slice(0, session.index + 1);
    const askedIds = new Set(usedPrefix.map((q) => q.id));
    pool = SBData.stratifiedQueue(pool.filter((q) => !askedIds.has(q.id)), (q) => q.subject);
    session.queue = usedPrefix.concat(pool);
  }

  function selectAllSubjects() {
    subjectItems.forEach((i) => filterState.subjects.add(i.value));
    syncChips(subjectItems, 'subjects');
  }

  function initSettings() {
    subjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
    subjectItems.forEach((i) => filterState.subjects.add(i.value)); // every subject to start
    buildChips(document.getElementById('subjectChips'), subjectItems, 'subjects', (i) => i.label);

    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    roundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('roundMin'),
      maxInput: document.getElementById('roundMax'),
      fillEl: document.getElementById('roundSliderFill'),
      labelEl: document.getElementById('roundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { filterState.roundRange = [lo, hi]; onFilterChange(); },
    });
    document.getElementById('includeUnlabeledRounds').addEventListener('change', (e) => {
      filterState.includeUnlabeled = e.target.checked;
      onFilterChange();
    });

    qtypeItems = SBData.meta.qtypes.map((q) => ({ value: q, label: QTYPE_LABELS[q] || q }));
    buildChips(document.getElementById('qtypeChips'), qtypeItems, 'qtypes', (i) => i.label);
    formatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
    buildChips(document.getElementById('formatChips'), formatItems, 'formats', (i) => i.label);
    levelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));
    buildChips(document.getElementById('levelChips'), levelItems, 'levels', (i) => i.label);
    visualItems = SBData.VISUAL_KEYS.map((v) => ({ value: v, label: SBData.VISUAL_LABELS[v] }));
    buildChips(document.getElementById('visualChips'), visualItems, 'visuals', (i) => i.label);

    const tSelect = document.getElementById('tournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug;
      opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => {
      filterState.tournaments = new Set(tSelect.getMultiValues());
      onFilterChange();
    });
    SBData.enhanceMultiSelect(tSelect);

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      [[subjectItems, 'subjects'], [qtypeItems, 'qtypes'], [formatItems, 'formats'], [levelItems, 'levels'], [visualItems, 'visuals']].forEach(([items, key]) => {
        filterState[key].clear();
        syncChips(items, key);
      });
      filterState.tournaments.clear();
      tSelect.setMultiValues([]);
      if (roundSliderApi) roundSliderApi.reset();
      filterState.roundRange = null;
      document.getElementById('includeUnlabeledRounds').checked = true;
      filterState.includeUnlabeled = true;
      onFilterChange();
    });

    const rateSlider = document.getElementById('rateSlider');
    let savedRate = 1;
    try { savedRate = parseFloat(localStorage.getItem('sb_rate') || '1'); } catch (e) { /* default */ }
    rateSlider.value = isNaN(savedRate) ? 1 : savedRate;
    session.rate = parseFloat(rateSlider.value) || 1;
    document.getElementById('rateValue').textContent = session.rate.toFixed(1) + '×';
    rateSlider.addEventListener('input', () => {
      session.rate = parseFloat(rateSlider.value) || 1;
      document.getElementById('rateValue').textContent = session.rate.toFixed(1) + '×';
      try { localStorage.setItem('sb_rate', rateSlider.value); } catch (e) { /* not saved */ }
      // Applies to whatever is typing itself onto the screen right now too.
      if (runtime.revealCtl && !runtime.revealCtl.isDone()) runtime.revealCtl.setRate(session.rate);
    });

    updateMatchCount();
  }

  /* ================= SETTINGS SIDEBAR ================= */
  // On wide screens the sidebar starts open; on narrow ones it sits above the
  // question and starts closed. The gear button (or S) shows or hides it.
  const WIDE = window.matchMedia('(min-width: 992px)');
  function sidebarOpen() {
    const el = document.getElementById('settings');
    return WIDE.matches ? !el.classList.contains('collapsed') : el.classList.contains('show');
  }
  function toggleSidebar() {
    const el = document.getElementById('settings');
    if (WIDE.matches) el.classList.toggle('collapsed');
    else el.classList.toggle('show');
    document.getElementById('settingsBtn').setAttribute('aria-expanded', sidebarOpen() ? 'true' : 'false');
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
    phase: 'idle', // idle | revealing | buzzwindow | answering | reveal | done
    revealCtl: null,
    buzzedDuringReading: false,
    lastOutcome: null,
    timer: null, remainingMs: 0, totalMs: 0, timerKind: null, onExpire: null,
    paused: false,
  };
  function sessionActive() { return runtime.phase !== 'idle' && runtime.phase !== 'done'; }

  function startSession() {
    // Every subject switched off would match nothing; start from all of
    // them instead of refusing.
    if (!filterState.bookmarkedOnly && filterState.subjects.size === 0) {
      selectAllSubjects();
      updateMatchCount();
    }
    let pool = getFiltered();
    if (!pool.length) {
      setPill('No questions match your filters. Widen them in the settings and press Next.', 'revealed');
      return;
    }
    // Stratified by subject, so every selected subject gets equal turns
    // over the session however many questions each has.
    pool = SBData.stratifiedQueue(pool, (q) => q.subject);

    session.queue = pool;
    session.index = -1;
    session.correct = 0; session.incorrect = 0; session.skipped = 0;
    session.log = [];
    session.bookmarkedMode = filterState.bookmarkedOnly;
    renderQuestionLog();
    updateCounters();
    nextQuestion();
  }

  function updateCounters() {
    const seen = session.correct + session.incorrect;
    document.getElementById('statline').textContent =
      `${session.correct} correct / ${session.incorrect} incorrect with ${seen} question${seen === 1 ? '' : 's'} seen` +
      (session.skipped ? ` (${session.skipped} skipped)` : '');
  }

  function currentQ() { return session.index >= 0 ? session.queue[session.index] : null; }

  // A short fade-in on the question each time a new one comes up. Removing
  // the class, forcing a reflow, then re-adding it replays the animation.
  function playQuestionTransition() {
    const panel = document.getElementById('questionPanel');
    panel.classList.remove('q-panel-enter');
    void panel.offsetWidth;
    panel.classList.add('q-panel-enter');
  }

  function nextQuestion() {
    clearRuntimeTimer();
    if (runtime.revealCtl) runtime.revealCtl.stop();
    setPaused(false);

    session.index++;
    if (session.index >= session.queue.length) {
      if (session.bookmarkedMode) {
        // Practicing bookmarks loops instead of stopping, re-reading the
        // live bookmark set (stars may have changed mid-session).
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

    // The answer area can leave the page scrolled down; bring the new
    // question back into view.
    window.scrollTo(0, 0);

    playQuestionTransition();
    hidePill();
    document.getElementById('revealBox').style.display = 'none';
    document.getElementById('answerRow').style.display = 'none';
    document.getElementById('overrideBtn').style.display = 'none';
    resetTimer();
    setNextButtonMode('skip');
    setBuzzEnabled(true);
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('bookmarkBtn').disabled = false;
    document.getElementById('questionInfo').textContent = SBData.sourceLabelFor(q);
    updateBookmarkBtn();
    document.querySelectorAll('#choicesDisplay .choice-box').forEach((el) => {
      el.classList.remove('reveal-correct');
      el.classList.remove('clickable');
    });

    const qDisplay = document.getElementById('qDisplay');
    const subjectTag = document.getElementById('revealSubjectTag');
    const formatTag = document.getElementById('revealFormatTag');
    const qtypeTag = document.getElementById('revealQtypeTag');
    subjectTag.className = 'tag subject-' + q.subject;
    formatTag.className = 'tag fmt fmt-' + (q.format || '').toLowerCase();
    qtypeTag.className = SBData.qtypeTagClass(q);
    const tagSegments = [
      { text: labelFor(q.subject), el: subjectTag },
      { text: FORMAT_LABELS[q.format] || q.format, el: formatTag },
      { text: SBData.qtypeLabel(q), el: qtypeTag },
    ];
    const boxSegments = [{ html: SBData.renderMathHTML(q.question), el: qDisplay }];
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

    reserveRevealHeight(boxSegments);
    runtime.revealCtl = SBReveal.startReveal(tagSegments.concat(boxSegments), session.rate, {
      // The question and choices are given as math-rendered HTML, so
      // superscripts and subscripts type in already formatted.
      onComplete: () => { startBuzzWindow(); },
    });
  }

  // Reserve the final height of the question+choices area before the reveal
  // starts, so nothing below it creeps downward as the text fills in. The
  // question text's own box is held at its final height too, so a visual
  // question's figure (under the text) stays put.
  function reserveRevealHeight(boxSegments) {
    const wrap = document.getElementById('revealMeasureWrap');
    const textEl = boxSegments[0].el;
    wrap.style.minHeight = '';
    textEl.style.minHeight = '';
    boxSegments.forEach((s) => { s.el.innerHTML = s.html; });
    const h = wrap.scrollHeight;
    wrap.style.minHeight = h + 'px';
    textEl.style.minHeight = textEl.offsetHeight + 'px';
    boxSegments.forEach((s) => { s.el.textContent = ''; });
  }

  function startBuzzWindow() {
    if (runtime.phase !== 'revealing') return;
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
    setBuzzEnabled(false);
    setNextButtonMode('disabled');
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
    resolveQuestion({ attempted: true, correct: result.correct, close: !!result.close, userText: text });
  }

  function resolveQuestion(outcome) {
    clearRuntimeTimer();
    // Phase must flip to 'reveal' BEFORE skipToEnd() runs: skipToEnd() can
    // synchronously fire the reveal's onComplete (startBuzzWindow), which
    // only bails out once the phase says reading is over. In the other
    // order, skipping mid-reveal leaves a stray buzz timer running that
    // later resolves whatever question is current by then.
    runtime.phase = 'reveal';
    runtime.lastOutcome = outcome;
    setPaused(false);
    if (runtime.revealCtl) runtime.revealCtl.skipToEnd();

    // A skip LOGS as "Skipped" but counts toward Incorrect: you didn't get it.
    let category;
    if (!outcome.attempted) { category = 'skipped'; session.skipped++; session.incorrect++; }
    else if (outcome.correct) { category = 'correct'; session.correct++; }
    else { category = 'incorrect'; session.incorrect++; }
    updateCounters();

    const q = currentQ();
    session.log.unshift({ q, category, userText: outcome.userText || '' });
    if (window.SBAccount) SBAccount.recordAnswer(q, category, 'solo');
    renderQuestionLog();

    setBuzzEnabled(false);
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('answerRow').style.display = 'none';
    resetTimer();
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
    let html = `<div class="mb-1"><span class="grade-badge ${category}">${badgeText}</span>`;
    if (outcome && outcome.attempted && outcome.userText) {
      html += ` <span class="who-line">You answered: "${escapeHtml(outcome.userText)}"</span>`;
    }
    html += '</div>';
    if (category === 'incorrect' && outcome.close) {
      html += '<div class="close-hint">Close. If you meant the answer below, press <kbd>q</kbd> or "I was right" to count it.</div>';
    }
    html += `<div class="ans-line">${SBData.answerLineHTML(SBData.answerDisplayText(q), q.answer.letter, q.answer.accept)}</div>`;
    if (q.answer.reject.length) html += `<div class="alt-line">Do not accept: ${SBData.renderMathHTML(q.answer.reject.join('; '))}</div>`;
    html += `<div class="src-line">${SBData.sourceLineHTML(q)}</div>`;
    box.innerHTML = html;
    box.style.display = 'block';

    // "I was wrong" undoes a Correct; "I was right" undoes an Incorrect.
    const override = document.getElementById('overrideBtn');
    if (outcome && outcome.attempted) {
      override.textContent = outcome.correct ? 'I was wrong' : 'I was right';
      override.style.display = '';
    } else {
      override.style.display = 'none';
    }

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
    if (window.SBAccount) SBAccount.updateLastAnswer(runtime.lastOutcome.correct ? 'correct' : 'incorrect');
    showReveal();
    renderQuestionLog();
  }

  function toggleBookmark() {
    const q = currentQ();
    if (!q || runtime.phase === 'done') return;
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
  // Keep a logged question's own star in step with the one up top, in case
  // the question is still on screen when its star is toggled from there.
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
  function hidePill() {
    document.getElementById('statusPill').style.display = 'none';
  }

  function runTimer(ms, kind, onExpire) {
    clearRuntimeTimer();
    runtime.totalMs = ms; runtime.remainingMs = ms; runtime.timerKind = kind; runtime.onExpire = onExpire;
    renderTick(ms, kind);
    runtime.timer = setInterval(() => {
      if (runtime.paused) return;
      runtime.remainingMs -= 100;
      if (runtime.remainingMs <= 0) {
        renderTick(0, kind);
        clearInterval(runtime.timer); runtime.timer = null;
        const fn = runtime.onExpire; runtime.onExpire = null;
        if (fn) fn();
        return;
      }
      renderTick(runtime.remainingMs, kind);
    }, 100);
  }
  function clearRuntimeTimer() {
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null; runtime.onExpire = null;
  }
  // The big sidebar readout: whole seconds, then tenths in smaller type.
  function renderTick(remainingMs, kind) {
    const tenths = Math.max(0, Math.round(remainingMs / 100));
    document.getElementById('timerFace').textContent = String(Math.floor(tenths / 10));
    document.getElementById('timerFraction').textContent = '.' + (tenths % 10);
    document.getElementById('timer').classList.toggle('answering', kind === 'answer');
  }
  function resetTimer() { renderTick(0, null); }

  function setPaused(on) {
    runtime.paused = on;
    document.getElementById('pauseBadge').style.display = on ? '' : 'none';
    const btn = document.getElementById('pauseBtn');
    btn.innerHTML = on ? SBIcons.play : SBIcons.pause;
    btn.setAttribute('aria-label', on ? 'Resume' : 'Pause');
    btn.title = (on ? 'Resume' : 'Pause') + ' (shortcut: p)';
  }
  function togglePause() {
    if (runtime.phase !== 'revealing' && runtime.phase !== 'buzzwindow' && runtime.phase !== 'answering') return;
    setPaused(!runtime.paused);
    if (runtime.revealCtl && runtime.phase === 'revealing') {
      if (runtime.paused) runtime.revealCtl.pause(); else runtime.revealCtl.resume();
    }
    // The countdown checks runtime.paused on every tick.
  }

  function renderQuestionLog() {
    const el = document.getElementById('questionLog');
    el.innerHTML = '';
    session.log.forEach((entry) => {
      const li = document.createElement('li');
      li.appendChild(renderLogEntry(entry));
      el.appendChild(li);
    });
  }

  function renderLogEntry(entry) {
    const q = entry.q;
    const card = SBData.questionCard(q, {
      grade: entry.category,
      note: entry.userText ? `You answered: "${entry.userText}"` : '',
      // The star up top shows the current question's bookmark, which can be
      // this logged question; keep it in step.
      onBookmark: () => {
        const cur = currentQ();
        if (cur && cur.id === q.id) updateBookmarkBtn();
      },
    });
    card.classList.add('q-log-entry');
    return card;
  }

  function showSessionDone() {
    runtime.phase = 'done';
    clearRuntimeTimer();
    if (session.bookmarkedMode) hidePill();
    else setPill('Session complete', 'revealed');
    document.getElementById('qDisplay').textContent = '';
    document.getElementById('choicesDisplay').style.display = 'none';
    document.getElementById('qFigures').style.display = 'none';
    ['revealSubjectTag', 'revealFormatTag', 'revealQtypeTag'].forEach((id) => { document.getElementById(id).textContent = ''; });
    // reserveRevealHeight() pinned the last question's height; with no
    // question showing, that would only leave a tall empty gap.
    document.getElementById('revealMeasureWrap').style.minHeight = '';
    document.getElementById('qDisplay').style.minHeight = '';
    document.getElementById('questionInfo').textContent = '';
    document.getElementById('bookmarkBtn').disabled = true;
    document.getElementById('answerRow').style.display = 'none';
    document.getElementById('overrideBtn').style.display = 'none';
    setBuzzEnabled(false);
    document.getElementById('pauseBtn').disabled = true;
    resetTimer();
    setNextButtonMode(session.bookmarkedMode ? 'disabled' : 'start');
    const box = document.getElementById('revealBox');
    // Bookmarked practice loops (see nextQuestion()), so it only ends here
    // when every bookmark got un-starred mid-session.
    const doneMsg = session.bookmarkedMode
      ? 'Session complete: there are no bookmarked questions left.'
      : "You've gone through every question that matched your filters. Change them in the settings and press Next to go again.";
    box.innerHTML = `
      <div class="ans-line">${doneMsg}</div>
      <div class="alt-line">${session.correct} correct · ${session.incorrect} incorrect (${session.skipped} skipped) · ${session.correct + session.incorrect} total</div>
      <div class="mt-3 d-flex gap-2">
        <button class="btn btn-primary" id="playAgainBtn" type="button">${session.bookmarkedMode ? 'Practice every question' : 'Practice again'}</button>
        <a class="btn btn-outline-secondary" href="catalog.html">Search the database</a>
      </div>
    `;
    box.style.display = 'block';
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      if (session.bookmarkedMode) { location.href = 'solo.html'; return; }
      startSession();
    });
  }

  function wireGameControls() {
    document.getElementById('buzzBtn').addEventListener('click', buzzIn);
    document.getElementById('nextBtn').addEventListener('click', handleNextButton);
    document.getElementById('overrideBtn').addEventListener('click', overrideGrading);
    document.getElementById('bookmarkBtn').addEventListener('click', toggleBookmark);
    document.getElementById('pauseBtn').addEventListener('click', togglePause);
    document.getElementById('settingsBtn').addEventListener('click', toggleSidebar);
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); buzzIn(); return; }
      if (e.key === 'n' || e.key === 'N') { handleNextButton(); return; }
      if (e.key === 'q' || e.key === 'Q') { overrideGrading(); return; }
      if (e.key === 'b' || e.key === 'B') { toggleBookmark(); return; }
      if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
      if (e.key === 's' || e.key === 'S') { toggleSidebar(); return; }
    });
  }

  // Bookmarked practice (the bookmarks page's "Practice these" button):
  // the filters don't apply, so the sidebar says what's being practiced
  // instead, and the session starts at once.
  function startBookmarkedIfAsked() {
    if (new URLSearchParams(location.search).get('bookmarked') !== '1') return;
    filterState.bookmarkedOnly = true;
    const n = getFiltered().length;
    if (!n) {
      filterState.bookmarkedOnly = false;
      setPill("You haven't bookmarked any questions yet, so this is ordinary practice.", 'revealed');
      return;
    }
    document.getElementById('filterSettings').style.display = 'none';
    document.getElementById('bookmarkedNote').style.display = '';
    document.getElementById('bookmarkedNoteText').textContent =
      `Practicing your ${n.toLocaleString()} bookmarked question${n === 1 ? '' : 's'}, round and round.`;
    startSession();
  }

  setPaused(false);
  document.getElementById('settingsBtn').innerHTML = SBIcons.gear;
  document.getElementById('settingsBtn').setAttribute('aria-expanded', sidebarOpen() ? 'true' : 'false');
  setNextButtonMode('disabled');

  SBData.load().then(() => {
    initSettings();
    wireGameControls();
    setNextButtonMode('start');
    updateCounters();
    startBookmarkedIfAsked();
  }).catch((err) => {
    document.getElementById('qDisplay').textContent = 'Failed to load question data: ' + err.message;
  });
})();
