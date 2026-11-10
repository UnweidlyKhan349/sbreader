// stats.html: the logged-in account's stats, laid out as QB Reader's tossup
// and bonus stats pages, with both on one page: the filter form
// (js/user-stats.js), a CSV download, and tabs of tables by subject, format,
// level and set, each with a Total row and columns that sort when clicked.
// Science Bowl scoring in place of quizbowl's: 4 for a right answer, 0 for
// a wrong one, -4 for a wrong interrupt. Best Buzz is your earliest right
// answer; Recent lists the latest answers.
(function () {
  const $ = (id) => document.getElementById(id);
  const core = window.SBAccountCore;
  // Bootstrap Icons' caret-up-fill and caret-down-fill, as the Set List's.
  const CARET_UP = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m7.247 4.86-4.796 5.481c-.566.647-.106 1.659.753 1.659h9.592a1 1 0 0 0 .753-1.659l-4.796-5.48a1 1 0 0 0-1.506 0z"/></svg>';
  const CARET_DOWN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/></svg>';

  // Columns: [heading, value, text, hover title].
  const COLUMNS = [
    ['Heard', (t) => t.count, null, 'Questions heard'],
    ['4', (t) => t.fours, null, 'Right answers (+4)'],
    ['0', (t) => t.zeros, null, 'Wrong answers that cost nothing'],
    ['-4', (t) => t.negs, null, 'Wrong interrupts (-4)'],
    ['Celerity', (t) => t.celerity, (t) => t.celerity.toFixed(3), 'How much of the question was still unread when you buzzed, averaged over your right answers (0 to 1)'],
    ['Points', (t) => t.points, null, ''],
    ['PPQ', (t) => t.ppq, (t) => t.ppq.toFixed(2), 'Points per question'],
  ];
  const TABLES = {
    subject: { keyOf: (r) => r.subject, label: (k) => SBData.subjectLabel(k) },
    format: { keyOf: (r) => r.format, label: (k) => SBData.FORMAT_LABELS[k] || k },
    level: { keyOf: (r) => r.level, label: (k) => SBData.LEVEL_LABELS[k] || k },
    set: { keyOf: (r) => r.tournament, label: (k) => k },
  };
  const sortState = {}; // table -> { col (-1: the name), dir }
  let current = [];

  function renderTable(kind) {
    const table = $(kind + '-stats');
    const def = TABLES[kind];
    const lines = core.groupStats(current, def.keyOf).map((t) => ({ ...t, name: def.label(t.key) }));
    const sort = sortState[kind];
    if (sort) {
      const value = sort.col < 0 ? (t) => t.name : COLUMNS[sort.col][1];
      lines.sort((a, b) => {
        const x = value(a), y = value(b);
        return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir || String(a.name).localeCompare(String(b.name));
      });
    }
    const head = table.tHead;
    head.innerHTML = '';
    const hr = head.insertRow(-1);
    [[table.dataset.label, null, null, ''], ...COLUMNS].forEach(([title, , , hint], i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'clickable';
      th.tabIndex = 0;
      if (hint) th.title = hint;
      const on = sort && sort.col === i - 1;
      th.setAttribute('aria-sort', on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.append(title + ' ');
      const caret = document.createElement('span');
      caret.className = 'sort-indicator';
      caret.innerHTML = on ? (sort.dir > 0 ? CARET_UP : CARET_DOWN) : '';
      th.appendChild(caret);
      const click = () => {
        // A name sorts A-Z first, a number highest first; again reverses.
        const first = i === 0 ? 1 : -1;
        sortState[kind] = { col: i - 1, dir: on ? -sort.dir : first };
        renderTable(kind);
      };
      th.addEventListener('click', click);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
      hr.appendChild(th);
    });
    const cells = (tr, t, tag) => COLUMNS.forEach(([, value, text]) => {
      const c = document.createElement(tag);
      if (tag === 'th') c.scope = 'col';
      c.textContent = text ? text(t) : value(t);
      tr.appendChild(c);
    });
    const body = table.tBodies[0];
    body.innerHTML = '';
    lines.forEach((t) => {
      const tr = body.insertRow(-1);
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = t.name;
      tr.appendChild(th);
      cells(tr, t, 'td');
    });
    const foot = table.tFoot;
    foot.innerHTML = '';
    const fr = foot.insertRow(-1);
    const total = document.createElement('th');
    total.scope = 'col';
    total.textContent = 'Total';
    fr.appendChild(total);
    cells(fr, core.totalStats(current), 'th');
  }

  /* ---------------- Best Buzz and Recent: question cards ---------------- */
  // Cards need the questions themselves, so these two are filled in only
  // when their tab is opened (and again when the filters change it).
  function questionFor(id) {
    const aliases = (SBData.meta && SBData.meta.idAliases) || {};
    return SBData.byId.get(id) || SBData.byId.get(aliases[id]);
  }
  const RESULT = { correct: 'Correct', incorrect: 'Incorrect', neg: 'Incorrect', dead: 'No answer' };
  let cardsFor = null; // what the open card tab was last built from
  async function renderCards(pane) {
    const box = $(pane === 'best-buzz-tab-pane' ? 'best-buzz' : 'recent');
    const best = pane === 'best-buzz-tab-pane';
    const rows = best ? [core.bestBuzz(current)].filter(Boolean) : current.slice(0, 50);
    const sig = pane + ':' + rows.map((r) => r.id + r.outcome).join(',');
    if (cardsFor === sig) return;
    cardsFor = sig;
    if (!rows.length) {
      box.innerHTML = `<p class="text-body-secondary">${best ? 'No right answers yet.' : 'Nothing yet.'}</p>`;
      return;
    }
    box.innerHTML = '<p class="text-body-secondary">Loading…</p>';
    try { await SBData.loadIds(rows.map((r) => r.question_id)); } catch (e) {
      box.innerHTML = '<p class="text-body-secondary">Could not load the questions. Try refreshing.</p>';
      cardsFor = null;
      return;
    }
    if (cardsFor !== sig) return;
    box.innerHTML = '';
    rows.forEach((r) => {
      const q = questionFor(r.question_id);
      if (best) {
        const info = document.createElement('div');
        info.className = 'mb-3';
        [['Celerity', r.celerity.toFixed(3)], ['Date Played', new Date(r.created_at).toLocaleString()],
          ['Multiplayer', r.mode === 'mp'], ['Points', r.points]].forEach(([k, v]) => {
          const d = document.createElement('div');
          d.textContent = `${k}: ${v}`;
          info.appendChild(d);
        });
        if (q && window.SBReveal) {
          const key = document.createElement('div');
          key.className = 'text-body-secondary small mt-1';
          key.innerHTML = '<span class="buzz-marker">(#)</span> marks where you buzzed.';
          info.appendChild(key);
        }
        box.appendChild(info);
      }
      if (!q) return;
      const where = r.mode === 'mp' ? 'Multiplayer' : 'Play';
      box.appendChild(SBData.questionCard(q, {
        // Best Buzz marks where you buzzed, as QB Reader does.
        buzzAt: best ? 1 - r.celerity : undefined,
        grade: best ? null : (r.outcome === 'correct' ? 'correct' : r.outcome === 'dead' ? 'skipped' : 'incorrect'),
        note: best ? '' : `${RESULT[r.outcome]} (${r.points > 0 ? '+' : ''}${r.points}) in ${where}, ${new Date(r.created_at).toLocaleString()}`,
      }));
    });
  }

  /* ---------------- Tabs ---------------- */
  const tabs = [...document.querySelectorAll('#stats-tab [data-tab]')];
  function openTab(btn) {
    tabs.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      const pane = $(b.dataset.tab);
      pane.hidden = !on;
      pane.classList.toggle('active', on);
      pane.classList.toggle('show', on);
    });
    if (/best-buzz|recent/.test(btn.dataset.tab)) renderCards(btn.dataset.tab);
  }
  tabs.forEach((b) => b.addEventListener('click', () => openTab(b)));
  // Left and right arrows move between tabs, as Bootstrap's do.
  $('stats-tab').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const shown = tabs.filter((b) => !b.closest('li').hidden);
    const i = shown.indexOf(document.activeElement);
    if (i < 0) return;
    const next = shown[(i + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
    openTab(next);
    next.focus();
  });
  openTab(tabs[0]);

  /* ---------------- CSV ---------------- */
  // Every answer, whatever the filters say, as on QB Reader.
  const csv = $('download-stats-csv');
  const saveCsv = () => SBUserStats.download('stats.csv', core.answersCsv(SBUserStats.all()), 'text/csv');
  csv.addEventListener('click', saveCsv);
  csv.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saveCsv(); } });

  SBUserStats.init((rows) => {
    current = rows;
    Object.keys(TABLES).forEach(renderTable);
    const open = tabs.find((b) => b.classList.contains('active'));
    if (open && /best-buzz|recent/.test(open.dataset.tab)) renderCards(open.dataset.tab);
  });
})();
