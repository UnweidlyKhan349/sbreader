// stats.html: the logged-in account's answers, summed up the way qbreader's
// stats page does, plus the most recent ones as question cards.
(function () {
  const $ = (id) => document.getElementById(id);
  const RESULT_LABELS = { correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped' };

  function table(el, firstCol, rows, labelFn) {
    el.innerHTML = '';
    const head = document.createElement('thead');
    head.innerHTML = `<tr><th scope="col">${firstCol}</th><th class="text-end">Seen</th><th class="text-end">Correct</th><th class="text-end">Incorrect</th><th class="text-end">Skipped</th><th class="text-end">Accuracy</th></tr>`;
    const body = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = labelFn ? labelFn(r.key) : r.key;
      tr.appendChild(name);
      [r.total, r.correct, r.incorrect, r.skipped, r.accuracy + '%'].forEach((v) => {
        const td = document.createElement('td');
        td.className = 'text-end';
        td.textContent = typeof v === 'number' ? v.toLocaleString() : v;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (!rows.length) body.innerHTML = '<tr><td colspan="6" class="text-body-secondary">Nothing yet.</td></tr>';
    el.append(head, body);
  }

  async function render(user) {
    $('statsLoading').hidden = true;
    if (!SBAccount.enabled || !user) {
      $('statsLoggedOut').hidden = false;
      $('statsBody').hidden = true;
      if (!SBAccount.enabled) $('statsLoggedOut').innerHTML = '<p class="lead">Your stats</p><p>Accounts aren\'t switched on for this copy of SB Reader.</p>';
      return;
    }
    $('statsLoggedOut').hidden = true;
    $('statsBody').hidden = false;
    let rows;
    try { rows = await SBAccount.fetchAnswers(); } catch (err) {
      $('statsSummary').textContent = 'Could not load your stats: ' + SBAccount.friendlyError(err);
      return;
    }
    const s = SBAccountCore.aggregateStats(rows);
    $('statsSummary').textContent = s.total
      ? `${s.total.toLocaleString()} questions seen: ${s.correct.toLocaleString()} correct, ${s.incorrect.toLocaleString()} incorrect, ${s.skipped.toLocaleString()} skipped (${s.accuracy}% correct).`
      : 'No answers yet. Questions you answer in Play and Multiplayer while logged in show up here.';
    table($('bySubject'), 'Subject', s.bySubject, (k) => SBData.subjectLabel(k));
    table($('byQtype'), 'Type', s.byQtype, (k) => SBData.QTYPE_LABELS[k] || k);
    table($('byMode'), 'Mode', s.byMode, (k) => ({ solo: 'Play', mp: 'Multiplayer' }[k] || k));
    table($('byTournament'), 'Tournament', s.byTournament);

    const recent = rows.slice(0, 50);
    const box = $('recent');
    box.innerHTML = recent.length ? '<p class="text-body-secondary">Loading questions…</p>' : '<p class="text-body-secondary">Nothing yet.</p>';
    if (!recent.length) return;
    await SBData.loadIds(recent.map((r) => r.question_id));
    box.innerHTML = '';
    const aliases = (SBData.meta && SBData.meta.idAliases) || {};
    recent.forEach((r) => {
      const q = SBData.byId.get(r.question_id) || SBData.byId.get(aliases[r.question_id]);
      if (!q) return;
      const card = SBData.questionCard(q, { grade: r.result, hideAnswer: false, note: `${RESULT_LABELS[r.result] || r.result} in ${r.mode === 'mp' ? 'Multiplayer' : 'Play'}, ${new Date(r.created_at).toLocaleString()}` });
      box.appendChild(card);
    });
  }

  $('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm('Delete every answer in your stats? This can\'t be undone.')) return;
    try { await SBAccount.resetStats(); render(SBAccount.user()); } catch (err) { alert(SBAccount.friendlyError(err)); }
  });
  SBAccount.onChange((u) => render(u));
  SBAccount.ready.then(() => render(SBAccount.user()));
})();
