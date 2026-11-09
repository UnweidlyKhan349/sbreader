// set.html and packet.html, as QB Reader's set and packet pages.
//   set.html?set=<slug>              the set's packets, with their counts
//   packet.html?set=<slug>&packet=N  every question in packet N, read in
//                                    order, each with its answer line
// The deployed site also has a static copy of each, built by
// tools/build-pages.js: /sets/<slug> and /sets/<slug>/<N>, with the content
// already in the HTML (for search engines) and data-set / data-packet on
// #setPage; this script then redraws it with the interactive parts.
(function () {
  const { escapeHtml } = SBData;
  const params = new URLSearchParams(location.search);
  const root = document.getElementById('setPage');
  const isStatic = !!root.dataset.set;
  const slug = params.get('set') || root.dataset.set || '';
  // Where a set and its packets live: the static pages link to each other.
  const setHref = (s) => (isStatic ? `sets/${encodeURIComponent(s)}/` : `set?set=${encodeURIComponent(s)}`);
  const packetHref = (s, n) => (isStatic ? `sets/${encodeURIComponent(s)}/${n}` : `packet?set=${encodeURIComponent(s)}&amp;packet=${n}`);
  // The search-engine address of this page is its static copy.
  const SITE = 'https://sbreader.github.io/';
  function canonical(path) {
    if (isStatic || !slug) return;
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = SITE + path;
    document.head.appendChild(link);
  }
  function fail(text) {
    root.innerHTML = `<p>${escapeHtml(text)}</p><p><a href="set-list">Back to all sets</a></p>`;
  }
  function heading(html) {
    return `<div class="float-row mb-3"><span class="float-start">${html}</span><a class="float-end" href="set-list">Back to all sets</a></div>`;
  }

  function renderSet(t, packets) {
    document.title = `SBReader - ${t.name}`;
    const rows = packets.map((p, i) => {
      const tu = p.questions.filter((q) => q.qtype === 'tossup').length;
      const b = p.questions.length - tu;
      return `<tr><td>${i + 1}</td><td><a href="${packetHref(t.slug, i + 1)}">${escapeHtml(p.label)}</a></td><td>${tu}</td><td>${b}</td></tr>`;
    }).join('');
    root.innerHTML = heading(`View ${escapeHtml(t.name)} here:`)
      + SBData.tournamentSourceHTML(t, packets)
      + '<div class="table-responsive"><table class="table table-hover"><thead><tr><th scope="col">#</th><th scope="col">Packet Name</th><th scope="col"># of Toss-ups</th><th scope="col"># of Bonuses</th></tr></thead>'
      + `<tbody class="table-group-divider">${rows}</tbody></table></div>`;
  }

  function renderPacket(t, packets, n) {
    const p = packets[n - 1];
    if (!p) { fail('No such packet.'); return; }
    document.title = `SBReader - ${t.name} ${p.label}`;
    root.innerHTML = heading(`Packet ${n} (${escapeHtml(p.label)}) of <a href="${setHref(t.slug)}">${escapeHtml(t.name)}</a>:`)
      + SBData.packetSourceHTML(p);
    p.questions.forEach((q, i) => {
      const item = document.createElement('div');
      item.className = 'packet-question';
      const text = document.createElement('div');
      text.className = 'q-text';
      text.innerHTML = `${escapeHtml(String(q.num || i + 1))}. ` + SBData.readoutHTML(q);
      item.appendChild(text);
      if (q.visual) item.appendChild(SBData.questionFigures(q));
      if (q.choices) {
        const ch = document.createElement('div');
        ch.innerHTML = ['W', 'X', 'Y', 'Z'].filter((L) => q.choices[L]).map((L) => `${L}) ${SBData.renderMathHTML(q.choices[L])}`).join('<br>');
        item.appendChild(ch);
      }
      const a = q.answer || {};
      const ans = document.createElement('div');
      ans.innerHTML = 'ANSWER: ' + SBData.answerLineHTML(SBData.answerDisplayText(q), a.letter, a.accept, a.reject).replace(/^Answer: /, '');
      item.appendChild(ans);
      root.appendChild(item);
      if (i < p.questions.length - 1) root.appendChild(document.createElement('hr'));
    });
  }

  if (!slug) { fail('No set chosen.'); return; }
  SBData.loadSet(slug).then((t) => {
    if (!t) { fail('No set with that name.'); return; }
    const packets = SBPlay.packetsOf(t.slug);
    if (document.body.dataset.page === 'packet') {
      const n = parseInt(params.get('packet') || root.dataset.packet, 10);
      canonical(`sets/${t.slug}/${n}`);
      renderPacket(t, packets, n);
    } else {
      canonical(`sets/${t.slug}/`);
      renderSet(t, packets);
    }
  }).catch(() => fail('Could not load the question bank. Try refreshing.'));
})();
