/* Thin wrapper around PeerJS for a star-topology multiplayer room.
   Host holds the authoritative game state; every client only ever
   talks to the host (no client-to-client connections). */
(function (global) {
  // Google's public STUN servers, which let players find a direct route to
  // each other. There's no TURN relay.
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // How long we let a connection attempt hang before giving up and
  // surfacing a clear error, instead of leaving the UI stuck on
  // "Connecting..." forever with no feedback.
  const CONNECT_TIMEOUT_MS = 15000;

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { isTimeout: true })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // PeerJS failures come back as an Error with a `.type` (see PeerJS docs) -
  // translate the common ones into something a non-technical user can act
  // on, instead of a raw error object/type string.
  function friendlyPeerError(err) {
    const type = err && err.type;
    if (err && err.message && /^Timed out|^Could not connect/.test(err.message)) {
      return err.message;
    }
    switch (type) {
      case 'peer-unavailable':
        return 'No room found with that code. Double-check it (including capitalization) and make sure the host is still on the lobby screen.';
      case 'network':
      case 'socket-error':
      case 'socket-closed':
      case 'server-error':
      case 'ssl-unavailable':
        return 'Could not reach the connection service. Check your internet connection and try again.';
      case 'webrtc':
        return 'Your browser could not establish a direct connection to the other player. Try again, or try a different network.';
      case 'browser-incompatible':
        return 'This browser doesn’t support the features multiplayer needs. Try the latest Chrome, Edge, or Firefox.';
      case 'unavailable-id':
        return 'That room code is already in use — try creating the room again.';
      default:
        return (err && (err.message || type)) ? `Connection failed (${err.message || type}).` : 'Connection failed. Check your network connection and try again.';
    }
  }

  // Noticing that the other end is gone. PeerJS only closes a connection
  // once ICE reaches 'failed', which can take a long while after a tab is
  // closed, so the room would sit waiting for a host (or a player) who left.
  // The browser's own consent checks move ICE to 'disconnected' within
  // seconds, unaffected by timer throttling, so that's the main signal. A
  // ping every few seconds is the fallback: SILENCE_MS is longer than a
  // hidden tab's slowest timers (about once a minute), so a backgrounded
  // player isn't dropped for that alone.
  const ICE_GRACE_MS = 8000;
  const PING_MS = 5000;
  const SILENCE_MS = 75000;
  const PING = '__ping';
  function watchConn(conn, onDead) {
    let lastHeard = Date.now();
    let iceTimer = null;
    let done = false;
    const stop = () => { done = true; clearInterval(pinger); clearTimeout(iceTimer); };
    const dead = () => { if (done) return; stop(); try { conn.close(); } catch (e) { /* already closed */ } onDead(); };
    conn.on('iceStateChanged', (state) => {
      if (state === 'disconnected') {
        if (!iceTimer) iceTimer = setTimeout(dead, ICE_GRACE_MS);
      } else if (state === 'connected' || state === 'completed') {
        clearTimeout(iceTimer);
        iceTimer = null;
      }
    });
    conn.on('close', stop);
    const pinger = setInterval(() => {
      if (Date.now() - lastHeard > SILENCE_MS) { dead(); return; }
      if (conn.open) conn.send({ type: PING });
    }, PING_MS);
    // Call with each message; true means it was a ping, for this layer only.
    return (data) => { lastHeard = Date.now(); return !!(data && data.type === PING); };
  }

  function randomRoomCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  // peerId: a fixed ID to claim (a public lobby's) instead of a random room
  // code. If someone already holds it, `ready` rejects with 'unavailable-id'.
  function makeHost({ peerId, onPlayerMessage, onPlayerConnect, onPlayerDisconnect, onError }) {
    const roomCode = peerId || 'sbowl-' + randomRoomCode();
    let peer;
    try {
      peer = new Peer(roomCode, { debug: 0, config: ICE_CONFIG });
    } catch (err) {
      // If the PeerJS library itself failed to load/initialize (blocked
      // script, unsupported browser, etc.) this throws synchronously - catch
      // it and report it like any other connection failure instead of
      // leaving the caller with an uncaught exception and a UI stuck on
      // "Connecting..." forever.
      const failure = Promise.reject(err);
      failure.catch(() => {});
      onError && onError(err);
      return { roomCode, peer: null, ready: failure, broadcast() {}, sendTo() {}, closeConn() {}, playerCount() { return 0; }, close() {} };
    }
    const conns = new Map();
    // Each failure reaches onError exactly once: through the single 'error'
    // listener below, or - for the timeout, which isn't a PeerJS error -
    // through the catch on `ready`.
    const rawReady = new Promise((resolve, reject) => {
      peer.on('open', (id) => { resolve(id); });
      peer.on('error', reject);
    });
    const api = {
      roomCode, peer,
      ready: withTimeout(
        rawReady,
        CONNECT_TIMEOUT_MS,
        'Timed out setting up the room. Check your internet connection and try again.'
      ).catch((err) => { if (err && err.isTimeout && onError) onError(err); throw err; }),
      broadcast(data) { for (const c of conns.values()) { if (c.open) c.send(data); } },
      sendTo(connId, data) { const c = conns.get(connId); if (c && c.open) c.send(data); },
      closeConn(connId) { const c = conns.get(connId); if (c) c.close(); },
      playerCount() { return conns.size; },
      close() { for (const c of conns.values()) c.close(); peer.destroy(); },
    };
    peer.on('connection', (conn) => {
      conns.set(conn.peer, conn);
      // Each of these can fire for one connection; onPlayerDisconnect must
      // cope with being told more than once.
      const drop = () => { if (conns.get(conn.peer) === conn) conns.delete(conn.peer); onPlayerDisconnect && onPlayerDisconnect(conn.peer); };
      const heard = watchConn(conn, drop);
      conn.on('data', (data) => { if (!heard(data) && onPlayerMessage) onPlayerMessage(conn.peer, data); });
      conn.on('open', () => { onPlayerConnect && onPlayerConnect(conn.peer); });
      conn.on('close', drop);
      conn.on('error', drop);
    });
    peer.on('error', (err) => onError && onError(err));
    return api;
  }

  function makeClient(roomCode, { onHostMessage, onDisconnect, onError }) {
    let peer;
    try {
      peer = new Peer({ debug: 0, config: ICE_CONFIG });
    } catch (err) {
      const failure = Promise.reject(err);
      failure.catch(() => {});
      onError && onError(err);
      return { peer: null, ready: failure, send() {}, close() {} };
    }
    let conn = null;
    // As in makeHost: one onError call per failure.
    const report = (err) => { if (onError) onError(err); };
    let gone = false;
    const disconnected = () => { if (gone) return; gone = true; onDisconnect && onDisconnect(); };
    const rawReady = new Promise((resolve, reject) => {
      peer.on('open', () => {
        conn = peer.connect(roomCode.trim(), { reliable: true });
        const heard = watchConn(conn, disconnected);
        conn.on('open', () => { resolve(); });
        conn.on('data', (data) => { if (!heard(data) && onHostMessage) onHostMessage(data); });
        conn.on('close', disconnected);
        conn.on('error', (err) => { report(err); reject(err); });
      });
      peer.on('error', (err) => { report(err); reject(err); });
    });
    const api = {
      peer,
      ready: withTimeout(
        rawReady,
        CONNECT_TIMEOUT_MS,
        'Could not connect. Check the room code and your internet connection, then try again.'
      ).catch((err) => { if (err && err.isTimeout) report(err); throw err; }),
      send(data) { if (conn && conn.open) conn.send(data); },
      close() { if (conn) conn.close(); peer.destroy(); },
    };
    return api;
  }

  // Asks each room in `ids` how many players it has, without joining:
  // connects, sends 'peek', and waits for the host's 'peekInfo'. Resolves to
  // a Map of id -> player count, 0 for a room nobody is hosting, or null when
  // the connection failed. The broker usually reports an ID nobody holds as
  // 'peer-unavailable' at once, but not reliably for one asked about
  // recently, so a room that hasn't answered by the timeout counts as empty
  // too: a live host answers within a second or two.
  const PROBE_TIMEOUT_MS = 8000;
  const PROBE_FATAL = new Set(['browser-incompatible', 'invalid-id', 'invalid-key', 'network', 'ssl-unavailable', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id']);
  function probeRooms(ids) {
    const results = new Map();
    return new Promise((resolve) => {
      let peer = null;
      let timer = null;
      const finish = (unanswered) => {
        clearTimeout(timer);
        ids.forEach((id) => { if (!results.has(id)) results.set(id, unanswered); });
        try { if (peer) peer.destroy(); } catch (e) { /* already gone */ }
        resolve(results);
      };
      const settle = (id, value) => {
        if (results.has(id)) return;
        results.set(id, value);
        if (results.size >= ids.length) finish(null);
      };
      if (!ids.length) { resolve(results); return; }
      timer = setTimeout(() => finish(0), PROBE_TIMEOUT_MS);
      try {
        peer = new Peer({ debug: 0, config: ICE_CONFIG });
      } catch (err) {
        finish(null);
        return;
      }
      peer.on('open', () => {
        ids.forEach((id) => {
          const conn = peer.connect(id, { reliable: true });
          conn.on('open', () => conn.send({ type: 'peek' }));
          conn.on('data', (data) => {
            if (data && data.type === 'peekInfo') {
              settle(id, Math.max(0, Math.floor(Number(data.players)) || 0));
              conn.close();
            }
          });
          conn.on('error', () => settle(id, null));
        });
      });
      peer.on('error', (err) => {
        const type = err && err.type;
        if (type === 'peer-unavailable') {
          const m = /peer (\S+)/.exec(err.message || '');
          if (m && ids.includes(m[1])) settle(m[1], 0);
        } else if (PROBE_FATAL.has(type)) {
          finish(null);
        }
        // Anything else concerns one connection, which its own handlers
        // (or the timeout) settle.
      });
    });
  }

  global.SBPeer = { makeHost, makeClient, probeRooms, friendlyPeerError };
})(window);
