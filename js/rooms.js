// The multiplayer room list, kept in the Supabase project's mp_rooms and
// mp_players tables (supabase/schema.sql) when accounts are set up. Games
// run browser to browser; this only lets the lobby page list rooms with
// "N players - M online", keeps a room's players and scores after everyone
// has left, keeps a room's owner, bans and "controlled" switch, and marks
// rooms public or private. Without a project every call resolves to nothing
// and the lobby falls back to the built-in rooms.
//
// The calls go straight to the project's REST API with fetch, not through
// the Supabase library: the library is 214 KB and has to load and start
// before its first request, which held the lobby's list up by about a
// second. The functions are open to anyone with the publishable key, logged
// in or not, so no login token is needed.
(function () {
  const ONLINE_MS = 90 * 1000; // seen this recently = online
  const cfg = window.SB_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  function client() {
    if (!window.SBAccount || !SBAccount.enabled) return Promise.resolve(null);
    return SBAccount.ready.catch(() => null);
  }
  // Registry key for a room: its cleaned name, or "pub-<key>" for a
  // built-in public room.
  function key(name, permanentKey) { return permanentKey ? 'pub-' + permanentKey : name; }

  // This browser's secret for the room list: its player rows (and the rooms
  // it creates) can only be changed with it. Only a hash is stored there.
  const SECRET_KEY = 'sb_mp_secret';
  function mySecret() {
    let v = '';
    try { v = localStorage.getItem(SECRET_KEY) || ''; } catch (e) { /* storage blocked */ }
    if (/^[0-9a-f]{32}$/.test(v)) return v;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    v = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(SECRET_KEY, v); } catch (e) { /* this visit only */ }
    return v;
  }

  // A database function, called over REST: resolves { data, error }, where
  // error.missing means the project hasn't got the function (it hasn't run
  // the latest supabase/schema.sql).
  async function rpc(fn, args) {
    if (!enabled) return { data: null, error: { message: 'No project.' } };
    try {
      const res = await fetch(`${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return { data: body, error: null };
      const err = body && typeof body === 'object' ? body : {};
      return { data: null, error: { ...err, missing: err.code === 'PGRST202' || res.status === 404 } };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }

  function summarize(rows) {
    return {
      rooms: rows,
      activePlayers: rows.reduce((n, r) => n + r.online, 0),
      activeRooms: rows.filter((r) => r.online > 0).length,
    };
  }

  // The last list this browser saw, so the lobby can show it at once while
  // the current one is fetched (it's replaced within a moment).
  const CACHE_KEY = 'sb_mp_rooms_cache';
  const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  function cachedList() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Array.isArray(c.rows) && Date.now() - c.at < CACHE_MAX_AGE_MS) return summarize(c.rows);
    } catch (e) { /* none */ }
    return null;
  }

  // Every public room with its player and online counts, and the totals.
  // One request per page: later calls share it.
  let listPromise = null;
  function list() {
    if (!listPromise) listPromise = fetchList();
    return listPromise;
  }
  async function fetchList() {
    if (!enabled) return null;
    const { data, error } = await rpc('mp_list');
    if (!error) {
      const rows = (data || []).map((r) => ({ ...r, players: r.players | 0, online: r.online | 0 }));
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows })); } catch (e) { /* not kept */ }
      return summarize(rows);
    }
    if (!error.missing) return null;
    // A project from before the November 2026 schema: the tables directly.
    const c = await client();
    if (!c) return null;
    const [{ data: rooms, error: e1 }, { data: players, error: e2 }] = await Promise.all([
      c.from('mp_rooms').select('name, is_public, is_permanent'),
      c.from('mp_players').select('room, last_seen'),
    ]);
    if (e1 || e2) return null;
    const now = Date.now();
    const counts = new Map();
    (players || []).forEach((p) => {
      const t = counts.get(p.room) || { players: 0, online: 0 };
      t.players++;
      if (now - Date.parse(p.last_seen) < ONLINE_MS) t.online++;
      counts.set(p.room, t);
    });
    return summarize((rooms || []).filter((r) => r.is_public).map((r) => ({ ...r, ...(counts.get(r.name) || { players: 0, online: 0 }) })));
  }

  const BASE_COLS = 'pid, username, score, correct, incorrect, last_seen';
  const STAT_COLS = 'negs, cel_sum, cel_n';
  // A room's players as last reported, for a room starting up again.
  async function roster(roomKey) {
    if (!enabled) return [];
    const r = await rpc('mp_roster', { p_room: roomKey });
    if (!r.error) return r.data || [];
    if (!r.error.missing) return [];
    const c = await client();
    if (!c) return [];
    let { data, error } = await c.from('mp_players').select(`${BASE_COLS}, ${STAT_COLS}`).eq('room', roomKey);
    // A project set up before negs and celerity were saved has no such
    // columns; read what it has.
    if (error) ({ data, error } = await c.from('mp_players').select(BASE_COLS).eq('room', roomKey));
    return error ? [] : (data || []);
  }

  // Everything kept about a room, for whoever opens it:
  //   { exists, isPublic, ownerKey, banned: [pid], bannedAt: { pid: ms },
  //     controlled, players: [...] }
  // A ban lasts 30 minutes (the list has only the ones still running; a
  // project from before ban times gives no bannedAt).
  // exists is false for a room never seen before. Resolves null when there's
  // no project, or it can't be reached, or it predates room owners (then the
  // players come from mp_roster, with `legacy` set).
  async function roomInfo(roomKey) {
    if (!enabled || !roomKey) return null;
    const r = await rpc('mp_room', { p_room: roomKey });
    if (r.error) {
      if (!r.error.missing) return null;
      return { legacy: true, exists: null, players: await roster(roomKey) };
    }
    const d = r.data;
    if (!d || typeof d !== 'object') return { exists: false, isPublic: null, ownerKey: null, banned: [], bannedAt: {}, controlled: false, players: [] };
    const banned = Array.isArray(d.banned) ? d.banned.filter((x) => typeof x === 'string') : [];
    const bannedAt = {};
    if (d.ban_times && typeof d.ban_times === 'object') {
      banned.forEach((pid) => { const t = Number(d.ban_times[pid]); if (isFinite(t) && t > 0) bannedAt[pid] = t; });
    }
    return {
      exists: true,
      isPublic: d.is_public !== false,
      ownerKey: typeof d.owner_key === 'string' ? d.owner_key : null,
      banned,
      bannedAt,
      controlled: !!d.controlled,
      players: Array.isArray(d.players) ? d.players : [],
    };
  }

  // The room's creator records its owner key, bans and controlled switch
  // (creating the room's entry if it's new). Resolves true when saved, false
  // when this browser didn't create the room, null when there's no project
  // or it predates room owners; rejects when the save failed for now (no
  // connection, a server error), so the caller can try again.
  async function saveRoom(roomKey, { isPublic, ownerKey, banned, controlled }) {
    if (!enabled || !roomKey) return null;
    const r = await rpc('mp_set_room', {
      p_room: roomKey, p_secret: mySecret(), p_is_public: isPublic !== false, p_owner_key: ownerKey || null,
      p_banned: (banned || []).slice(0, 500), p_controlled: !!controlled,
    });
    if (r.error) {
      if (r.error.missing) return null;
      throw new Error(r.error.message || 'The room list could not be saved.');
    }
    return r.data === true;
  }

  let heardUnknown = false;
  // This player is in the room: called on joining and every 30 seconds
  // while there, with their current name and score.
  async function heartbeat(roomKey, { isPublic, isPermanent }, me) {
    if (!enabled || !roomKey || !me || !me.pid) return;
    const name = me.name.slice(0, 24) || 'Player';
    const args = {
      p_room: roomKey, p_is_public: !!isPublic, p_pid: me.pid, p_secret: mySecret(), p_username: name,
      p_score: me.score | 0, p_correct: me.correct | 0, p_incorrect: me.incorrect | 0,
      p_negs: me.negs | 0, p_cel_sum: Math.max(0, Number(me.celSum) || 0), p_cel_n: me.celN | 0,
    };
    // p_heard (questions heard in the room) was added in November 2026; a
    // project that hasn't run the schema since takes the call without it.
    let { error } = heardUnknown ? { error: { missing: true } } : await rpc('mp_heartbeat', { ...args, p_heard: Math.max(0, me.heard | 0) });
    if (error && error.missing) {
      ({ error } = await rpc('mp_heartbeat', args));
      if (!error) heardUnknown = true;
    }
    if (!error || !error.missing) return;
    const c = await client();
    if (!c) return;
    const now = new Date().toISOString();
    await c.from('mp_rooms').upsert({ name: roomKey, is_public: !!isPublic, is_permanent: !!isPermanent, updated_at: now }, { onConflict: 'name' });
    const row = {
      room: roomKey, pid: me.pid, username: name,
      score: me.score | 0, correct: me.correct | 0, incorrect: me.incorrect | 0, last_seen: now,
    };
    const stats = { negs: me.negs | 0, cel_sum: Math.max(0, Number(me.celSum) || 0), cel_n: me.celN | 0 };
    const r2 = await c.from('mp_players').upsert({ ...row, ...stats }, { onConflict: 'room,pid' });
    // Without the newer columns (an older schema), save the rest.
    if (r2.error) await c.from('mp_players').upsert(row, { onConflict: 'room,pid' });
  }

  window.SBRooms = { enabled, list, cachedList, roster, roomInfo, saveRoom, heartbeat, key, ONLINE_MS };
})();
