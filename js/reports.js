// "Report" on a question: a short form (what's wrong, an optional note) that
// saves a row to the Supabase project's question_reports table, and a quiet
// log of "I was right" overrides (answer_overrides) - both read in the
// project's dashboard (README, Reports). Without a project the form says
// reports aren't switched on. Needs site.js (SBSite.showModal) and account.js.
(function () {
  const REASONS = [
    ['answer', 'The answer is wrong, or a right answer was marked wrong'],
    ['question', 'The question is wrong, unclear or garbled'],
    ['figure', 'A figure is missing or wrong'],
    ['subject', 'The subject, round or source is wrong'],
    ['other', 'Something else'],
  ];
  const MAX_PER_PAGE = 10; // reports one page view may send
  const sent = new Set(); // question ids reported from this page
  let modal = null;
  let current = null;

  function client() {
    if (!window.SBAccount || !SBAccount.enabled) return Promise.resolve(null);
    return SBAccount.ready.catch(() => null);
  }
  function page() { return (document.body && document.body.dataset.page) || location.pathname.split('/').pop() || 'home'; }
  // A table that isn't there yet (schema.sql not run since reports were added).
  function missingTable(error) { return error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '')); }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-labelledby', 'reportTitle');
    modal.innerHTML = `
      <div class="modal-dialog">
        <form class="modal-content" id="reportForm">
          <div class="modal-header">
            <h5 class="modal-title" id="reportTitle">Report a problem</h5>
            <button type="button" class="btn-close" data-sb-dismiss aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="small text-body-secondary mb-2" id="reportWhich"></p>
            ${REASONS.map(([v, label], i) => `<div class="form-check"><input class="form-check-input" type="radio" name="reportReason" id="reportReason${i}" value="${v}"${i === 0 ? ' checked' : ''}><label class="form-check-label" for="reportReason${i}">${label}</label></div>`).join('')}
            <label class="form-label mt-3" for="reportNote">What's wrong? (optional)</label>
            <textarea class="form-control" id="reportNote" rows="3" maxlength="500" placeholder="e.g. the key should be W, or ${'“'}5 meters${'”'} should be accepted"></textarea>
            <div class="alert mt-3 mb-0" id="reportStatus" role="status" hidden></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-sb-dismiss>Cancel</button>
            <button type="submit" class="btn btn-primary" id="reportSend">Send report</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#reportForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  }
  function status(text, kind) {
    const el = modal.querySelector('#reportStatus');
    el.hidden = !text;
    el.className = 'alert mt-3 mb-0 alert-' + (kind || 'secondary');
    el.textContent = text || '';
  }

  function open(q) {
    if (!q || !window.SBSite) return;
    if (!modal) buildModal();
    current = q;
    modal.querySelector('#reportWhich').textContent = SBData.sourceLabelFor ? SBData.sourceLabelFor(q) : '';
    modal.querySelector('#reportNote').value = '';
    modal.querySelector('#reportReason0').checked = true;
    modal.querySelector('#reportSend').disabled = false;
    status('');
    SBSite.showModal(modal);
  }

  async function send() {
    const q = current;
    const btn = modal.querySelector('#reportSend');
    if (sent.has(q.id)) { status('You already reported this question. Thanks!', 'secondary'); return; }
    if (sent.size >= MAX_PER_PAGE) { status('Thanks for all the reports! Reload the page to send more.', 'secondary'); return; }
    const c = await client();
    if (!c) { status("Reports aren't switched on for this copy of SB Reader.", 'warning'); return; }
    btn.disabled = true;
    const reason = (modal.querySelector('input[name="reportReason"]:checked') || {}).value || 'other';
    const note = modal.querySelector('#reportNote').value.trim().slice(0, 500);
    const { error } = await c.from('question_reports').insert({ question_id: q.id, reason, note: note || null, page: page().slice(0, 40) });
    if (error) {
      btn.disabled = false;
      status(missingTable(error) ? "Reports aren't set up on this site yet." : SBAccount.friendlyError(error), 'danger');
      return;
    }
    sent.add(q.id);
    // A thank-you in the form itself, which then closes on its own.
    status('Thanks! Your report was sent.', 'success');
    setTimeout(() => { if (current === q) SBSite.hideModal(modal); }, 1200);
  }

  // A "Report" link for a card footer.
  function link(q) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'report-link';
    a.textContent = 'Report';
    a.title = 'Report a problem with this question';
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); a.blur(); open(q); });
    return a;
  }

  // "I was right": what was typed and the key, once per question per page.
  const logged = new Set();
  function logOverride(q, typed, mode) {
    const text = String(typed || '').trim().slice(0, 200);
    if (!q || !q.id || !text || logged.has(q.id)) return;
    logged.add(q.id);
    const key = q.answer ? ((q.answer.letter ? q.answer.letter + ') ' : '') + (q.answer.text || '')).slice(0, 300) : null;
    client().then((c) => c && c.from('answer_overrides').insert({ question_id: q.id, typed: text, answer_key: key, mode })).catch(() => {});
  }

  window.SBReports = { open, link, logOverride };
})();
