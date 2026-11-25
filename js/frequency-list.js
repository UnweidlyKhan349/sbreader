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

  // A subject's 50 most frequent answers over the whole bank. (Round,
  // limit, type and year filters and TXT/CSV downloads were here once;
  // removed on November 22, 2026. Old links with those parameters show the
  // plain list.)
  const LIMIT = 50;
  function renderList(s) {
    document.title = `SBReader - Frequency List - ${s.label}`;
    root.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-start column-gap-3 mb-3 freq-head">
        <div class="lead" id="freqTitle"></div>
        <div class="text-nowrap ms-auto"><a href="frequency-list">Back to all frequency lists</a></div>
      </div>
      <p>Click on an answer to search for it in the database:</p>
      <table class="table table-hover">
        <thead><tr><th scope="col">#</th><th scope="col">Answer</th><th scope="col">Frequency</th></tr></thead>
        <tbody class="table-group-divider" id="frequency-list"></tbody>
      </table>`;
    document.getElementById('freqTitle').textContent = `The ${LIMIT} most frequent answers in ${s.label} questions:`;
    const body = document.getElementById('frequency-list');
    SBData.frequencyList(SBData.filterQuestions({ subjects: [s.key] }), LIMIT).forEach(({ answer, count }, i) => {
      const tr = body.insertRow();
      tr.insertCell().textContent = i + 1;
      const a = document.createElement('a');
      a.className = 'text-body text-decoration-none';
      a.href = 'database?' + new URLSearchParams({ answer, subject: s.key });
      a.innerHTML = SBData.renderMathHTML(answer);
      tr.insertCell().appendChild(a);
      tr.insertCell().textContent = count;
    });
    // (an old link's filters are dropped from the address)
    if ([...params.keys()].some((k) => k !== 'subject')) history.replaceState(null, '', 'frequency-list?' + new URLSearchParams({ subject: s.key }));
  }

  (subject ? SBData.load() : SBData.loadMeta()).then(() => {
    const s = subject && SBData.meta.subjects.find((x) => x.key === subject);
    if (subject && !s) { root.innerHTML = '<p>No such subject. <a href="frequency-list">Back to all frequency lists</a></p>'; return; }
    if (s) renderList(s); else renderIndex();
  }).catch((err) => { root.innerHTML = `<p>${SBData.escapeHtml(SBData.loadErrorText(err))}</p>`; });
})();
