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

  const LIMIT = 50;
  function renderList(s) {
    document.title = `SBReader - Frequency List - ${s.label}`;
    root.innerHTML = `
      <div class="d-flex justify-content-between mb-3">
        <div class="lead">The ${LIMIT} most frequent answers in ${escapeHtml(s.label)} questions:</div>
        <div><a href="frequency-list">Back to all frequency lists</a></div>
      </div>
      <p>Click on an answer to search for it in the database:</p>
      <table class="table table-hover">
        <thead><tr><th scope="col">#</th><th scope="col">Answer</th><th scope="col">Frequency</th></tr></thead>
        <tbody class="table-group-divider" id="frequency-list"></tbody>
      </table>`;
    const body = document.getElementById('frequency-list');
    SBData.frequencyList(SBData.questions.filter((q) => q.subject === s.key), LIMIT).forEach(({ answer, count }, i) => {
      const tr = body.insertRow();
      tr.insertCell().textContent = i + 1;
      const a = document.createElement('a');
      a.className = 'text-body text-decoration-none';
      a.href = 'catalog?' + new URLSearchParams({ answer, subject: s.key });
      a.innerHTML = SBData.renderMathHTML(answer);
      tr.insertCell().appendChild(a);
      tr.insertCell().textContent = count;
    });
  }

  (subject ? SBData.load() : SBData.loadMeta()).then(() => {
    const s = subject && SBData.meta.subjects.find((x) => x.key === subject);
    if (subject && !s) { root.innerHTML = '<p>No such subject. <a href="frequency-list">Back to all frequency lists</a></p>'; return; }
    if (s) renderList(s); else renderIndex();
  }).catch(() => { root.innerHTML = '<p>Could not load the question bank. Try refreshing.</p>'; });
})();
