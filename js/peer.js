/* Thin wrapper around PeerJS for multiplayer rooms: a full mesh in which
   every player is connected to every other (see makeMesh), plus the
   lobby-list probe (probeRooms). */
(function (global) {
  // Google's public STUN servers, which let players find a direct route to
  // each other. There's no TURN relay; when two players can't reach each
  // other directly (a phone on mobile data and a computer on home Wi-Fi, say),
  // their messages go through the room's relay channel instead (see makeMesh).
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // TURN: when the site's Supabase project has the turn-credentials Edge
  // Function (supabase/functions/turn-credentials, README "Multiplayer relay
  // (TURN)"), its short-lived Cloudflare TURN logins are added to the list
  // above, so players whose networks block a direct connection get a proper
  // relay. They're fetched straight from the function (not through the
  // Supabase library, which takes a moment to load) and kept in this browser
  // for 12 hours (they last 24), so usually they're already here. Nothing
  // waits on them for long: connections read the list when they're made, so
  // logins that arrive later still serve every connection after that.
  const TURN_FN = 'turn-credentials';
  const TURN_KEY = 'sb_turn_servers';
  const TURN_KEEP_MS = 12 * 60 * 60 * 1000;
  let icePromise = null;
  function addTurn(servers) {
    if (!Array.isArray(servers)) return;
    servers.filter((s) => s && s.urls).forEach((s) => ICE_CONFIG.iceServers.push(s));
  }
  function savedTurn() {
    for (const store of ['localStorage', 'sessionStorage']) {
      try {
        const saved = JSON.parse(window[store].getItem(TURN_KEY) || 'null');
        if (saved && saved.until > Date.now() && Array.isArray(saved.servers)) return saved.servers;
      } catch (e) { /* not saved */ }
    }
    return null;
  }
  function prepareIce() {
    if (icePromise) return icePromise;
    const saved = savedTurn();
    if (saved) { addTurn(saved); icePromise = Promise.resolve(true); return icePromise; }
    const cfg = (typeof window !== 'undefined' && window.SB_CONFIG) || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || typeof fetch !== 'function') { icePromise = Promise.resolve(false); return icePromise; }
    const ask = fetch(`${cfg.supabaseUrl.replace(/\/+$/, '')}/functions/v1/${TURN_FN}`, { headers: { apikey: cfg.supabaseAnonKey } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.iceServers) || !data.iceServers.length) return false;
        addTurn(data.iceServers);
        try { localStorage.setItem(TURN_KEY, JSON.stringify({ servers: data.iceServers, until: Date.now() + TURN_KEEP_MS })); } catch (e) { /* not saved */ }
        return true;
      }).catch(() => false);
    icePromise = Promise.race([ask, new Promise((r) => setTimeout(() => r(false), 3000))]);
    return icePromise;
  }
  // The longest a new connection waits for the TURN logins on a first visit.
  const ICE_WAIT_MS = 1500;

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

     makeMesh({ onMessage(fromId, data), onJoin(id), onLeave(id, graceful), doorInfo(),
                onDisconnect(), onReconnect() })
       ready              resolves with this player's own peer ID
       join(roomId)       through the door: connects to every player listed;
                          resolves { members, ...doorInfo } (the ones reached)
       claimDoor(roomId)  takes the room's ID; rejects 'unavailable-id' if held
       releaseDoor(), holdsDoor()
       send(id, data), broadcast(data), isUp(id), memberIds()
       connectTo(id)      (re)connects to one player
       leave()            tells everyone, then closes everything

     The relay: when the site has a Supabase project, every player in a room
     also joins a Realtime channel named after it. A direct (WebRTC) link is
     always tried first; if it hasn't opened after a few seconds - the two
     players' networks won't let them connect directly - that pair talks
     through the channel instead, with the same messages. The door works the
     same way: a newcomer who can't reach the door directly asks on the
     channel, and the door's holder answers there. */
  const MESH_CONNECT_MS = 10000;
  // A direct link not open by then gets the relay as well; the first to open
  // carries the pair's messages.
  const RELAY_AFTER_MS = 3500;
  const RELAY_WAIT_MS = 8000;
  // Timer ticks go out ten times a second; each player's timer runs on its
  // own between them, so over the relay two a second (and the final 0) do.
  const RELAY_TICK_MS = 500;
  const DOOR_HOLD_MS = 15000;
  const BYE = '__bye';

  // How long the connection service may stay unreachable before the player
  // is told they've been disconnected (it usually comes back within seconds).
  const LOST_AFTER_MS = 8000;

  function makeMesh({ onMessage, onJoin, onLeave, doorInfo, onDisconnect, onReconnect }) {
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
    // Open on the connection service, and (in parallel, briefly) the TURN
    // logins, before the first connection to anyone.
    const iceWait = Promise.race([prepareIce(), new Promise((r) => setTimeout(r, ICE_WAIT_MS))]);
    const opened = withTimeout(new Promise((resolve, reject) => {
      self.on('open', resolve);
      self.on('error', (err) => {
        const m = err && err.type === 'peer-unavailable' && /peer (\S+)/.exec(err.message || '');
        if (m && pending.has(m[1])) { pending.get(m[1])(err); return; }
        reject(err);
      });
    }), CONNECT_TIMEOUT_MS, 'Timed out reaching the connection service. Check your internet connection and try again.');
    const ready = Promise.all([opened, iceWait]).then(([id]) => id);
    ready.catch(() => {});
    // Disconnected: the browser went offline, or the connection service has
    // been unreachable for a while with no other player still connected.
    // Told once (onDisconnect), never after leaving on purpose.
    let lostTold = false;
    function checkLost() {
      if (lostTold || self.destroyed || !onDisconnect) return;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline || (self.disconnected && conns.size === 0)) { lostTold = true; onDisconnect(); }
    }
    // Back again after being told (the browser is online and the connection
    // service reachable): told once more (onReconnect), and a later loss is
    // told afresh.
    function checkBack() {
      if (!lostTold || self.destroyed) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (self.disconnected) return;
      lostTold = false;
      if (onReconnect) onReconnect();
    }
    self.on('disconnected', () => {
      setTimeout(() => { if (!self.destroyed && self.disconnected) self.reconnect(); }, 1000);
      setTimeout(() => { if (!self.destroyed && self.disconnected) checkLost(); }, LOST_AFTER_MS);
    });
    // PeerJS opens again once a reconnect() gets through.
    self.on('open', () => checkBack());
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => checkLost());
      window.addEventListener('online', () => {
        if (!self.destroyed && self.disconnected) { try { self.reconnect(); } catch (e) { /* tried again later */ } }
        checkBack();
      });
    }

    /* ----- The relay channel (see above) ----- */
    const relay = { roomId: null, ch: null, opening: null, waits: new Map(), lastTick: new Map() };
    function relayClient() {
      const acct = typeof window !== 'undefined' && window.SBAccount;
      if (!acct || !acct.enabled) return Promise.resolve(null);
      return acct.ready.catch(() => null);
    }
    // Joins the room's channel (once per room); resolves the channel, or null
    // when there's no project or it can't be reached.
    function openRelay(roomId) {
      if (relay.roomId === roomId && relay.opening) return relay.opening;
      closeRelay();
      relay.roomId = roomId;
      relay.opening = Promise.all([ready, relayClient()]).then(([, c]) => {
        if (!c || relay.roomId !== roomId) return null;
        return new Promise((resolve) => {
          const ch = c.channel('sbreader-room:' + roomId, { config: { broadcast: { self: false }, presence: { key: self.id } } });
          ch.on('broadcast', { event: 'm' }, ({ payload }) => onRelay(payload));
          ch.on('presence', { event: 'leave' }, ({ key }) => {
            const conn = conns.get(key);
            if (conn && conn.relay) conn.remoteClosed();
          });
          let settled = false;
          const done = (v) => { if (!settled) { settled = true; resolve(v); } };
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') { relay.ch = ch; ch.track({ at: Date.now() }).catch(() => {}); done(ch); }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') done(null);
          });
          setTimeout(() => done(null), RELAY_WAIT_MS);
        });
      }).catch(() => null);
      return relay.opening;
    }
    function closeRelay() {
      const ch = relay.ch;
      relay.ch = null; relay.opening = null; relay.roomId = null;
      if (ch) { try { ch.untrack(); ch.unsubscribe(); } catch (e) { /* gone */ } }
    }
    function relaySend(to, k, d) {
      if (!relay.ch) return false;
      relay.ch.send({ type: 'broadcast', event: 'm', payload: { from: self.id, to, k, d } }).catch(() => {});
      return true;
    }
    // A link to one player over the channel, shaped like a PeerJS connection
    // (peer, open, send, close, on) so the rest of the mesh treats it alike.
    function relayConn(peer) {
      const handlers = {};
      const conn = {
        relay: true, peer, open: true,
        on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return conn; },
        emit(evt, ...a) { (handlers[evt] || []).slice().forEach((fn) => fn(...a)); },
        send(data) {
          if (!conn.open) return;
          if (data && data.type === 'tick' && data.remainingMs > 0) {
            const now = Date.now();
            if (now - (relay.lastTick.get(peer) || 0) < RELAY_TICK_MS) return;
            relay.lastTick.set(peer, now);
          }
          relaySend([peer], 'd', data);
        },
        close() { if (!conn.open) return; conn.open = false; relaySend([peer], 'close'); conn.emit('close'); },
        remoteClosed() { if (!conn.open) return; conn.open = false; conn.emit('close'); },
      };
      return conn;
    }
    function onRelay(p) {
      if (!p || typeof p.from !== 'string' || p.from === self.id) return;
      const toMe = p.to === '*' || (Array.isArray(p.to) && p.to.includes(self.id));
      if (!toMe) return;
      const existing = conns.get(p.from);
      if (p.k === 'hello') {
        // A newcomer who couldn't reach the door directly.
        if (door && door.open) {
          const info = doorInfo ? doorInfo() : {};
          relaySend([p.from], 'members', { members: [self.id, ...conns.keys()], ...info });
        }
        return;
      }
      if (p.k === 'members') { const w = relay.waits.get('door'); if (w) w(p.d); return; }
      if (p.k === 'open') {
        // Someone who couldn't reach this player directly: the pair links over
        // the channel (replacing any half-open direct link, so both ends agree).
        if (!existing || !existing.relay || !existing.open) adopt(relayConn(p.from));
        relaySend([p.from], 'opened');
        return;
      }
      if (p.k === 'opened') {
        const w = relay.waits.get(p.from);
        if (w) w();
        return;
      }
      if (p.k === 'close') { if (existing && existing.relay) existing.remoteClosed(); return; }
      if (p.k === 'd') {
        let conn = existing;
        if (!conn || !conn.relay || !conn.open) {
          // They're talking over the channel, so this end does too.
          conn = relayConn(p.from);
          adopt(conn);
        }
        conn.emit('data', p.d);
      }
    }
    // Links to one player over the channel; resolves once they've answered.
    function relayLink(id) {
      return new Promise((resolve, reject) => {
        if (!relay.ch) { reject(new Error('No relay.')); return; }
        const timer = setTimeout(() => { relay.waits.delete(id); reject(Object.assign(new Error('Could not reach a player.'), { isTimeout: true })); }, RELAY_WAIT_MS);
        relay.waits.set(id, () => {
          clearTimeout(timer); relay.waits.delete(id);
          const cur = conns.get(id);
          if (!cur || !cur.relay || !cur.open) adopt(relayConn(id));
          resolve(id);
        });
        relaySend([id], 'open');
      });
    }

    function adopt(conn) {
      const id = conn.peer;
      const old = conns.get(id);
      // A pair already talking over the relay stays there.
      if (old && old.relay && old.open && !conn.relay) { try { conn.close(); } catch (e) { /* unused */ } return; }
      conns.set(id, conn);
      if (old && old !== conn) { try { old.close(); } catch (e) { /* replaced */ } }
      let gone = false;
      const drop = (graceful) => {
        if (gone) return;
        gone = true;
        if (conns.get(id) !== conn) return; // replaced by a newer link
        conns.delete(id);
        if (onLeave) onLeave(id, !!graceful);
        if (!graceful && conns.size === 0) setTimeout(checkLost, LOST_AFTER_MS);
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

    function connectDirect(id) {
      return ready.then(() => withTimeout(new Promise((resolve, reject) => {
        pending.set(id, reject);
        const conn = self.connect(id, { reliable: true });
        conn.on('open', () => { pending.delete(id); adopt(conn); resolve(id); });
        conn.on('error', (err) => { pending.delete(id); reject(err); });
      }), MESH_CONNECT_MS, 'Could not reach a player.').finally(() => pending.delete(id)));
    }
    // Direct first; the relay too if that hasn't opened in a few seconds.
    function connectTo(id) {
      const direct = connectDirect(id);
      if (!relay.opening) return direct;
      return new Promise((resolve, reject) => {
        let left = 2; let lastErr = null; let won = false;
        const win = (v) => { if (!won) { won = true; resolve(v); } };
        const lose = (err) => { lastErr = err; if (--left === 0 && !won) reject(lastErr); };
        direct.then(win, lose);
        const timer = setTimeout(() => {
          relay.opening.then((ch) => (ch && !won ? relayLink(id) : Promise.reject(lastErr || new Error('No relay.')))).then(win, lose);
        }, RELAY_AFTER_MS);
        direct.then(() => clearTimeout(timer), () => {});
      });
    }

    function join(roomId) {
      openRelay(roomId);
      const relayedKnocks = new WeakSet();
      const relayed = (info) => relayedKnocks.has(info);
      const viaRelay = () => new Promise((resolve, reject) => {
        relay.opening.then((ch) => {
          if (!ch) { reject(new Error('No relay.')); return; }
          const timer = setTimeout(() => { relay.waits.delete('door'); reject(Object.assign(new Error('Could not connect.'), { isTimeout: true })); }, RELAY_WAIT_MS);
          relay.waits.set('door', (info) => { clearTimeout(timer); relay.waits.delete('door'); if (info && typeof info === 'object') relayedKnocks.add(info); resolve(info); });
          relaySend('*', 'hello');
        });
      });
      const direct = knockDirect(roomId);
      // The door answers directly within a second or two when it can; after
      // that, ask on the channel too. Nobody holding the door at all
      // ('peer-unavailable') isn't a reason to ask: the room is empty.
      const knock = new Promise((resolve, reject) => {
        let left = 2; let lastErr = null; let won = false;
        const win = (v) => { if (!won) { won = true; resolve(v); } };
        const lose = (err) => { lastErr = lastErr || err; if (--left === 0 && !won) reject(lastErr); };
        direct.then(win, (err) => { lastErr = err; if (err && err.type === 'peer-unavailable') { won = true; reject(err); return; } lose(err); });
        setTimeout(() => { if (!won) viaRelay().then(win, lose); else lose(null); }, RELAY_AFTER_MS);
      });
      return knock.then((info) => {
        const others = info.members.filter((id) => typeof id === 'string' && id !== self.id);
        // Answered on the channel: this network can't reach the room directly,
        // so link over the channel straight away (direct only if that fails).
        const link = (id) => (relayed(info) ? relayLink(id).catch(() => connectTo(id)) : connectTo(id));
        return Promise.allSettled(others.map(link)).then(() => ({ ...info, members: others.filter((id) => conns.has(id)) }));
      });
    }

    function knockDirect(roomId) {
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
        .finally(() => pending.delete(roomId)));
    }

    function claimDoor(roomId) {
      openRelay(roomId);
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
      // Whether anyone in the room is reached through the relay (for the UI).
      relayed: () => [...conns.values()].some((c) => c.relay && c.open),
      isUp: (id) => conns.has(id),
      memberIds: () => [...conns.keys()],
      leave() {
        for (const c of conns.values()) { try { if (c.open) c.send({ type: BYE }); } catch (e) { /* going */ } }
        releaseDoor();
        setTimeout(closeRelay, 300); // let the goodbyes out first
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

  global.SBPeer = { prepareIce, makeMesh, probeRooms, randomRoomCode, friendlyPeerError };
})(window);
