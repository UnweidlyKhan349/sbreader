// Shared by stats.html and graphs.html, as on QB Reader's user stats pages:
// the account's answers and the filter form above the tables and charts
// (levels, set name, tossups / bonuses, multiplayer / singleplayer, start
// and end date). Tossups and bonuses are on one page, since Science Bowl
// scores them alike here; the two switches show either alone. (An old
// link's ?type=bonus or ?type=tossup opens with just that type on.)
//
//   SBUserStats.init(onData)    onData(rows, all) runs with the filtered
//                               answers (and all of them) once they've
//                               loaded and on every filter change
(function () {
  const $ = (id) => document.getElementById(id);
  const core = window.SBAccountCore;
  const preset = new URLSearchParams(location.search).get('type');
  const page = /graphs/.test(location.pathname) ? 'graphs' : 'stats';
  let all = null; // every answer, normalized
  let onData = null;
  let setNames = [];

  // The links across the top: this page's is the active one.
  function markNav() {
    document.querySelectorAll('#userNav a').forEach((a) => {
      const on = a.dataset.page === page;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
    });
  }

  function filters() {
    const levels = $('levels');
    return {
      tossups: $('include-tossups').checked,
      bonuses: $('include-bonuses').checked,
      levels: levels.getMultiValues ? levels.getMultiValues() : [],
      set: $('set-name').classList.contains('is-invalid') ? '' : $('set-name').value,
      mp: $('include-multiplayer').checked,
      solo: $('include-singleplayer').checked,
      start: $('start-date').value,
      end: $('end-date').value,
    };
  }
  function apply() {
    if (all && onData) onData(core.filterAnswers(all, filters()), all);
  }

  // A set name that isn't in the list is marked, and not filtered on.
  function checkSetName() {
    const v = $('set-name').value.trim().toLowerCase();
    $('set-name').classList.toggle('is-invalid', !!v && setNames.length > 0 && !setNames.includes(v));
  }

  async function load(user) {
    $('statsLoading').hidden = true;
    if (!SBAccount.enabled || !user) {
      $('statsLoggedOut').hidden = false;
      $('statsBody').hidden = true;
      if (!SBAccount.enabled) $('statsLoggedOut').innerHTML = '<p class="lead">Your stats</p><p>Accounts aren\'t switched on for this copy of SB Reader.</p>';
      return;
    }
    $('statsLoggedOut').hidden = true;
    $('statsBody').hidden = false;
    try {
      const [rows, meta] = await Promise.all([SBAccount.fetchAnswers(), SBData.loadMeta().catch(() => null)]);
      const tournaments = (meta && meta.tournaments) || [];
      // A question's level is its tournament's.
      const levelOf = new Map(tournaments.map((t) => [t.name, t.level || 'hs']));
      setNames = tournaments.map((t) => t.name.toLowerCase());
      $('set-list').innerHTML = '';
      tournaments.forEach((t) => { const o = document.createElement('option'); o.value = t.name; $('set-list').appendChild(o); });
      all = rows.map((r) => core.normalizeAnswer({ ...r, level: levelOf.get(r.tournament) || null }));
      $('statsError').hidden = true;
      checkSetName();
      apply();
    } catch (err) {
      $('statsError').textContent = 'Could not load your stats: ' + SBAccount.friendlyError(err);
      $('statsError').hidden = false;
    }
  }

  function init(fn) {
    onData = fn;
    markNav();
    if (preset === 'bonus') $('include-tossups').checked = false;
    if (preset === 'tossup') $('include-bonuses').checked = false;
    SBData.enhanceMultiSelect($('levels'), { noun: 'level' });
    $('form').addEventListener('submit', (e) => { e.preventDefault(); checkSetName(); apply(); });
    $('set-name').addEventListener('change', () => { checkSetName(); apply(); });
    ['levels', 'include-tossups', 'include-bonuses', 'include-multiplayer', 'include-singleplayer', 'start-date', 'end-date'].forEach((id) => $(id).addEventListener('change', apply));
    let shownFor;
    const show = (u) => {
      const id = u ? u.id : null;
      if (shownFor === id) return;
      shownFor = id;
      load(u);
    };
    SBAccount.onChange(show);
    SBAccount.ready.then(() => show(SBAccount.user()));
  }

  // Hands the browser a file to save.
  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.SBUserStats = { init, apply, markNav, download, all: () => all || [] };
})();
