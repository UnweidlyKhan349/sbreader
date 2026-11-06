// frequency-list.html, as QB Reader's frequency lists.
//   frequency-list.html                 a link per subject
//   frequency-list.html?subject=<key>   the most frequent answers in it, with
//                                       a limit, question type and level, TXT
//                                       and CSV downloads, and each answer
//                                       opening a Database search for it
(function () {
  const { escapeHtml } = SBData;
  const root = document.getElementById('freqPage');
  const params = new URLSearchParams(location.search);
  const subject = params.get('subject');

  function renderIndex() {
    const items = SBData.meta.subjects.map((s) => `<li class="list-group-item"><a href="frequency-list.html?subject=${encodeURIComponent(s.key)}">${escapeHtml(s.label)}</a></li>`).join('');
    root.innerHTML = '<p class="lead">Choose a link below to view the frequency list for that subject.</p>'
      + `<ul class="text-center list-group list-group-horizontal-md">${items}</ul>`;
  }

  function renderList(s) {
    document.title = `SBReader - Frequency List - ${s.label}`;
    const state = { limit: 50, qtype: 'all', level: 'all' };
    let current = [];
    root.innerHTML = `
      <div class="d-flex justify-content-between mb-3">
        <div class="lead">The <span id="limit">50</span> most frequent answers in ${escapeHtml(s.label)} <span id="question-type">questions</span>:</div>
        <div><a href="frequency-list.html">Back to all frequency lists</a></div>
      </div>
      <p><b>Download this page:</b><a class="ms-2 clickable" id="download-txt" role="button" tabindex="0">TXT</a><a class="ms-2 clickable" id="download-csv" role="button" tabindex="0">CSV</a></p>
      <form class="row" id="form">
        <div class="col-6 col-md-4 mb-3">
          <label class="form-label" for="level-select">Choose a level:</label>
          <select class="form-control" id="level-select">
            <option value="all" selected>All levels</option>
            <option value="hs">High School</option>
            <option value="ms">Middle School</option>
          </select>
        </div>
        <div class="col-6 col-md-4 mb-3">
          <label class="form-label" for="limit-select">Choose a limit:</label>
          <select class="form-control" id="limit-select">
            ${[25, 50, 100, 200, 500, 1000].map((n) => `<option value="${n}"${n === 50 ? ' selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="col-12 col-md-4 mb-3">
          <label class="form-label" for="question-type-select">Choose a question type:</label>
          <select class="form-control" id="question-type-select">
            <option value="tossup">Toss-ups only</option>
            <option value="bonus">Bonuses only</option>
            <option value="all" selected>All questions</option>
          </select>
        </div>
      </form>
      <p>Click on an answer to search for it in the database:</p>
      <table class="table table-hover">
        <thead><tr><th scope="col">#</th><th scope="col">Answer</th><th scope="col">Frequency</th></tr></thead>
        <tbody class="table-group-divider" id="frequency-list"></tbody>
      </table>`;

    function draw() {
      const qs = SBData.questions.filter((q) => q.subject === s.key
        && (state.qtype === 'all' || q.qtype === state.qtype)
        && (state.level === 'all' || q.level === state.level));
      current = SBData.frequencyList(qs, state.limit);
      document.getElementById('limit').textContent = state.limit;
      document.getElementById('question-type').textContent = state.qtype === 'tossup' ? 'toss-ups' : state.qtype === 'bonus' ? 'bonuses' : 'questions';
      const body = document.getElementById('frequency-list');
      body.innerHTML = '';
      current.forEach(({ answer, count }, i) => {
        const tr = body.insertRow();
        tr.insertCell().textContent = i + 1;
        const a = document.createElement('a');
        a.className = 'text-body text-decoration-none';
        const search = new URLSearchParams({ answer, subject: s.key });
        if (state.qtype !== 'all') search.set('qtype', state.qtype);
        if (state.level !== 'all') search.set('level', state.level);
        a.href = 'catalog.html?' + search;
        a.innerHTML = SBData.renderMathHTML(answer);
        tr.insertCell().appendChild(a);
        tr.insertCell().textContent = count;
      });
    }
    function download(ext, text) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: ext === 'csv' ? 'text/csv' : 'text/plain' }));
      a.download = `${s.key}-${state.qtype}-frequency-list.${ext}`;
      a.click();
    }
    const csvField = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const onKey = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
    const txt = () => download('txt', current.map(({ answer, count }, i) => `${i + 1}. ${answer} (${count})`).join('\n') + '\n');
    const csv = () => download('csv', 'rank,answer,frequency\n' + current.map(({ answer, count }, i) => `${i + 1},${csvField(answer)},${count}`).join('\n') + '\n');
    document.getElementById('download-txt').addEventListener('click', txt);
    document.getElementById('download-txt').addEventListener('keydown', onKey(txt));
    document.getElementById('download-csv').addEventListener('click', csv);
    document.getElementById('download-csv').addEventListener('keydown', onKey(csv));
    document.getElementById('limit-select').addEventListener('change', (e) => { state.limit = +e.target.value; draw(); });
    document.getElementById('question-type-select').addEventListener('change', (e) => { state.qtype = e.target.value; draw(); });
    document.getElementById('level-select').addEventListener('change', (e) => { state.level = e.target.value; draw(); });
    draw();
  }

  (subject ? SBData.load() : SBData.loadMeta()).then(() => {
    const s = subject && SBData.meta.subjects.find((x) => x.key === subject);
    if (subject && !s) { root.innerHTML = '<p>No such subject. <a href="frequency-list.html">Back to all frequency lists</a></p>'; return; }
    if (s) renderList(s); else renderIndex();
  }).catch(() => { root.innerHTML = '<p>Could not load the question bank. Try refreshing.</p>'; });
})();
