// Pieces Play (solo.html) and Multiplayer share, in QB Reader's style:
// the subject toggles, the question cards in the history, packet-number
// parsing, and settings saved per device.
(function () {
  const { escapeHtml } = SBData;

  /* ---------------- Subjects ---------------- */
  // One toggle per subject, in its subject's colour, shown right in the
  // sidebar. `selected` is a Set of subject keys, edited in place;
  // onChange() runs after every change. Returns { sync(), setDisabled(bool) }.
  function subjectButtons(container, subjects, selected, onChange) {
    container.classList.add('subject-grid');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Subjects');
    let disabled = false;
    const buttons = subjects.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-subject';
      b.dataset.subject = s.key;
      b.textContent = s.label;
      b.addEventListener('click', () => {
        if (disabled) return;
        if (selected.has(s.key)) selected.delete(s.key); else selected.add(s.key);
        sync();
        b.blur();
        onChange();
      });
      container.appendChild(b);
      return b;
    });
    function sync() {
      buttons.forEach((b) => {
        const on = selected.has(b.dataset.subject);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = disabled;
      });
    }
    sync();
    return { sync, setDisabled(on) { disabled = on; sync(); } };
  }

  /* ---------------- History cards ---------------- */
  // One finished question, as QB Reader's game cards: the header is the
  // answer (click it, or press k for the latest, to show the question) with
  // a star on the right; the question, its answer line and the packet link
  // sit underneath, collapsed; the footer names the set, subject and slot.
  // opts: { grade, answer: { text, letter, accept, reject, sourceUrl }, note, onStar(isStarred) }
  function historyCard(q, opts) {
    opts = opts || {};
    const a = opts.answer || { text: SBData.answerDisplayText(q), letter: q.answer && q.answer.letter, accept: q.answer && q.answer.accept, reject: q.answer && q.answer.reject };
    const card = document.createElement('div');
    card.className = 'card my-2 history-card';
    card.dataset.qid = q.id;

    const header = document.createElement('div');
    header.className = 'card-header d-flex justify-content-between align-items-start gap-2';
    const title = document.createElement('span');
    title.className = 'card-header-clickable clickable';
    title.setAttribute('role', 'button');
    title.setAttribute('aria-expanded', 'false');
    title.tabIndex = 0;
    const grade = opts.grade && opts.grade !== 'skipped'
      ? `<span class="grade-badge ${escapeHtml(opts.grade)} me-2">${escapeHtml({ correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped' }[opts.grade] || opts.grade)}</span>`
      : '';
    title.innerHTML = grade + (a.letter ? escapeHtml(a.letter) + ') ' : '') + SBData.renderMathHTML(a.text || '');
    const star = SBData.bookmarkButton(q.id, (on) => {
      // Every card of this question shows the same star.
      if (card.parentElement) repaintStars(card.parentElement, q.id);
      if (opts.onStar) opts.onStar(on);
    });
    const paintStar = star.paint;
    card.paintStar = paintStar;
    header.append(title, star);

    const collapse = document.createElement('div');
    collapse.className = 'card-container collapse';
    const body = document.createElement('div');
    body.className = 'card-body';
    SBData.appendQuestionBody(body, q);
    const hr = document.createElement('hr');
    body.appendChild(hr);
    const ans = document.createElement('div');
    ans.innerHTML = 'ANSWER: ' + (a.letter ? escapeHtml(a.letter) + ') ' : '') + SBData.renderMathHTML(a.text || '')
      + (a.accept && a.accept.length ? ' <span class="also-accept">(also accept: ' + SBData.renderMathHTML(a.accept.join('; ')) + ')</span>' : '');
    body.appendChild(ans);
    if (a.reject && a.reject.length) {
      const rej = document.createElement('div');
      rej.className = 'small-note';
      rej.innerHTML = 'Do not accept: ' + SBData.renderMathHTML(a.reject.join('; '));
      body.appendChild(rej);
    }
    if (opts.note) {
      const note = document.createElement('div');
      note.className = 'small-note mt-1';
      note.textContent = opts.note;
      body.appendChild(note);
    }
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const src = a.sourceUrl || q.sourceUrl;
    const left = [q.tournament, SBData.subjectLabel(q.subject), SBData.qtypeLabel(q)].filter(Boolean).map(escapeHtml).join(' / ');
    const slot = [SBData.roundLabelFor(q) ? 'Packet ' + escapeHtml(SBData.roundLabelFor(q)) : '', q.num ? 'Question ' + escapeHtml(q.num) : ''].filter(Boolean).join(' / ');
    footer.innerHTML = `<small class="text-muted">${left}</small>`
      + `<small class="text-muted float-end">${slot}${/^https?:\/\//.test(src || '') ? ` / <a href="${escapeHtml(src)}" target="_blank" rel="noopener">Source</a>` : ''}</small>`;
    collapse.append(body, footer);
    card.append(header, collapse);

    function toggle() {
      const open = !collapse.classList.contains('show');
      collapse.classList.toggle('show', open);
      title.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.toggleOpen = toggle;
    return card;
  }

  // k and t act on the newest card in a history list.
  function latestCard(list) { return list.querySelector('.history-card'); }
  function toggleLatest(list) { const c = latestCard(list); if (c) c.toggleOpen(); }
  function starLatest(list) { const c = latestCard(list); if (c) c.querySelector('.star-question').click(); }
  // Repaints every card's star for one question (it may be starred elsewhere).
  function repaintStars(list, qid) {
    list.querySelectorAll('.history-card').forEach((c) => { if (c.dataset.qid === String(qid) && c.paintStar) c.paintStar(); });
  }

  /* ---------------- Sets and packets ---------------- */
  // A tournament's packets in reading order: [{ label, questions }].
  function packetsOf(slugOrName) {
    const qs = SBData.questions.filter((q) => q.tSlug === slugOrName || q.tournament === slugOrName);
    const ordered = SBData.sortByPacketOrder(qs, { recent: false });
    const packets = [];
    const byLabel = new Map();
    ordered.forEach((q) => {
      const label = SBData.roundLabelFor(q) || 'Unlabeled';
      if (!byLabel.has(label)) { byLabel.set(label, { label, questions: [] }); packets.push(byLabel.get(label)); }
      byLabel.get(label).questions.push(q);
    });
    return packets;
  }
  // "1-3, 5" -> [1, 2, 3, 5] (1-based, within 1..max). Empty -> every packet.
  function parsePacketNumbers(text, max) {
    const out = new Set();
    const s = (text || '').trim();
    if (!s) { for (let i = 1; i <= max; i++) out.add(i); return [...out]; }
    s.split(/[,\s]+/).filter(Boolean).forEach((part) => {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      let lo = +m[1]; let hi = m[2] ? +m[2] : lo;
      if (lo > hi) [lo, hi] = [hi, lo];
      for (let i = Math.max(1, lo); i <= Math.min(max, hi); i++) out.add(i);
    });
    return [...out].sort((x, y) => x - y);
  }

  /* ---------------- Saved settings ---------------- */
  function loadSettings(key, defaults) {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (e) { return { ...defaults }; }
  }
  function saveSettings(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* not saved */ }
  }

  window.SBPlay = {
    subjectButtons, historyCard, toggleLatest, starLatest, repaintStars,
    packetsOf, parsePacketNumbers, loadSettings, saveSettings,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SBPlay;
})();
