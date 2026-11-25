// Account logic with no network or DOM, shared by js/account.js and the
// tests: merging bookmarks, picking which settings win, and the numbers on
// the stats and graphs pages.
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

  /* ---------------- Stats (the Tossup Stats / Bonus Stats pages) ---------------- */
  // An answers row as the stats pages count it. Science Bowl scoring: +4
  // right, -4 for a wrong interrupt, 0 for any other wrong answer; a
  // question you never buzzed on is "dead". Rows saved before points were
  // stored have none: a right answer was 4 and the rest count as 0.
  //   outcome: correct | incorrect | neg | dead
  //   celerity: the share of the question still unread at the buzz (0-1)
  //   day: the local date it was played, YYYY-MM-DD
  function dayKey(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }
  function normalizeAnswer(r) {
    const points = typeof r.points === 'number' ? r.points : (r.result === 'correct' ? 4 : 0);
    const outcome = r.result === 'correct' ? 'correct' : r.result === 'skipped' ? 'dead' : points < 0 ? 'neg' : 'incorrect';
    const celerity = outcome !== 'dead' && typeof r.celerity === 'number' && r.celerity >= 0 && r.celerity <= 1 ? r.celerity : null;
    return { ...r, qtype: r.qtype === 'bonus' ? 'bonus' : 'tossup', points, outcome, celerity, day: dayKey(r.created_at) };
  }

  // f: { qtype, tossups, bonuses, solo, mp, set, levels, start, end }: one
  // question type, or tossups / bonuses switched off; which modes count
  // (both unless switched off), one tournament by name, the
  // levels (none means all), and the first and last day (YYYY-MM-DD).
  function filterAnswers(rows, f) {
    f = f || {};
    const set = (f.set || '').trim().toLowerCase();
    const levels = f.levels && f.levels.length ? new Set(f.levels) : null;
    return rows.filter((r) => {
      if (f.qtype && r.qtype !== f.qtype) return false;
      if (f.tossups === false && r.qtype !== 'bonus') return false;
      if (f.bonuses === false && r.qtype === 'bonus') return false;
      if (f.solo === false && r.mode !== 'mp') return false;
      if (f.mp === false && r.mode === 'mp') return false;
      if (set && String(r.tournament || '').toLowerCase() !== set) return false;
      if (levels && !levels.has(r.level)) return false;
      if (f.start && (!r.day || r.day < f.start)) return false;
      if (f.end && (!r.day || r.day > f.end)) return false;
      return true;
    });
  }

  // One line of a stats table: questions heard, how many gave 4, 0 and -4,
  // dead ones, points, and celerity (averaged over the right answers, as QB
  // Reader does; buzzpoint is averaged over every buzz).
  function statLine(key) {
    return { key, count: 0, fours: 0, zeros: 0, negs: 0, dead: 0, points: 0, celSum: 0, celN: 0, buzzSum: 0, buzzN: 0 };
  }
  function addTo(t, r) {
    t.count++;
    t.points += r.points;
    if (r.outcome === 'correct') t.fours++;
    else if (r.outcome === 'neg') t.negs++;
    else if (r.outcome === 'dead') t.dead++;
    else t.zeros++;
    if (r.celerity != null) {
      t.buzzSum += r.celerity; t.buzzN++;
      if (r.outcome === 'correct') { t.celSum += r.celerity; t.celN++; }
    }
  }
  function finish(t) {
    t.celerity = t.celN ? t.celSum / t.celN : 0;
    t.buzzpoint = t.buzzN ? t.buzzSum / t.buzzN : 0;
    t.ppq = t.count ? t.points / t.count : 0;
    return t;
  }
  function totalStats(rows) {
    const t = statLine('Total');
    rows.forEach((r) => addTo(t, r));
    return finish(t);
  }
  // Rows grouped by keyOf(row), most heard first.
  function groupStats(rows, keyOf) {
    const groups = new Map();
    rows.forEach((r) => {
      const key = keyOf(r) || 'Unknown';
      if (!groups.has(key)) groups.set(key, statLine(key));
      addTo(groups.get(key), r);
    });
    return [...groups.values()].map(finish).sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }
  // The earliest right answer: the highest celerity (the newest on a tie).
  function bestBuzz(rows) {
    let best = null;
    rows.forEach((r) => {
      if (r.outcome !== 'correct' || r.celerity == null) return;
      if (!best || r.celerity > best.celerity || (r.celerity === best.celerity && r.created_at > best.created_at)) best = r;
    });
    return best;
  }
  // One line per day played, oldest first (the Graphs pages).
  function dailyStats(rows) {
    return groupStats(rows.filter((r) => r.day), (r) => r.day).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  // Every answer as a CSV file, one line each, newest first.
  const CSV_HEADER = ['created', 'question_id', 'set', 'level', 'subject', 'type', 'format', 'multiplayer', 'result', 'celerity', 'points'];
  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function answersCsv(rows) {
    const lines = rows.map((r) => [r.created_at, r.question_id, r.tournament, r.level, r.subject, r.qtype, r.format,
      r.mode === 'mp', r.outcome, r.celerity == null ? '' : Math.round(r.celerity * 1000) / 1000, r.points].map(csvCell).join(','));
    return [CSV_HEADER.join(','), ...lines].join('\n') + '\n';
  }

  const api = { SETTINGS_KEYS, mergeBookmarks, pickSettings, normalizeAnswer, filterAnswers, totalStats, groupStats, bestBuzz, dailyStats, answersCsv };
  global.SBAccountCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
