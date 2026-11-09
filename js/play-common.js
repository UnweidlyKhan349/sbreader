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
      b.className = 'btn btn-outline-danger rounded-0 btn-subject';
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
  // Round names as players say them: "Round Robin 3" / "rr 3" -> "RR 3",
  // "Double Elimination 2" / "de 2" -> "DE 2"; other packet names as written.
  function shortRound(label) {
    return String(label)
      .replace(/\bround[\s-]*robin\b/gi, 'RR')
      .replace(/\bdouble[\s-]*elimination\b/gi, 'DE')
      .replace(/\b(rr|de|se)(?=\s*\d)/gi, (m) => m.toUpperCase())
      .replace(/\bfinals?\b/gi, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
  }

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
    // Just the answer, as on QB Reader (no Correct / Incorrect chip), in
    // bold after its letter: "Z) <b>RR Lyrae</b>".
    // The answer bold and underlined, as QB Reader's answerlines are.
    title.innerHTML = (a.letter ? escapeHtml(a.letter) + ') ' : '') + '<b><u>' + SBData.renderMathHTML(a.text || '') + '</u></b>';
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
      + (a.accept && a.accept.length ? ' <span class="also-accept">(also accept: ' + SBData.renderMathHTML(a.accept.join('; ')) + ')</span>' : '')
      + (a.reject && a.reject.length ? ' <span class="do-not-accept">(do not accept: ' + SBData.renderMathHTML(a.reject.join('; ')) + ')</span>' : '');
    body.appendChild(ans);
    if (opts.note) {
      const note = document.createElement('div');
      note.className = 'small-note mt-1';
      note.textContent = opts.note;
      body.appendChild(note);
    }
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const src = a.sourceUrl || q.sourceUrl;
    // "MIT 2020 / RR 3 / Question 6 / Math / Toss-up" (or the packet's own
    // name, "2016 Question Exchange / Aug 11 Albany / ...") on the left,
    // "Source packet | Report" on the right.
    const round = SBData.roundLabelFor(q);
    const left = [q.tournament, round ? shortRound(round) : '', q.num ? 'Question ' + q.num : '', SBData.subjectLabel(q.subject), SBData.qtypeLabel(q)].filter(Boolean).map(escapeHtml).join(' / ');
    footer.innerHTML = `<small class="text-muted">${left}</small><small class="text-muted float-end card-footer-links"></small>`;
    const links = footer.querySelector('.float-end');
    if (/^https?:\/\//.test(src || '')) links.innerHTML = `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">Source packet</a>`;
    if (window.SBReports) {
      if (links.childNodes.length) links.append(' | ');
      links.append(SBReports.link(q));
    }
    collapse.append(body, footer);
    card.append(header, collapse);

    // Opens and closes with Bootstrap's collapse animation (the height
    // slides over .35s), as QB Reader's cards do.
    // Whether it's open or opening is tracked here: the .show class only
    // lands when the animation ends, so a second click mid-slide would
    // otherwise read the card as still closed and open it again.
    let animating = null;
    let isOpen = false;
    function toggle() {
      const open = !isOpen;
      isOpen = open;
      title.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (animating) { clearTimeout(animating); animating = null; }
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const finish = () => {
        animating = null;
        collapse.classList.remove('collapsing');
        collapse.classList.add('collapse');
        collapse.classList.toggle('show', open);
        collapse.style.height = '';
      };
      if (reduce) { finish(); return; }
      if (open) {
        collapse.classList.remove('collapse');
        collapse.classList.add('collapsing');
        collapse.style.height = '0px';
        void collapse.offsetHeight;
        collapse.style.height = collapse.scrollHeight + 'px';
      } else {
        collapse.style.height = collapse.getBoundingClientRect().height + 'px';
        void collapse.offsetHeight;
        collapse.classList.remove('collapse', 'show');
        collapse.classList.add('collapsing');
        collapse.style.height = '0px';
      }
      animating = setTimeout(finish, 350);
    }
    // A click doesn't leave the header focused, and only Enter toggles it from
    // the keyboard: Space is Buzz on the pages with these cards, and a card
    // that kept focus used to open as well when Space buzzed.
    title.addEventListener('click', () => { toggle(); title.blur(); });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toggle(); } });
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

  /* ---------------- Question label ---------------- */
  // "AVES 2 RR 3 Toss-up 12" above the question ("... of 25" in a set). Once the question is over it links
  // to the packet (underlined, in the text colour) when there is one.
  // opts: SBData.sourceLabelFor's ({ ofPacket }).
  function linkQuestionInfo(el, q, url, opts) {
    const label = SBData.sourceLabelFor(q, ' ', opts);
    if (/^https?:\/\//i.test(url || '')) {
      el.innerHTML = `<a class="question-info-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open the packet">${escapeHtml(label)}</a>`;
    } else {
      el.textContent = label;
    }
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

  // The packet picker for "Select by Set Name": a searchable multi-select
  // (as the tournament picker), listing the set's packets. Nothing picked
  // means every packet. The choice is still kept as a "1, 3, 5" string, so
  // saved settings and multiplayer messages are unchanged. onChange(text).
  function packetSelect(selectEl, onChange) {
    SBData.enhanceMultiSelect(selectEl, { noun: 'packet' });
    selectEl.addEventListener('change', () => {
      onChange(selectEl.getMultiValues().map(Number).sort((x, y) => x - y).join(', '));
    });
    return {
      // Lists this set's packets and ticks the ones in `text`.
      setPackets(packets, text) {
        selectEl.innerHTML = '';
        packets.forEach((p, i) => {
          const o = document.createElement('option');
          o.value = String(i + 1);
          o.textContent = p.label;
          selectEl.appendChild(o);
        });
        const chosen = (text || '').trim() ? parsePacketNumbers(text, packets.length) : [];
        selectEl.setMultiValues(chosen.length === packets.length ? [] : chosen.map(String));
      },
    };
  }

  /* ---------------- Saved settings ---------------- */
  function loadSettings(key, defaults) {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (e) { return { ...defaults }; }
  }
  function saveSettings(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* not saved */ }
  }

  // "Report" floated to the right of a revealed answer line. Needs reports.js.
  function answerReportLink(q) {
    const a = SBReports.link(q);
    a.classList.add('answer-report', 'float-end', 'ms-2', 'fw-normal');
    return a;
  }

  // The year slider's label, as on QB Reader: "Year range: 2010 - 2026".
  function yearLabel(lo, hi) { return `Year range: ${lo} - ${hi}`; }

  window.SBPlay = {
    subjectButtons, packetSelect, historyCard, linkQuestionInfo, toggleLatest, starLatest, repaintStars, answerReportLink,
    packetsOf, parsePacketNumbers, loadSettings, saveSettings, yearLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SBPlay;
})();
