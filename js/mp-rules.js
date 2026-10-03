/* SciBowl Practice - multiplayer host rules with no DOM or network code, so
   they can be tested in Node.

   cleanHostMessage: anyone with the room code can connect and send arbitrary
   data, so the host only ever acts on the cleaned copy this returns - known
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
      tournaments: new Set((meta.tournaments || []).map((t) => t.slug)),
      maxRound: Math.max(1, ...rounds),
    };
  }

  const NO_FIELDS = new Set(['buzz', 'next', 'togglePause', 'skip', 'override']);

  // Returns a cleaned copy of `msg`, or null when it should be ignored.
  function cleanHostMessage(msg, meta) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    const { type } = msg;
    if (NO_FIELDS.has(type)) return { type };
    if (type === 'join') return { type, name: str(msg.name, LIMITS.name).trim() || 'Player' };
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
      return {
        type,
        subjects: knownValues(msg.subjects, known.subjects),
        qtypes: knownValues(msg.qtypes, known.qtypes),
        formats: knownValues(msg.formats, known.formats),
        levels: knownValues(msg.levels, known.levels),
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

  global.SBMpRules = { cleanHostMessage, canOverrideOwn, LIMITS, RATE_MIN, RATE_MAX };
})(typeof window !== 'undefined' ? window : globalThis);
