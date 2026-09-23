/* Thin wrapper around PeerJS for a star-topology multiplayer room.
   Host holds the authoritative game state; every client only ever
   talks to the host (no client-to-client connections). */
(function (global) {
  // PeerJS defaults to Google's public STUN servers only, with no TURN
  // fallback. STUN alone can't traverse symmetric NATs / many restrictive
  // networks, which is a common cause of WebRTC connections hanging forever
  // in the "connecting" state. Add STUN + a public TURN relay (Open Relay
  // Project) as a fallback so connections have a much better chance of
  // completing across real-world networks.
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  };

  // How long we let a connection attempt hang before giving up and
  // surfacing a clear error, instead of leaving the UI stuck on
  // "Connecting..." forever with no feedback.
  const CONNECT_TIMEOUT_MS = 15000;

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
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

  function randomRoomCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  function makeHost({ onPlayerMessage, onPlayerConnect, onPlayerDisconnect, onError }) {
    const roomCode = 'sbowl-' + randomRoomCode();
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
      return { roomCode, peer: null, ready: failure, broadcast() {}, sendTo() {}, playerCount() { return 0; }, close() {} };
    }
    const conns = new Map();
    const rawReady = new Promise((resolve, reject) => {
      peer.on('open', (id) => { resolve(id); });
      peer.on('error', (err) => { onError && onError(err); reject(err); });
    });
    const api = {
      roomCode, peer,
      ready: withTimeout(
        rawReady,
        CONNECT_TIMEOUT_MS,
        'Timed out setting up the room. Check your internet connection and try again.'
      ).catch((err) => { onError && onError(err); throw err; }),
      broadcast(data) { for (const c of conns.values()) { if (c.open) c.send(data); } },
      sendTo(connId, data) { const c = conns.get(connId); if (c && c.open) c.send(data); },
      playerCount() { return conns.size; },
      close() { for (const c of conns.values()) c.close(); peer.destroy(); },
    };
    peer.on('connection', (conn) => {
      conns.set(conn.peer, conn);
      conn.on('data', (data) => onPlayerMessage && onPlayerMessage(conn.peer, data));
      conn.on('open', () => { onPlayerConnect && onPlayerConnect(conn.peer); });
      conn.on('close', () => { conns.delete(conn.peer); onPlayerDisconnect && onPlayerDisconnect(conn.peer); });
      conn.on('error', (err) => { conns.delete(conn.peer); onPlayerDisconnect && onPlayerDisconnect(conn.peer); });
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
    let settled = false;
    const rawReady = new Promise((resolve, reject) => {
      peer.on('open', (id) => {
        conn = peer.connect(roomCode.trim(), { reliable: true });
        conn.on('open', () => { resolve(); });
        conn.on('data', (data) => onHostMessage && onHostMessage(data));
        conn.on('close', () => { onDisconnect && onDisconnect(); });
        conn.on('error', (err) => { onError && onError(err); reject(err); });
      });
      peer.on('error', (err) => { onError && onError(err); reject(err); });
    });
    const api = {
      peer,
      ready: withTimeout(
        rawReady,
        CONNECT_TIMEOUT_MS,
        'Could not connect. Check the room code and your internet connection, then try again.'
      ).then((v) => { settled = true; return v; }).catch((err) => {
        if (!settled) { onError && onError(err); }
        settled = true;
        throw err;
      }),
      send(data) { if (conn && conn.open) conn.send(data); },
      close() { if (conn) conn.close(); peer.destroy(); },
    };
    return api;
  }

  global.SBPeer = { makeHost, makeClient, friendlyPeerError };
})(window);
