// A stand-in for PeerJS in the browser tests: peers in tabs of one browser
// context, linked by a BroadcastChannel acting as both the broker and the
// data channel, so Multiplayer runs with no network.
//   window.__NO_DIRECT = true   direct links never open (players whose
//                               networks block them; the relay is needed)
//   window.__LAG_MS = 150       every message arrives this much later
(function () {
  const bc = new BroadcastChannel('fakepeer');
  const local = new Map(); // id -> Peer in this tab
  class Emitter { constructor() { this.h = {}; } on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; } emit(e, ...a) { (this.h[e] || []).slice().forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); } }
  const conns = new Map(); // cid -> Conn
  class Conn extends Emitter {
    constructor(cid, me, peer) { super(); this.cid = cid; this.me = me; this.peer = peer; this.open = false; conns.set(cid, this); }
    send(d) { if (this.open) bc.postMessage({ t: 'data', cid: this.cid, to: this.peer, d: JSON.parse(JSON.stringify(d)) }); }
    close() { if (!this.open) return; this.open = false; bc.postMessage({ t: 'close', cid: this.cid, to: this.peer }); this.emit('close'); }
  }
  const asks = new Map();
  // IDs this tab is still claiming: id -> { at, q }. As on the real broker,
  // only one of two claims on an ID can succeed, however close together:
  // the earlier claim (then the smaller q) answers the later one's question.
  const claiming = new Map();
  const earlier = (a, b) => a.at < b.at || (a.at === b.at && a.q < b.q);
  bc.onmessage = ({ data: m }) => {
    if (m.t === 'whohas') {
      const mine = claiming.get(m.id);
      const held = (local.has(m.id) && !local.get(m.id).destroyed) || (mine && m.at != null && earlier(mine, m));
      if (held) bc.postMessage({ t: 'ihave', id: m.id, q: m.q });
      return;
    }
    if (window.__NO_DIRECT && m.t === 'connect') return; // NAT: direct links never open
    if (m.t === 'ihave') { const a = asks.get(m.q); if (a) a(); return; }
    if (m.t === 'connect') {
      const p = local.get(m.to); if (!p || p.destroyed) return;
      const c = new Conn(m.cid, m.to, m.from); c.open = true; p.emit('connection', c);
      c.emit('open');
      bc.postMessage({ t: 'accept', cid: m.cid }); return;
    }
    if (m.t === 'accept') { const c = conns.get(m.cid); if (c && !c.open) { c.accepted = true; c.open = true; c.emit('open'); } return; }
    if (m.t === 'data') { const c = conns.get(m.cid); if (c && c.me === m.to && c.open) { if (window.__LAG_MS) setTimeout(() => c.emit('data', m.d), window.__LAG_MS); else c.emit('data', m.d); } return; }
    if (m.t === 'close') { const c = conns.get(m.cid); if (c && c.me === m.to && c.open) { c.open = false; c.emit('close'); } }
  };
  window.Peer = class extends Emitter {
    constructor(id) {
      super(); this.destroyed = false; this.disconnected = false;
      const explicit = typeof id === 'string';
      this.id = explicit ? id : 'p' + Math.random().toString(36).slice(2, 10);
      const q = Math.random().toString(36).slice(2);
      const at = Date.now();
      let taken = false; asks.set(q, () => { taken = true; });
      claiming.set(this.id, { at, q });
      this.claimQ = q;
      bc.postMessage({ t: 'whohas', id: this.id, q, at });
      setTimeout(() => {
        asks.delete(q);
        if (claiming.get(this.id) && claiming.get(this.id).q === q) claiming.delete(this.id);
        if (taken) { this.emit('error', { type: 'unavailable-id', message: 'ID "' + this.id + '" is taken' }); return; }
        local.set(this.id, this); this.open = true; this.emit('open', this.id);
      }, 150);
    }
    connect(to) {
      const cid = Math.random().toString(36).slice(2);
      const c = new Conn(cid, this.id, to);
      if (window.__NO_DIRECT) {
        // The broker knows whether the ID exists; the direct link itself never opens.
        const q = Math.random().toString(36).slice(2); let exists = false;
        asks.set(q, () => { exists = true; });
        bc.postMessage({ t: 'whohas', id: to, q });
        setTimeout(() => { asks.delete(q); if (!exists) this.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + to }); }, 300);
        return c;
      }
      bc.postMessage({ t: 'connect', cid, from: this.id, to });
      setTimeout(() => { if (!c.accepted) this.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + to }); }, 400);
      return c;
    }
    destroy() {
      this.destroyed = true;
      if (local.get(this.id) === this) local.delete(this.id);
      if (claiming.get(this.id) && claiming.get(this.id).q === this.claimQ) claiming.delete(this.id);
    }
    reconnect() {} disconnect() {}
  };
})();
