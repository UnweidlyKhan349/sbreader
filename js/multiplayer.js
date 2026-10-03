(function () {
  const QTYPE_LABELS = { tossup: 'Tossup', bonus: 'Bonus' };
  const FORMAT_LABELS = { SA: 'Short Answer', MC: 'Multiple Choice' };
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];
  const ROOM_PREFIX = 'sbowl-';
  const TYPING_THROTTLE_MS = 150;
  const CHAT_HISTORY = 60;

  const filterState = { subjects: new Set(), qtypes: new Set(), formats: new Set(), levels: new Set(), tournaments: new Set(), roundRange: null, includeUnlabeled: true };
  let subjectItems, qtypeItems, formatItems, levelItems, roundSliderApi;
  // Snapshot of whatever filters actually produced the room's current queue -
  // kept in sync on room creation and whenever the in-game settings panel is
  // applied, and used to seed that panel each time it's reopened.
  let activeFilterState = null;

  const myState = { role: null, myId: null, myName: '', rate: 1 };

  /* ================= LOBBY SETUP ================= */
  function buildChips(container, items, stateObj, key, labelFn, onChange) {
    container.innerHTML = '';
    items.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      if (item.subjectAttr) chip.dataset.subject = item.subjectAttr;
      chip.textContent = labelFn(item);
      chip.classList.toggle('active', stateObj[key].has(item.value));
      chip.addEventListener('click', () => {
        if (stateObj[key].has(item.value)) stateObj[key].delete(item.value);
        else stateObj[key].add(item.value);
        chip.classList.toggle('active', stateObj[key].has(item.value));
        if (onChange) onChange();
      });
      container.appendChild(chip);
      item._el = chip;
    });
  }
  function filterQuestionsFor(stateObj) {
    return SBData.filterQuestions({
      subjects: stateObj.subjects,
      roundRange: stateObj.roundRange,
      includeUnlabeled: stateObj.includeUnlabeled,
      qtypes: stateObj.qtypes, formats: stateObj.formats, levels: stateObj.levels,
      tournaments: stateObj.tournaments,
    });
  }
  function getFiltered() { return filterQuestionsFor(filterState); }
  function updateMatchCount() {
    document.getElementById('matchCount').textContent = `${getFiltered().length.toLocaleString()} questions match your filters`;
  }

  function initLobby() {
    subjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
    // Default to every subject selected.
    subjectItems.forEach((i) => { filterState.subjects.add(i.value); });
    buildChips(document.getElementById('subjectChips'), subjectItems, filterState, 'subjects', (i) => i.label, updateMatchCount);

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
    buildChips(document.getElementById('qtypeChips'), qtypeItems, filterState, 'qtypes', (i) => i.label, updateMatchCount);
    formatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
    buildChips(document.getElementById('formatChips'), formatItems, filterState, 'formats', (i) => i.label, updateMatchCount);
    levelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));
    buildChips(document.getElementById('levelChips'), levelItems, filterState, 'levels', (i) => i.label, updateMatchCount);

    const tSelect = document.getElementById('tournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug; opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => { filterState.tournaments = new Set(tSelect.getMultiValues()); updateMatchCount(); });
    SBData.enhanceMultiSelect(tSelect);
    updateMatchCount();

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      [[subjectItems, 'subjects'], [qtypeItems, 'qtypes'], [formatItems, 'formats'], [levelItems, 'levels']].forEach(([items, key]) => {
        filterState[key].clear();
        items.forEach((i) => i._el.classList.remove('active'));
      });
      filterState.tournaments.clear();
      tSelect.setMultiValues([]);
      if (roundSliderApi) roundSliderApi.reset();
      document.getElementById('includeUnlabeledRounds').checked = true;
      filterState.includeUnlabeled = true;
      updateMatchCount();
    });

    const rateSlider = document.getElementById('mpRateSlider');
    SBData.wireRangeFill(rateSlider);
    rateSlider.addEventListener('input', () => {
      document.getElementById('mpRateValue').textContent = parseFloat(rateSlider.value).toFixed(1) + '×';
    });

    document.getElementById('createRoomBtn').addEventListener('click', createRoom);
    document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);

    document.getElementById('hostNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); createRoom(); }
    });
    document.getElementById('joinCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); joinRoom(); }
    });
    document.getElementById('joinNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); joinRoom(); }
    });
  }

  /* ================= SHARED GAME STATE (rendered identically on host & clients) ================= */
  const game = {
    players: [], phase: 'lobby', index: 0, total: 0,
    question: null, buzzedPlayerId: null, lockedOut: new Set(),
    // lastGrade: { playerId, correct, userText } - who most recently answered
    // this question and how it was graded, used to badge the buzz-status
    // panel and the answer box. Reset to null at the start of each question.
    lastGrade: null, log: [], paused: false,
    lastRevealData: null, liveTypingText: '', liveTypingFrom: null,
    // Last tick actually applied (remainingMs/totalMs/kind), so a re-render
    // triggered by something other than a fresh tick - e.g. toggling pause,
    // which stops the host from broadcasting further ticks while paused -
    // can redraw the timer at its correct frozen value instead of the bar
    // just vanishing until the next tick happens to arrive. See
    // fullRenderFromState / applyTickLocal / hideTimer.
    lastTick: null,
    // attempts: [{ playerId, playerName, userText, correct }] - every buzz
    // that's been graded on the CURRENT question, oldest first. Kept visible
    // to everyone (not cleared when the next player buzzes) so a wrong
    // answer stays on screen instead of disappearing the moment someone
    // else buzzes in. Reset only when the next question starts.
    attempts: [],
    // True once anyone has overridden their answer to correct this
    // question - locks the override control for everyone (see
    // hostOverrideLastGrade / fullRenderFromState). Reset each question.
    overrideLocked: false,
  };

  let revealCtl = null;

  // Non-host clients only get a countdown "tick" broadcast from the host
  // every ~200ms (plus real network latency/jitter on top), so rendering
  // those ticks directly looks choppy compared to the host's own smooth
  // locally-driven 100ms updates. Smooth it out client-side the same way
  // the text-reveal controller does: anchor each received tick to
  // Date.now() and interpolate locally on a fast local timer, correcting
  // back to the true value every time a fresh tick actually arrives.
  let clientTick = null; // { totalMs, remainingAtAnchor, kind, runStart, pausedElapsed, paused, intervalId }
  function stopClientTickLoop() {
    if (clientTick && clientTick.intervalId) clearInterval(clientTick.intervalId);
    clientTick = null;
  }
  function clientTickElapsed(ct) {
    return ct.paused ? ct.pausedElapsed : ct.pausedElapsed + (Date.now() - ct.runStart);
  }
  function onClientTick(remainingMs, totalMs, kind) {
    stopClientTickLoop();
    clientTick = {
      totalMs, remainingAtAnchor: remainingMs, kind,
      runStart: Date.now(), pausedElapsed: 0, paused: !!game.paused,
      intervalId: null,
    };
    const step = () => {
      if (!clientTick) return;
      const display = Math.max(0, clientTick.remainingAtAnchor - clientTickElapsed(clientTick));
      // Keep game.lastTick current so a re-render triggered by something
      // other than a tick (e.g. a pauseState broadcast, which is all a
      // client gets while paused - the host stops sending ticks entirely)
      // can redraw this client's own interpolated value instead of the
      // timer just vanishing. See fullRenderFromState.
      game.lastTick = { remainingMs: display, totalMs: clientTick.totalMs, kind: clientTick.kind };
      renderTick(display, clientTick.totalMs, clientTick.kind);
      if (display <= 0) stopClientTickLoop();
    };
    step();
    if (clientTick) clientTick.intervalId = setInterval(step, 50);
  }
  function setClientTickPaused(paused) {
    if (!clientTick || clientTick.paused === !!paused) return;
    if (paused) {
      clientTick.pausedElapsed = clientTickElapsed(clientTick);
      clientTick.paused = true;
    } else {
      clientTick.runStart = Date.now();
      clientTick.paused = false;
    }
  }

  function labelFor(subjectKey) {
    const found = (SBData.meta.subjects || []).find((s) => s.key === subjectKey);
    return found ? found.label : subjectKey;
  }
  function escapeHtml(s) {
    const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML;
  }
  // A blank submission renders as the literal word (blank), with no quote
  // marks (they'd wrongly imply the player typed the word "(blank)"); a
  // real submission still renders quoted.
  function formatUserAnswer(text) {
    return text ? `"${escapeHtml(text)}"` : '(blank)';
  }
  function sanitizeQuestion(q) {
    return {
      id: q.id, tournament: q.tournament, roundLabel: q.roundLabel, round: q.round,
      subject: q.subject, format: q.format, qtype: q.qtype, level: q.level, question: q.question,
      visual: q.visual,
      choices: q.choices ? { W: q.choices.W, X: q.choices.X, Y: q.choices.Y, Z: q.choices.Z } : null,
    };
  }
  function displayRoomCode(code) { return code.startsWith(ROOM_PREFIX) ? code.slice(ROOM_PREFIX.length) : code; }

  function copyRoomCode() {
    const el = document.getElementById('mpRoomCodeDisplay');
    const text = el.textContent;
    if (!text || text === '-----') return;
    const showCopied = () => {
      const prev = el.textContent;
      el.textContent = 'Copied!';
      el.classList.add('copied');
      setTimeout(() => { el.textContent = prev; el.classList.remove('copied'); }, 1100);
    };
    const legacyCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { /* best effort */ }
      showCopied();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(legacyCopy);
    } else {
      legacyCopy();
    }
  }

  /* ================= RENDERING (host + client share this) ================= */
  function renderPlayerList(container) {
    container.innerHTML = '';
    game.players.slice().sort((a, b) => b.score - a.score).forEach((p) => {
      const row = document.createElement('div');
      // A graded attempt always wins (correct/incorrect), even though
      // game.buzzedPlayerId keeps pointing at the last-buzzed player all the
      // way through the reveal phase (other UI uses that to keep showing who
      // answered) - otherwise the row would stay stuck yellow forever after
      // a wrong (or right) answer instead of turning red/green.
      let stateClass = '';
      const attempt = game.attempts.find((a) => a.playerId === p.id);
      if (attempt) {
        stateClass = attempt.correct ? ' answered-correct' : ' answered-incorrect';
      } else if (p.id === game.buzzedPlayerId && game.phase === 'answering') {
        stateClass = ' buzzed'; // currently buzzed in and typing - not graded yet
      }
      row.className = 'mp-player-row' + (p.id === myState.myId ? ' me' : '') + stateClass;
      const lockedBadge = game.lockedOut.has(p.id) ? '<span class="badge">locked out</span>' : (p.id === game.buzzedPlayerId && game.phase === 'answering' ? '<span class="badge">buzzed!</span>' : '');
      row.innerHTML = `<span class="name">${escapeHtml(p.name)}${p.id === myState.myId ? ' (you)' : ''}</span> ${lockedBadge} <span class="pts">${p.score}</span>`;
      container.appendChild(row);
    });
  }

  function setPill(text, cls) {
    const el = document.getElementById('mpStatusPill');
    el.textContent = text; el.className = 'status-pill ' + (cls || '');
    el.style.display = 'inline-flex';
  }
  function hidePill() {
    document.getElementById('mpStatusPill').style.display = 'none';
  }

  function renderTick(remainingMs, totalMs, kind) {
    const row = document.getElementById('mpTimerRow');
    row.style.display = 'flex';
    const fill = document.getElementById('mpTimerFill');
    fill.className = 'timer-bar-fill' + (kind === 'answer' ? ' answer' : '');
    fill.style.width = Math.max(0, (remainingMs / totalMs) * 100) + '%';
    document.getElementById('mpTimerLabel').textContent = (remainingMs / 1000).toFixed(1) + 's';
  }
  function hideTimer() { document.getElementById('mpTimerRow').style.display = 'none'; stopClientTickLoop(); game.lastTick = null; }

  function renderQuestionLog() {
    const el = document.getElementById('mpQuestionLog');
    el.innerHTML = '';
    if (!game.log.length) {
      el.innerHTML = '<div class="q-log-empty">Questions the room has gone through will show up here.</div>';
      return;
    }
    game.log.forEach((entry) => {
      el.appendChild(renderLogEntry(entry));
    });
  }

  function renderLogEntry(entry) {
    const q = entry.question;
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
      // whichever question is currently active, which can be this exact
      // logged question - keep the two stars in sync instead of leaving
      // the main one stale.
      if (game.question && game.question.id === q.id) updateMpBookmarkBtn();
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
    aText.innerHTML = (entry.answer.letter ? `${entry.answer.letter}) ` : '') + SBData.renderMathHTML(entry.answer.answerText);
    card.appendChild(aText);

    if (entry.answeredBy) {
      const who = document.createElement('div');
      who.className = 'small-note';
      who.style.marginTop = '4px';
      who.textContent = `${entry.answeredBy} answered: ${entry.userText ? `"${entry.userText}"` : '(blank)'}`;
      card.appendChild(who);
    }

    return card;
  }

  function renderBuzzStatus() {
    const panel = document.getElementById('mpBuzzStatus');
    const whoEl = document.getElementById('mpBuzzWho');
    const typedEl = document.getElementById('mpBuzzTyped');
    const attemptsEl = document.getElementById('mpBuzzAttempts');
    if (!panel) return;

    const buzzedPlayer = game.buzzedPlayerId ? game.players.find((p) => p.id === game.buzzedPlayerId) : null;
    // The "X buzzed in! ... [typing / Submitted: ...]" line only makes
    // sense while someone is actively answering right now, before their
    // attempt has been graded. Once the question reaches reveal, that
    // attempt (like every other one this question) shows the same way as
    // all the others: a uniform "[badge] Name: "answer"" row in the
    // attempts list below, not specially formatted up here - this is what
    // makes the results list read as one consistent sequence (badge, name,
    // quoted answer, divider, badge, name, quoted answer, ...) instead of
    // the last attempt looking different from the ones before it.
    const isCurrentlyAnswering = game.phase === 'answering' && buzzedPlayer;

    if (isCurrentlyAnswering) {
      whoEl.style.display = 'block';
      typedEl.style.display = 'block';
      whoEl.textContent = `${buzzedPlayer.name}${buzzedPlayer.id === myState.myId ? ' (you)' : ''} buzzed in!`;
      if (game.liveTypingFrom === buzzedPlayer.id && game.liveTypingText && buzzedPlayer.id !== myState.myId) {
        typedEl.classList.add('live-typing');
        typedEl.innerHTML = `<span class="live-typing-name">${escapeHtml(buzzedPlayer.name)}:</span> <span class="live-typing-text">${escapeHtml(game.liveTypingText)}</span>`;
      } else if (buzzedPlayer.id === myState.myId) {
        typedEl.classList.remove('live-typing');
        typedEl.textContent = 'Type your answer below and press Enter.';
      } else {
        typedEl.classList.remove('live-typing');
        typedEl.textContent = 'Waiting for their answer…';
      }
    } else {
      whoEl.style.display = 'none';
      typedEl.style.display = 'none';
      typedEl.classList.remove('live-typing');
    }
    // The attempts list only needs a gap above it when the "X buzzed in! ..."
    // status lines are actually showing above it - with those hidden, the
    // list is the first thing in the panel and a gap above it just reads as
    // wasted space at the top of the box.
    attemptsEl.classList.toggle('has-status-above', isCurrentlyAnswering);
    // A subtle panel-wide tint from the most recently graded attempt, so
    // the outcome of the question reads at a glance even before scanning
    // the individual rows below.
    panel.className = 'mp-buzz-status' + (game.phase === 'reveal' && game.lastGrade ? (game.lastGrade.correct ? ' graded-correct' : ' graded-incorrect') : '');

    // Every attempt graded so far this question, oldest first, each as a
    // uniform "[badge] Name: "answer"" row with a divider between them -
    // once the question reaches reveal this is the room's full results
    // list, including the final attempt (previously shown separately,
    // above, and again - redundantly - inside the answer box itself; see
    // showReveal(), which no longer repeats it there).
    attemptsEl.innerHTML = '';
    game.attempts.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'mp-buzz-attempt-row';
      const badgeText = a.correct ? 'Correct' : 'Incorrect';
      row.innerHTML = `<span class="grade-badge ${a.correct ? 'correct' : 'incorrect'}">${badgeText}</span><span class="name">${escapeHtml(a.playerName)}${a.playerId === myState.myId ? ' (you)' : ''}:</span><span class="text">${formatUserAnswer(a.userText)}</span>`;
      attemptsEl.appendChild(row);
    });

    panel.style.display = (isCurrentlyAnswering || game.attempts.length) ? 'block' : 'none';
  }

  function buildRevealSegments(q) {
    const qDisplay = document.getElementById('mpQDisplay');
    qDisplay.classList.remove('mp-waiting-text');
    const subjectTag = document.getElementById('mpRevealSubjectTag');
    const formatTag = document.getElementById('mpRevealFormatTag');
    const qtypeTag = document.getElementById('mpRevealQtypeTag');
    subjectTag.className = 'tag subject-' + q.subject;
    formatTag.className = 'tag fmt fmt-' + (q.format || '').toLowerCase();
    qtypeTag.className = 'tag qtype-' + q.qtype;
    const tagSegments = [
      { text: labelFor(q.subject).toUpperCase(), el: subjectTag },
      { text: (FORMAT_LABELS[q.format] || q.format).toUpperCase(), el: formatTag },
      { text: (QTYPE_LABELS[q.qtype] || q.qtype).toUpperCase(), el: qtypeTag },
    ];
    const boxSegments = [{ text: q.question, el: qDisplay }];
    const choicesDisplay = document.getElementById('mpChoicesDisplay');
    if (q.choices) {
      choicesDisplay.style.display = 'grid';
      LETTERS.forEach((L) => boxSegments.push({ text: q.choices[L] || '', el: document.getElementById('mpChoiceText' + L) }));
    } else {
      choicesDisplay.style.display = 'none';
    }
    return { tagSegments, boxSegments };
  }

  // Reserve the final height of the question+choices area before the reveal
  // starts, so the buttons below it don't creep downward as the text fills
  // in letter by letter.
  function reserveRevealHeight(boxSegments) {
    const wrap = document.getElementById('mpRevealMeasureWrap');
    wrap.style.minHeight = '';
    boxSegments.forEach((s) => { s.el.textContent = s.text; });
    const h = wrap.scrollHeight;
    wrap.style.minHeight = h + 'px';
    boxSegments.forEach((s) => { s.el.textContent = ''; });
  }

  // instant=true renders the full text immediately with no animation (used when a
  // player joins mid-question and has nothing to "catch up" on).
  function startLocalReveal(q, instant, onComplete) {
    if (revealCtl) revealCtl.stop();
    const { tagSegments, boxSegments } = buildRevealSegments(q);
    reserveRevealHeight(boxSegments);
    // Only the question/choice segments get math-rendered (real
    // superscript/subscript for well-formed "^"/"_" notation) - the tag
    // segments are just uppercase subject/format/qtype labels.
    if (instant) {
      tagSegments.forEach((s) => { s.el.textContent = s.text; });
      boxSegments.forEach((s) => { s.el.innerHTML = SBData.renderMathHTML(s.text); });
      revealCtl = null;
      if (onComplete) onComplete();
      return;
    }
    revealCtl = SBReveal.startReveal(tagSegments.concat(boxSegments), myState.rate, {
      onComplete: () => {
        boxSegments.forEach((s) => { s.el.innerHTML = SBData.renderMathHTML(s.text); });
        if (onComplete) onComplete();
      },
    });
    if (game.paused) revealCtl.pause();
  }

  function fullRenderFromState() {
    renderPlayerList(document.getElementById('mpPlayerList'));
    renderQuestionLog();
    renderBuzzStatus();
    updateMpBookmarkBtn();
    const buzzBtn = document.getElementById('mpBuzzBtn');
    const answerRow = document.getElementById('mpAnswerRow');
    const nextBtn = document.getElementById('mpNextBtn');
    const overrideBtn = document.getElementById('mpOverrideBtn');
    const revealBox = document.getElementById('mpRevealBox');
    const pauseBtn = document.getElementById('mpPauseBtn');
    const choicesDisplay = document.getElementById('mpChoicesDisplay');

    if (game.question) {
      choicesDisplay.style.display = game.question.choices ? 'grid' : 'none';
    } else {
      choicesDisplay.style.display = 'none';
    }
    // The lobby's "waiting to start" screen has nothing but a single line
    // of text and the Start button - the panel's usual min-height (sized
    // for a full question + choices) and its always-reserved tag-row space
    // just left a big empty gap above and below that line, so both are
    // dropped while phase === 'lobby'.
    const questionPanelEl = document.querySelector('.question-panel');
    if (questionPanelEl) questionPanelEl.classList.toggle('mp-lobby-compact', game.phase === 'lobby');

    revealBox.style.display = 'none';
    document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => { el.classList.remove('reveal-correct'); el.classList.remove('clickable'); });
    answerRow.style.display = 'none';
    nextBtn.style.display = 'none';
    buzzBtn.style.display = 'none';
    overrideBtn.style.display = 'none';
    document.getElementById('mpBookmarkBtn').style.display = game.question ? 'inline-flex' : 'none';
    // Don't blindly hide the timer on every re-render - a re-render can be
    // triggered by something other than a fresh tick (pausing stops the
    // host from broadcasting further ticks entirely; see hostTogglePause),
    // and hiding it unconditionally made the whole timer disappear the
    // moment you paused instead of staying visible at its frozen value.
    // Redraw the last known tick if we're still in a timer-bearing phase;
    // otherwise there's genuinely nothing to show.
    if (game.lastTick && (game.phase === 'reading' || game.phase === 'buzzwindow' || game.phase === 'answering')) {
      renderTick(game.lastTick.remainingMs, game.lastTick.totalMs, game.lastTick.kind);
    } else {
      hideTimer();
    }
    hidePill();
    pauseBtn.style.display = (game.phase === 'lobby' || game.phase === 'gameover') ? 'none' : 'inline-flex';
    pauseBtn.textContent = game.paused ? 'Resume (P)' : 'Pause (P)';
    document.getElementById('mpPauseBadge').style.display = game.paused ? 'inline-flex' : 'none';

    const amBuzzed = game.buzzedPlayerId === myState.myId;
    const amLocked = game.lockedOut.has(myState.myId);

    if (game.phase === 'lobby') {
      nextBtn.style.display = 'inline-flex';
      // "(N)" here is the keyboard-shortcut hint, same convention as every
      // other button label in this game ("Skip (N)", "Next question (N)") -
      // it's the literal letter N, not a player count.
      nextBtn.textContent = 'Start (N)';
      nextBtn.dataset.mode = 'next';
      nextBtn.classList.add('primary');
      const qDisplay = document.getElementById('mpQDisplay');
      qDisplay.textContent = 'Ready when you are — click Start or press N to begin.';
      qDisplay.classList.add('mp-waiting-text');
    } else if (game.phase === 'reading') {
      buzzBtn.style.display = amLocked ? 'none' : 'inline-flex';
      nextBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Skip (N)';
      nextBtn.dataset.mode = 'skip';
      nextBtn.classList.remove('primary');
    } else if (game.phase === 'buzzwindow') {
      buzzBtn.style.display = amLocked ? 'none' : 'inline-flex';
      nextBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Skip (N)';
      nextBtn.dataset.mode = 'skip';
      nextBtn.classList.remove('primary');
    } else if (game.phase === 'answering') {
      if (amBuzzed) {
        answerRow.style.display = 'flex';
        document.getElementById('mpAnswerInput').value = '';
        document.getElementById('mpAnswerInput').focus();
        if (game.question && game.question.format === 'MC' && game.question.choices) {
          document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => el.classList.add('clickable'));
        }
      }
    } else if (game.phase === 'reveal') {
      nextBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Next question (N)';
      nextBtn.dataset.mode = 'next';
      nextBtn.classList.add('primary');
      // Anyone who buzzed and was graded THIS question can override their
      // own answer - not just whoever happened to be graded last, and not
      // just the host. Once someone's been overridden to correct, though,
      // the room has its answer and overriding locks for everyone (see
      // hostOverrideLastGrade). game.attempts/game.overrideLocked are kept
      // in sync for host and client alike (see applyGradeLocal / the
      // 'graded' and 'sync' messages).
      if (!game.overrideLocked && game.attempts.some((a) => a.playerId === myState.myId)) {
        overrideBtn.style.display = 'inline-flex';
      }
      showReveal();
    } else if (game.phase === 'gameover') {
      setPill('Game over', 'revealed');
    }
  }

  function showReveal() {
    const box = document.getElementById('mpRevealBox');
    const r = game.lastRevealData;
    if (!r) { box.style.display = 'none'; return; }
    // Who answered what, and whether they were right, now lives entirely in
    // the attempts list in mpBuzzStatus (renderBuzzStatus) above this box -
    // repeating the last attempt's badge/name/text here too was the
    // reported duplication ("Incorrect ... Host answered: ..." showing up
    // twice). A skipped question (nobody attempted it) still gets its own
    // badge here, since renderBuzzStatus has nothing to show in that case.
    let html = '';
    if (!game.lastGrade) {
      html += `<div class="grade-badge skipped">Skipped</div>`;
    }
    html += `<div class="ans-line">${SBData.answerLineHTML(r.answerText, r.letter, r.accept)}</div>`;
    if (r.reject && r.reject.length) html += `<div class="alt-line">Do not accept: ${SBData.renderMathHTML(r.reject.join('; '))}</div>`;
    const roundPart = SBData.roundLabelFor(game.question);
    html += `<div class="src-line">${escapeHtml(game.question.tournament)}${roundPart ? ' · ' + escapeHtml(roundPart) : ''}</div>`;
    box.innerHTML = html;
    box.style.display = 'block';
    if (revealCtl && !revealCtl.isDone()) revealCtl.skipToEnd();
    if (game.question.choices && r.letter) {
      const el = document.querySelector(`#mpChoicesDisplay .choice-box[data-letter="${r.letter}"]`);
      if (el) el.classList.add('reveal-correct');
    }
  }

  function updateMpBookmarkBtn() {
    const btn = document.getElementById('mpBookmarkBtn');
    if (!btn || !game.question) return;
    const isBm = SBData.bookmarks.isBookmarked(game.question.id);
    btn.textContent = isBm ? '★' : '☆';
    btn.classList.toggle('active', isBm);
    btn.title = isBm ? 'Unbookmark (B)' : 'Bookmark (B)';
    syncLogBookmarkStar(game.question.id, isBm);
  }
  // Keep a logged question's own star in sync with the main bookmark
  // button, in case the question is still current (its log entry already
  // exists) when the star gets toggled from up top instead of from the log.
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
  function toggleMpBookmark() {
    if (!game.question) return;
    SBData.bookmarks.toggle(game.question.id);
    updateMpBookmarkBtn();
  }

  /* ================= CHAT ================= */
  function renderChatAppend(entry) {
    const log = document.getElementById('mpChatLog');
    if (!log) return;
    const row = document.createElement('div');
    row.className = 'mp-chat-msg' + (entry.from === myState.myId ? ' me' : '');
    row.innerHTML = `<span class="who">${escapeHtml(entry.name)}:</span>${escapeHtml(entry.text)}`;
    log.appendChild(row);
    while (log.children.length > 200) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function sendChat(text) {
    text = (text || '').trim();
    if (!text) return;
    if (myState.role === 'host') {
      hostBroadcastChat('HOST', myState.myName, text);
    } else if (client) {
      client.send({ type: 'chatSend', text });
    }
  }

  /* ================= HOST-ONLY AUTHORITATIVE LOGIC ================= */
  let host = null;
  const hostGame = {
    queue: [], index: -1, phase: 'lobby',
    buzzedConnId: null, buzzedDuringReading: false, anyAttempt: false,
    lockedOutIds: new Set(),
    timer: null, remainingMs: 0, totalMs: 0, timerKind: null, onExpire: null,
    // Wall-clock anchor for the running timer (see hostRunTimer) - remainingMs
    // is derived from Date.now() vs. this anchor rather than trusted as a
    // running tally, so a throttled setInterval (backgrounded tab) can never
    // make it drift slow.
    timerAnchorAt: null, timerRemainingAtAnchor: 0,
    paused: false, lastGrade: null, currentFull: null,
    buzzwindowRemainingMs: null,
    // Per-player grade record for the CURRENT question only (cleared each
    // new question) - connId -> { correct, delta, userText, buzzedDuringReading }.
    // Lets any player who buzzed this question override their OWN answer
    // later, not just whoever happened to buzz last (the old single
    // hostGame.lastGrade slot could only ever represent one player).
    gradesByConn: new Map(),
    // Once true (someone's overridden their answer to correct), overriding
    // is locked for the rest of the question - the room already has its
    // winner for this one, so re-litigating other answers doesn't make sense.
    overrideLocked: false,
  };
  const hostPlayers = new Map();
  // Makes sure a newly (or re-)named player doesn't share a display name
  // with someone already in the room - most commonly two people both
  // leaving the name box blank and getting the "Player" default, but this
  // covers any exact-name collision the same way: "Player" becomes
  // "Player 2", a second "Player 2" becomes "Player 3", and so on.
  function uniqueName(desired, excludeConnId) {
    const taken = new Set();
    hostPlayers.forEach((p, id) => { if (id !== excludeConnId) taken.add(p.name); });
    if (!taken.has(desired)) return desired;
    let n = 2;
    while (taken.has(`${desired} ${n}`)) n++;
    return `${desired} ${n}`;
  }
  const hostChat = [];

  function createRoom() {
    let pool = getFiltered();
    if (!pool.length) { alert('No questions match your filters.'); return; }
    // Stratify by subject so every selected subject gets roughly equal turns
    // for the whole game, instead of subjects with more questions in the
    // pool dominating once a smaller subject's supply runs out.
    pool = SBData.stratifiedQueue(pool, (q) => q.subject);

    myState.role = 'host';
    myState.myId = 'HOST';
    myState.myName = document.getElementById('hostNameInput').value.trim() || 'Host';
    myState.rate = parseFloat(document.getElementById('mpRateSlider').value) || 1;

    hostGame.queue = pool;
    hostGame.index = -1;
    hostGame.phase = 'lobby';
    game.total = pool.length;
    game.log = [];
    hostPlayers.set('HOST', { id: 'HOST', name: myState.myName, score: 0, connId: 'HOST' });
    activeFilterState = {
      subjects: new Set(filterState.subjects), qtypes: new Set(filterState.qtypes), formats: new Set(filterState.formats), levels: new Set(filterState.levels),
      tournaments: new Set(filterState.tournaments), roundRange: filterState.roundRange, includeUnlabeled: filterState.includeUnlabeled,
    };

    host = SBPeer.makeHost({
      onPlayerMessage: handleHostMessage,
      onPlayerConnect: () => {},
      onPlayerDisconnect: (connId) => { hostPlayers.delete(connId); broadcastLobby(); },
      onError: (err) => { console.error('Room error:', err); },
    });

    host.ready.then((id) => {
      enterGameScreen();
      document.getElementById('mpRoomCodeDisplay').textContent = displayRoomCode(id);
      broadcastLobby();
      fullRenderFromState();
    }).catch((err) => {
      alert('Could not start the room.\n\n' + SBPeer.friendlyPeerError(err));
    });
  }

  function enterGameScreen() {
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('mpGameScreen').style.display = 'flex';
    // Room settings are editable by anyone in the room, not just the host -
    // shown here (reached by both createRoom() and joinRoom()) so it
    // appears for every role instead of only ever being revealed by the
    // host's own room-creation code path.
    document.getElementById('mpSettingsBtn').style.display = 'inline-flex';
  }

  function broadcastLobby() {
    game.players = [...hostPlayers.values()].map((p) => ({ id: p.id, name: p.name, score: p.score }));
    renderPlayerList(document.getElementById('mpPlayerList'));
    if (host) host.broadcast({ type: 'lobby', players: game.players, roomCode: host.roomCode });
  }

  function hostBroadcastChat(fromId, name, text) {
    const entry = { from: fromId, name, text: text.slice(0, 300), ts: Date.now() };
    hostChat.push(entry);
    while (hostChat.length > CHAT_HISTORY) hostChat.shift();
    if (host) host.broadcast({ type: 'chat', entry });
    renderChatAppend(entry);
  }

  // Lets every player (not just the host) seed the room-settings panel with
  // the room's real current filters/rate when they open it, and keeps that
  // local copy fresh afterward - sent whenever those filters actually
  // change (see hostApplySettingsFromValues) and folded into the sync
  // payload below for anyone who joins mid-game.
  function settingsStatePayload() {
    return {
      subjects: [...activeFilterState.subjects], qtypes: [...activeFilterState.qtypes], formats: [...activeFilterState.formats], levels: [...activeFilterState.levels],
      tournaments: [...activeFilterState.tournaments], roundRange: activeFilterState.roundRange, includeUnlabeled: activeFilterState.includeUnlabeled,
      rate: myState.rate,
    };
  }
  function broadcastSettingsState() {
    if (!host || !activeFilterState) return;
    host.broadcast({ type: 'settingsState', ...settingsStatePayload() });
  }

  function sendSyncTo(connId) {
    const full = hostGame.currentFull;
    host.sendTo(connId, {
      type: 'sync',
      index: hostGame.index, total: hostGame.queue.length,
      question: full ? sanitizeQuestion(full) : null,
      phase: hostGame.phase,
      buzzedPlayerId: hostGame.buzzedConnId,
      lockedOut: [...hostGame.lockedOutIds],
      scores: [...hostPlayers.values()].map((p) => ({ id: p.id, score: p.score })),
      log: game.log,
      paused: hostGame.paused,
      rate: myState.rate,
      settings: activeFilterState ? settingsStatePayload() : null,
      lastRevealData: hostGame.phase === 'reveal' ? game.lastRevealData : null,
      lastGrade: game.lastGrade,
      attempts: game.attempts,
      overrideLocked: hostGame.overrideLocked,
      chat: hostChat.slice(-CHAT_HISTORY),
    });
  }

  function handleHostMessage(connId, msg) {
    if (msg.type === 'join') {
      const isLate = hostGame.phase !== 'lobby' && hostGame.phase !== 'gameover';
      hostPlayers.set(connId, { id: connId, name: uniqueName((msg.name || 'Player').slice(0, 24)), score: 0, connId });
      broadcastLobby();
      if (isLate) {
        sendSyncTo(connId);
      } else if (activeFilterState) {
        // Not "late" (still in the lobby, before Start) - sendSyncTo isn't
        // called for this case, but the joiner still needs the room's
        // current settings the first time they open the settings panel.
        host.sendTo(connId, { type: 'settingsState', ...settingsStatePayload() });
      }
      return;
    }
    if (msg.type === 'buzz') { hostHandleBuzz(connId); return; }
    if (msg.type === 'submitAnswer') { hostHandleAnswer(connId, msg.text); return; }
    if (msg.type === 'typing') {
      if (connId !== hostGame.buzzedConnId) return;
      game.liveTypingText = msg.text; game.liveTypingFrom = connId;
      host.broadcast({ type: 'typing', playerId: connId, text: msg.text });
      renderBuzzStatus();
      return;
    }
    if (msg.type === 'chatSend') {
      const p = hostPlayers.get(connId);
      hostBroadcastChat(connId, p ? p.name : 'Player', msg.text);
      return;
    }
    if (msg.type === 'next') { if (hostGame.phase === 'reveal' || hostGame.phase === 'lobby') hostNextQuestion(); return; }
    if (msg.type === 'togglePause') { hostTogglePause(); return; }
    if (msg.type === 'skip') { hostSkipQuestion(); return; }
    if (msg.type === 'updateSettings') {
      hostApplySettingsFromValues({
        subjects: new Set(msg.subjects), qtypes: new Set(msg.qtypes), formats: new Set(msg.formats), levels: new Set(msg.levels), tournaments: new Set(msg.tournaments),
        roundRange: msg.roundRange, includeUnlabeled: msg.includeUnlabeled, rate: msg.rate,
      });
      return;
    }
    if (msg.type === 'override') { hostOverrideLastGrade(connId); return; }
  }

  function hostNextQuestion() {
    clearHostTimer();
    hostGame.index++;
    hostGame.buzzedConnId = null;
    hostGame.anyAttempt = false;
    hostGame.lockedOutIds = new Set();
    hostGame.lastGrade = null;
    hostGame.gradesByConn = new Map();
    hostGame.overrideLocked = false;
    game.overrideLocked = false;
    hostGame.buzzwindowRemainingMs = null;
    game.lastRevealData = null;
    game.liveTypingText = ''; game.liveTypingFrom = null;

    if (hostGame.index >= hostGame.queue.length) {
      hostGame.phase = 'gameover';
      const scores = [...hostPlayers.values()].map((p) => ({ id: p.id, name: p.name, score: p.score }));
      host.broadcast({ type: 'gameover', scores });
      applyGameOverLocal(scores);
      return;
    }
    const full = hostGame.queue[hostGame.index];
    hostGame.currentFull = full;
    const sanitized = sanitizeQuestion(full);
    hostGame.phase = 'reading';
    host.broadcast({ type: 'question', index: hostGame.index, total: hostGame.queue.length, question: sanitized, rate: myState.rate });
    applyQuestionLocal(hostGame.index, hostGame.queue.length, sanitized);

    startLocalReveal(sanitized, false, () => hostStartBuzzWindow());
  }

  function hostStartBuzzWindow() {
    if (hostGame.phase !== 'reading') return;
    hostGame.phase = 'buzzwindow';
    host.broadcast({ type: 'phase', phase: 'buzzwindow' });
    applyPhaseLocal('buzzwindow');
    const full = hostGame.currentFull;
    const ms = full.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
    hostRunTimer(ms, 'buzz', () => hostReveal());
  }

  function hostHandleBuzz(connId) {
    if (hostGame.phase !== 'reading' && hostGame.phase !== 'buzzwindow') return;
    if (hostGame.lockedOutIds.has(connId) || hostGame.buzzedConnId) return;
    hostGame.buzzedDuringReading = hostGame.phase === 'reading';
    // If this buzz interrupted the buzz-in countdown (not the reading), bank
    // whatever time was left on it so a wrong answer can resume from there
    // instead of restarting the whole countdown from full duration.
    if (hostGame.phase === 'buzzwindow') {
      hostGame.buzzwindowRemainingMs = hostGame.remainingMs;
    }
    hostGame.buzzedConnId = connId;
    hostGame.anyAttempt = true;
    hostGame.phase = 'answering';
    clearHostTimer();
    // Pause (not stop) the reveal — if this buzz is wrong, the rest of the
    // question should keep being revealed for the remaining field.
    if (revealCtl && !revealCtl.isDone()) revealCtl.pause();
    game.liveTypingText = ''; game.liveTypingFrom = null;
    const p = hostPlayers.get(connId);
    host.broadcast({ type: 'buzzAccepted', playerId: connId, playerName: p ? p.name : '?' });
    applyBuzzLocal(connId);
    // If the answer timer runs out, submit whatever they'd typed so far
    // instead of forcing a blank - game.liveTypingText tracks their latest
    // known input for exactly this buzzed player throughout the countdown.
    hostRunTimer(ANSWER_MS, 'answer', () => {
      const pendingText = game.liveTypingFrom === connId ? game.liveTypingText : '';
      hostHandleAnswer(connId, pendingText);
    });
  }

  function hostHandleAnswer(connId, text) {
    if (hostGame.phase !== 'answering' || connId !== hostGame.buzzedConnId) return;
    clearHostTimer();
    const full = hostGame.currentFull;
    const result = text.trim() ? SBAnswer.checkAnswer(full, text) : { correct: false };
    hostApplyGrade(connId, result.correct, text);
  }

  function hostApplyGrade(connId, correct, userText) {
    const p = hostPlayers.get(connId);
    let delta = 0;
    if (correct) {
      delta = 4; if (p) p.score += 4;
    } else {
      delta = hostGame.buzzedDuringReading ? -4 : 0;
      if (p) p.score += delta;
      hostGame.lockedOutIds.add(connId);
    }
    hostGame.lastGrade = { connId, correct, delta, userText };
    // Remember this player's own grade (and the buzz-timing context that
    // determines their incorrect-answer penalty) keyed by connId, not just
    // as "the" last grade - so they can still override THEIR OWN answer
    // later even after someone else has buzzed and been graded too.
    hostGame.gradesByConn.set(connId, { correct, delta, userText, buzzedDuringReading: hostGame.buzzedDuringReading });
    const scores = [...hostPlayers.values()].map((pp) => ({ id: pp.id, score: pp.score }));
    host.broadcast({ type: 'graded', playerId: connId, correct, delta, userText, scores });
    applyGradeLocal(connId, correct, delta, scores, userText);

    if (correct) {
      hostReveal();
      return;
    }
    const remaining = [...hostPlayers.keys()].filter((id) => !hostGame.lockedOutIds.has(id));
    hostGame.buzzedConnId = null;
    game.liveTypingText = ''; game.liveTypingFrom = null;
    if (!remaining.length) {
      hostReveal();
      return;
    }
    const canResumeReading = hostGame.buzzedDuringReading && revealCtl && !revealCtl.isDone();
    if (canResumeReading) {
      // CRITICAL FIX: an incorrect buzz mid-reading must not silently end the
      // question — resume revealing the rest of it for whoever's left.
      hostGame.phase = 'reading';
      host.broadcast({ type: 'phase', phase: 'reading', lockedOut: [...hostGame.lockedOutIds] });
      applyPhaseLocal('reading', [...hostGame.lockedOutIds]);
      revealCtl.resume();
    } else {
      hostGame.phase = 'buzzwindow';
      host.broadcast({ type: 'phase', phase: 'buzzwindow', lockedOut: [...hostGame.lockedOutIds] });
      applyPhaseLocal('buzzwindow', [...hostGame.lockedOutIds]);
      const full = hostGame.currentFull;
      const fullDurationMs = full.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
      // Resume the buzz-in countdown from where it was interrupted, rather
      // than restarting the whole question's buzz window at full duration.
      const ms = hostGame.buzzwindowRemainingMs != null
        ? hostGame.buzzwindowRemainingMs
        : fullDurationMs;
      hostGame.buzzwindowRemainingMs = null;
      // Pass the ORIGINAL full duration as the bar's 100% reference (see
      // hostRunTimer) so picking up with, say, 12 of 20 seconds left shows a
      // partially-drained bar - the portion already spent before the first
      // buzz stays visibly "empty" - instead of rendering as a fresh full bar.
      hostRunTimer(ms, 'buzz', () => hostReveal(), fullDurationMs);
    }
  }

  function hostOverrideLastGrade(requesterConnId) {
    // Once someone's been overridden to correct, the room has its answer
    // for this question - no more re-litigating other players' attempts.
    if (hostGame.overrideLocked) return;
    // Anyone who buzzed (and was graded) THIS question can override their
    // OWN answer, whether or not they were the last one to buzz - looked up
    // by connId now rather than assuming it's whoever's in the single
    // "last grade" slot, which could only ever represent one player. The
    // override button/shortcut is only ever shown for your own graded
    // answer (see fullRenderFromState), but a message straight from a
    // client could still claim someone else's, so enforce it here too.
    const g = hostGame.gradesByConn.get(requesterConnId);
    if (!g) return;
    const p = hostPlayers.get(requesterConnId);
    if (p) p.score -= g.delta;
    const nowCorrect = !g.correct;
    let delta = 0;
    if (nowCorrect) {
      delta = 4;
    } else {
      // Use THIS attempt's own buzz-timing context (captured when it was
      // originally graded), not whatever the most recent buzz happened to
      // be - otherwise overriding an earlier player's answer could apply
      // the wrong player's reading/buzz-window penalty.
      delta = g.buzzedDuringReading ? -4 : 0;
      hostGame.lockedOutIds.add(requesterConnId);
    }
    if (p) p.score += delta;
    const updated = { ...g, correct: nowCorrect, delta };
    hostGame.gradesByConn.set(requesterConnId, updated);
    hostGame.lastGrade = { connId: requesterConnId, correct: nowCorrect, delta, userText: g.userText };
    if (nowCorrect) hostGame.overrideLocked = true;
    game.overrideLocked = hostGame.overrideLocked;
    const scores = [...hostPlayers.values()].map((pp) => ({ id: pp.id, score: pp.score }));
    host.broadcast({ type: 'graded', playerId: requesterConnId, correct: nowCorrect, delta, userText: g.userText, scores, override: true, overrideLocked: hostGame.overrideLocked });
    applyGradeLocal(requesterConnId, nowCorrect, delta, scores, g.userText, true, hostGame.overrideLocked);
    if (game.log.length) game.log[0].category = nowCorrect ? 'correct' : 'incorrect';
    host.broadcast({ type: 'logUpdate', log: game.log });
    if (nowCorrect && hostGame.phase !== 'reveal') hostReveal();
    fullRenderFromState();
  }

  function hostReveal() {
    clearHostTimer();
    hostGame.phase = 'reveal';
    const full = hostGame.currentFull;
    const revealData = {
      // Prefer the MC choice's own full text over the separate answer-text
      // field, which is sometimes truncated in the source data - see
      // SBData.answerDisplayText.
      answerText: SBData.answerDisplayText(full), letter: full.answer.letter || null,
      accept: full.answer.accept, reject: full.answer.reject,
    };
    const grade = hostGame.lastGrade;
    const category = grade && grade.correct ? 'correct' : (hostGame.anyAttempt ? 'incorrect' : 'skipped');
    const answeredByPlayer = grade ? hostPlayers.get(grade.connId) : null;
    const logEntry = {
      question: sanitizeQuestion(full),
      answer: revealData,
      category,
      answeredBy: answeredByPlayer ? answeredByPlayer.name : null,
      userText: grade ? grade.userText : null,
    };
    game.log.unshift(logEntry);
    host.broadcast({ type: 'reveal', ...revealData, logEntry });
    applyRevealLocal(revealData);
  }

  function hostRunTimer(ms, kind, onExpire, displayTotalMs) {
    clearHostTimer();
    // displayTotalMs lets a resumed countdown (e.g. the buzz window picking
    // back up after a wrong answer) keep the bar's 100%-width reference at
    // the ORIGINAL full duration, rather than at just what's left. Without
    // this, resuming with (say) 12s left of a 20s window reset the bar's own
    // notion of "full" to 12s, so it rendered as a full bar instead of a
    // partially-drained one - it looked like a fresh countdown instead of a
    // pickup, hiding how much time had already been spent before the buzz.
    hostGame.totalMs = displayTotalMs != null ? displayTotalMs : ms;
    hostGame.remainingMs = ms; hostGame.timerKind = kind; hostGame.onExpire = onExpire;
    // Anchored to the wall clock (Date.now()), not to a running tally
    // decremented by a fixed 100ms per interval firing. A backgrounded /
    // inactive browser tab throttles setInterval - sometimes to once a
    // second or slower - and the old fixed-decrement approach assumed every
    // firing represented exactly 100ms of real time, so the host's own
    // countdown (and every tick it broadcasts) ran far too SLOW while its
    // tab was in the background. A non-host client interpolates smoothly
    // between ticks based on its own real elapsed time (see onClientTick),
    // so when one of those too-slow ticks finally arrived, it reported a
    // remaining time much HIGHER than what the client had already counted
    // down to on its own - the timer visibly jumping back up, exactly the
    // reported bug. Computing remainingMs from actual elapsed time instead
    // means every tick, however late it fires, reports the true remaining
    // time - it can only ever count down for a client, never jump up.
    hostGame.timerRemainingAtAnchor = ms;
    hostGame.timerAnchorAt = Date.now();
    host.broadcast({ type: 'tick', remainingMs: ms, totalMs: hostGame.totalMs, kind });
    applyTickLocal(ms, hostGame.totalMs, kind);
    hostGame.timer = setInterval(() => {
      if (hostGame.paused) return;
      const elapsed = Date.now() - hostGame.timerAnchorAt;
      hostGame.remainingMs = Math.max(0, hostGame.timerRemainingAtAnchor - elapsed);
      if (hostGame.remainingMs <= 0) {
        hostGame.remainingMs = 0;
        host.broadcast({ type: 'tick', remainingMs: 0, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
        applyTickLocal(0, hostGame.totalMs, hostGame.timerKind);
        clearInterval(hostGame.timer); hostGame.timer = null;
        const fn = hostGame.onExpire; hostGame.onExpire = null;
        if (fn) fn();
        return;
      }
      applyTickLocal(hostGame.remainingMs, hostGame.totalMs, hostGame.timerKind);
      // Broadcast on every firing (rather than every other one, as before)
      // - when the tab is throttled, firings are already sparse, and this
      // is exactly when corrections need to reach clients as soon as they
      // can, not be held back further by a cadence check on top of that.
      host.broadcast({ type: 'tick', remainingMs: hostGame.remainingMs, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
    }, 100);
  }
  function clearHostTimer() {
    if (hostGame.timer) clearInterval(hostGame.timer);
    hostGame.timer = null; hostGame.onExpire = null;
  }

  function hostTogglePause() {
    if (hostGame.phase === 'lobby' || hostGame.phase === 'gameover') return;
    hostGame.paused = !hostGame.paused;
    game.paused = hostGame.paused;
    // Send the pause/resume flag itself before the tick below, so by the
    // time a client applies that tick it already knows whether to hold it
    // frozen or keep counting down from it.
    host.broadcast({ type: 'pauseState', paused: hostGame.paused });
    if (hostGame.timer) {
      if (hostGame.paused) {
        // Freeze the running timer's remaining time at this instant, so the
        // wall-clock-anchored countdown in hostRunTimer doesn't keep
        // counting down against Date.now() while paused.
        const elapsed = Date.now() - hostGame.timerAnchorAt;
        hostGame.timerRemainingAtAnchor = Math.max(0, hostGame.timerRemainingAtAnchor - elapsed);
        hostGame.remainingMs = hostGame.timerRemainingAtAnchor;
      } else {
        // Resuming: re-anchor to now, keeping the frozen remaining value.
        hostGame.timerAnchorAt = Date.now();
      }
      // The interval that normally drives ticks skips its body entirely
      // while paused (see hostRunTimer), so nothing pushes the freshly
      // frozen value out on its own. Push one now so the host's own render
      // and every client's game.lastTick reflect the frozen time right
      // away, instead of showing whatever was last ticked up to 100ms ago.
      host.broadcast({ type: 'tick', remainingMs: hostGame.remainingMs, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
      applyTickLocal(hostGame.remainingMs, hostGame.totalMs, hostGame.timerKind);
    }
    if (revealCtl && hostGame.phase === 'reading') {
      if (hostGame.paused) revealCtl.pause(); else revealCtl.resume();
    }
    fullRenderFromState();
  }

  // Anyone can skip a question that's still being read / open for buzzing
  // (not once someone's actively answering) - jumps straight to reveal with
  // no grade, same as the timer naturally expiring with nobody buzzing in.
  function hostSkipQuestion() {
    if (hostGame.phase !== 'reading' && hostGame.phase !== 'buzzwindow') return;
    hostReveal();
  }

  /* ---- host applies its own broadcasts to its local render state (host is also a player) ---- */
  // A small fade/slide-in on the whole question panel each time a new
  // question comes up (same treatment as solo practice) - shared by both
  // the host and clients since both funnel through applyQuestionLocal
  // below. Re-triggering the same CSS class doesn't restart its animation
  // on its own - removing the class, forcing a reflow (reading
  // offsetWidth), then re-adding it is what makes it replay every time.
  function playQuestionTransition() {
    const panel = document.querySelector('.question-panel');
    if (!panel) return;
    panel.classList.remove('q-panel-enter');
    void panel.offsetWidth;
    panel.classList.add('q-panel-enter');
  }

  function applyQuestionLocal(index, total, sanitized) {
    game.index = index; game.total = total; game.question = sanitized;
    game.phase = 'reading'; game.buzzedPlayerId = null; game.lockedOut = new Set();
    game.lastGrade = null; game.attempts = [];
    game.overrideLocked = false;
    // A new question is starting - make sure the chat box isn't still
    // holding keyboard focus, so buzz/keyboard shortcuts work immediately
    // without the player having to click away from chat first.
    const chatInput = document.getElementById('mpChatInput');
    if (chatInput && document.activeElement === chatInput) chatInput.blur();
    playQuestionTransition();
    fullRenderFromState();
  }
  function applyPhaseLocal(phase, lockedOut) {
    game.phase = phase;
    if (lockedOut) game.lockedOut = new Set(lockedOut);
    game.buzzedPlayerId = null;
    fullRenderFromState();
  }
  function applyBuzzLocal(playerId) {
    game.buzzedPlayerId = playerId; game.phase = 'answering';
    fullRenderFromState();
  }
  function applyGradeLocal(playerId, correct, delta, scores, userText, isOverride, overrideLocked) {
    scores.forEach((s) => { const pl = game.players.find((p) => p.id === s.id); if (pl) pl.score = s.score; });
    if (!correct) game.lockedOut.add(playerId);
    game.lastGrade = { playerId, correct, userText };
    if (overrideLocked !== undefined) game.overrideLocked = !!overrideLocked;
    // Find THIS player's own attempt row to update, rather than assuming an
    // override always targets whichever attempt happens to be last in the
    // list - a player who buzzed earlier (not last) can now override their
    // own answer too, and each player has at most one attempt per question.
    const existing = isOverride ? game.attempts.find((a) => a.playerId === playerId) : null;
    if (existing) {
      existing.correct = correct;
    } else {
      const p = game.players.find((pp) => pp.id === playerId);
      game.attempts.push({ playerId, playerName: p ? p.name : '?', userText, correct });
    }
    renderPlayerList(document.getElementById('mpPlayerList'));
    renderBuzzStatus();
  }
  function applyRevealLocal(revealData) {
    game.phase = 'reveal'; game.lastRevealData = revealData;
    fullRenderFromState();
  }
  function applyTickLocal(remainingMs, totalMs, kind) {
    game.lastTick = { remainingMs, totalMs, kind };
    renderTick(remainingMs, totalMs, kind);
  }
  function applyGameOverLocal(scores) {
    document.getElementById('mpGameScreen').style.display = 'none';
    document.getElementById('mpSummaryScreen').style.display = 'block';
    const el = document.getElementById('mpFinalScores');
    el.innerHTML = '';
    scores.slice().sort((a, b) => b.score - a.score).forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'mp-player-row';
      row.innerHTML = `<span class="name">${i === 0 ? '🏆 ' : ''}${escapeHtml(p.name)}</span><span class="pts">${p.score}</span>`;
      el.appendChild(row);
    });
  }

  /* ================= CLIENT (joiner) LOGIC ================= */
  let client = null;
  function joinRoom() {
    // The visible room code is always uppercase (see displayRoomCode/
    // randomRoomCode), so capitalize whatever was typed before connecting -
    // typing "xfts2" should still reach room "XFTS2" instead of being
    // treated as a different, nonexistent code. Strip a pasted "sbowl-"
    // prefix case-insensitively first (ROOM_PREFIX itself is lowercase)
    // so the canonical lowercase prefix always gets re-added exactly once.
    let codeRaw = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (codeRaw.toLowerCase().startsWith(ROOM_PREFIX)) codeRaw = codeRaw.slice(ROOM_PREFIX.length);
    const code = ROOM_PREFIX + codeRaw;
    const name = document.getElementById('joinNameInput').value.trim() || 'Player';
    const joinStatusEl = document.getElementById('joinStatus');
    if (!codeRaw) { joinStatusEl.textContent = 'Enter a room code.'; joinStatusEl.classList.remove('status-error'); return; }
    myState.role = 'client';
    myState.myName = name;
    joinStatusEl.textContent = 'Connecting…';
    joinStatusEl.classList.remove('status-error');

    client = SBPeer.makeClient(code, {
      onHostMessage: handleClientMessage,
      onDisconnect: () => { alert('Disconnected from host.'); location.reload(); },
      onError: (err) => { console.error('Join error:', err); },
    });
    client.ready.then(() => {
      myState.myId = client.peer.id;
      client.send({ type: 'join', name });
      enterGameScreen();
      document.getElementById('mpRoomCodeDisplay').textContent = displayRoomCode(code);
      fullRenderFromState();
    }).catch((err) => {
      joinStatusEl.textContent = SBPeer.friendlyPeerError(err);
      joinStatusEl.classList.add('status-error');
    });
  }

  function handleClientMessage(msg) {
    if (msg.type === 'lobby') {
      game.players = msg.players;
      renderPlayerList(document.getElementById('mpPlayerList'));
      return;
    }
    if (msg.type === 'sync') {
      // Joined mid-game: catch up instantly instead of sitting on a waiting screen.
      game.index = msg.index; game.total = msg.total; game.question = msg.question;
      game.phase = msg.phase; game.buzzedPlayerId = msg.buzzedPlayerId;
      game.lockedOut = new Set(msg.lockedOut || []);
      game.paused = msg.paused;
      game.log = msg.log || [];
      game.lastRevealData = msg.lastRevealData || null;
      game.lastGrade = msg.lastGrade || null;
      game.attempts = msg.attempts || [];
      game.overrideLocked = !!msg.overrideLocked;
      game.liveTypingText = ''; game.liveTypingFrom = null;
      myState.rate = msg.rate || 1;
      if (msg.settings) applySettingsStateLocal(msg.settings);
      const chatLog = document.getElementById('mpChatLog');
      if (chatLog) chatLog.innerHTML = '';
      (msg.chat || []).forEach(renderChatAppend);
      if (msg.scores) {
        msg.scores.forEach((s) => { const pl = game.players.find((p) => p.id === s.id); if (pl) pl.score = s.score; });
      }
      if (game.question) startLocalReveal(game.question, true);
      fullRenderFromState();
      return;
    }
    if (msg.type === 'question') {
      game.index = msg.index; game.total = msg.total; game.question = msg.question;
      game.phase = 'reading'; game.buzzedPlayerId = null; game.lockedOut = new Set();
      game.liveTypingText = ''; game.liveTypingFrom = null;
      game.lastGrade = null; game.attempts = [];
      game.overrideLocked = false;
      myState.rate = msg.rate || 1;
      playQuestionTransition();
      fullRenderFromState();
      startLocalReveal(msg.question, false);
      return;
    }
    if (msg.type === 'phase') {
      game.phase = msg.phase;
      if (msg.lockedOut) game.lockedOut = new Set(msg.lockedOut);
      game.buzzedPlayerId = null;
      if (msg.phase === 'reading') {
        if (revealCtl && revealCtl.isPaused()) revealCtl.resume();
      } else if (revealCtl && !revealCtl.isDone()) {
        // The reading window is over one way or another — make sure the full
        // text is showing, regardless of any local animation drift (this is
        // also what keeps a backgrounded/throttled tab from looking stuck).
        revealCtl.skipToEnd();
      }
      fullRenderFromState();
      return;
    }
    if (msg.type === 'buzzAccepted') {
      game.buzzedPlayerId = msg.playerId; game.phase = 'answering';
      game.liveTypingText = ''; game.liveTypingFrom = null;
      if (revealCtl && !revealCtl.isDone()) revealCtl.pause();
      fullRenderFromState();
      return;
    }
    if (msg.type === 'typing') {
      game.liveTypingText = msg.text; game.liveTypingFrom = msg.playerId;
      renderBuzzStatus();
      return;
    }
    if (msg.type === 'chat') {
      renderChatAppend(msg.entry);
      return;
    }
    if (msg.type === 'graded') {
      msg.scores.forEach((s) => { const pl = game.players.find((p) => p.id === s.id); if (pl) pl.score = s.score; });
      if (!msg.correct) game.lockedOut.add(msg.playerId);
      game.lastGrade = { playerId: msg.playerId, correct: msg.correct, userText: msg.userText };
      if (msg.overrideLocked !== undefined) game.overrideLocked = !!msg.overrideLocked;
      // Update THIS player's own attempt row specifically - an override can
      // now target any earlier attempt, not just whichever one is last.
      const existing = msg.override ? game.attempts.find((a) => a.playerId === msg.playerId) : null;
      if (existing) {
        existing.correct = msg.correct;
      } else {
        const p = game.players.find((pp) => pp.id === msg.playerId);
        game.attempts.push({ playerId: msg.playerId, playerName: p ? p.name : '?', userText: msg.userText, correct: msg.correct });
      }
      renderPlayerList(document.getElementById('mpPlayerList'));
      renderBuzzStatus();
      if (game.phase === 'reveal') showReveal();
      return;
    }
    if (msg.type === 'reveal') {
      game.phase = 'reveal'; game.lastRevealData = msg;
      if (msg.logEntry) game.log.unshift(msg.logEntry);
      fullRenderFromState();
      return;
    }
    if (msg.type === 'logUpdate') {
      game.log = msg.log;
      renderQuestionLog();
      return;
    }
    if (msg.type === 'tick') {
      onClientTick(msg.remainingMs, msg.totalMs, msg.kind);
      return;
    }
    if (msg.type === 'pauseState') {
      game.paused = msg.paused;
      if (revealCtl) { if (game.paused) revealCtl.pause(); else revealCtl.resume(); }
      setClientTickPaused(game.paused);
      fullRenderFromState();
      return;
    }
    if (msg.type === 'gameover') {
      applyGameOverLocal(msg.scores);
      return;
    }
    if (msg.type === 'settingsState') {
      applySettingsStateLocal(msg);
      // If the settings panel is open right now, refresh what it's showing
      // so a change someone else just made (or the room's real settings,
      // the first time this arrives) doesn't sit stale behind it.
      if (document.getElementById('mpSettingsOverlay').style.display !== 'none') {
        midGameFilterState.subjects = new Set(activeFilterState.subjects);
        midGameFilterState.qtypes = new Set(activeFilterState.qtypes);
        midGameFilterState.formats = new Set(activeFilterState.formats);
        midGameFilterState.levels = new Set(activeFilterState.levels);
        midGameFilterState.tournaments = new Set(activeFilterState.tournaments);
        midGameFilterState.roundRange = activeFilterState.roundRange;
        midGameFilterState.includeUnlabeled = activeFilterState.includeUnlabeled;
        refreshSettingsPanelFromState();
      }
      return;
    }
  }

  // Keeps this client's local mirror of the room's settings (activeFilterState
  // + myState.rate) in sync with whatever the host last broadcast - used for
  // both the 'settingsState' message and the 'settings' field folded into
  // 'sync'. The host is the only one who ever actually recomputes the
  // question queue from these values (see hostApplySettingsFromValues); this
  // is just every other client's read-only copy, kept fresh so their own
  // settings panel always seeds from the room's real current values instead
  // of stale or default ones.
  function applySettingsStateLocal(s) {
    activeFilterState = {
      subjects: new Set(s.subjects), qtypes: new Set(s.qtypes), formats: new Set(s.formats), levels: new Set(s.levels),
      tournaments: new Set(s.tournaments), roundRange: s.roundRange, includeUnlabeled: s.includeUnlabeled,
    };
    myState.rate = s.rate || 1;
    // Live-apply to whatever's currently typing itself onto the screen, not
    // just the next question, so "change speed mid-question" actually works.
    if (revealCtl && !revealCtl.isDone()) revealCtl.setRate(myState.rate);
  }

  /* ================= SHARED ACTIONS ================= */
  function doBuzz() {
    if (game.paused) return;
    if (game.phase !== 'reading' && game.phase !== 'buzzwindow') return;
    if (game.lockedOut.has(myState.myId)) return;
    if (myState.role === 'host') hostHandleBuzz('HOST');
    else client.send({ type: 'buzz' });
  }
  function doSubmitAnswer(text) {
    if (game.phase !== 'answering' || game.buzzedPlayerId !== myState.myId) return;
    if (myState.role === 'host') hostHandleAnswer('HOST', text);
    else client.send({ type: 'submitAnswer', text });
  }
  function doNext() {
    if (game.phase !== 'reveal' && game.phase !== 'lobby') return;
    if (myState.role === 'host') hostNextQuestion();
    else client.send({ type: 'next' });
  }
  function doSkip() {
    if (game.phase !== 'reading' && game.phase !== 'buzzwindow') return;
    if (myState.role === 'host') hostSkipQuestion();
    else client.send({ type: 'skip' });
  }
  function handleNextBtn() {
    const mode = document.getElementById('mpNextBtn').dataset.mode;
    if (mode === 'skip') doSkip();
    else doNext();
  }
  function doTogglePause() {
    if (myState.role === 'host') hostTogglePause();
    else client.send({ type: 'togglePause' });
  }
  function doOverride() {
    // Anyone who buzzed this question can override their own graded
    // answer, whenever it happened - the button/shortcut is only ever
    // shown when you have an attempt this question and nobody's overridden
    // to correct yet (see fullRenderFromState), and hostOverrideLastGrade()
    // enforces the same restrictions again on the host side for a message
    // sent straight over the wire.
    if (myState.role === 'host') hostOverrideLastGrade('HOST');
    else if (client) client.send({ type: 'override' });
  }

  let typingThrottled = false;
  let pendingTypingText = null;
  function sendTypingUpdate(text) {
    if (myState.role === 'host') {
      game.liveTypingText = text; game.liveTypingFrom = 'HOST';
      host.broadcast({ type: 'typing', playerId: 'HOST', text });
    } else if (client) {
      client.send({ type: 'typing', text });
    }
  }
  function doTypingInput(text) {
    if (game.phase !== 'answering' || game.buzzedPlayerId !== myState.myId) return;
    if (typingThrottled) {
      // Don't just drop this keystroke - previously an update mid-cooldown
      // was silently dropped forever (until the *next* keystroke happened
      // to land outside the window), which is exactly why what others saw
      // could lag behind or never catch up to what was actually typed.
      // Bank the latest text and flush it the moment the cooldown ends.
      pendingTypingText = text;
      return;
    }
    typingThrottled = true;
    sendTypingUpdate(text);
    setTimeout(() => {
      typingThrottled = false;
      if (pendingTypingText !== null) {
        const t = pendingTypingText;
        pendingTypingText = null;
        doTypingInput(t);
      }
    }, TYPING_THROTTLE_MS);
  }

  /* ================= IN-GAME ROOM SETTINGS (host only) ================= */
  const midGameFilterState = { subjects: new Set(), qtypes: new Set(), formats: new Set(), levels: new Set(), tournaments: new Set(), roundRange: null, includeUnlabeled: true };
  let midGameSubjectItems, midGameQtypeItems, midGameFormatItems, midGameLevelItems, midGameRoundSliderApi, midGameSettingsWired = false;
  // Set for the duration of any programmatic repaint of the settings panel
  // FROM already-authoritative state (refreshSettingsPanelFromState, below)
  // - as opposed to a real edit the person watching the panel just made.
  // The round-range slider's setRange() unconditionally re-fires its
  // onChange callback even when the values aren't actually changing, and
  // that callback calls requestApplySettings() same as a real drag would.
  // Without this guard, a repaint triggered by an incoming 'settingsState'
  // message would immediately send right back out as an 'updateSettings'
  // message, which comes back as another 'settingsState', which repaints
  // again, forever - a feedback loop between host and client (or between
  // two clients) that a real drag never causes, since nothing repaints the
  // panel while the person is mid-drag on their own slider.
  let suppressSettingsApplyEcho = false;

  function updateMidGameMatchCount() {
    document.getElementById('mpSettingsMatchCount').textContent =
      `${filterQuestionsFor(midGameFilterState).length.toLocaleString()} questions match your filters`;
  }

  function initMidGameSettings() {
    if (midGameSettingsWired) return;
    midGameSettingsWired = true;

    midGameSubjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
    midGameQtypeItems = SBData.meta.qtypes.map((q) => ({ value: q, label: QTYPE_LABELS[q] || q }));
    midGameFormatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
    midGameLevelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));

    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    midGameRoundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('mpSettingsRoundMin'),
      maxInput: document.getElementById('mpSettingsRoundMax'),
      fillEl: document.getElementById('mpSettingsRoundSliderFill'),
      labelEl: document.getElementById('mpSettingsRoundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { midGameFilterState.roundRange = [lo, hi]; updateMidGameMatchCount(); requestApplySettings(); },
    });
    document.getElementById('mpSettingsIncludeUnlabeledRounds').addEventListener('change', (e) => {
      midGameFilterState.includeUnlabeled = e.target.checked;
      updateMidGameMatchCount();
      requestApplySettings();
    });

    const tSelect = document.getElementById('mpSettingsTournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug; opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => { midGameFilterState.tournaments = new Set(tSelect.getMultiValues()); updateMidGameMatchCount(); requestApplySettings(); });
    SBData.enhanceMultiSelect(tSelect);

    document.getElementById('mpSettingsClearBtn').addEventListener('click', () => {
      [[midGameSubjectItems, 'subjects'], [midGameQtypeItems, 'qtypes'], [midGameFormatItems, 'formats'], [midGameLevelItems, 'levels']].forEach(([items, key]) => {
        midGameFilterState[key].clear();
        items.forEach((i) => i._el.classList.remove('active'));
      });
      midGameFilterState.tournaments.clear();
      tSelect.setMultiValues([]);
      if (midGameRoundSliderApi) midGameRoundSliderApi.reset();
      document.getElementById('mpSettingsIncludeUnlabeledRounds').checked = true;
      midGameFilterState.includeUnlabeled = true;
      updateMidGameMatchCount();
      requestApplySettings();
    });

    const rateSlider = document.getElementById('mpSettingsRateSlider');
    SBData.wireRangeFill(rateSlider);
    rateSlider.addEventListener('input', () => {
      document.getElementById('mpSettingsRateValue').textContent = parseFloat(rateSlider.value).toFixed(1) + '×';
      requestApplySettings();
    });

    document.getElementById('mpSettingsDoneBtn').addEventListener('click', closeSettingsPanel);
    document.getElementById('mpSettingsCloseBtn').addEventListener('click', closeSettingsPanel);
    // Click on the dimmed backdrop (not the panel itself) closes the modal.
    document.getElementById('mpSettingsOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'mpSettingsOverlay') closeSettingsPanel();
    });
  }

  function openSettingsPanel() {
    // Room settings are editable by anyone in the room, not just the host -
    // activeFilterState is kept as a live mirror of the room's real
    // settings for every role (the host sets it directly; a client fills it
    // in from the 'settingsState'/'sync' messages - see handleClientMessage),
    // so there's nothing host-specific left to gate here.
    if (!activeFilterState) return;
    const snapshot = {
      subjects: new Set(activeFilterState.subjects),
      qtypes: new Set(activeFilterState.qtypes),
      formats: new Set(activeFilterState.formats), levels: new Set(activeFilterState.levels),
      tournaments: new Set(activeFilterState.tournaments),
      roundRange: activeFilterState.roundRange,
      includeUnlabeled: activeFilterState.includeUnlabeled,
    };
    // Seed every control this panel's wiring can eagerly read from - not
    // just midGameFilterState, but the rate slider's raw DOM value too -
    // *before* initMidGameSettings() runs. That function only wires its
    // controls once ever, the first time ANYONE opens this panel, and part
    // of that one-time wiring - the round-range slider's constructor -
    // eagerly fires its onChange callback, which calls requestApplySettings().
    // That reads midGameFilterState directly, but reads the reveal-speed
    // rate straight off the <input> element (see requestApplySettings), so
    // if that element is still sitting at its HTML default of 1.0 at this
    // instant, the very first settings-panel open of the session would
    // silently reset everyone's reveal speed to 1.0 - previously true for
    // the host (who alone could open this panel) and now, since anyone can
    // trigger it and it goes out live over the network, for the room's
    // real settings too. Setting the slider's value here first closes that
    // gap for both the host's own local apply and a client's live message.
    midGameFilterState.subjects = new Set(snapshot.subjects);
    midGameFilterState.qtypes = new Set(snapshot.qtypes);
    midGameFilterState.formats = new Set(snapshot.formats);
    midGameFilterState.levels = new Set(snapshot.levels);
    midGameFilterState.tournaments = new Set(snapshot.tournaments);
    midGameFilterState.roundRange = snapshot.roundRange;
    midGameFilterState.includeUnlabeled = snapshot.includeUnlabeled;
    document.getElementById('mpSettingsRateSlider').value = myState.rate;
    initMidGameSettings();
    // Defensive re-assert: harmless no-op unless the eager wiring above
    // somehow changed activeFilterState (it shouldn't, now that everything
    // it can read from is seeded with real values first, but this keeps
    // midGameFilterState/activeFilterState in lockstep regardless).
    activeFilterState = {
      subjects: new Set(snapshot.subjects), qtypes: new Set(snapshot.qtypes), formats: new Set(snapshot.formats), levels: new Set(snapshot.levels),
      tournaments: new Set(snapshot.tournaments), roundRange: snapshot.roundRange, includeUnlabeled: snapshot.includeUnlabeled,
    };
    midGameFilterState.subjects = new Set(snapshot.subjects);
    midGameFilterState.qtypes = new Set(snapshot.qtypes);
    midGameFilterState.formats = new Set(snapshot.formats);
    midGameFilterState.levels = new Set(snapshot.levels);
    midGameFilterState.tournaments = new Set(snapshot.tournaments);
    midGameFilterState.roundRange = snapshot.roundRange;
    midGameFilterState.includeUnlabeled = snapshot.includeUnlabeled;

    refreshSettingsPanelFromState();
    document.getElementById('mpSettingsOverlay').style.display = 'flex';
  }

  // Repaints every control in the (already-open, or about-to-open) settings
  // panel from midGameFilterState/myState.rate - split out of
  // openSettingsPanel() so a live 'settingsState' update from someone else
  // can refresh the panel in place while it's sitting open, instead of only
  // ever being seeded once at open time.
  function refreshSettingsPanelFromState() {
    // The rate slider's value is set FIRST, before touching the round-range
    // slider below - setRange() re-fires that slider's onChange synchronously,
    // which (via requestApplySettings) reads the rate slider's live DOM
    // value, so that value must already be correct by the time it runs.
    const rateSlider = document.getElementById('mpSettingsRateSlider');
    rateSlider.value = myState.rate;
    if (rateSlider.refreshRangeFill) rateSlider.refreshRangeFill();
    document.getElementById('mpSettingsRateValue').textContent = parseFloat(myState.rate).toFixed(1) + '×';

    const onChipChange = () => { updateMidGameMatchCount(); requestApplySettings(); };
    // Everything in this repaint is being set FROM state that's already
    // authoritative (midGameFilterState/myState.rate), not from someone
    // interacting with the panel right now - suppressSettingsApplyEcho
    // stops the round-range slider's forced onChange (see setRange below)
    // from turning that repaint straight back into an outgoing settings
    // request (see the comment on its declaration for why that matters).
    suppressSettingsApplyEcho = true;
    try {
      buildChips(document.getElementById('mpSettingsSubjectChips'), midGameSubjectItems, midGameFilterState, 'subjects', (i) => i.label, onChipChange);
      buildChips(document.getElementById('mpSettingsQtypeChips'), midGameQtypeItems, midGameFilterState, 'qtypes', (i) => i.label, onChipChange);
      buildChips(document.getElementById('mpSettingsFormatChips'), midGameFormatItems, midGameFilterState, 'formats', (i) => i.label, onChipChange);
      buildChips(document.getElementById('mpSettingsLevelChips'), midGameLevelItems, midGameFilterState, 'levels', (i) => i.label, onChipChange);
      document.getElementById('mpSettingsTournamentSelect').setMultiValues(Array.from(midGameFilterState.tournaments));
      document.getElementById('mpSettingsIncludeUnlabeledRounds').checked = midGameFilterState.includeUnlabeled;
      if (midGameRoundSliderApi && midGameFilterState.roundRange) {
        midGameRoundSliderApi.setRange(midGameFilterState.roundRange[0], midGameFilterState.roundRange[1]);
      }
    } finally {
      suppressSettingsApplyEcho = false;
    }
    updateMidGameMatchCount();
  }

  function closeSettingsPanel() {
    // Same guard as solo practice: if every subject got toggled off, don't
    // let that empty selection persist for the room - reset back to "all
    // subjects" (and push that out like any other settings change) so the
    // panel reopens usefully next time instead of showing 0 matches.
    if (midGameFilterState.subjects.size === 0 && midGameSubjectItems && midGameSubjectItems.length) {
      midGameSubjectItems.forEach((i) => {
        midGameFilterState.subjects.add(i.value);
        if (i._el) i._el.classList.add('active');
      });
      updateMidGameMatchCount();
      requestApplySettings();
    }
    document.getElementById('mpSettingsOverlay').style.display = 'none';
  }

  // Host-side application of a full set of room settings, wherever they
  // came from - the host's own settings-panel edits, or a client's
  // 'updateSettings' message (see handleHostMessage). Applied live (no
  // separate "Apply" step). The reveal-speed rate is independent of the
  // question pool, so it always takes effect. The filter/queue side only
  // takes effect once at least one question matches - otherwise we
  // silently leave the existing queue tail alone (no blocking alert() on
  // every keystroke while someone is still mid-way through picking
  // filters) and the visible match-count text already tells them why
  // nothing changed.
  function hostApplySettingsFromValues(values) {
    myState.rate = values.rate || 1;
    // Live-apply to the host's own in-progress reveal too, same as clients.
    if (revealCtl && !revealCtl.isDone()) revealCtl.setRate(myState.rate);

    let pool = filterQuestionsFor(values);
    if (pool.length) {
      // Keep every question already asked (or in progress) exactly as-is,
      // and only replace the not-yet-asked tail of the queue with a fresh
      // pool built from the new filters, so we don't re-serve a question
      // that's already been asked this game.
      const askedIds = new Set(hostGame.queue.slice(0, hostGame.index + 1).map((q) => q.id));
      pool = SBData.stratifiedQueue(pool.filter((q) => !askedIds.has(q.id)), (q) => q.subject);
      const usedPrefix = hostGame.queue.slice(0, hostGame.index + 1);
      hostGame.queue = usedPrefix.concat(pool);
      game.total = hostGame.queue.length;

      activeFilterState = {
        subjects: new Set(values.subjects), qtypes: new Set(values.qtypes), formats: new Set(values.formats), levels: new Set(values.levels),
        tournaments: new Set(values.tournaments), roundRange: values.roundRange, includeUnlabeled: values.includeUnlabeled,
      };
    }
    // The new rate and question total reach clients naturally with the next
    // 'question' broadcast (hostNextQuestion already sends both), but
    // everyone's mirrored copy of the active filters/rate - and their
    // settings panel, if they have it open - needs to hear about this
    // right away, not just whoever triggered the change.
    broadcastSettingsState();
  }

  // Role-aware entry point used by every control inside the room-settings
  // panel, whether the panel is open for the host or for any other player -
  // the panel itself is identical for everyone now. Reads the panel's
  // current in-progress values and either applies them directly (host) or
  // asks the host to (client).
  function requestApplySettings() {
    if (suppressSettingsApplyEcho) return;
    const values = {
      subjects: new Set(midGameFilterState.subjects), qtypes: new Set(midGameFilterState.qtypes), formats: new Set(midGameFilterState.formats), levels: new Set(midGameFilterState.levels),
      tournaments: new Set(midGameFilterState.tournaments), roundRange: midGameFilterState.roundRange, includeUnlabeled: midGameFilterState.includeUnlabeled,
      rate: parseFloat(document.getElementById('mpSettingsRateSlider').value) || 1,
    };
    if (myState.role === 'host') {
      hostApplySettingsFromValues(values);
    } else if (client) {
      client.send({
        type: 'updateSettings',
        subjects: [...values.subjects], qtypes: [...values.qtypes], formats: [...values.formats], levels: [...values.levels],
        tournaments: [...values.tournaments], roundRange: values.roundRange, includeUnlabeled: values.includeUnlabeled,
        rate: values.rate,
      });
    }
  }

  function wireGameControls() {
    document.getElementById('mpBuzzBtn').addEventListener('click', doBuzz);
    document.getElementById('mpNextBtn').addEventListener('click', handleNextBtn);
    document.getElementById('mpOverrideBtn').addEventListener('click', doOverride);
    document.getElementById('mpBookmarkBtn').addEventListener('click', toggleMpBookmark);
    document.getElementById('mpPauseBtn').addEventListener('click', doTogglePause);
    document.getElementById('mpSettingsBtn').addEventListener('click', openSettingsPanel);
    document.getElementById('mpRoomCodeDisplay').addEventListener('click', copyRoomCode);
    document.getElementById('mpSubmitBtn').addEventListener('click', () => doSubmitAnswer(document.getElementById('mpAnswerInput').value));
    document.getElementById('mpAnswerInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmitAnswer(document.getElementById('mpAnswerInput').value); }
    });
    document.getElementById('mpAnswerInput').addEventListener('input', (e) => doTypingInput(e.target.value));
    document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => {
      el.addEventListener('click', () => {
        if (!el.classList.contains('clickable')) return;
        doSubmitAnswer(el.dataset.letter);
      });
    });
    document.getElementById('mpChatSendBtn').addEventListener('click', () => {
      const input = document.getElementById('mpChatInput');
      sendChat(input.value);
      input.value = '';
    });
    document.getElementById('mpChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById('mpChatInput');
        sendChat(input.value);
        input.value = '';
      }
    });
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('mpGameScreen').style.display === 'none') return;
      if (document.getElementById('mpSettingsOverlay').style.display !== 'none') {
        // While the room settings modal is open, the only shortcuts that
        // apply are Escape (always) and S (unless typing in a field, e.g.
        // the tournament search box) to close it - every other in-game
        // shortcut (buzz, next, pause, ...) stays disabled so it can't fire
        // behind the modal's back, same as before this modal had any
        // shortcut of its own.
        if (e.key === 'Escape') { closeSettingsPanel(); return; }
        const settingsTag = (e.target && e.target.tagName) || '';
        if ((e.key === 's' || e.key === 'S') && settingsTag !== 'INPUT' && settingsTag !== 'TEXTAREA') {
          closeSettingsPanel();
        }
        return;
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); doBuzz(); return; }
      if (e.key === 'n' || e.key === 'N') { handleNextBtn(); return; }
      if (e.key === 'p' || e.key === 'P') { doTogglePause(); return; }
      if (e.key === 'q' || e.key === 'Q') { doOverride(); return; }
      if (e.key === 'b' || e.key === 'B') { toggleMpBookmark(); return; }
      if (e.key === 's' || e.key === 'S') { openSettingsPanel(); return; }
      if (e.key === '/') { e.preventDefault(); document.getElementById('mpChatInput').focus(); return; }
    });
    // Safety net for the tab-throttling desync bug: when the tab regains
    // focus, force the reveal to catch up to whatever phase we're actually in.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (game.phase !== 'reading' && game.phase !== 'lobby' && revealCtl && !revealCtl.isDone()) {
        revealCtl.skipToEnd();
      }
      fullRenderFromState();
    });
  }

  SBData.load().then(() => {
    initLobby();
    wireGameControls();
  }).catch((err) => {
    document.getElementById('lobbyScreen').innerHTML = '<p>Failed to load question data: ' + err.message + '</p>';
  });
})();
