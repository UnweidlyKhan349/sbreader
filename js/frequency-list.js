// frequency-list.html, as QB Reader's frequency lists.
//   frequency-list.html                 a link per subject
//   frequency-list.html?subject=<key>   the most frequent answers in it, each
//                                       opening a Database search for it
(function () {
  const { escapeHtml } = SBData;
  const root = document.getElementById('freqPage');
  const params = new URLSearchParams(location.search);
  const subject = params.get('subject');

  function renderIndex() {
    const items = SBData.meta.subjects.map((s) => `<li class="list-group-item"><a href="frequency-list?subject=${encodeURIComponent(s.key)}">${escapeHtml(s.label)}</a></li>`).join('');
    root.innerHTML = '<p class="lead">Choose a link below to view the frequency list for that subject.</p>'
      + `<ul class="text-center list-group list-group-horizontal-md">${items}</ul>`;
  }

  // The list's filters, as on QB Reader's frequency list (its difficulty
  // menu is our round slider): a round range, how many answers, tossups or
  // bonuses, and a year range. They're kept in the address
  // (?subject=chem&limit=100&type=bonus&rounds=1-5&years=2020-2026), so a
  // list can be linked.
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 1000;
  const TYPE_LABELS = { tossup: 'Tossups', bonus: 'Bonuses' };
  function parseRange(v, lo, hi) {
    const m = /^(\d+)-(\d+)$/.exec(v || '');
    if (!m) return [lo, hi];
    const a = Math.max(lo, Math.min(hi, +m[1]));
    const b = Math.max(a, Math.min(hi, +m[2]));
    return [a, b];
  }
  function csvCell(v) {
    const t = String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderList(s) {
    document.title = `SBReader - Frequency List - ${s.label}`;
    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    const [firstYear, lastYear] = SBData.yearSpan();
    const state = {
      limit: Math.max(1, Math.min(MAX_LIMIT, parseInt(params.get('limit'), 10) || DEFAULT_LIMIT)),
      type: ['tossup', 'bonus'].includes(params.get('type')) ? params.get('type') : '',
      rounds: parseRange(params.get('rounds'), 1, maxRound),
      years: parseRange(params.get('years'), firstYear, lastYear),
    };
    const typeOptions = ['<option value="">All questions</option>']
      .concat(Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}"${state.type === v ? ' selected' : ''}>${l}</option>`)).join('');
    root.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div class="lead" id="freqTitle"></div>
        <div class="text-nowrap"><a href="frequency-list">Back to all frequency lists</a></div>
      </div>
      <p class="freq-downloads"><b>Download this page:</b>
        <a href="#" id="downloadTxt">TXT</a>
        <a href="#" id="downloadCsv">CSV</a>
      </p>
      <div class="row g-4 mb-3">
        <div class="col-12 col-md-4">
          <label class="form-label" id="freqRoundLabel" for="freqRoundMin"></label>
          <div class="dual-slider freq-slider" id="freqRoundSlider">
            <div class="track"></div>
            <div class="range-fill" id="freqRoundFill"></div>
            <input type="range" id="freqRoundMin" step="1" aria-label="Lowest round" />
            <input type="range" id="freqRoundMax" step="1" aria-label="Highest round" />
          </div>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label" for="freqLimit">Choose a limit:</label>
          <input class="form-control" type="number" id="freqLimit" min="1" max="${MAX_LIMIT}" step="1" value="${state.limit}" />
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label" for="freqType">Choose a question type:</label>
          <select class="form-select" id="freqType">${typeOptions}</select>
        </div>
      </div>
      <div class="mb-4">
        <label class="form-label" id="freqYearLabel" for="freqYearMin"></label>
        <div class="dual-slider" id="freqYearSlider">
          <div class="track"></div>
          <div class="range-fill" id="freqYearFill"></div>
          <input type="range" id="freqYearMin" step="1" aria-label="Earliest year" />
          <input type="range" id="freqYearMax" step="1" aria-label="Latest year" />
        </div>
      </div>
      <p>Click on an answer to search for it in the database:</p>
      <table class="table table-hover">
        <thead><tr><th scope="col">#</th><th scope="col">Answer</th><th scope="col">Frequency</th></tr></thead>
        <tbody class="table-group-divider" id="frequency-list"></tbody>
      </table>`;
    const body = document.getElementById('frequency-list');
    let rows = [];

    function syncUrl() {
      const p = new URLSearchParams({ subject: s.key });
      if (state.limit !== DEFAULT_LIMIT) p.set('limit', state.limit);
      if (state.type) p.set('type', state.type);
      if (state.rounds[0] !== 1 || state.rounds[1] !== maxRound) p.set('rounds', state.rounds.join('-'));
      if (state.years[0] !== firstYear || state.years[1] !== lastYear) p.set('years', state.years.join('-'));
      history.replaceState(null, '', 'frequency-list?' + p);
    }
    function render() {
      const allRounds = state.rounds[0] === 1 && state.rounds[1] === maxRound;
      const allYears = state.years[0] === firstYear && state.years[1] === lastYear;
      const qs = SBData.filterQuestions({
        subjects: [s.key],
        qtypes: state.type ? [state.type] : null,
        roundRange: allRounds ? null : state.rounds,
        includeUnlabeled: allRounds,
        yearRange: allYears ? null : state.years,
      });
      rows = SBData.frequencyList(qs, state.limit);
      document.getElementById('freqTitle').textContent = `The ${state.limit} most frequent answers in ${s.label} ${state.type ? TYPE_LABELS[state.type].toLowerCase() : 'questions'}:`;
      body.textContent = '';
      rows.forEach(({ answer, count }, i) => {
        const tr = body.insertRow();
        tr.insertCell().textContent = i + 1;
        const a = document.createElement('a');
        a.className = 'text-body text-decoration-none';
        a.href = 'catalog?' + new URLSearchParams({ answer, subject: s.key });
        a.innerHTML = SBData.renderMathHTML(answer);
        tr.insertCell().appendChild(a);
        tr.insertCell().textContent = count;
      });
      syncUrl();
    }

    // (wiring a slider reports its full range once: keep the address's)
    const startRounds = state.rounds.slice();
    const startYears = state.years.slice();
    SBData.wireRoundRangeSlider({
      minInput: document.getElementById('freqRoundMin'),
      maxInput: document.getElementById('freqRoundMax'),
      fillEl: document.getElementById('freqRoundFill'),
      labelEl: document.getElementById('freqRoundLabel'),
      maxRound,
      label: (lo, hi) => (lo === hi ? `Choose a round: ${lo}` : `Choose a round range: ${lo} - ${hi}`),
      onChange: (lo, hi) => { state.rounds = [lo, hi]; render(); },
    }).setRange(startRounds[0], startRounds[1]);
    SBData.wireRoundRangeSlider({
      minInput: document.getElementById('freqYearMin'),
      maxInput: document.getElementById('freqYearMax'),
      fillEl: document.getElementById('freqYearFill'),
      labelEl: document.getElementById('freqYearLabel'),
      min: firstYear,
      maxRound: lastYear,
      label: (lo, hi) => (lo === hi ? `Year: ${lo}` : `Year range: ${lo} - ${hi}`),
      onChange: (lo, hi) => { state.years = [lo, hi]; render(); },
    }).setRange(startYears[0], startYears[1]);

    const limitInput = document.getElementById('freqLimit');
    limitInput.addEventListener('change', () => {
      const n = parseInt(limitInput.value, 10);
      state.limit = Math.max(1, Math.min(MAX_LIMIT, n > 0 ? n : DEFAULT_LIMIT));
      limitInput.value = state.limit;
      render();
    });
    document.getElementById('freqType').addEventListener('change', (e) => { state.type = e.target.value; render(); });

    const fileBase = () => `frequency-list-${s.key}${state.type ? '-' + state.type : ''}`;
    document.getElementById('downloadTxt').addEventListener('click', (e) => {
      e.preventDefault();
      download(fileBase() + '.txt', rows.map(({ answer, count }, i) => `${i + 1}. ${answer} (${count})`).join('\n') + '\n', 'text/plain');
    });
    document.getElementById('downloadCsv').addEventListener('click', (e) => {
      e.preventDefault();
      const lines = ['Rank,Answer,Frequency'].concat(rows.map(({ answer, count }, i) => [i + 1, answer, count].map(csvCell).join(',')));
      download(fileBase() + '.csv', lines.join('\n') + '\n', 'text/csv');
    });
    render();
  }

  (subject ? SBData.load() : SBData.loadMeta()).then(() => {
    const s = subject && SBData.meta.subjects.find((x) => x.key === subject);
    if (subject && !s) { root.innerHTML = '<p>No such subject. <a href="frequency-list">Back to all frequency lists</a></p>'; return; }
    if (s) renderList(s); else renderIndex();
  }).catch(() => { root.innerHTML = '<p>Could not load the question bank. Try refreshing.</p>'; });
})();
