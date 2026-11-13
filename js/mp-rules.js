/* SB Reader - multiplayer rules with no DOM or network code, so they can be
   tested in Node.

   cleanHostMessage: anyone with the room code can connect and send arbitrary
   data, so the player running the game (the coordinator) only ever acts on
   the cleaned copy this returns - known
   type, string fields cut to length, settings limited to values that exist
   in meta.json. */
(function (global) {
  const LIMITS = { name: 24, answer: 200, chat: 300 };
  // Reading speed, as on QB Reader: 0 (slowest) to 100, 50 by default.
  const RATE_MIN = 0;
  const RATE_MAX = 100;
  const RATE_DEFAULT = 50;
  function readingSpeed(v) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v == null ? NaN : v);
    return isFinite(n) ? Math.round(Math.max(RATE_MIN, Math.min(RATE_MAX, n))) : RATE_DEFAULT;
  }

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
      years: yearsOf(meta),
    };
  }
  // The first and last of the tournaments' years.
  function yearsOf(meta) {
    const ys = (meta.tournaments || []).map((t) => parseInt(String(t.date || '').slice(0, 4), 10)).filter((y) => y > 0);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
  }

  // announceRounds: the sender let go of the round slider; the room says what
  // the rounds are now (from its own settings, not the message).
  const NO_FIELDS = new Set(['buzz', 'next', 'togglePause', 'skip', 'override', 'announceRounds', 'announceYears', 'clearStats']);

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
  // QB Reader keeps rooms and players in its server's memory, and the
  // server restarts every day at 08:00 UTC: that's when offline players'
  // scores and idle rooms go. The same hour is kept here (and in
  // supabase/schema.sql, mp_last_restart). This is the latest restart at or
  // before `now`, in ms.
  const RESTART_HOUR_UTC = 8;
  function lastRestart(now) {
    const d = new Date(now);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESTART_HOUR_UTC);
    return t <= now ? t : t - 24 * 60 * 60 * 1000;
  }
  // Players who leave stay in the room's player list, marked offline, with
  // their score, until the next restart (there's no timer per player). This
  // checks the entry is well formed and from after the last one.
  function stillOffline(entry, now) {
    return !!entry && typeof entry.leftAt === 'number' && entry.leftAt >= lastRestart(now);
  }
  // As QB Reader's Player.hasActivity: has heard a question or answered
  // one. A player who leaves without any is taken off the list at once.
  function hasActivity(p) {
    return !!p && ['heard', 'correct', 'incorrect', 'negs'].some((k) => Number(p[k]) > 0);
  }

  // Rooms are named, as on QB Reader (multiplayer.html?room=<name>). A name
  // is kept to letters, digits and dashes (spaces become dashes), lower
  // case, at most 32 characters; its PeerJS door is sbowl-room-<name>.
  // "pub-" is the built-in rooms' prefix in the room list ("pub-all" is
  // General), so a name can't start with it: "pub-all" becomes "all".
  const ROOM_PREFIX = 'sbowl-room-';
  function cleanRoomName(name) {
    return (typeof name === 'string' ? name : '').toLowerCase().trim()
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '').replace(/^(?:pub(?:-|$))+/, '').replace(/^-+/, '')
      .slice(0, 32).replace(/-+$/, '');
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
  // by one each time a new player takes over. Follow a message when it's our
  // coordinator's (same term), or when it's a legitimate takeover:
  //   - the sender is a member of the room (in `order`),
  //   - the term is newer, but by at most MAX_TERM_STEP (a takeover adds
  //     one; a few in quick succession can add a little more), and
  //   - our coordinator has gone (isUp says so), or the sender is the one
  //     the room would pick next without it (the first player still up in
  //     the order, the same rule onMemberLeft uses).
  // So a larger number alone doesn't make anyone the coordinator. If two
  // players took over in the same term, the one earlier in the order wins.
  // Before we have a coordinator (just joined, when nobody is a member yet
  // to us), the first player to speak with a term is followed; once we've
  // named the next coordinator ourselves (ours left), its newer term is.
  // view: { term, coordinatorId, order, isUp(id) }
  const MAX_TERM_STEP = 3;
  function acceptsCoordinator(view, from, term) {
    if (typeof term !== 'number' || !Number.isFinite(term) || term < 0) return false;
    const order = view.order || [];
    if (view.coordinatorId == null) return true;
    if (from === view.coordinatorId) return term >= view.term && term - view.term <= MAX_TERM_STEP;
    if (!order.includes(from)) return false;
    if (term > view.term) {
      if (term - view.term > MAX_TERM_STEP) return false;
      const isUp = typeof view.isUp === 'function' ? view.isUp : () => true;
      if (!isUp(view.coordinatorId)) return true;
      return pickCoordinator(order.filter((id) => id !== view.coordinatorId), isUp) === from;
    }
    if (term < view.term) return false;
    const a = rankIn(order, from);
    const b = rankIn(order, view.coordinatorId);
    return a < b || (a === b && from < view.coordinatorId);
  }

  // Vote kicks, as on QB Reader: a player who has answered a question
  // correctly can start one (at most every 90 seconds); it needs three
  // quarters of the players online, and at least two votes; a kicked
  // player can't come back for 30 minutes.
  const VOTEKICK_COOLDOWN_MS = 90 * 1000;
  const KICK_BAN_MS = 30 * 60 * 1000;
  function votekickThreshold(online) { return Math.max(Math.floor((online || 0) * 3 / 4), 2); }
  function isKicked(kicked, pid, now) {
    if (!pid || !Array.isArray(kicked)) return false;
    const t = now == null ? Date.now() : now;
    return kicked.some((k) => k && k.pid === pid && t - k.at < KICK_BAN_MS);
  }

  // A room owner's proof, sent with 'join' (see the room owner section of
  // js/multiplayer.js): their public key ("x.y", base64url), the time, and
  // a signature, which whoever runs the game checks.
  const B64URL = /^[A-Za-z0-9_-]+$/;
  function cleanOwnerProof(v) {
    if (!v || typeof v !== 'object') return null;
    const key = typeof v.key === 'string' && v.key.length <= 200 && /^[A-Za-z0-9_-]{20,100}\.[A-Za-z0-9_-]{20,100}$/.test(v.key) ? v.key : '';
    const sig = typeof v.sig === 'string' && v.sig.length <= 200 && B64URL.test(v.sig) ? v.sig : '';
    const ts = typeof v.ts === 'number' && Number.isFinite(v.ts) ? v.ts : NaN;
    return key && sig && Number.isFinite(ts) ? { key, ts, sig } : null;
  }
  // What a room's owner can do to another player.
  const OWNER_ACTIONS = new Set(['mute', 'unmute', 'ban']);

  // Returns a cleaned copy of `msg`, or null when it should be ignored.
  // A chat message's ID ties its live, still-being-typed copy to the sent one.
  function cleanChatId(v) { return typeof v === 'string' && /^[a-z0-9]{4,16}$/.test(v) ? v : null; }

  function cleanHostMessage(msg, meta) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    const { type } = msg;
    if (NO_FIELDS.has(type)) return { type };
    if (type === 'join') {
      const out = { type, name: str(msg.name, LIMITS.name).trim() || 'Player' };
      const pid = cleanPid(msg.pid);
      if (pid) out.pid = pid;
      const owner = cleanOwnerProof(msg.owner);
      if (owner) out.owner = owner;
      return out;
    }
    if (type === 'ownerAction') {
      if (!OWNER_ACTIONS.has(msg.action)) return null;
      const targetId = str(msg.targetId, 80);
      const targetPid = cleanPid(msg.targetPid);
      if (!targetId && !targetPid) return null;
      return { type, action: msg.action, targetId: targetId || null, targetPid: targetPid || null };
    }
    if (type === 'votekick') {
      const targetId = str(msg.targetId, 80);
      return targetId ? { type, targetId } : null;
    }
    if (type === 'rename') {
      const name = str(msg.name, LIMITS.name).trim();
      return name ? { type, name } : null;
    }
    if (type === 'submitAnswer' || type === 'typing') return { type, text: str(msg.text, LIMITS.answer) };
    if (type === 'chatSend') {
      const text = str(msg.text, LIMITS.chat).trim();
      if (!text) return null;
      const cid = cleanChatId(msg.cid);
      return cid ? { type, text, cid } : { type, text };
    }
    if (type === 'updateSettings') {
      const known = settingsFromMeta(meta);
      let roundRange = null;
      if (Array.isArray(msg.roundRange) && msg.roundRange.length === 2) {
        const lo = Math.round(clampNumber(msg.roundRange[0], 1, known.maxRound, 1));
        const hi = Math.round(clampNumber(msg.roundRange[1], 1, known.maxRound, known.maxRound));
        roundRange = [Math.min(lo, hi), Math.max(lo, hi)];
      }
      // A year range within the bank's years; the whole span means no limit.
      let yearRange = null;
      if (known.years && Array.isArray(msg.yearRange) && msg.yearRange.length === 2) {
        const [first, last] = known.years;
        const lo = Math.round(clampNumber(msg.yearRange[0], first, last, first));
        const hi = Math.round(clampNumber(msg.yearRange[1], first, last, last));
        yearRange = [Math.min(lo, hi), Math.max(lo, hi)];
        if (yearRange[0] === first && yearRange[1] === last) yearRange = null;
      }
      return {
        type,
        // Questions are always random ones matching the filters. (Reading a
        // set's packets in order was a mode once; a message from an older
        // copy that still asks for it gets random questions.)
        mode: 'random',
        setName: '',
        packetNumbers: '',
        rebuzz: msg.rebuzz === true,
        // Allow skips (on unless turned off), and a controlled room (only
        // its owner changes the settings; the coordinator checks who asked).
        skip: msg.skip !== false,
        controlled: msg.controlled === true,
        timer: msg.timer !== false,
        isPublic: msg.isPublic !== false,
        subjects: knownValues(msg.subjects, known.subjects),
        qtypes: knownValues(msg.qtypes, known.qtypes),
        formats: knownValues(msg.formats, known.formats),
        levels: knownValues(msg.levels, known.levels),
        visuals: knownValues(msg.visuals, known.visuals),
        tournaments: knownValues(msg.tournaments, known.tournaments),
        roundRange,
        yearRange,
        includeUnlabeled: msg.includeUnlabeled !== false,
        rate: readingSpeed(msg.rate),
        // The sender's count of its own changes, echoed back so it can tell
        // a stale echo from its latest change.
        seq: Number.isSafeInteger(msg.seq) && msg.seq >= 0 ? msg.seq : 0,
      };
    }
    return null;
  }

  // Whether a player may flip their own grade on the current question:
  // they were graded, and nobody else has been overridden to correct.
  // Someone who was marked wrong may say "I was right" even after another
  // player was graded correct: the question is theirs then, and the other
  // player's answer is marked wrong (two players can't both score on one
  // question; see hostOverrideLastGrade). attempts: [{ playerId, correct }].
  // overrideLocked is the ID of the player overridden to correct (false if
  // none): only they may still take it back ("I was wrong"). A bare `true`
  // locks everyone.
  function canOverrideOwn(attempts, playerId, overrideLocked) {
    if (overrideLocked && overrideLocked !== playerId) return false;
    return attempts.some((a) => a.playerId === playerId);
  }

  // Public lobbies: rooms with a fixed, well-known code that anyone can join
  // from the lobby list. There's no server to keep them open: the first
  // player in opens one, and like any room it lasts as long as anyone is in
  // it. General lets the room pick its subjects and starts with every
  // subject but Energy; each subject but Energy also has its own room, fixed
  // to that subject.
  const PUBLIC_PREFIX = 'sbowl-pub-';
  const NO_PUBLIC_LOBBY = new Set(['energy']);
  function publicLobbies(meta) {
    const keys = (meta.subjects || []).map((s) => (typeof s === 'string' ? s : s.key));
    return [{ key: 'all', subjects: keys.filter((k) => !NO_PUBLIC_LOBBY.has(k)) }].concat(
      keys.filter((k) => !NO_PUBLIC_LOBBY.has(k)).map((k) => ({ key: k, subjects: [k] }))
    ).map((l) => ({ ...l, peerId: PUBLIC_PREFIX + l.key }));
  }
  // A lobby's name in links: "general" for General (key 'all', which its door
  // and room-list entry keep), the subject key for the others.
  function lobbySlug(lobby) { return lobby.key === 'all' ? 'general' : lobby.key; }
  function findPublicLobby(meta, key) {
    let k = typeof key === 'string' ? key.trim().toLowerCase() : '';
    if (k === 'general') k = 'all'; // ?lobby=general (and old ?lobby=all links)
    return publicLobbies(meta).find((l) => l.key === k) || null;
  }

  global.SBMpRules = { cleanOwnerProof, cleanChatId, votekickThreshold, isKicked, VOTEKICK_COOLDOWN_MS, KICK_BAN_MS, cleanRoomName, roomPeerId, ROOM_PREFIX, cleanHostMessage, canOverrideOwn, cleanPid, stillOffline, lastRestart, hasActivity, coordinatorOrder, pickCoordinator, acceptsCoordinator, MAX_TERM_STEP, publicLobbies, findPublicLobby, lobbySlug, LIMITS, RATE_MIN, RATE_MAX, RATE_DEFAULT, readingSpeed };
})(typeof window !== 'undefined' ? window : globalThis);
