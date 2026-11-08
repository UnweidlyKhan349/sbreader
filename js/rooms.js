// The multiplayer room list, kept in the Supabase project's mp_rooms and
// mp_players tables (supabase/schema.sql) when accounts are set up. Games
// run browser to browser; this only lets the lobby page list rooms with
// "N players - M online", keeps a room's players and scores after everyone
// has left, and marks rooms public or private. Without a project every call
// resolves to nothing and the lobby falls back to the built-in rooms.
(function () {
  const ONLINE_MS = 90 * 1000; // seen this recently = online
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
  // The functions in supabase/schema.sql (mp_list, mp_roster, mp_heartbeat)
  // are the way in. A project that hasn't run the November 2026 schema
  // doesn't have them yet; then the tables are used directly, as before.
  function missingFn(error) { return !!error && (error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message || '')); }

  function summarize(rows) {
    return {
      rooms: rows,
      activePlayers: rows.reduce((n, r) => n + r.online, 0),
      activeRooms: rows.filter((r) => r.online > 0).length,
    };
  }

  // Every public room with its player and online counts, and the totals.
  async function list() {
    const c = await client();
    if (!c) return null;
    const { data, error } = await c.rpc('mp_list');
    if (!error) return summarize((data || []).map((r) => ({ ...r, players: r.players | 0, online: r.online | 0 })));
    if (!missingFn(error)) return null;
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
    const c = await client();
    if (!c) return [];
    const r = await c.rpc('mp_roster', { p_room: roomKey });
    if (!r.error) return r.data || [];
    if (!missingFn(r.error)) return [];
    let { data, error } = await c.from('mp_players').select(`${BASE_COLS}, ${STAT_COLS}`).eq('room', roomKey);
    // A project set up before negs and celerity were saved has no such
    // columns; read what it has.
    if (error) ({ data, error } = await c.from('mp_players').select(BASE_COLS).eq('room', roomKey));
    return error ? [] : (data || []);
  }

  // This player is in the room: called on joining and every 30 seconds
  // while there, with their current name and score.
  async function heartbeat(roomKey, { isPublic, isPermanent }, me) {
    const c = await client();
    if (!c || !roomKey || !me || !me.pid) return;
    const name = me.name.slice(0, 24) || 'Player';
    const { error } = await c.rpc('mp_heartbeat', {
      p_room: roomKey, p_is_public: !!isPublic, p_pid: me.pid, p_secret: mySecret(), p_username: name,
      p_score: me.score | 0, p_correct: me.correct | 0, p_incorrect: me.incorrect | 0,
      p_negs: me.negs | 0, p_cel_sum: Math.max(0, Number(me.celSum) || 0), p_cel_n: me.celN | 0,
    });
    if (!error || !missingFn(error)) return;
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

  window.SBRooms = { list, roster, heartbeat, key, ONLINE_MS };
})();
