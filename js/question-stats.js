// Community statistics for each question, as on QB Reader's "Tossup Stats":
// how often the question has been heard across everyone who plays, how
// often it was answered right, wrong or with an interrupt, the average
// celerity of the right answers, and the points it gave.
//
// Every play (in Play, and your own buzzes in Multiplayer) is sent, without
// an account, to the Supabase project's question_play function once its
// result is final (when the next question starts, or the page is left), so
// an "I was wrong" / "I was right" counts. question_stats sums them up. Both
// are plain REST calls, so this works logged out and without supabase-js.
// Without a project, or before supabase/schema.sql has been run with them,
// the Stats window says so. Needs site.js (SBSite.showModal).
(function () {
  const cfg = window.SB_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const RESULTS = ['correct', 'incorrect', 'neg', 'unanswered'];

  function rpc(fn, args, keepalive) {
    return fetch(`${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      keepalive: !!keepalive,
    });
  }

  // ---- Recording ----
  // One play waits at a time: a later result for the same question (an
  // override, a correct rebuzz) replaces it, and a play of another question
  // sends it.
  let pending = null;
  function send(play, keepalive) {
    if (!enabled || !play) return;
    rpc('question_play', {
      p_question_id: play.id, p_qtype: play.qtype, p_result: play.result,
      p_celerity: play.celerity, p_mode: play.mode,
    }, keepalive).catch(() => {});
  }
  // q: the question; result: correct | incorrect | neg | unanswered;
  // celerity: share of the question still unread at a correct buzz (0-1);
  // key: tells two plays of one question apart (Multiplayer's question index).
  function track(q, mode, result, celerity, key) {
    if (!q || !(q.id > 0) || !RESULTS.includes(result)) return;
    const k = q.id + ':' + (key == null ? '' : key);
    if (pending && pending.k !== k) flush();
    pending = {
      k, id: q.id, qtype: q.qtype === 'bonus' ? 'bonus' : 'tossup', result, mode: mode === 'mp' ? 'mp' : 'solo',
      celerity: result === 'correct' && typeof celerity === 'number' && celerity >= 0 && celerity <= 1 ? Math.round(celerity * 1000) / 1000 : null,
    };
  }
  // Changes the waiting play's result (an override), if it's this question.
  function update(q, result, celerity) {
    if (!pending || !q || pending.id !== q.id || !RESULTS.includes(result)) return;
    pending.result = result;
    pending.celerity = result === 'correct' && typeof celerity === 'number' ? Math.round(celerity * 1000) / 1000 : null;
  }
  function flush(keepalive) {
    const p = pending;
    pending = null;
    send(p, keepalive);
  }
  // Leaving the page (or hiding it on a phone, which may be the last chance).
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

  // ---- Showing ----
  let modal = null;
  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-labelledby', 'qStatsTitle');
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="qStatsTitle">Question Stats</h5>
            <button type="button" class="btn-close" data-sb-dismiss aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="small text-body-secondary mb-2" id="qStatsWhich"></p>
            <div id="qStatsBody"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-sb-dismiss>Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const fmt = (n, d) => (Number.isFinite(n) ? n.toFixed(d) : '-');
  // The rows, as QB Reader's table: how many heard it, each result with its
  // points, average celerity, total points and points per question heard.
  function rows(q, s) {
    const heard = s.heard | 0;
    const points = 4 * (s.correct | 0) - 4 * (s.negs | 0);
    const label = q.qtype === 'bonus' ? 'Bonuses heard' : 'Toss-ups heard';
    const per = q.qtype === 'bonus' ? 'Points per bonus' : 'Points per toss-up';
    return [
      [label, heard],
      ['Correct (+4)', s.correct | 0],
      ['Incorrect (0)', s.incorrect | 0],
      ['Interrupts (−4)', s.negs | 0],
      ['No answer', s.unanswered | 0],
      ['Average celerity', s.cel_n ? fmt(s.cel_sum / s.cel_n, 3) : '-'],
      ['Total points', points],
      [per, heard ? fmt(points / heard, 2) : '-'],
    ];
  }
  function show(html) { modal.querySelector('#qStatsBody').innerHTML = html; }
  async function open(q) {
    if (!q || !window.SBSite) return;
    if (!modal) buildModal();
    modal.querySelector('#qStatsWhich').textContent = SBData.sourceLabelFor ? SBData.sourceLabelFor(q, ' / ') : '';
    show('<p class="mb-0">Loading…</p>');
    SBSite.showModal(modal);
    if (!enabled) { show('<p class="mb-0">Question stats aren\'t switched on for this copy of SB Reader.</p>'); return; }
    // This browser's own play of it, still waiting to be sent, counts too.
    if (pending && pending.id === q.id) flush();
    try {
      const res = await rpc('question_stats', { p_question_id: q.id });
      if (res.status === 404) { show('<p class="mb-0">Question stats aren\'t set up on this site yet.</p>'); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const s = (Array.isArray(data) ? data[0] : data) || {};
      if (!(s.heard > 0)) { show('<p class="mb-0">Nobody has played this question yet.</p>'); return; }
      show('<table class="table table-sm mb-0 q-stats-table"><tbody>'
        + rows(q, s).map(([k, v]) => `<tr><td>${k}</td><td class="text-end">${v}</td></tr>`).join('')
        + '</tbody></table>');
    } catch (e) {
      show('<p class="mb-0">Couldn\'t load the stats. Check your connection and try again.</p>');
    }
  }

  // A "Stats" link, beside Report.
  function link(q) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'stats-link';
    a.textContent = 'Stats';
    a.title = 'How everyone has done on this question';
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); a.blur(); open(q); });
    return a;
  }

  window.SBQuestionStats = { enabled, track, update, flush, open, link, rows };
})();
