// The multiplayer room list, kept in a Supabase project's mp_rooms and
// mp_players tables (supabase/schema.sql; the project is named in
// js/config.js). Games run browser to browser; this only lets the lobby
// page list rooms with "N players - M online", keeps a room's players and
// scores after everyone has left, and marks rooms public or private. There
// are no accounts: the tables are open to anyone, and only hold room names,
// player names and practice scores. Without a project every call resolves
// to nothing and the lobby falls back to the built-in rooms.
(function () {
  const ONLINE_MS = 90 * 1000; // seen this recently = online
  const cfg = window.SB_CONFIG || {};
  const here = document.currentScript ? document.currentScript.src : '';
  const libUrl = here ? here.replace(/rooms\.js(\?.*)?$/, 'vendor/supabase.min.js') : 'js/vendor/supabase.min.js';
  let clientPromise = null;
  // The Supabase client, made on first use (the library is only loaded
  // when a project is set up).
  function client() {
    if (!(cfg.supabaseUrl && cfg.supabaseAnonKey)) return Promise.resolve(null);
    if (!clientPromise) {
      clientPromise = new Promise((resolve, reject) => {
        if (window.supabase && window.supabase.createClient) { resolve(); return; }
        const s = document.createElement('script');
        s.src = libUrl;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load the room list library.'));
        document.head.appendChild(s);
      }).then(() => window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        // No logins: nothing to keep between visits.
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })).catch((e) => { console.warn(e); return null; });
    }
    return clientPromise;
  }
  // Registry key for a room: its cleaned name, or "pub-<key>" for a
  // built-in public room.
  function key(name, permanentKey) { return permanentKey ? 'pub-' + permanentKey : name; }

  // Every room with its player and online counts, and the totals.
  async function list() {
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
    const out = (rooms || []).map((r) => ({ ...r, ...(counts.get(r.name) || { players: 0, online: 0 }) }));
    return {
      rooms: out,
      activePlayers: out.reduce((n, r) => n + r.online, 0),
      activeRooms: out.filter((r) => r.online > 0).length,
    };
  }

  const BASE_COLS = 'pid, username, score, correct, incorrect, last_seen';
  const STAT_COLS = 'negs, cel_sum, cel_n';
  // A room's players as last reported, for a room starting up again.
  async function roster(roomKey) {
    const c = await client();
    if (!c) return [];
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
    const now = new Date().toISOString();
    await c.from('mp_rooms').upsert({ name: roomKey, is_public: !!isPublic, is_permanent: !!isPermanent, updated_at: now }, { onConflict: 'name' });
    const row = {
      room: roomKey, pid: me.pid, username: me.name.slice(0, 24) || 'Player',
      score: me.score | 0, correct: me.correct | 0, incorrect: me.incorrect | 0, last_seen: now,
    };
    const stats = { negs: me.negs | 0, cel_sum: Math.max(0, Number(me.celSum) || 0), cel_n: me.celN | 0 };
    const { error } = await c.from('mp_players').upsert({ ...row, ...stats }, { onConflict: 'room,pid' });
    // Without the newer columns (an older schema), save the rest.
    if (error) await c.from('mp_players').upsert(row, { onConflict: 'room,pid' });
  }

  window.SBRooms = { list, roster, heartbeat, key, ONLINE_MS };
})();
