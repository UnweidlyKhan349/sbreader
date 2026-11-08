// Account logic with no network or DOM, shared by js/account.js and the
// tests: merging bookmarks, picking which settings win, and the numbers on
// the Stats page.
(function (global) {
  // Settings an account carries between devices (localStorage keys).
  const SETTINGS_KEYS = ['sb_theme', 'sb_reading_speed', 'sb_mp_name', 'sb_hide_answers'];

  // Bookmarks are merged at login against `base`, the set both sides agreed
  // on at the last sync on this device: a star removed on either side since
  // then stays removed, and one added on either side is kept. With no base
  // (this device's first sync for the account) it's a union, so nothing
  // starred on either side is lost.
  //   all: the merged set; toUpload / toDelete: the account's changes.
  function mergeBookmarks(local, remote, base) {
    const L = new Set(local), R = new Set(remote);
    let all;
    if (!base) all = new Set([...R, ...L]);
    else {
      const B = new Set(base);
      all = new Set();
      for (const id of new Set([...L, ...R])) {
        const removedHere = B.has(id) && !L.has(id);
        const removedThere = B.has(id) && !R.has(id);
        if (!removedHere && !removedThere) all.add(id);
      }
    }
    return {
      all: [...all],
      toUpload: [...all].filter((id) => !R.has(id)),
      toDelete: [...R].filter((id) => !all.has(id)),
    };
  }

  // The newer side wins, whole: { data, from: 'local'|'remote' }.
  function pickSettings(local, localUpdated, remote, remoteUpdated) {
    const l = Date.parse(localUpdated || 0) || 0;
    const r = Date.parse(remoteUpdated || 0) || 0;
    if (remote && r > l) return { data: remote, from: 'remote' };
    return { data: local || {}, from: 'local' };
  }

  function tally() { return { total: 0, correct: 0, incorrect: 0, skipped: 0 }; }
  function add(t, result) {
    t.total++;
    if (result === 'correct' || result === 'incorrect' || result === 'skipped') t[result]++;
  }
  function pct(t) { return t.total ? Math.round((1000 * t.correct) / t.total) / 10 : 0; }

  // rows: [{ result, subject, qtype, tournament, mode }] -> totals and
  // per-subject / type / tournament / mode breakdowns, each sorted by how
  // many questions they hold.
  function aggregateStats(rows) {
    const total = tally();
    const groups = { subject: new Map(), qtype: new Map(), tournament: new Map(), mode: new Map() };
    rows.forEach((r) => {
      add(total, r.result);
      Object.keys(groups).forEach((k) => {
        const key = r[k] || 'unknown';
        if (!groups[k].has(key)) groups[k].set(key, tally());
        add(groups[k].get(key), r.result);
      });
    });
    const list = (m) => [...m.entries()]
      .map(([key, t]) => ({ key, ...t, accuracy: pct(t) }))
      .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
    return {
      ...total,
      accuracy: pct(total),
      bySubject: list(groups.subject),
      byQtype: list(groups.qtype),
      byTournament: list(groups.tournament),
      byMode: list(groups.mode),
    };
  }

  const api = { SETTINGS_KEYS, mergeBookmarks, pickSettings, aggregateStats };
  global.SBAccountCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
