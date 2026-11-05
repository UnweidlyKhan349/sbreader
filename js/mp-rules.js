/* SB Reader - multiplayer rules with no DOM or network code, so they can be
   tested in Node.

   cleanHostMessage: anyone with the room code can connect and send arbitrary
   data, so the player running the game (the coordinator) only ever acts on
   the cleaned copy this returns - known
   type, string fields cut to length, settings limited to values that exist
   in meta.json. */
(function (global) {
  const LIMITS = { name: 24, answer: 200, chat: 300 };
  const RATE_MIN = 0.5;
  const RATE_MAX = 2.5;

  function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }
  function knownValues(v, allowed) {
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x) => typeof x === 'string' && allowed.has(x)))];
  }
  function clampNumber(v, lo, hi, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  }

  function settingsFromMeta(meta) {
    const keyOf = (s) => (typeof s === 'string' ? s : s.key);
    const rounds = meta.rounds && meta.rounds.length ? meta.rounds : [1];
    return {
      subjects: new Set((meta.subjects || []).map(keyOf)),
      qtypes: new Set(meta.qtypes || []),
      formats: new Set(meta.formats || []),
      levels: new Set(meta.levels || ['hs', 'ms']),
      visuals: new Set(['visual', 'text']),
      tournaments: new Set((meta.tournaments || []).map((t) => t.slug)),
      maxRound: Math.max(1, ...rounds),
    };
  }

  const NO_FIELDS = new Set(['buzz', 'next', 'togglePause', 'skip', 'override']);

  // A player's ID for the life of their browser, sent with 'join' so a
  // player who drops out and comes back gets their score back. Not a secret: it only ever guards a practice score.
  const PID_RE = /^[A-Za-z0-9_-]{8,40}$/;
  function cleanPid(v) {
    return typeof v === 'string' && PID_RE.test(v) ? v : '';
  }

  /* Who runs the game. Every player holds the whole live game, but buzzes,
     timers and grading still need one player to rule on them, the
     "coordinator". It's simply the longest-standing player still connected,
     so when they leave, everyone agrees at once on who carries on, and that
     player continues from their own copy without missing a beat.

     coordinatorOrder: the room's player IDs in joining order, then anyone
     connected who isn't on the list yet (in ID order). */
  function coordinatorOrder(playerIds, extraIds) {
    const out = [];
    const seen = new Set();
    const add = (id) => { if (typeof id === 'string' && !seen.has(id)) { seen.add(id); out.push(id); } };
    (playerIds || []).forEach(add);
    [...(extraIds || [])].sort().forEach(add);
    return out;
  }
  function pickCoordinator(order, isUp) {
    return order.find((id) => isUp(id)) || null;
  }
  // A player who leaves stays on the leaderboard, marked offline, for an hour
  // (with their score, for if they come back). Whether `entry` ({ leftAt })
  // should still be shown at time `now`.
  // Players who leave stay in the room's player list, marked offline, for
  // good (as on QB Reader): this only checks the entry is well formed.
  const OFFLINE_KEEP_MS = Infinity;
  function stillOffline(entry, now) {
    return !!entry && typeof entry.leftAt === 'number' && now - entry.leftAt < OFFLINE_KEEP_MS;
  }

  // Rooms are named, as on QB Reader (multiplayer.html?room=<name>). A name
  // is kept to letters, digits and dashes (spaces become dashes), lower
  // case, at most 32 characters; its PeerJS door is sbowl-room-<name>.
  const ROOM_PREFIX = 'sbowl-room-';
  function cleanRoomName(name) {
    return (typeof name === 'string' ? name : '').toLowerCase().trim()
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  }
  function roomPeerId(name) {
    const clean = cleanRoomName(name);
    return clean ? ROOM_PREFIX + clean : '';
  }

  function rankIn(order, id) {
    const i = order.indexOf(id);
    return i < 0 ? Infinity : i;
  }
  // Every message from a coordinator is stamped with its term, which goes up
  // by one each time a new player takes over. Follow a message when its term
  // is newer than ours, or it's our coordinator's; if two players took over
  // in the same term, the one earlier in the order wins.
  // view: { term, coordinatorId, order }
  function acceptsCoordinator(view, from, term) {
    if (typeof term !== 'number' || !Number.isFinite(term)) return false;
    if (term !== view.term) return term > view.term;
    if (from === view.coordinatorId) return true;
    const a = rankIn(view.order, from);
    const b = rankIn(view.order, view.coordinatorId);
    return a < b || (a === b && from < view.coordinatorId);
  }

  // Returns a cleaned copy of `msg`, or null when it should be ignored.
  function cleanHostMessage(msg, meta) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    const { type } = msg;
    if (NO_FIELDS.has(type)) return { type };
    if (type === 'join') {
      const out = { type, name: str(msg.name, LIMITS.name).trim() || 'Player' };
      const pid = cleanPid(msg.pid);
      if (pid) out.pid = pid;
      return out;
    }
    if (type === 'rename') {
      const name = str(msg.name, LIMITS.name).trim();
      return name ? { type, name } : null;
    }
    if (type === 'submitAnswer' || type === 'typing') return { type, text: str(msg.text, LIMITS.answer) };
    if (type === 'chatSend') {
      const text = str(msg.text, LIMITS.chat).trim();
      return text ? { type, text } : null;
    }
    if (type === 'updateSettings') {
      const known = settingsFromMeta(meta);
      let roundRange = null;
      if (Array.isArray(msg.roundRange) && msg.roundRange.length === 2) {
        const lo = Math.round(clampNumber(msg.roundRange[0], 1, known.maxRound, 1));
        const hi = Math.round(clampNumber(msg.roundRange[1], 1, known.maxRound, known.maxRound));
        roundRange = [Math.min(lo, hi), Math.max(lo, hi)];
      }
      const setName = str(msg.setName, 80);
      return {
        type,
        // How questions are chosen: random (filters) or a set's packets.
        mode: msg.mode === 'set' ? 'set' : 'random',
        setName: known.tournaments.has(setName) ? setName : '',
        packetNumbers: str(msg.packetNumbers, 60).replace(/[^0-9,\s-]/g, ''),
        rebuzz: msg.rebuzz === true,
        timer: msg.timer !== false,
        isPublic: msg.isPublic !== false,
        subjects: knownValues(msg.subjects, known.subjects),
        qtypes: knownValues(msg.qtypes, known.qtypes),
        formats: knownValues(msg.formats, known.formats),
        levels: knownValues(msg.levels, known.levels),
        visuals: knownValues(msg.visuals, known.visuals),
        tournaments: knownValues(msg.tournaments, known.tournaments),
        roundRange,
        includeUnlabeled: msg.includeUnlabeled !== false,
        rate: clampNumber(msg.rate, RATE_MIN, RATE_MAX, 1),
      };
    }
    return null;
  }

  // Whether a player may flip their own grade on the current question:
  // they were graded, nobody has overridden to correct yet, and - for a
  // wrong answer - nobody else was already graded correct (two players
  // can't both score on one question). attempts: [{ playerId, correct }].
  function canOverrideOwn(attempts, playerId, overrideLocked) {
    if (overrideLocked) return false;
    const mine = attempts.find((a) => a.playerId === playerId);
    if (!mine) return false;
    return mine.correct || !attempts.some((a) => a.playerId !== playerId && a.correct);
  }

  // Public lobbies: rooms with a fixed, well-known code that anyone can join
  // from the lobby list. There's no server to keep them open: the first
  // player in opens one, and like any room it lasts as long as anyone is in
  // it. One lobby covers every subject, and each subject but energy has its
  // own.
  const PUBLIC_PREFIX = 'sbowl-pub-';
  const NO_PUBLIC_LOBBY = new Set(['energy']);
  function publicLobbies(meta) {
    const keys = (meta.subjects || []).map((s) => (typeof s === 'string' ? s : s.key));
    return [{ key: 'all', subjects: keys }].concat(
      keys.filter((k) => !NO_PUBLIC_LOBBY.has(k)).map((k) => ({ key: k, subjects: [k] }))
    ).map((l) => ({ ...l, peerId: PUBLIC_PREFIX + l.key }));
  }
  function findPublicLobby(meta, key) {
    const k = typeof key === 'string' ? key.trim().toLowerCase() : '';
    return publicLobbies(meta).find((l) => l.key === k) || null;
  }

  global.SBMpRules = { cleanRoomName, roomPeerId, ROOM_PREFIX, cleanHostMessage, canOverrideOwn, cleanPid, stillOffline, OFFLINE_KEEP_MS, coordinatorOrder, pickCoordinator, acceptsCoordinator, publicLobbies, findPublicLobby, LIMITS, RATE_MIN, RATE_MAX };
})(typeof window !== 'undefined' ? window : globalThis);
