// stars.html: your starred questions, tossups and bonuses together, as QB
// Reader's starred pages: a card per question with its star (click to
// unstar), 20 to a page, Clear Starred Questions behind a confirmation, and
// the list as a TXT, CSV or JSON file. Stars live in this browser and, when
// you're logged in, in your account (js/account.js keeps the two in step),
// so the page works logged out too.
(function () {
  const $ = (id) => document.getElementById(id);
  const typeOf = (q) => (q.qtype === 'bonus' ? 'bonus' : 'tossup');
  const PAGE_SIZE = 20;
  let questions = [];
  let page = 1;

  function renderPagination(totalPages) {
    const el = $('question-pagination');
    el.innerHTML = '';
    if (totalPages <= 1) return;
    const ul = document.createElement('ul');
    ul.className = 'pagination justify-content-center flex-wrap mb-0';
    const item = (label, to, { active = false, disabled = false, aria } = {}) => {
      const li = document.createElement('li');
      li.className = 'page-item' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-link';
      btn.textContent = label;
      if (aria) btn.setAttribute('aria-label', aria);
      if (active) btn.setAttribute('aria-current', 'page');
      if (disabled || active) btn.disabled = true;
      else btn.addEventListener('click', () => { render(to); $('question-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      li.appendChild(btn);
      ul.appendChild(li);
    };
    item('«', page - 1, { disabled: page <= 1, aria: 'Previous page' });
    const pages = new Set([1, totalPages]);
    for (let n = page - 2; n <= page + 2; n++) if (n >= 1 && n <= totalPages) pages.add(n);
    let last = 0;
    [...pages].sort((x, y) => x - y).forEach((n) => {
      if (n - last > 1) item('…', 0, { disabled: true });
      item(String(n), n, { active: n === page });
      last = n;
    });
    item('»', page + 1, { disabled: page >= totalPages, aria: 'Next page' });
    el.appendChild(ul);
  }

  function render(to) {
    const totalPages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
    page = Math.min(Math.max(1, to || 1), totalPages);
    const list = $('question-list');
    list.innerHTML = '';
    const count = $('starred-count');
    count.hidden = !questions.length;
    count.textContent = `${questions.length.toLocaleString()} starred question${questions.length === 1 ? '' : 's'}`;
    $('clear-starred').disabled = !questions.length;
    if (!questions.length) {
      list.innerHTML = '<p class="text-body-secondary">You have no starred questions.</p>';
    }
    // As on QB Reader, an unstarred question stays on the page (its star
    // empty, so a slip can be undone) until the page is loaded again.
    questions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach((q) => list.appendChild(SBData.questionCard(q)));
    renderPagination(totalPages);
  }

  // The starred questions, in packet order, newest sets first.
  async function load() {
    const ids = [...SBData.bookmarks.getAll()];
    try {
      if (ids.length) await SBData.loadIds(ids); else await SBData.loadMeta();
    } catch (e) {
      $('question-list').innerHTML = '<p class="text-body-secondary">Could not load the question bank. Try refreshing.</p>';
      return;
    }
    const aliases = (SBData.meta && SBData.meta.idAliases) || {};
    const seen = new Set();
    questions = [];
    ids.forEach((id) => {
      const q = ids.length ? (SBData.byId.get(id) || SBData.byId.get(aliases[id])) : null;
      if (!q || seen.has(q.id)) return;
      seen.add(q.id);
      questions.push(q);
    });
    if (questions.length) questions = SBData.sortByPacketOrder(questions, { recent: true }) || questions;
    render(page);
  }

  /* ---------------- Clear ---------------- */
  $('clear-starred').addEventListener('click', () => SBSite.showModal($('clear-starred-modal')));
  $('confirm').addEventListener('click', () => {
    // One at a time, so each removal reaches the account too.
    questions.forEach((q) => { if (SBData.bookmarks.isBookmarked(q.id)) SBData.bookmarks.remove(q.id); });
    SBSite.hideModal($('clear-starred-modal'));
    questions = [];
    render(1);
  });

  /* ---------------- Downloads ---------------- */
  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const still = () => questions.filter((q) => SBData.bookmarks.isBookmarked(q.id));
  const choiceLines = (q) => (q.choices ? ['W', 'X', 'Y', 'Z'].map((k) => `${k}) ${q.choices[k]}`) : []);
  const answerText = (q) => (q.answer.letter ? q.answer.letter + ') ' : '') + q.answer.text;
  const round = (q) => (SBData.roundLabelFor ? SBData.roundLabelFor(q) : '') || '';
  function asText(list) {
    return list.map((q) => [
      [q.tournament, round(q), q.num ? 'Question ' + q.num : ''].filter(Boolean).join(' | '),
      `${typeOf(q) === 'bonus' ? 'BONUS' : 'TOSS-UP'} ${SBData.subjectLabel(q.subject)} ${SBData.FORMAT_LABELS[q.format] || q.format || ''}`.trim(),
      q.question, ...choiceLines(q),
      'ANSWER: ' + answerText(q)
        + (q.answer.accept.length ? ` (also accept: ${q.answer.accept.join('; ')})` : '')
        + (q.answer.reject.length ? ` (do not accept: ${q.answer.reject.join('; ')})` : ''),
    ].join('\n')).join('\n\n') + '\n';
  }
  const cell = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function asCsv(list) {
    const header = ['id', 'set', 'level', 'round', 'number', 'subject', 'type', 'format', 'question', 'W', 'X', 'Y', 'Z', 'answer', 'also_accept', 'do_not_accept', 'source'];
    const lines = list.map((q) => [q.id, q.tournament, q.level, round(q), q.num, q.subject, typeOf(q), q.format, q.question,
      ...['W', 'X', 'Y', 'Z'].map((k) => (q.choices ? q.choices[k] : '')), answerText(q), q.answer.accept.join('; '), q.answer.reject.join('; '), q.sourceUrl || ''].map(cell).join(','));
    return [header.join(','), ...lines].join('\n') + '\n';
  }
  function asJson(list) {
    return JSON.stringify({ questions: list.map((q) => ({
      id: q.id, set: q.tournament, level: q.level, round: round(q), number: q.num, subject: q.subject, type: typeOf(q), format: q.format,
      question: q.question, choices: q.choices, answer: q.answer, source: q.sourceUrl || null,
    })) }, null, 2) + '\n';
  }
  const file = 'starred-questions';
  [['txt', asText, 'text/plain'], ['csv', asCsv, 'text/csv'], ['json', asJson, 'application/json']].forEach(([ext, make, mime]) => {
    const link = $('download-questions-' + ext);
    const go = () => download(`${file}.${ext}`, make(still()), mime);
    link.addEventListener('click', go);
    link.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  load();
  // An account's stars arriving at login.
  window.addEventListener('sb-bookmarks-synced', load);
})();
