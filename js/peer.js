/* Thin wrapper around PeerJS for multiplayer rooms: a full mesh in which
   every player is connected to every other (see makeMesh), plus the
   lobby-list probe (probeRooms). */
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
  const ICE_GRACE_MS = 3000;
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

  /* ---------- Mesh: a room that belongs to nobody ----------
     Every player connects to every other player. The room's code is only a
     "door": whoever holds that peer ID answers newcomers with the list of
     players to connect to (and lobby-list probes with a player count). The
     door can change hands without anyone in the room noticing.

     makeMesh({ onMessage(fromId, data), onJoin(id), onLeave(id, graceful), doorInfo() })
       ready              resolves with this player's own peer ID
       join(roomId)       through the door: connects to every player listed;
                          resolves { members, ...doorInfo } (the ones reached)
       claimDoor(roomId)  takes the room's ID; rejects 'unavailable-id' if held
       releaseDoor(), holdsDoor()
       send(id, data), broadcast(data), isUp(id), memberIds()
       connectTo(id)      (re)connects to one player
       leave()            tells everyone, then closes everything */
  const MESH_CONNECT_MS = 10000;
  const DOOR_HOLD_MS = 15000;
  const BYE = '__bye';

  function makeMesh({ onMessage, onJoin, onLeave, doorInfo }) {
    const conns = new Map();
    let self;
    let door = null;
    // Failed connects come back as errors on the peer, naming the ID.
    const pending = new Map(); // peer ID -> reject
    try {
      self = new Peer({ debug: 0, config: ICE_CONFIG });
    } catch (err) {
      const failure = Promise.reject(err);
      failure.catch(() => {});
      return { ready: failure, id: null, join: () => failure, claimDoor: () => failure, releaseDoor() {}, holdsDoor: () => false, send() {}, broadcast() {}, isUp: () => false, memberIds: () => [], connectTo: () => failure, leave() {} };
    }
    const ready = withTimeout(new Promise((resolve, reject) => {
      self.on('open', resolve);
      self.on('error', (err) => {
        const m = err && err.type === 'peer-unavailable' && /peer (\S+)/.exec(err.message || '');
        if (m && pending.has(m[1])) { pending.get(m[1])(err); return; }
        reject(err);
      });
    }), CONNECT_TIMEOUT_MS, 'Timed out reaching the connection service. Check your internet connection and try again.');
    ready.catch(() => {});
    self.on('disconnected', () => {
      setTimeout(() => { if (!self.destroyed && self.disconnected) self.reconnect(); }, 1000);
    });

    function adopt(conn) {
      const id = conn.peer;
      const old = conns.get(id);
      conns.set(id, conn);
      if (old && old !== conn) { try { old.close(); } catch (e) { /* replaced */ } }
      let gone = false;
      const drop = (graceful) => {
        if (gone) return;
        gone = true;
        if (conns.get(id) !== conn) return; // replaced by a newer link
        conns.delete(id);
        if (onLeave) onLeave(id, !!graceful);
      };
      const heard = watchConn(conn, () => drop(false));
      conn.on('data', (data) => {
        if (heard(data)) return;
        if (data && data.type === BYE) { drop(true); try { conn.close(); } catch (e) { /* gone */ } return; }
        if (onMessage) onMessage(id, data);
      });
      conn.on('close', () => drop(false));
      conn.on('error', () => drop(false));
      if (!old && onJoin) onJoin(id);
    }
    self.on('connection', (conn) => {
      conn.on('open', () => adopt(conn));
    });

    function connectTo(id) {
      return ready.then(() => withTimeout(new Promise((resolve, reject) => {
        pending.set(id, reject);
        const conn = self.connect(id, { reliable: true });
        conn.on('open', () => { pending.delete(id); adopt(conn); resolve(id); });
        conn.on('error', (err) => { pending.delete(id); reject(err); });
      }), MESH_CONNECT_MS, 'Could not reach a player.').finally(() => pending.delete(id)));
    }

    function join(roomId) {
      return ready.then(() => withTimeout(new Promise((resolve, reject) => {
        pending.set(roomId, reject);
        const conn = self.connect(roomId, { reliable: true });
        conn.on('open', () => conn.send({ type: '__hello' }));
        conn.on('error', (err) => reject(err));
        conn.on('data', (data) => {
          if (!data || data.type !== '__members' || !Array.isArray(data.members)) return;
          pending.delete(roomId);
          try { conn.close(); } catch (e) { /* done with the door */ }
          resolve(data);
        });
      }), CONNECT_TIMEOUT_MS, 'Could not connect. Check the room code and your internet connection, then try again.')
        .finally(() => pending.delete(roomId)))
        .then((info) => {
          const others = info.members.filter((id) => typeof id === 'string' && id !== self.id);
          return Promise.allSettled(others.map(connectTo)).then(() => ({ ...info, members: others.filter((id) => conns.has(id)) }));
        });
    }

    function claimDoor(roomId) {
      if (door && !door.destroyed && door.id === roomId) return Promise.resolve(roomId);
      releaseDoor();
      let d;
      try { d = new Peer(roomId, { debug: 0, config: ICE_CONFIG }); } catch (err) { return Promise.reject(err); }
      door = d;
      d.on('connection', (conn) => {
        conn.on('data', (data) => {
          if (!data) return;
          const info = doorInfo ? doorInfo() : {};
          if (data.type === '__hello') conn.send({ type: '__members', members: [self.id, ...conns.keys()], ...info });
          else if (data.type === 'peek') conn.send({ type: 'peekInfo', players: info.players || 0 });
        });
        setTimeout(() => { try { conn.close(); } catch (e) { /* gone */ } }, DOOR_HOLD_MS);
      });
      d.on('disconnected', () => {
        setTimeout(() => { if (!d.destroyed && d.disconnected) d.reconnect(); }, 1000);
      });
      return withTimeout(new Promise((resolve, reject) => {
        d.on('open', resolve);
        d.on('error', reject);
      }), CONNECT_TIMEOUT_MS, 'Timed out setting up the room. Check your internet connection and try again.')
        .catch((err) => { if (door === d) door = null; try { d.destroy(); } catch (e) { /* never opened */ } throw err; });
    }
    function releaseDoor() {
      if (door) { try { door.destroy(); } catch (e) { /* gone */ } }
      door = null;
    }

    return {
      ready,
      get id() { return self.id; },
      join, claimDoor, releaseDoor, connectTo,
      holdsDoor: () => !!(door && door.open),
      send(id, data) { const c = conns.get(id); if (c && c.open) c.send(data); },
      broadcast(data) { for (const c of conns.values()) { if (c.open) c.send(data); } },
      isUp: (id) => conns.has(id),
      memberIds: () => [...conns.keys()],
      leave() {
        for (const c of conns.values()) { try { if (c.open) c.send({ type: BYE }); } catch (e) { /* going */ } }
        releaseDoor();
        try { self.destroy(); } catch (e) { /* gone */ }
      },
    };
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

  global.SBPeer = { makeMesh, probeRooms, randomRoomCode, friendlyPeerError };
})(window);
