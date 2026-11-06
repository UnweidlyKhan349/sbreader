// set.html and packet.html, as QB Reader's set and packet pages.
//   set.html?set=<slug>              the set's packets, with their counts
//   packet.html?set=<slug>&packet=N  every question in packet N, read in
//                                    order, each with its answer line
(function () {
  const { escapeHtml } = SBData;
  const params = new URLSearchParams(location.search);
  const slug = params.get('set') || '';
  const root = document.getElementById('setPage');
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
      return `<tr><td>${i + 1}</td><td><a href="packet?set=${encodeURIComponent(t.slug)}&amp;packet=${i + 1}">${escapeHtml(p.label)}</a></td><td>${tu}</td><td>${b}</td></tr>`;
    }).join('');
    root.innerHTML = heading(`View ${escapeHtml(t.name)} here:`)
      + '<div class="table-responsive"><table class="table table-hover"><thead><tr><th scope="col">#</th><th scope="col">Packet Name</th><th scope="col"># of Toss-ups</th><th scope="col"># of Bonuses</th></tr></thead>'
      + `<tbody class="table-group-divider">${rows}</tbody></table></div>`;
  }

  // A question as plain text, for the TXT download.
  function plainQuestion(q) {
    const kind = SBData.qtypeLabel(q).toUpperCase();
    const lines = [`${q.num || ''}. ${kind} ${SBData.subjectLabel(q.subject)} ${SBData.FORMAT_LABELS[q.format] || q.format || ''}`.trim(), SBData.splitNumberedStatements(q.question)];
    if (q.choices) ['W', 'X', 'Y', 'Z'].forEach((L) => { if (q.choices[L]) lines.push(`${L}) ${q.choices[L]}`); });
    const a = q.answer || {};
    let ans = 'ANSWER: ' + (a.letter ? a.letter + ') ' : '') + SBData.answerDisplayText(q);
    if (a.accept && a.accept.length) ans += ` (also accept: ${a.accept.join('; ')})`;
    if (a.reject && a.reject.length) ans += ` [do not accept: ${a.reject.join('; ')}]`;
    lines.push(ans);
    return lines.join('\n');
  }
  function downloadLink(text, name, type, label) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    return `<a class="ms-2" href="${url}" download="${escapeHtml(name)}">${label}</a>`;
  }

  function renderPacket(t, packets, n) {
    const p = packets[n - 1];
    if (!p) { fail('No such packet.'); return; }
    document.title = `SBReader - ${t.name} ${p.label}`;
    const file = `${t.slug}-packet-${n}`;
    const txt = p.questions.map(plainQuestion).join('\n\n') + '\n';
    const json = JSON.stringify(p.questions.map((q) => ({
      id: q.id, number: q.num, type: q.qtype, subject: q.subject, format: q.format, question: q.question,
      choices: q.choices || undefined, answer: q.answer, source: q.sourceUrl || undefined,
    })), null, 2);
    let html = heading(`Packet ${n} (${escapeHtml(p.label)}) of <a href="set?set=${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a>:`)
      + `<p><b>Download packet:</b>${downloadLink(txt, file + '.txt', 'text/plain', 'TXT')}${downloadLink(json, file + '.json', 'application/json', 'JSON')}</p>`;
    root.innerHTML = html;
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
      const meta = document.createElement('div');
      const tags = [SBData.subjectLabel(q.subject), SBData.qtypeLabel(q), SBData.FORMAT_LABELS[q.format] || q.format].filter(Boolean).map(escapeHtml).join(' / ');
      meta.innerHTML = `&lt;${tags}&gt;` + (/^https?:\/\//.test(q.sourceUrl || '') ? ` <a href="${escapeHtml(q.sourceUrl)}" target="_blank" rel="noopener">Source packet</a>` : '');
      item.appendChild(meta);
      root.appendChild(item);
      if (i < p.questions.length - 1) root.appendChild(document.createElement('hr'));
    });
  }

  if (!slug) { fail('No set chosen.'); return; }
  SBData.loadSet(slug).then((t) => {
    if (!t) { fail('No set with that name.'); return; }
    const packets = SBPlay.packetsOf(t.slug);
    if (document.body.dataset.page === 'packet') renderPacket(t, packets, parseInt(params.get('packet'), 10));
    else renderSet(t, packets);
  }).catch(() => fail('Could not load the question bank. Try refreshing.'));
})();
