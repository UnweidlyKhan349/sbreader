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

  // A room's players as last reported, for a room starting up again.
  async function roster(roomKey) {
    const c = await client();
    if (!c) return [];
    const { data, error } = await c.from('mp_players').select('pid, username, score, correct, incorrect, last_seen').eq('room', roomKey);
    return error ? [] : (data || []);
  }

  // This player is in the room: called on joining and every 30 seconds
  // while there, with their current name and score.
  async function heartbeat(roomKey, { isPublic, isPermanent }, me) {
    const c = await client();
    if (!c || !roomKey || !me || !me.pid) return;
    const now = new Date().toISOString();
    await c.from('mp_rooms').upsert({ name: roomKey, is_public: !!isPublic, is_permanent: !!isPermanent, updated_at: now }, { onConflict: 'name' });
    await c.from('mp_players').upsert({
      room: roomKey, pid: me.pid, username: me.name.slice(0, 24) || 'Player',
      score: me.score | 0, correct: me.correct | 0, incorrect: me.incorrect | 0, last_seen: now,
    }, { onConflict: 'room,pid' });
  }

  window.SBRooms = { list, roster, heartbeat, key, ONLINE_MS };
})();
