(function () {
  const { QTYPE_LABELS, FORMAT_LABELS, escapeHtml } = SBData;
  const labelFor = SBData.subjectLabel;
  const TOSSUP_BUZZ_MS = 4000;
  const BONUS_BUZZ_MS = 20000;
  const ANSWER_MS = 10000;
  // Once someone has buzzed on a question, the time left to buzz after it
  // has been read through is never under this: a wrong answer given in the
  // last second still leaves the others time to buzz.
  const AFTER_BUZZ_MS = 5000;
  const LETTERS = ['W', 'X', 'Y', 'Z'];
  const TYPING_THROTTLE_MS = 150;
  const CHAT_HISTORY = 60;

  // Snapshot of whatever filters actually produced the room's current queue -
  // kept in sync on room creation and whenever the in-game settings panel is
  // applied, and used to seed that panel each time it's reopened.
  let activeFilterState = null;

  // publicLobby: the built-in public room (from SBMpRules.publicLobbies)
  // this is, or null. roomName: the room's name (multiplayer.html?room=).
  // roomId: the room's peer ID. pid: this browser's player ID (see myPid).
  const myState = { role: null, myId: null, myName: '', rate: 50, publicLobby: null, roomName: '', roomId: null, pid: '' };
  // The lobby's room list is asked for at once, before anything else loads
  // (a link straight into a room skips it).
  const linkedToRoom = /[?&](room|lobby)=/.test(location.search);
  if (!linkedToRoom && window.SBRooms) SBRooms.list();
  // The question bank (SBData.load, started from <head>) is only needed to
  // pick questions, so entering a room doesn't wait for it; whoever runs the
  // game waits for it before the first question.
  function bankLoaded() { return !!SBData.questions; }

  // The last name used on this device, prefilled into the name boxes and
  // used when joining straight from an invite link.
  const NAME_KEY = 'sb_mp_name';
  function savedName() {
    try { return (localStorage.getItem(NAME_KEY) || '').slice(0, SBMpRules.LIMITS.name); } catch (e) { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage blocked */ }
  }
  // Random names, as QB Reader gives: for a new room ("quantum-otter") and
  // for a first-time player ("Quantum Otter").
  const NAME_WORDS = [
    ['quantum', 'nimble', 'covalent', 'orbital', 'stellar', 'polar', 'kinetic', 'tidal', 'ionic', 'lunar', 'mitotic', 'prime', 'radiant', 'tectonic', 'vector', 'zesty'],
    ['otter', 'falcon', 'quokka', 'lynx', 'heron', 'tapir', 'gecko', 'ibis', 'marmot', 'narwhal', 'okapi', 'puffin', 'koala', 'newt', 'bison', 'wombat'],
  ];
  function randomWords() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    return [pick(NAME_WORDS[0]), pick(NAME_WORDS[1])];
  }
  function myName() {
    const saved = savedName();
    if (saved) return saved;
    const name = randomWords().map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    saveName(name);
    return name;
  }

  // This browser's player ID, sent with every join so a player who drops out
  // and comes back (or follows the room to a new host) keeps their score.
  const PID_KEY = 'sb_mp_pid';
  function randomPid() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function myPid() {
    let pid = '';
    try { pid = localStorage.getItem(PID_KEY) || ''; } catch (e) { /* storage blocked */ }
    if (SBMpRules.cleanPid(pid)) return pid;
    pid = randomPid();
    try { localStorage.setItem(PID_KEY, pid); } catch (e) { /* this visit only */ }
    return pid;
  }

  /* ================= LOBBY ================= */
  // Filter toggles (the room settings in the sidebar use these).
  // The questions for a set of room settings, in reading order: random
  // questions matching the filters (mixed evenly across subjects).
  function queueFor(values) {
    return SBData.stratifiedQueue(SBData.filterQuestions({
      subjects: values.subjects,
      roundRange: values.roundRange,
      yearRange: values.yearRange,
      includeUnlabeled: values.includeUnlabeled !== false,
      tournaments: values.tournaments,
    }), (q) => q.subject);
  }
  // A new room's settings: every subject, random questions, timer on.
  function defaultFilters(isPublic) {
    return {
      mode: 'random', setName: '', packetNumbers: '', rebuzz: false, skip: true, controlled: false, timer: true, isPublic: isPublic !== false,
      subjects: new Set(SBData.meta.subjects.map((x) => x.key)), qtypes: new Set(), formats: new Set(), levels: new Set(), visuals: new Set(),
      tournaments: new Set(), roundRange: null, yearRange: null, includeUnlabeled: true,
    };
  }

  /* ================= LOBBY PAGE ================= */
  // As on QB Reader: a room name (a random one as the placeholder) and Go,
  // which joins that room or opens it; "Make room private" keeps a new room
  // off the list. Below, the built-in rooms and the public rooms, each with
  // "N players - M online".
  function initLobby() {
    const input = document.getElementById('newRoomName');
    input.placeholder = randomWords().join('-');
    document.getElementById('roomForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = SBMpRules.cleanRoomName(input.value) || input.placeholder;
      const params = new URLSearchParams({ room: name });
      if (document.getElementById('privateRoomCheckbox').checked) params.set('private', 'true');
      if (document.getElementById('controlledRoomCheckbox').checked) params.set('controlled', 'true');
      goToRoom(`${location.pathname}?${params}`);
    });
    // A room in the lists opens on this page, without loading it again (the
    // connection and the questions already on their way carry over). A
    // middle click or ctrl-click still opens a new tab.
    ['permanentRoomList', 'roomList'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      goToRoom(a.href);
    }));
    // Back (or forward) from a room: the page as that address has it.
    window.addEventListener('popstate', () => location.reload());
    document.getElementById('emptyRoomCheckbox').addEventListener('change', (e) => {
      document.querySelectorAll('#roomList .empty-room').forEach((li) => li.classList.toggle('d-none', !e.target.checked));
      showNoRooms();
    });
  }

  function goToRoom(href) {
    if (joining || myState.role) return;
    try { history.pushState(null, '', href); } catch (e) { location.href = href; return; }
    if (!joinFromLink()) location.reload();
  }

  function roomItem(href, label, players, online, labelIsName) {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (labelIsName) a.classList.add('room-link');
    li.appendChild(a);
    const counts = players == null
      ? (online == null ? '' : ` - ${online} online`)
      : ` - ${players} player${players === 1 ? '' : 's'} - ${online} online`;
    li.appendChild(document.createTextNode(counts));
    return li;
  }

  // "No public rooms." when none is showing (empty rooms are hidden unless
  // "Show empty rooms" is ticked).
  function showNoRooms() {
    const none = document.querySelector('#roomList .no-rooms');
    if (!none) return;
    const shown = [...document.querySelectorAll('#roomList li:not(.no-rooms)')].some((li) => !li.classList.contains('d-none'));
    none.classList.toggle('d-none', shown);
  }

  // Filled once when the page opens (it doesn't refresh itself).
  // A promise that gives up after `ms` with `fallback`, so a slow room list
  // or roster never holds up the lobby or entering a room.
  function within(promise, ms, fallback) {
    return Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
  }

  // The last list this browser saw is drawn at once, then the current one
  // (usually within half a second) replaces it.
  async function renderRoomLists() {
    const fresh = within(SBRooms.list(), 6000, null);
    const cached = SBRooms.cachedList ? SBRooms.cachedList() : null;
    paintRoomLists(cached, null);
    const reg = await fresh;
    let probe = null;
    if (!reg) {
      // No room list: count the built-in rooms by asking each one.
      probe = await SBPeer.probeRooms(lobbyList.map((l) => l.peerId)).catch(() => new Map());
    }
    paintRoomLists(reg, probe);
  }

  // reg: SBRooms.list()'s answer; probe: the built-in rooms' counts asked
  // directly. Neither yet: the built-in rooms, without counts.
  function paintRoomLists(reg, probe) {
    const permanent = document.getElementById('permanentRoomList');
    const list = document.getElementById('roomList');
    const counted = !!(reg || probe);
    const byName = new Map((reg ? reg.rooms : []).map((r) => [r.name, r]));
    permanent.innerHTML = '';
    lobbyList.forEach((lobby) => {
      const href = `${location.pathname}?lobby=${encodeURIComponent(SBMpRules.lobbySlug(lobby))}`;
      if (!counted) { permanent.appendChild(roomItem(href, lobbyLabel(lobby), null, null)); return; }
      const r = byName.get(SBRooms.key('', lobby.key));
      const online = reg ? (r ? r.online : 0) : (probe.get(lobby.peerId) || 0);
      permanent.appendChild(roomItem(href, lobbyLabel(lobby), reg ? (r ? r.players : 0) : null, online));
    });
    if (!counted) return;
    list.innerHTML = '';
    const rooms = reg ? reg.rooms.filter((r) => r.is_public && !r.is_permanent) : [];
    rooms.sort((a, b) => (b.online - a.online) || (b.players - a.players));
    const showEmpty = document.getElementById('emptyRoomCheckbox').checked;
    rooms.forEach((r) => {
      const li = roomItem(`${location.pathname}?room=${encodeURIComponent(r.name)}`, r.name, r.players, r.online, true);
      if (r.online === 0) li.classList.add('empty-room');
      if (r.online === 0 && !showEmpty) li.classList.add('d-none');
      list.appendChild(li);
    });
    const none = document.createElement('li');
    none.className = 'list-group-item text-body-secondary no-rooms';
    none.textContent = 'No public rooms.';
    list.appendChild(none);
    showNoRooms();
    const activePlayers = reg ? reg.activePlayers : [...probe.values()].reduce((n, c) => n + (c || 0), 0);
    const activeRooms = reg ? reg.activeRooms : [...probe.values()].filter((c) => c > 0).length;
    // "There is 1 active player in 1 active room." / "There are 3 active players in 2 active rooms."
    const plural = (n, word) => `${n.toLocaleString()} active ${word}${n === 1 ? '' : 's'}`;
    document.getElementById('activeSummary').textContent = `There ${activePlayers === 1 ? 'is' : 'are'} ${plural(activePlayers, 'player')} in ${plural(activeRooms, 'room')}.`;
  }

  /* ================= SHARED GAME STATE (rendered identically on host & clients) ================= */
  const game = {
    players: [], phase: 'lobby', index: 0, total: 0,
    question: null, buzzedPlayerId: null, lockedOut: new Set(),
    // lastGrade: { playerId, correct, userText } - who most recently answered
    // this question and how it was graded, used to badge the buzz-status
    // panel and the answer box. Reset to null at the start of each question.
    lastGrade: null, log: [], paused: false,
    lastRevealData: null, liveTypingText: '', liveTypingFrom: null,
    // IDs of every question asked since the room last started from the top,
    // kept by everyone, so whoever takes over (and any rebuild of the queue
    // after a settings change) never asks one again. Cleared only at the end
    // of the questions, when Start begins again.
    asked: [],
    // Players who've left, with their scores, by pid (host's copy, for
    // whoever takes over).
    departed: [],
    // Players vote kicked out: [{ pid, at }], kept by everyone so whoever
    // takes over keeps turning them away for 30 minutes.
    kicked: [],
    // The room's owner (a named room's creator, as on QB Reader): the public
    // half of their signing key (see ownerKeys), or null for a room without
    // one (the built-in rooms). The owner's row has `owner` set and a crown.
    ownerKey: null,
    // Players the owner banned (pids; for 30 minutes, as on QB Reader:
    // bannedAt has when, by pid) and muted (mute keys: they can't chat).
    // Kept by everyone, like `kicked`.
    banned: [],
    bannedAt: {},
    muted: [],
    // Last tick actually applied (remainingMs/totalMs/kind), so a re-render
    // triggered by something other than a fresh tick - e.g. toggling pause,
    // which stops the host from broadcasting further ticks while paused -
    // can redraw the timer at its correct frozen value instead of the bar
    // just vanishing until the next tick happens to arrive. See
    // fullRenderFromState / applyTickLocal / hideTimer.
    lastTick: null,
    // attempts: [{ playerId, playerName, userText, correct, close }] - every buzz
    // that's been graded on the CURRENT question, oldest first. Kept visible
    // to everyone (not cleared when the next player buzzes) so a wrong
    // answer stays on screen instead of disappearing the moment someone
    // else buzzes in. Reset only when the next question starts.
    attempts: [],
    // True once anyone has overridden their answer to correct this
    // question - locks the override control for everyone (see
    // hostOverrideLastGrade / fullRenderFromState). Reset each question.
    overrideLocked: false,
  };

  let revealCtl = null;

  // Non-host clients only get a countdown "tick" broadcast from the host
  // every ~200ms (plus real network latency/jitter on top), so rendering
  // those ticks directly looks choppy compared to the host's own smooth
  // locally-driven 100ms updates. Smooth it out client-side the same way
  // the text-reveal controller does: anchor each received tick to
  // Date.now() and interpolate locally on a fast local timer, correcting
  // back to the true value every time a fresh tick actually arrives.
  let clientTick = null; // { totalMs, remainingAtAnchor, kind, runStart, pausedElapsed, paused, intervalId }
  function stopClientTickLoop() {
    if (clientTick && clientTick.intervalId) clearInterval(clientTick.intervalId);
    clientTick = null;
  }
  function clientTickElapsed(ct) {
    return ct.paused ? ct.pausedElapsed : ct.pausedElapsed + (Date.now() - ct.runStart);
  }
  function onClientTick(remainingMs, totalMs, kind) {
    stopClientTickLoop();
    clientTick = {
      totalMs, remainingAtAnchor: remainingMs, kind,
      runStart: Date.now(), pausedElapsed: 0, paused: !!game.paused,
      intervalId: null,
    };
    const step = () => {
      if (!clientTick) return;
      const display = Math.max(0, clientTick.remainingAtAnchor - clientTickElapsed(clientTick));
      // Keep game.lastTick current so a re-render triggered by something
      // other than a tick (e.g. a pauseState broadcast, which is all a
      // client gets while paused - the host stops sending ticks entirely)
      // can redraw this client's own interpolated value instead of the
      // timer just vanishing. See fullRenderFromState.
      game.lastTick = { remainingMs: display, totalMs: clientTick.totalMs, kind: clientTick.kind };
      renderTick(display, clientTick.totalMs, clientTick.kind);
      if (display <= 0) stopClientTickLoop();
    };
    step();
    if (clientTick) clientTick.intervalId = setInterval(step, 50);
  }
  function setClientTickPaused(paused) {
    if (!clientTick || clientTick.paused === !!paused) return;
    if (paused) {
      clientTick.pausedElapsed = clientTickElapsed(clientTick);
      clientTick.paused = true;
    } else {
      clientTick.runStart = Date.now();
      clientTick.paused = false;
    }
  }

  // A blank submission renders as the literal word (blank), with no quote
  // marks (they'd wrongly imply the player typed the word "(blank)"); a
  // real submission still renders quoted.
  function formatUserAnswer(text) {
    return text ? `"${escapeHtml(text)}"` : '(blank)';
  }
  function sanitizeQuestion(q) {
    return {
      id: q.id, tournament: q.tournament, roundLabel: q.roundLabel, round: q.round, num: q.num,
      subject: q.subject, format: q.format, qtype: q.qtype, level: q.level, question: q.question,
      visual: q.visual, images: q.images, packetSize: q.packetSize,
      choices: q.choices ? { W: q.choices.W, X: q.choices.X, Y: q.choices.Y, Z: q.choices.Z } : null,
    };
  }
  // The room's name above the question (click it to copy the link).
  function showRoomCode() {
    const el = document.getElementById('mpRoomCodeDisplay');
    const lobby = myState.publicLobby;
    el.textContent = lobby ? lobbyLabel(lobby) : myState.roomName;
    el.dataset.code = lobby ? lobby.key : myState.roomName;
    document.getElementById('mpRoomLabel').textContent = 'Room';
    document.title = `SBReader - Multiplayer - ${el.textContent}`;
  }

  // A link to this page that joins the room as soon as it's opened.
  function inviteLink() {
    if (myState.publicLobby) return `${location.origin}${location.pathname}?lobby=${encodeURIComponent(SBMpRules.lobbySlug(myState.publicLobby))}`;
    return `${location.origin}${location.pathname}?room=${encodeURIComponent(myState.roomName)}`;
  }

  function copyRoomCode() {
    const el = document.getElementById('mpRoomCodeDisplay');
    if (!el.dataset.code) return;
    const text = inviteLink();
    const showCopied = () => {
      const prev = el.textContent;
      el.textContent = 'Link copied!';
      el.classList.add('copied');
      setTimeout(() => { el.textContent = prev; el.classList.remove('copied'); }, 1400);
    };
    const legacyCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { /* best effort */ }
      showCopied();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(legacyCopy);
    } else {
      legacyCopy();
    }
  }

  /* ================= RENDERING (host + client share this) ================= */
  // The player list, as on QB Reader: each player with their points in a
  // pill (green online, gray offline), you highlighted, offline players
  // shown only with "Show offline players" on. Click a player for their
  // numbers.
  const OFFLINE_KEY = 'sb_mp_show_offline';
  let showOffline = false;
  try { showOffline = localStorage.getItem(OFFLINE_KEY) === '1'; } catch (e) { /* default off */ }
  let openStatsFor = null;
  // The players who've left, as rows for the leaderboard.
  function offlineRows() {
    const now = Date.now();
    return (game.departed || []).filter((d) => SBMpRules.stillOffline(d, now)).map((d) => ({ id: null, pid: d.pid, name: d.name, score: d.score, correct: d.correct || 0, incorrect: d.incorrect || 0, celSum: d.celSum || 0, celN: d.celN || 0, negs: d.negs || 0, heard: d.heard || 0, owner: !!d.owner, offline: true }));
  }
  // Whether this player is the room's owner, as the room has it.
  // As on QB Reader, a room's owner counts only while the room is private:
  // in a public room nobody has a crown, mutes, bans or controls the
  // settings (the built-in rooms are always public).
  function roomIsPrivate() { return !myState.publicLobby && roomSetting('isPublic', true) === false; }
  function isOwner(p) { return !!(p && p.owner) && roomIsPrivate(); }
  // QB Reader's crown.
  const CROWN = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" class="crown-icon mp-crown me-1" viewBox="0 0 24 24" role="img" aria-label="Room owner"><path fill="#F5C518" stroke="#B8860B" stroke-width="1" stroke-linejoin="round" d="M2 8l4.5 3L12 4l5.5 7L22 8l-2 11H4L2 8z"/></svg>';
  function amOwner() {
    const me = game.players.find((p) => p.id === myState.myId);
    return !!(me && me.owner);
  }
  // Mutes are by player ID (pid), or by connection for a player without one.
  function muteKey(p) { return p && (p.pid || (p.id ? 'id:' + p.id : null)); }
  // Mutes are the owner's, so they hold only while the room is private.
  function isMuted(p) { const k = muteKey(p); return !!k && roomIsPrivate() && (game.muted || []).includes(k); }
  function renderPlayerList(container) {
    // Your name as the room has it ("Henry 2" when another Henry got there
    // first) goes in the username box, unless you're typing in it.
    const meNow = game.players.find((p) => p.id === myState.myId);
    const nameBox = document.getElementById('mpUsername');
    if (meNow && nameBox && document.activeElement !== nameBox && nameBox.value !== meNow.name) nameBox.value = meNow.name;
    // Keep a player's Votekick menu open across repaints.
    const openMenu = container.querySelector('.dropdown-menu.show');
    const openMenuKey = openMenu ? openMenu.closest('[data-key]').dataset.key : null;
    container.innerHTML = '';
    const offline = offlineRows();
    const everyone = game.players.concat(offline).sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
    everyone.forEach((p) => {
      const key = p.id || 'pid:' + p.pid;
      const item = document.createElement('div');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.className = 'list-group-item list-group-item-action clickable mp-player-row';
      if (p.offline) item.classList.add('offline');
      if (p.offline && !showOffline) item.classList.add('d-none');
      if (p.id === myState.myId) item.classList.add('user-score');
      const attempt = !p.offline && game.attempts.find((x) => x.playerId === p.id);
      if (attempt) item.classList.add(attempt.correct ? 'answered-correct' : 'answered-incorrect');
      else if (!p.offline && p.id === game.buzzedPlayerId && game.phase === 'answering') item.classList.add('buzzed');
      // As on QB Reader, other online players get a small menu beside their
      // name with "Votekick" in it; in a private room its owner also gets
      // Mute and Ban there (and Ban for offline players), has a crown, and
      // can't be vote kicked.
      const others = p.id !== myState.myId;
      const canKick = !p.offline && p.id && others && !isOwner(p);
      const ownerTools = amOwner() && roomIsPrivate() && others && !p.owner && (p.offline ? !!p.pid : !!p.id);
      const menu = [];
      if (canKick) menu.push('<li><button type="button" class="dropdown-item" data-votekick title="Start or join a vote to kick this player. 90 second cooldown.">Votekick</button></li>');
      if (ownerTools && !p.offline) menu.push(`<li><button type="button" class="dropdown-item" data-mute>${isMuted(p) ? 'Unmute' : 'Mute'}</button></li>`);
      if (ownerTools) menu.push('<li><button type="button" class="dropdown-item text-danger" data-ban title="Remove this player from the room for 30 minutes">Ban</button></li>');
      item.innerHTML = `<div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center">
            <span class="${menu.length ? 'me-2' : 'me-1'}">${isOwner(p) ? CROWN : ''}${escapeHtml(p.name)}${isMuted(p) ? '<span class="mp-muted" title="Muted by the room owner" aria-label="muted">&#128263;</span>' : ''}</span>
            ${menu.length ? `<div class="dropdown ms-1">
              <button class="btn btn-default dropdown-toggle py-0 px-1" type="button" data-sb-dropdown aria-label="Actions for ${escapeHtml(p.name)}"></button>
              <ul class="dropdown-menu">${menu.join('')}</ul>
            </div>` : ''}
          </div>
          <span class="badge rounded-pill ${p.offline ? 'bg-secondary' : 'bg-success'}">${Number(p.score) || 0}</span>
        </div>`;
      if (menu.length) {
        const toggle = item.querySelector('[data-sb-dropdown]');
        SBSite.wireDropdown(toggle);
        toggle.addEventListener('click', () => closePlayerPopover());
        if (openMenuKey === key) { item.querySelector('.dropdown-menu').classList.add('show'); toggle.setAttribute('aria-expanded', 'true'); }
        const act = (sel, fn) => {
          const b = item.querySelector(sel);
          if (!b) return;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            item.querySelector('.dropdown-menu').classList.remove('show');
            fn();
          });
        };
        act('[data-votekick]', () => requestVotekick(p.id));
        act('[data-mute]', () => requestOwnerAction(isMuted(p) ? 'unmute' : 'mute', p));
        act('[data-ban]', () => {
          SBSite.confirm(`Ban ${p.name} from this room? They won't be able to come back.`, { title: 'Ban player', ok: 'Ban', danger: true })
            .then((yes) => { if (yes) requestOwnerAction('ban', p); });
        });
      }
      item.dataset.key = key;
      item.setAttribute('aria-haspopup', 'dialog');
      const toggleStats = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openStatsFor = openStatsFor === key ? null : key;
        renderPlayerPopover();
      };
      item.addEventListener('click', toggleStats);
      item.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === item) toggleStats(e); });
      container.appendChild(item);
    });
    renderPlayerPopover();
  }

  // As on QB Reader: clicking a player opens a popover beside the list with
  // their name and stats; clicking anywhere else (or Esc) closes it. It's
  // repainted with the list, so the numbers stay live while it's open.
  // It fades in and out, as Bootstrap's popovers do on QB Reader (.fade, then
  // .show; the 0.15 s opacity transition is Bootstrap's own).
  let playerPopover = null;
  let popoverHideTimer = null;
  const POPOVER_FADE_MS = 150;
  function closePlayerPopover() {
    openStatsFor = null;
    if (!playerPopover || playerPopover.hidden) return;
    playerPopover.classList.remove('show');
    clearTimeout(popoverHideTimer);
    popoverHideTimer = setTimeout(() => { if (!openStatsFor) playerPopover.hidden = true; }, POPOVER_FADE_MS);
  }
  function renderPlayerPopover() {
    const item = openStatsFor && document.querySelector(`#mpPlayerList [data-key="${CSS.escape(openStatsFor)}"]`);
    if (!item || item.classList.contains('d-none') || !item.offsetParent) { closePlayerPopover(); return; }
    const offline = offlineRows();
    const p = game.players.concat(offline).find((x) => (x.id || 'pid:' + x.pid) === openStatsFor);
    if (!p) { closePlayerPopover(); return; }
    if (!playerPopover) {
      playerPopover = document.createElement('div');
      playerPopover.className = 'popover custom-popover fade';
      playerPopover.hidden = true;
      playerPopover.setAttribute('role', 'dialog');
      playerPopover.innerHTML = '<div class="popover-arrow"></div><h3 class="popover-header"></h3><div class="popover-body"></div>';
      playerPopover.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(playerPopover);
      document.addEventListener('click', closePlayerPopover);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openStatsFor) closePlayerPopover(); });
      window.addEventListener('resize', () => { if (openStatsFor) renderPlayerPopover(); });
    }
    const heard = (p.correct || 0) + (p.incorrect || 0) + (p.negs || 0);
    const pill = (v) => `<span class="float-end badge rounded-pill bg-secondary">${escapeHtml(String(v))}</span>`;
    const plain = (v) => `<span class="float-end">${escapeHtml(String(v))}</span>`;
    playerPopover.querySelector('.popover-header').textContent = p.name;
    playerPopover.querySelector('.popover-body').innerHTML = '<ul class="list-group list-group-flush">' + [
      ['Points', pill(p.score)], ['Correct', pill(p.correct || 0)], ['Incorrect', pill(p.incorrect || 0)], ['Negs', pill(p.negs || 0)], ['Accuracy', plain(heard ? Math.round((100 * (p.correct || 0)) / heard) + '%' : '-')], ['Celerity', plain((p.celN ? 1 - p.celSum / p.celN : 0).toFixed(3))],
      ['Online?', plain(p.offline ? 'No' : 'Yes')],
    ].concat(isOwner(p) ? [['Room owner', plain('Yes')]] : []).map(([k, v]) => `<li class="list-group-item"><span>${k}</span>${v}</li>`).join('') + '</ul>';
    // Placed to the left of the player, as QB Reader's are; below it when
    // there's no room on the left (phones).
    clearTimeout(popoverHideTimer);
    const appearing = playerPopover.hidden || !playerPopover.classList.contains('show');
    playerPopover.hidden = false;
    const r = item.getBoundingClientRect();
    const w = playerPopover.offsetWidth;
    const h = playerPopover.offsetHeight;
    const arrow = playerPopover.querySelector('.popover-arrow');
    const sx = window.scrollX; const sy = window.scrollY;
    const left = r.left >= w + 16;
    playerPopover.classList.toggle('bs-popover-start', left);
    playerPopover.classList.toggle('bs-popover-bottom', !left);
    if (left) {
      playerPopover.style.left = (sx + r.left - w - 8) + 'px';
      playerPopover.style.top = (sy + r.top + r.height / 2 - h / 2) + 'px';
      arrow.style.left = ''; arrow.style.top = (h / 2 - 8) + 'px';
    } else {
      const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
      playerPopover.style.left = (sx + x) + 'px';
      playerPopover.style.top = (sy + r.bottom + 8) + 'px';
      arrow.style.top = ''; arrow.style.left = (r.left + r.width / 2 - x - 8) + 'px';
    }
    if (appearing) {
      void playerPopover.offsetWidth; // start from transparent, then fade in
      playerPopover.classList.add('show');
    }
  }


  // The big sidebar readout: whole seconds, then tenths in smaller type.
  function renderTick(remainingMs) {
    const tenths = Math.max(0, Math.round(remainingMs / 100));
    document.getElementById('mpTimerFace').textContent = String(Math.floor(tenths / 10));
    document.getElementById('mpTimerFraction').textContent = '.' + (tenths % 10);
  }
  function hideTimer() { renderTick(0); stopClientTickLoop(); game.lastTick = null; }

  /* ================= ROOM HISTORY ================= */
  // As on QB Reader, everything that happens goes at the top of one list
  // under the question: events in italics ("Bob buzzed"), the answer being
  // typed (live) and how it was graded, chat, and each finished question as
  // a collapsed card headed by its answer (k opens the latest, t stars it).
  function historyEl() { return document.getElementById('mpHistory'); }
  function logEvent(who, text) {
    const li = document.createElement('li');
    const i = document.createElement('i');
    const name = document.createElement('span');
    name.className = 'event-username';
    name.textContent = who;
    i.append(name, document.createTextNode(' ' + text));
    li.appendChild(i);
    historyEl().prepend(li);
  }
  // The live answer line: [Buzz] or [Answer], the name, what they've typed
  // so far, then the grade badges.
  function liveBuzzLine(playerId, name) {
    let li = document.getElementById('live-buzz');
    if (!li) {
      li = document.createElement('li');
      li.id = 'live-buzz';
      // As on QB Reader: "Buzz" on a toss-up, "Answer" on a bonus.
      const label = game.question && game.question.qtype === 'bonus' ? 'Answer' : 'Buzz';
      li.innerHTML = `<span class="badge text-light bg-primary">${label}</span> <b></b> <span class="live-answer"></span>`;
      historyEl().prepend(li);
    }
    li.dataset.player = playerId;
    li.querySelector('b').textContent = name;
    return li;
  }
  function finishBuzzLine(playerId, name, correct, userText, close) {
    const li = liveBuzzLine(playerId, name);
    // White text on both (QB Reader uses dark text on the green one).
    const cls = correct ? 'badge text-white bg-success' : 'badge text-white bg-danger';
    li.querySelector('.badge').className = cls;
    li.querySelector('.live-answer').textContent = userText ? userText : '(blank)';
    const second = document.createElement('span');
    second.className = cls + ' ms-1';
    second.textContent = correct ? 'Correct' : 'Incorrect';
    li.appendChild(second);
    if (!correct && close) {
      const hint = document.createElement('span');
      hint.className = 'close-hint ms-2';
      hint.textContent = 'Close';
      li.appendChild(hint);
    }
    li.removeAttribute('id');
    li.dataset.buzzPlayer = playerId;
    li.dataset.buzzQ = String(game.index);
  }
  // An override re-colours that player's line for this question: green and
  // "Correct", or red and "Incorrect".
  function recolorBuzzLine(playerId, correct) {
    const li = [...historyEl().querySelectorAll('li[data-buzz-player]')]
      .find((x) => x.dataset.buzzPlayer === playerId && x.dataset.buzzQ === String(game.index));
    if (!li) return;
    const badges = li.querySelectorAll('.badge');
    badges.forEach((b) => { b.classList.toggle('bg-success', correct); b.classList.toggle('bg-danger', !correct); });
    if (badges.length > 1) badges[badges.length - 1].textContent = correct ? 'Correct' : 'Incorrect';
    const hint = li.querySelector('.close-hint');
    if (hint && correct) hint.remove();
  }
  // Called when the buzzed player's typing arrives.
  function renderBuzzStatus() {
    const li = document.getElementById('live-buzz');
    if (!li || game.phase !== 'answering') return;
    if (game.liveTypingFrom === game.buzzedPlayerId) li.querySelector('.live-answer').textContent = game.liveTypingText;
  }

  // Cards for finished questions. Each log entry gets one card, once; on
  // joining, the whole log is carded (oldest at the bottom).
  const carded = new Set();
  function cardKey(entry) { return `${entry.question.id}:${entry.at || ''}`; }
  function addHistoryCard(entry) {
    const k = cardKey(entry);
    if (carded.has(k)) return;
    carded.add(k);
    const a = entry.answer || {};
    const card = SBPlay.historyCard(entry.question, {
      grade: entry.category,
      answer: { text: a.answerText, letter: a.letter, accept: a.accept, reject: a.reject, sourceUrl: a.sourceUrl },
    });
    historyEl().prepend(card);
  }
  // Every logged question but the one still on screen gets its card.
  function renderQuestionLog() {
    game.log.slice().reverse().forEach((entry, i, arr) => {
      const isCurrent = i === arr.length - 1 && game.phase === 'reveal';
      if (!isCurrent) addHistoryCard(entry);
    });
  }

  function buildRevealSegments(q) {
    const qDisplay = document.getElementById('mpQDisplay');
    qDisplay.classList.remove('mp-waiting-text');
    // Read out as a moderator would: "TOSS-UP Physics Short Answer ...".
    const boxSegments = [{ html: SBData.readoutHTML(q), el: qDisplay, lead: SBReveal.visibleLength(SBData.readoutHeaderHTML(q)) }];
    const choicesDisplay = document.getElementById('mpChoicesDisplay');
    if (q.choices) {
      choicesDisplay.style.display = 'grid';
      LETTERS.forEach((L) => boxSegments.push({ html: SBData.renderMathHTML(q.choices[L] || ''), el: document.getElementById('mpChoiceText' + L) }));
    } else {
      choicesDisplay.style.display = 'none';
    }
    // A visual question's image(s) are up from the start; only the text reveals.
    const figures = document.getElementById('mpQFigures');
    if (q.visual && q.images && q.images.length) {
      figures.replaceChildren(...SBData.questionFigures(q, { eager: true }).children);
      figures.style.display = '';
    } else {
      figures.replaceChildren();
      figures.style.display = 'none';
    }
    return { boxSegments };
  }

  // instant=true renders the full text immediately with no animation (a
  // player joining after the reading is over). startUnits starts the reading
  // part-way through (a player joining mid-question, at the room's point).
  function startLocalReveal(q, instant, onComplete, startUnits) {
    if (revealCtl) revealCtl.stop();
    const { boxSegments } = buildRevealSegments(q);
    // The question and choices are math-rendered HTML from the start, so
    // superscripts and subscripts type in already formatted.
    if (instant) {
      boxSegments.forEach((s) => { s.el.innerHTML = s.html; });
      revealCtl = null;
      if (onComplete) onComplete();
      return;
    }
    revealCtl = SBReveal.startReveal(boxSegments, myState.rate, {
      onComplete: () => { if (onComplete) onComplete(); },
      startUnits: startUnits || 0,
    });
    if (game.paused) revealCtl.pause();
  }

  // The reading runs only while the question is being read and the room
  // isn't paused. Someone answering holds it too, so lifting a pause during
  // an answer mustn't read on and show the others more of the question.
  function syncRevealToState() {
    if (!revealCtl || revealCtl.isDone()) return;
    if (game.phase === 'reading' && !game.paused) revealCtl.resume(); else revealCtl.pause();
  }

  // The room's switches as they stand (activeFilterState mirrors them for
  // every player).
  function roomSetting(key, fallback) {
    return activeFilterState && activeFilterState[key] !== undefined ? activeFilterState[key] : fallback;
  }

  // How a question's source line is labelled ("Toss-up 10").
  function labelOpts() { return undefined; }

  function fullRenderFromState() {
    renderPlayerList(document.getElementById('mpPlayerList'));
    renderQuestionLog();
    renderBuzzStatus();
    const buzzBtn = document.getElementById('mpBuzzBtn');
    const answerRow = document.getElementById('mpAnswerRow');
    const nextBtn = document.getElementById('mpNextBtn');
    const overrideBtn = document.getElementById('mpOverrideBtn');
    const revealBox = document.getElementById('mpRevealBox');
    const pauseBtn = document.getElementById('mpPauseBtn');
    const choicesDisplay = document.getElementById('mpChoicesDisplay');

    choicesDisplay.style.display = game.question && game.question.choices ? 'grid' : 'none';
    document.getElementById('mpQFigures').style.display = game.question && game.question.visual ? '' : 'none';
    document.getElementById('mpQuestionPanel').classList.toggle('mp-lobby-compact', game.phase === 'lobby');
    const info = document.getElementById('mpQuestionInfo');
    if (game.question && game.phase === 'reveal' && game.lastRevealData) SBPlay.linkQuestionInfo(info, game.question, game.lastRevealData.sourceUrl || null, labelOpts());
    else info.textContent = game.question && game.phase !== 'lobby' ? SBData.sourceLabelFor(game.question, ' ', labelOpts()) : '';
    document.getElementById('mpTimer').classList.toggle('d-none', !roomSetting('timer', true));

    revealBox.style.display = 'none';
    document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => { el.classList.remove('reveal-correct'); el.classList.remove('clickable'); });
    answerRow.classList.add('d-none');
    overrideBtn.classList.add('d-none');
    // A re-render isn't always a fresh tick (pausing stops the ticks), so
    // redraw the last known tick in a timer-bearing phase rather than
    // zeroing the timer. Nothing counts down while the question is read, so
    // the timer is at 0 there (also when reading picks up again after a
    // wrong interrupt).
    if (game.lastTick && (game.phase === 'buzzwindow' || game.phase === 'answering')) {
      renderTick(game.lastTick.remainingMs);
    } else {
      hideTimer();
    }
    pauseBtn.disabled = game.phase === 'lobby' || game.phase === 'reveal';
    pauseBtn.innerHTML = game.paused ? SBIcons.play : SBIcons.pause;
    pauseBtn.setAttribute('aria-label', game.paused ? 'Resume' : 'Pause');

    const amBuzzed = game.buzzedPlayerId === myState.myId;
    const amLocked = game.lockedOut.has(myState.myId);
    buzzBtn.disabled = !((game.phase === 'reading' || game.phase === 'buzzwindow') && !amLocked);
    nextBtn.disabled = game.phase === 'answering'
      || ((game.phase === 'reading' || game.phase === 'buzzwindow') && !canSkip());
    // As on QB Reader, the first button is a green Start before the game.
    nextBtn.classList.toggle('btn-success', game.phase === 'lobby');
    nextBtn.classList.toggle('btn-primary', game.phase !== 'lobby');

    if (game.phase === 'lobby') {
      nextBtn.textContent = 'Start';
      nextBtn.title = 'Shortcut: n';
      nextBtn.dataset.mode = 'next';
      document.getElementById('mpQDisplay').textContent = '';
    } else if (game.phase === 'reading' || game.phase === 'buzzwindow') {
      nextBtn.textContent = isRealSkip() ? 'Skip' : 'Next';
      nextBtn.dataset.mode = 'skip';
      nextBtn.title = !canSkip() ? 'Skipping is turned off in this room' : isRealSkip() ? 'Shortcut: s' : 'Shortcut: n or s';
    } else if (game.phase === 'answering') {
      nextBtn.textContent = 'Next';
      nextBtn.title = 'Shortcut: n';
      nextBtn.dataset.mode = '';
      if (amBuzzed) {
        answerRow.classList.remove('d-none');
        document.getElementById('mpAnswerInput').value = '';
        document.getElementById('mpAnswerInput').focus();
        if (game.question && game.question.format === 'MC' && game.question.choices) {
          document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => el.classList.add('clickable'));
        }
      }
    } else if (game.phase === 'reveal') {
      nextBtn.textContent = 'Next';
      nextBtn.title = 'Shortcut: n';
      nextBtn.dataset.mode = 'next';
      showReveal();
    }
    renderOverrideLink();
  }

  // Anyone who buzzed and was graded this question can override their own
  // answer once it's revealed, until someone's been overridden to correct
  // (see hostOverrideLastGrade, SBMpRules.canOverrideOwn). The link sits on
  // the same line as your buzz ("Buzz Henry … Incorrect"), at the right, as
  // Play puts it beside the grade.
  function renderOverrideLinkSoon() { setTimeout(renderOverrideLink, 0); }
  function renderOverrideLink() {
    const overrideBtn = document.getElementById('mpOverrideBtn');
    overrideBtn.classList.add('d-none');
    historyEl().querySelectorAll('.mp-inline-override').forEach((el) => el.remove());
    document.querySelectorAll('#mpRevealBox .answer-report').forEach((el) => el.remove());
    if (game.phase !== 'reveal') return;
    // Report at the right of the answer line, for everyone.
    const q = game.question && ((SBData.byId && SBData.byId.get(game.question.id)) || game.question);
    const ans = document.querySelector('#mpRevealBox .ans-line');
    if (ans && window.SBReports && q) ans.prepend(SBPlay.answerReportLink(q));
    if (!SBMpRules.canOverrideOwn(game.attempts, myState.myId, game.overrideLocked)) return;
    const mine = game.attempts.filter((x) => x.playerId === myState.myId).pop();
    const label = mine && mine.correct ? 'I was wrong' : 'I was right';
    const myLine = [...historyEl().querySelectorAll('li[data-buzz-player]')]
      .find((x) => x.dataset.buzzPlayer === myState.myId && x.dataset.buzzQ === String(game.index));
    if (!myLine) {
      overrideBtn.textContent = label;
      overrideBtn.classList.remove('d-none');
      return;
    }
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'btn btn-link p-0 float-end mp-inline-override';
    link.title = 'Shortcut: q';
    link.textContent = label;
    link.addEventListener('click', (e) => { e.preventDefault(); link.blur(); doOverride(); });
    myLine.appendChild(link);
  }

  // The answer under the question, as QB Reader shows it.
  function showReveal() {
    const box = document.getElementById('mpRevealBox');
    const r = game.lastRevealData;
    if (!r) { box.style.display = 'none'; return; }
    let html = '';
    html += `<p class="ans-line mb-1">ANSWER: ${SBData.answerLineHTML(r.answerText, r.letter, r.accept, r.reject).replace(/^Answer: /, '')}</p>`;
    box.innerHTML = html;
    // Once it's over, the label above the question links to the packet.
    SBPlay.linkQuestionInfo(document.getElementById('mpQuestionInfo'), game.question, r.sourceUrl || null, labelOpts());
    box.style.display = 'block';
    if (revealCtl && !revealCtl.isDone()) revealCtl.skipToEnd();
    if (game.question.choices && r.letter) {
      const el = document.querySelector(`#mpChoicesDisplay .choice-box[data-letter="${r.letter}"]`);
      if (el) el.classList.add('reveal-correct');
    }
  }

  /* ================= CHAT ================= */
  // Every player keeps the room's chat (not lines shown only to them, marked
  // `local`), so whoever takes over the game can carry it on. Events the
  // room should hear about ("Bob joined the game") travel the same way, as
  // system lines, and show in italics. Chat is open in public rooms too.
  let chatMirror = [];
  function renderChatAppend(entry) {
    if (!entry.local) {
      chatMirror.push(entry);
      while (chatMirror.length > CHAT_HISTORY) chatMirror.shift();
    }
    if (entry.system) { logEvent(entry.name || '', entry.text); return; }
    if (entry.cid) {
      finishedChats.add(entry.cid);
      // The message was shown while it was typed: it becomes the sent one
      // where it stands.
      const live = liveChatEls.get(entry.from);
      if (live && live.dataset.cid === entry.cid) {
        liveChatEls.delete(entry.from);
        live.classList.remove('chat-live');
        live.querySelector('b').textContent = entry.name;
        const text = live.querySelector('.live-chat-text');
        text.textContent = entry.text;
        text.classList.remove('text-muted');
        return;
      }
    }
    const li = document.createElement('li');
    li.className = 'chat-message';
    const b = document.createElement('b');
    b.textContent = entry.name;
    li.append(b, document.createTextNode(' ' + entry.text));
    historyEl().prepend(li);
  }
  function amMuted() { return isMuted(game.players.find((p) => p.id === myState.myId)); }
  function sendChat(text) {
    text = (text || '').trim();
    if (amMuted()) { endLiveChat(true); if (text) logEvent('You', 'are muted in this room'); return; }
    const cid = myChatId;
    endLiveChat(!text);
    if (!text) return;
    if (myState.role === 'host') {
      const me = hostPlayers.get(myState.myId);
      hostBroadcastChat(myState.myId, me ? me.name : myState.myName, text, false, cid);
    } else if (client) {
      client.send({ type: 'chatSend', text, cid });
    }
  }

  /* Live chat, as on QB Reader: everyone sees a message in the room's
     history while it's being typed. Each message has an ID (cid); the typed
     copy goes straight to every player, and the sent one, from whoever runs
     the game, replaces it where it stands. */
  const liveChatEls = new Map(); // player ID -> their live <li>
  const finishedChats = new Set(); // cids already sent, so a late live copy is dropped
  let myChatId = null;
  let liveChatTimer = null;
  let liveChatPending = null;
  function newChatId() { return Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '') || 'c0000'; }
  function chatNameFor(id) {
    const p = game.players.find((x) => x.id === id);
    if (p) return p.name;
    const m = memberInfo.get(id);
    return m ? m.name : (id === myState.myId ? myState.myName : 'Player');
  }
  // As on QB Reader: the line appears as soon as the chat box opens (the name
  // and nothing yet), the text follows in grey as it's typed, and it turns
  // normal once sent. `text` null removes the line (the box was closed).
  function renderLiveChat(playerId, cid, text) {
    if (finishedChats.has(cid)) return;
    let li = liveChatEls.get(playerId);
    if (text === null) {
      if (li && li.dataset.cid === cid) { li.remove(); liveChatEls.delete(playerId); }
      return;
    }
    if (!li || li.dataset.cid !== cid) {
      if (li) li.remove();
      li = document.createElement('li');
      li.className = 'chat-message chat-live';
      li.dataset.cid = cid;
      const span = document.createElement('span');
      span.className = 'live-chat-text text-muted';
      li.append(document.createElement('b'), document.createTextNode(' '), span);
      historyEl().prepend(li);
      liveChatEls.set(playerId, li);
    }
    li.querySelector('b').textContent = chatNameFor(playerId);
    li.querySelector('.live-chat-text').textContent = text;
  }
  function broadcastLiveChat(cid, text) {
    if (mesh && !amMuted()) mesh.broadcast({ type: 'chatLive', cid, text: text === null ? null : text.slice(0, SBMpRules.LIMITS.chat) });
  }
  // The chat box opened: everyone sees your (still empty) line.
  function startLiveChat() {
    if (!myChatId) myChatId = newChatId();
    renderLiveChat(myState.myId, myChatId, '');
    broadcastLiveChat(myChatId, '');
  }
  function onChatTyping(text) {
    if (!myChatId) myChatId = newChatId();
    renderLiveChat(myState.myId, myChatId, text);
    liveChatPending = text;
    if (liveChatTimer) return;
    const flush = () => {
      liveChatTimer = null;
      if (liveChatPending === null || !myChatId) return;
      broadcastLiveChat(myChatId, liveChatPending);
      liveChatPending = null;
      liveChatTimer = setTimeout(flush, TYPING_THROTTLE_MS);
    };
    flush();
  }
  // Sent (the sent copy replaces the live one) or dropped (it's removed).
  function endLiveChat(dropped) {
    clearTimeout(liveChatTimer);
    liveChatTimer = null;
    liveChatPending = null;
    const cid = myChatId;
    myChatId = null;
    if (!cid) return;
    if (dropped) {
      renderLiveChat(myState.myId, cid, null);
      broadcastLiveChat(cid, null);
    }
  }
  // A system line for the whole room, from whoever runs the game.
  function hostEvent(connId, text) {
    if (myState.role !== 'host') return;
    const p = hostPlayers.get(connId);
    hostBroadcastChat('SYSTEM', p ? p.name : (connId === myState.myId ? myState.myName : 'Someone'), text, true);
  }

  /* ================= HOST-ONLY AUTHORITATIVE LOGIC ================= */
  let host = null;
  const hostGame = {
    queue: [], index: -1, phase: 'lobby',
    buzzedConnId: null, buzzedDuringReading: false, anyAttempt: false,
    lockedOutIds: new Set(),
    timer: null, remainingMs: 0, totalMs: 0, timerKind: null, onExpire: null,
    // Wall-clock anchor for the running timer (see hostRunTimer) - remainingMs
    // is derived from Date.now() vs. this anchor rather than trusted as a
    // running tally, so a throttled setInterval (backgrounded tab) can never
    // make it drift slow.
    timerAnchorAt: null, timerRemainingAtAnchor: 0,
    paused: false, lastGrade: null, currentFull: null,
    buzzwindowRemainingMs: null,
    // Per-player grade record for the CURRENT question only (cleared each
    // new question) - connId -> { correct, delta, userText, buzzedDuringReading }.
    // Lets any player who buzzed this question override their OWN answer
    // later, not just whoever happened to buzz last.
    gradesByConn: new Map(),
    // Once true (someone's overridden their answer to correct), overriding
    // is locked for the rest of the question - the room already has its
    // winner for this one, so re-litigating other answers doesn't make sense.
    overrideLocked: false,
  };
  const hostPlayers = new Map();
  // Makes sure a newly (or re-)named player doesn't share a display name
  // with someone already in the room - most commonly two people both
  // leaving the name box blank and getting the "Player" default, but this
  // covers any exact-name collision the same way: "Player" becomes
  // "Player 2", a second "Player 2" becomes "Player 3", and so on.
  function uniqueName(desired, excludeConnId) {
    const taken = new Set();
    hostPlayers.forEach((p, id) => { if (id !== excludeConnId) taken.add(p.name); });
    // Offline players still show on the board, so their names stay taken.
    departedPlayers.forEach((d) => taken.add(d.name));
    if (!taken.has(desired)) return desired;
    let n = 2;
    while (taken.has(`${desired} ${n}`)) n++;
    return `${desired} ${n}`;
  }
  const hostChat = [];

  // A copy of a full set of room settings (filters plus mode and switches).
  function copyFilters(f) {
    return {
      // (Rooms only read random questions now; the three fields stay in the
      // settings so players on an older copy still understand them.)
      mode: 'random', setName: '', packetNumbers: '',
      rebuzz: !!f.rebuzz, skip: f.skip !== false, controlled: !!f.controlled, timer: f.timer !== false, isPublic: f.isPublic !== false,
      subjects: new Set(f.subjects), qtypes: new Set(f.qtypes || []), formats: new Set(f.formats || []), levels: new Set(f.levels || []), visuals: new Set(f.visuals || []),
      tournaments: new Set(f.tournaments || []), roundRange: f.roundRange || null, yearRange: f.yearRange || null, includeUnlabeled: f.includeUnlabeled !== false,
    };
  }

  function resetHostGame() {
    clearHostTimer();
    Object.assign(hostGame, {
      queue: [], index: -1, phase: 'lobby', queueStale: false,
      buzzedConnId: null, buzzedDuringReading: false, anyAttempt: false,
      lockedOutIds: new Set(), remainingMs: 0, totalMs: 0, timerKind: null,
      timerAnchorAt: null, timerRemainingAtAnchor: 0,
      paused: false, lastGrade: null, currentFull: null, buzzwindowRemainingMs: null,
      gradesByConn: new Map(), overrideLocked: false,
    });
    stopClientTickLoop();
    game.paused = false;
    game.buzzedPlayerId = null;
    game.lockedOut = new Set();
    game.lastGrade = null;
    game.attempts = [];
    game.overrideLocked = false;
    game.lastRevealData = null;
    game.liveTypingText = ''; game.liveTypingFrom = null;
  }

  // A player who leaves keeps their score here, by pid, for when they come
  // back. Every player has a copy (see broadcastLobby).
  const DEPARTED_MAX = 500;
  const departedPlayers = new Map();
  function markOffline(p) {
    departedPlayers.delete(p.pid);
    departedPlayers.set(p.pid, { pid: p.pid, name: p.name, score: p.score, correct: p.correct || 0, incorrect: p.incorrect || 0, celSum: p.celSum || 0, celN: p.celN || 0, negs: p.negs || 0, heard: p.heard || 0, owner: !!p.owner, leftAt: Date.now() });
    while (departedPlayers.size > DEPARTED_MAX) departedPlayers.delete(departedPlayers.keys().next().value);
  }
  // As on QB Reader, offline players stay on the leaderboard until the
  // daily restart (08:00 UTC; SBMpRules.lastRestart), with no timer of
  // their own.
  function pruneDeparted() {
    const now = Date.now();
    departedPlayers.forEach((d, pid) => { if (!SBMpRules.stillOffline(d, now)) departedPlayers.delete(pid); });
  }
  function hostPlayerLeft(connId, quiet) {
    const p = hostPlayers.get(connId);
    if (!p) return;
    if (hostGame.phase === 'answering' && hostGame.buzzedConnId === connId) {
      clearHostTimer();
      buzzedPlayerGone(connId);
    }
    hostPlayers.delete(connId);
    // As on QB Reader: a player who leaves without having heard or answered
    // anything is taken off the list; anyone else stays on it, offline.
    if (p.pid) {
      if (SBMpRules.hasActivity(p)) markOffline(p);
      else departedPlayers.delete(p.pid);
    }
    broadcastLobby();
    if (!quiet) hostBroadcastChat('SYSTEM', p.name, 'left the game', true);
  }

  /* ---------------- Vote kicks (QB Reader's rules, SBMpRules) ---------------- */
  const votekicks = new Map(); // target id -> { voters: Set, threshold }
  const lastVotekickBy = new Map(); // voter pid (or id) -> when they last started one
  function hostVotekick(voterId, targetId) {
    const voter = hostPlayers.get(voterId);
    const target = hostPlayers.get(targetId);
    if (!voter || !target || voterId === targetId || isOwner(target)) return;
    const tell = (text) => { if (voterId === myState.myId) logEvent('You', text); else host.sendTo(voterId, { type: 'votekickRefused', text }); };
    if (!(voter.correct > 0)) { tell('can only vote kick once you\'ve answered a question correctly'); return; }
    let vk = votekicks.get(targetId);
    if (!vk) {
      const key = voter.pid || voterId;
      const wait = SBMpRules.VOTEKICK_COOLDOWN_MS - (Date.now() - (lastVotekickBy.get(key) || 0));
      if (wait > 0) { tell(`can start another vote kick in ${Math.ceil(wait / 1000)} seconds`); return; }
      lastVotekickBy.set(key, Date.now());
      vk = { voters: new Set([voterId]), threshold: SBMpRules.votekickThreshold(hostPlayers.size) };
      votekicks.set(targetId, vk);
      hostEvent(voterId, `started a vote kick against ${target.name} (1/${vk.threshold})`);
    } else {
      if (vk.voters.has(voterId)) return;
      vk.voters.add(voterId);
      hostEvent(voterId, `voted to kick ${target.name} (${vk.voters.size}/${vk.threshold})`);
    }
    if (vk.voters.size >= vk.threshold) hostKick(targetId);
  }
  function hostKick(targetId) {
    const target = hostPlayers.get(targetId);
    votekicks.delete(targetId);
    if (!target) return;
    const now = Date.now();
    game.kicked = game.kicked.filter((k) => now - k.at < SBMpRules.KICK_BAN_MS);
    if (target.pid) game.kicked.push({ pid: target.pid, at: now });
    hostBroadcastChat('SYSTEM', target.name, 'has been vote kicked from this room', true);
    host.broadcast({ type: 'kicked', playerId: targetId });
    if (targetId === myState.myId) { broadcastLobby(); leaveKicked(); return; }
    hostPlayerLeft(targetId, true);
  }
  // A ban lasts 30 minutes, like a vote kick (QB Reader's BAN_DURATION).
  // A ban with no time (from a player on an older copy of the site) counts
  // from when it's first seen here.
  function pruneBans() {
    const now = Date.now();
    const at = game.bannedAt || {};
    const kept = {};
    game.banned = game.banned.filter((pid) => {
      const t = typeof at[pid] === 'number' ? at[pid] : now;
      if (now - t >= SBMpRules.KICK_BAN_MS) return false;
      kept[pid] = t;
      return true;
    });
    game.bannedAt = kept;
  }
  function isBanned(pid) {
    if (!pid) return false;
    pruneBans();
    return game.banned.includes(pid);
  }
  // Whoever is kicked (or banned) goes back to the lobby, which says so.
  function leaveKicked(banned) {
    location.href = `${location.pathname}?${banned ? 'banned' : 'kicked'}=1`;
  }
  function requestVotekick(targetId) {
    const me = game.players.find((p) => p.id === myState.myId);
    if (!me || !(me.correct > 0)) { logEvent('You', 'can only vote kick once you\'ve answered a question correctly'); return; }
    if (myState.role === 'host') hostVotekick(myState.myId, targetId);
    else if (client) client.send({ type: 'votekick', targetId });
  }

  /* ---------------- The room's owner ----------------
     A named room belongs to the browser that created it, as on QB Reader:
     the owner has a crown, can mute and ban players, and can make the room
     "controlled", where only they change the settings. The built-in rooms
     have no owner.

     There's no server to vouch for anyone, so the owner proves who they are
     with a signing key (ECDSA P-256, WebCrypto) that only their browser
     holds (localStorage sb_mp_owner_key). The room keeps the key's public
     half (game.ownerKey, and in the room list, so it outlasts the room); on
     joining, the owner signs "<room>|<their connection ID>|<time>", which
     whoever runs the game checks. The signature names the sender's own
     connection and is good for a minute, so it can't be reused by anyone
     else. */
  const OWNER_KEY_STORE = 'sb_mp_owner_key';
  const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
  const PROOF_MAX_AGE_MS = 60 * 1000;
  let ownerKeyPromise = null;
  // This browser's key: { pub: 'x.y' (base64url), priv: CryptoKey }, or
  // null without WebCrypto. create: make one if there's none yet.
  function myOwnerKey(create) {
    const subtle = window.crypto && crypto.subtle;
    if (!subtle) return Promise.resolve(null);
    if (ownerKeyPromise) return ownerKeyPromise.then((k) => (k || !create ? k : (ownerKeyPromise = makeOwnerKey())));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(OWNER_KEY_STORE) || 'null'); } catch (e) { /* none */ }
    if (saved && saved.x && saved.y && saved.d) {
      ownerKeyPromise = subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: saved.x, y: saved.y, d: saved.d, ext: true }, ECDSA, false, ['sign'])
        .then((priv) => ({ pub: `${saved.x}.${saved.y}`, priv }))
        .catch(() => null);
      return myOwnerKey(create);
    }
    if (!create) return Promise.resolve(null);
    ownerKeyPromise = makeOwnerKey();
    return ownerKeyPromise;
  }
  function makeOwnerKey() {
    const subtle = crypto.subtle;
    return subtle.generateKey(ECDSA, true, ['sign', 'verify']).then(async (pair) => {
      const jwk = await subtle.exportKey('jwk', pair.privateKey);
      try { localStorage.setItem(OWNER_KEY_STORE, JSON.stringify({ x: jwk.x, y: jwk.y, d: jwk.d })); } catch (e) { /* this visit only */ }
      return { pub: `${jwk.x}.${jwk.y}`, priv: pair.privateKey };
    }).catch(() => null);
  }
  function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  // What the owner sends with 'join', when this browser holds the room's
  // key (or any key: whoever runs the game compares it with the room's).
  async function ownerProof() {
    const k = await myOwnerKey(false);
    if (!k || !mesh || !mesh.id) return null;
    const ts = Date.now();
    const text = `${roomKey()}|${mesh.id}|${ts}`;
    try {
      const sig = await crypto.subtle.sign(SIGN, k.priv, new TextEncoder().encode(text));
      return { key: k.pub, ts, sig: b64url(sig) };
    } catch (e) { return null; }
  }
  async function verifyOwnerProof(proof, fromId) {
    if (!game.ownerKey || !proof || proof.key !== game.ownerKey || !window.crypto || !crypto.subtle) return false;
    if (Math.abs(Date.now() - proof.ts) > PROOF_MAX_AGE_MS) return false;
    const [x, y] = game.ownerKey.split('.');
    try {
      const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, ext: true }, ECDSA, false, ['verify']);
      return await crypto.subtle.verify(SIGN, pub, unb64url(proof.sig), new TextEncoder().encode(`${roomKey()}|${fromId}|${proof.ts}`));
    } catch (e) { return false; }
  }

  // The owner's tools, from the player menu: mute, unmute or ban `target`
  // (a leaderboard row: online with an id, or offline with a pid).
  function requestOwnerAction(action, target) {
    const targetId = target.offline ? null : target.id;
    const targetPid = target.pid || null;
    if (myState.role === 'host') hostOwnerAction(myState.myId, action, targetId, targetPid);
    else if (client) client.send({ type: 'ownerAction', action, targetId, targetPid });
  }
  function hostOwnerAction(connId, action, targetId, targetPid) {
    const by = hostPlayers.get(connId);
    if (!isOwner(by)) return;
    const online = targetId ? hostPlayers.get(targetId) : null;
    const offline = !online && targetPid ? departedPlayers.get(targetPid) : null;
    const target = online || offline;
    if (!target || target.owner || targetId === connId) return;
    if (action === 'mute' || action === 'unmute') {
      const k = muteKey(target);
      if (!k) return;
      game.muted = game.muted.filter((x) => x !== k);
      if (action === 'mute') game.muted.push(k);
      broadcastLobby();
      hostBroadcastChat('SYSTEM', target.name, action === 'mute' ? 'was muted by the room owner' : 'was unmuted by the room owner', true);
      return;
    }
    if (action !== 'ban') return;
    pruneBans();
    if (target.pid && !game.banned.includes(target.pid)) {
      game.banned = game.banned.concat(target.pid).slice(-500);
      game.bannedAt[target.pid] = Date.now();
    }
    hostBroadcastChat('SYSTEM', target.name, 'was banned by the room owner', true);
    if (online) {
      host.broadcast({ type: 'kicked', playerId: targetId, banned: true });
      if (targetId === myState.myId) { if (target.pid) departedPlayers.delete(target.pid); hostPlayers.delete(targetId); broadcastLobby(); leaveKicked(true); return; }
      hostPlayerLeft(targetId, true);
    }
    // A banned player is taken off the leaderboard too.
    if (target.pid) departedPlayers.delete(target.pid);
    broadcastLobby();
  }

  // Skips: with "Allow skips" off, nobody can skip a question while it's
  // read or open for buzzing, the room's owner included. Only once the
  // reading is over in a room with no timer (where nothing else would end
  // the question) can anyone move on.
  // Moving on is a skip while the question is being read, or open for
  // buzzing on the clock. With the timer off, a question that has been read
  // in full waits for Next: that's the end of it, not a skip.
  function isRealSkip() {
    return game.phase === 'reading' || (game.phase === 'buzzwindow' && roomSetting('timer', true));
  }
  function canSkip() {
    if (roomSetting('skip', true)) return true;
    return game.phase === 'buzzwindow' && !roomSetting('timer', true);
  }

  // The owner's browser keeps the room's record (owner key, bans and the
  // controlled switch) in the room list, so the room comes back the same
  // after everyone has left. Only the browser that created the room can
  // change it there; for anyone else saveRoom just answers false.
  // A record counts as saved only once the room list says so. A save that
  // failed for now (saveRoom rejects: no connection, a server error) is
  // tried again, sooner then later, until it goes through or the record
  // changes. One save is out at a time, so an older save's answer never
  // marks a newer record as saved; a change made meanwhile is sent when
  // it's back.
  let settledRecord = '';
  let savingRecord = null;
  let recordRetry = null;
  let recordRetryMs = 0;
  const RECORD_RETRY_MAX_MS = 60000;
  function saveRoomRecord() {
    if (!amOwner() || myState.publicLobby || !game.ownerKey) return;
    const key = roomKey();
    const rec = { isPublic: roomSetting('isPublic', true), ownerKey: game.ownerKey, banned: game.banned.slice(), controlled: !!roomSetting('controlled', false) };
    const text = key + '\u0000' + JSON.stringify(rec);
    if (text === settledRecord || savingRecord !== null) return;
    clearTimeout(recordRetry); recordRetry = null;
    savingRecord = text;
    SBRooms.saveRoom(key, rec).then(() => {
      // Saved (true), or nothing a retry would change: this browser didn't
      // create the room (false), or there's no room list for it (null).
      savingRecord = null;
      settledRecord = text;
      recordRetryMs = 0;
      saveRoomRecord();
    }, () => {
      savingRecord = null;
      recordRetryMs = Math.min(RECORD_RETRY_MAX_MS, recordRetryMs ? recordRetryMs * 2 : 2000);
      recordRetry = setTimeout(() => { recordRetry = null; saveRoomRecord(); }, recordRetryMs);
    });
  }

  // Whatever depends on who owns the room: the controlled-room lock on the
  // settings, the controlled and public switches, the record in the room
  // list. As on QB Reader, a room is never both public and controlled.
  function refreshOwnerControls() {
    const owner = amOwner();
    const controlled = !!roomSetting('controlled', false) && roomIsPrivate();
    const locked = controlled && !owner;
    const fieldset = document.getElementById('mpRoomSettings');
    if (fieldset) fieldset.disabled = locked;
    // The switch is there in rooms with an owner; only the owner can use
    // it, and only while the room is private.
    document.getElementById('mpControlledRow').classList.toggle('d-none', !game.ownerKey);
    const sw = document.getElementById('mpToggleControlled');
    sw.checked = controlled;
    sw.disabled = !owner || !roomIsPrivate();
    // A controlled room stays private until it's made uncontrolled.
    document.getElementById('mpTogglePublic').disabled = !!myState.publicLobby || controlled;
    // As on QB Reader, a note says why some settings can't be changed.
    document.getElementById('mpPermanentNote').classList.toggle('d-none', !myState.publicLobby);
    document.getElementById('mpControlledNote').classList.toggle('d-none', !controlled);
    // Skip follows "Allow skips".
    if (game.phase === 'reading' || game.phase === 'buzzwindow') document.getElementById('mpNextBtn').disabled = !canSkip();
    saveRoomRecord();
  }

  function enterGameScreen() {
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('mpGameScreen').style.display = '';
    document.getElementById('mpButtonBar').style.display = '';
  }

  function broadcastLobby() {
    game.players = [...hostPlayers.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, correct: p.correct || 0, incorrect: p.incorrect || 0, celSum: p.celSum || 0, celN: p.celN || 0, negs: p.negs || 0, heard: p.heard || 0, pid: p.pid || null, owner: !!p.owner }));
    pruneDeparted();
    pruneBans();
    game.departed = [...departedPlayers.values()];
    renderPlayerList(document.getElementById('mpPlayerList'));
    refreshOwnerControls();
    if (host) host.broadcast({ type: 'lobby', players: game.players, departed: game.departed, kicked: game.kicked, ownerKey: game.ownerKey, banned: game.banned, bannedAt: game.bannedAt, muted: game.muted, roomCode: myState.roomId });
  }

  function hostBroadcastChat(fromId, name, text, system, cid) {
    const entry = { from: fromId, name, text: text.slice(0, SBMpRules.LIMITS.chat), ts: Date.now() };
    if (system) entry.system = true;
    if (cid) entry.cid = cid;
    hostChat.push(entry);
    while (hostChat.length > CHAT_HISTORY) hostChat.shift();
    if (host) host.broadcast({ type: 'chat', entry });
    renderChatAppend(entry);
  }

  // Lets every player (not just the host) seed the room-settings panel with
  // the room's real current filters/rate when they open it, and keeps that
  // local copy fresh afterward - sent whenever those filters actually
  // change (see hostApplySettingsFromValues) and folded into the sync
  // payload below for anyone who joins mid-game.
  function settingsStatePayload() {
    const f = activeFilterState;
    return {
      mode: 'random', setName: '', packetNumbers: '',
      rebuzz: !!f.rebuzz, skip: f.skip !== false, controlled: !!f.controlled, timer: f.timer !== false, isPublic: f.isPublic !== false,
      subjects: [...f.subjects], qtypes: [...f.qtypes], formats: [...f.formats], levels: [...f.levels], visuals: [...(f.visuals || [])],
      tournaments: [...f.tournaments], roundRange: f.roundRange, yearRange: f.yearRange || null, includeUnlabeled: f.includeUnlabeled,
      rate: myState.rate,
    };
  }
  // `by` and `seq` say whose change this is and which of theirs (see
  // requestApplySettings).
  function broadcastSettingsState(by, seq) {
    if (!host || !activeFilterState) return;
    host.broadcast({ type: 'settingsState', ...settingsStatePayload(), by: by || null, seq: seq || 0 });
  }

  function sendSyncTo(connId) {
    const full = hostGame.currentFull;
    host.sendTo(connId, {
      type: 'sync',
      index: hostGame.index, total: hostGame.queue.length,
      question: full ? sanitizeQuestion(full) : null,
      phase: hostGame.phase,
      buzzedPlayerId: hostGame.buzzedConnId,
      lockedOut: [...hostGame.lockedOutIds],
      scores: [...hostPlayers.values()].map((p) => ({ id: p.id, score: p.score })),
      log: game.log,
      asked: game.asked,
      paused: hostGame.paused,
      rate: myState.rate,
      settings: activeFilterState ? settingsStatePayload() : null,
      lastRevealData: hostGame.phase === 'reveal' ? game.lastRevealData : null,
      lastGrade: game.lastGrade,
      attempts: game.attempts,
      overrideLocked: hostGame.overrideLocked,
      chat: hostChat.slice(-CHAT_HISTORY),
      // How much of the question the room has read, so a newcomer reads on
      // from there instead of seeing it all (and can't buzz on unread text).
      readUnits: revealCtl && !revealCtl.isDone() && (hostGame.phase === 'reading' || hostGame.phase === 'answering') ? revealCtl.units() : null,
    });
  }

  function handleHostMessage(connId, rawMsg) {
    const msg = SBMpRules.cleanHostMessage(rawMsg, SBData.meta);
    if (!msg) return;
    // Everything but 'join' needs a player who has joined.
    if (msg.type !== 'join' && !hostPlayers.has(connId)) return;
    if (msg.type === 'join') {
      if (hostPlayers.has(connId)) return;
      if (SBMpRules.isKicked(game.kicked, msg.pid)) { host.sendTo(connId, { type: 'kicked', playerId: connId }); return; }
      if (isBanned(msg.pid)) { host.sendTo(connId, { type: 'kicked', playerId: connId, banned: true }); return; }
      // A returning player (same pid, not already in the room) gets their
      // score back.
      const pidInUse = msg.pid && [...hostPlayers.values()].some((p) => p.pid === msg.pid);
      const back = msg.pid && !pidInUse ? departedPlayers.get(msg.pid) : null;
      if (back) departedPlayers.delete(msg.pid);
      hostPlayers.set(connId, { id: connId, name: uniqueName(msg.name, connId), score: back ? back.score : 0, correct: back ? back.correct || 0 : 0, incorrect: back ? back.incorrect || 0 : 0, celSum: back ? back.celSum || 0 : 0, celN: back ? back.celN || 0 : 0, negs: back ? back.negs || 0 : 0, heard: back ? back.heard || 0 : 0, connId, pid: pidInUse ? null : (msg.pid || null) });
      broadcastLobby();
      hostEvent(connId, 'joined the game');
      // The room's owner, coming back: their signature says so.
      if (msg.owner) verifyOwnerProof(msg.owner, connId).then((ok) => {
        const p = hostPlayers.get(connId);
        if (!ok || !p || myState.role !== 'host') return;
        p.owner = true;
        broadcastLobby();
      });
      // Everything a joiner needs, including the chat and the question log,
      // whether or not the game has started.
      sendSyncTo(connId);
      return;
    }
    if (msg.type === 'buzz') { hostHandleBuzz(connId); return; }
    if (msg.type === 'submitAnswer') { hostHandleAnswer(connId, msg.text); return; }
    if (msg.type === 'typing') {
      if (connId !== hostGame.buzzedConnId) return;
      game.liveTypingText = msg.text; game.liveTypingFrom = connId;
      host.broadcast({ type: 'typing', playerId: connId, text: msg.text });
      renderBuzzStatus();
      return;
    }
    if (msg.type === 'chatSend') {
      const p = hostPlayers.get(connId);
      if (isMuted(p)) { host.sendTo(connId, { type: 'notice', text: 'are muted in this room' }); return; }
      hostBroadcastChat(connId, p ? p.name : 'Player', msg.text, false, msg.cid);
      return;
    }
    if (msg.type === 'next') { if (hostGame.phase === 'reveal' || hostGame.phase === 'lobby') { if (hostGame.phase === 'lobby') hostEvent(connId, 'started the game'); hostNextQuestion(); } return; }
    if (msg.type === 'announceRounds') { hostAnnounceRounds(connId); return; }
    if (msg.type === 'announceYears') { hostAnnounceYears(connId); return; }
    if (msg.type === 'togglePause') { if (hostGame.phase !== 'lobby') hostEvent(connId, hostGame.paused ? 'unpaused the game' : 'paused the game'); hostTogglePause(); return; }
    if (msg.type === 'skip') {
      if (!canSkip()) return;
      if (isRealSkip()) hostEvent(connId, 'skipped the question');
      hostSkipQuestion();
      return;
    }
    if (msg.type === 'updateSettings') {
      hostApplySettingsFromValues({
        mode: msg.mode, setName: msg.setName, packetNumbers: msg.packetNumbers, rebuzz: msg.rebuzz, skip: msg.skip, controlled: msg.controlled, timer: msg.timer, isPublic: msg.isPublic,
        subjects: new Set(msg.subjects), qtypes: new Set(msg.qtypes), formats: new Set(msg.formats), levels: new Set(msg.levels), visuals: new Set(msg.visuals || []), tournaments: new Set(msg.tournaments),
        roundRange: msg.roundRange, yearRange: msg.yearRange, includeUnlabeled: msg.includeUnlabeled, rate: msg.rate, seq: msg.seq,
      }, connId);
      // Someone else changed the room's settings: show it in this player's
      // sidebar too (the others hear it as a 'settingsState').
      showSettingsFromState();
      return;
    }
    if (msg.type === 'override') { hostOverrideLastGrade(connId); return; }
    if (msg.type === 'rename') { hostRenamePlayer(connId, msg.name); return; }
    if (msg.type === 'clearStats') { hostClearStats(connId); return; }
    if (msg.type === 'votekick') { hostVotekick(connId, msg.targetId); return; }
    if (msg.type === 'ownerAction') { hostOwnerAction(connId, msg.action, msg.targetId, msg.targetPid); return; }
  }

  // Any player can rename themselves mid-game. The name is made unique the
  // same way as on joining, and the room is told in chat.
  function hostRenamePlayer(connId, desired) {
    const p = hostPlayers.get(connId);
    if (!p || !desired) return;
    const name = uniqueName(desired, connId);
    if (name === p.name) return;
    const old = p.name;
    p.name = name;
    if (connId === myState.myId) myState.myName = name;
    broadcastLobby();
    hostBroadcastChat('SYSTEM', old, `changed their username to ${name}`, true);
  }

  // Clear stats, as on QB Reader: a player's own score and counts go back to
  // zero, and the room is told.
  function hostClearStats(connId) {
    const p = hostPlayers.get(connId);
    if (!p) return;
    Object.assign(p, { score: 0, correct: 0, incorrect: 0, negs: 0, celSum: 0, celN: 0, heard: 0 });
    broadcastLobby();
    hostEvent(connId, 'cleared their stats');
  }

  function hostNextQuestion() {
    // The first question waits for the question bank, if it's still loading.
    if (!bankLoaded()) {
      if (hostGame.waitingForBank) return;
      hostGame.waitingForBank = true;
      setMatchCountText('Loading questions…');
      SBData.load().then(() => {
        hostGame.waitingForBank = false;
        onBankLoaded();
        if (myState.role === 'host' && (hostGame.phase === 'lobby' || hostGame.phase === 'reveal')) hostNextQuestion();
      }).catch((err) => { hostGame.waitingForBank = false; setMatchCountText(`Couldn't load the questions: ${err.message}`); });
      return;
    }
    if (hostGame.queueStale || (hostGame.index < 0 && !hostGame.queue.length)) rebuildQueue();
    clearHostTimer();
    hostGame.index++;
    hostGame.buzzedConnId = null;
    hostGame.anyAttempt = false;
    hostGame.lockedOutIds = new Set();
    hostGame.lastGrade = null;
    hostGame.gradesByConn = new Map();
    hostGame.overrideLocked = false;
    game.overrideLocked = false;
    hostGame.buzzwindowRemainingMs = null;
    game.lastRevealData = null;
    game.liveTypingText = ''; game.liveTypingFrom = null;

    if (hostGame.index >= hostGame.queue.length) {
      // As on QB Reader: everyone is told they've reached the end and stays
      // in the room, back before the first question; Start (n) begins the
      // set (or the room's questions) again from the top.
      hostGame.phase = 'lobby';
      hostGame.index = -1;
      hostGame.queue = [];
      hostGame.queueStale = true;
      hostGame.currentFull = null;
      const mode = roomSetting('mode', 'random');
      host.broadcast({ type: 'endOfQuestions', mode });
      applyEndOfQuestionsLocal(mode);
      return;
    }
    const full = hostGame.queue[hostGame.index];
    hostGame.currentFull = full;
    const sanitized = sanitizeQuestion(full);
    hostGame.phase = 'reading';
    host.broadcast({ type: 'question', index: hostGame.index, total: hostGame.queue.length, question: sanitized, rate: myState.rate });
    applyQuestionLocal(hostGame.index, hostGame.queue.length, sanitized);
    SBData.preloadImages(hostGame.queue[hostGame.index + 1]);

    startLocalReveal(sanitized, false, () => hostStartBuzzWindow());
  }

  function hostStartBuzzWindow() {
    if (myState.role !== 'host' || hostGame.phase !== 'reading') return;
    hostGame.phase = 'buzzwindow';
    host.broadcast({ type: 'phase', phase: 'buzzwindow' });
    applyPhaseLocal('buzzwindow');
    const full = hostGame.currentFull;
    let ms = full.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
    // (After a wrong interrupt, the question read on to here.)
    if (hostGame.anyAttempt) ms = Math.max(ms, AFTER_BUZZ_MS);
    hostRunTimer(ms, 'buzz', () => hostReveal());
  }

  function hostHandleBuzz(connId) {
    if (hostGame.phase !== 'reading' && hostGame.phase !== 'buzzwindow') return;
    if (hostGame.lockedOutIds.has(connId) || hostGame.buzzedConnId) return;
    hostGame.buzzedDuringReading = hostGame.phase === 'reading';
    // If this buzz interrupted the buzz-in countdown (not the reading), bank
    // whatever time was left on it so a wrong answer can resume from there
    // instead of restarting the whole countdown from full duration.
    if (hostGame.phase === 'buzzwindow') {
      hostGame.buzzwindowRemainingMs = hostGame.remainingMs;
    }
    hostGame.buzzedConnId = connId;
    hostGame.anyAttempt = true;
    hostGame.phase = 'answering';
    clearHostTimer();
    // Pause (not stop) the reveal — if this buzz is wrong, the rest of the
    // question should keep being revealed for the remaining field.
    if (revealCtl && !revealCtl.isDone()) revealCtl.pause();
    game.liveTypingText = ''; game.liveTypingFrom = null;
    const p = hostPlayers.get(connId);
    // Celerity: how much of the question had been read at this buzz.
    const celerity = hostGame.buzzedDuringReading && revealCtl ? revealCtl.progress() : 1;
    host.broadcast({ type: 'buzzAccepted', playerId: connId, playerName: p ? p.name : '?', celerity });
    applyBuzzLocal(connId, celerity);
    // If the answer timer runs out, submit whatever they'd typed so far
    // instead of forcing a blank - game.liveTypingText tracks their latest
    // known input for exactly this buzzed player throughout the countdown.
    hostRunTimer(ANSWER_MS, 'answer', () => answerTimeUp(connId));
  }

  function hostHandleAnswer(connId, text) {
    if (hostGame.phase !== 'answering' || connId !== hostGame.buzzedConnId) return;
    clearHostTimer();
    const full = hostGame.currentFull;
    const result = text.trim() ? SBAnswer.checkAnswer(full, text) : { correct: false };
    hostApplyGrade(connId, result.correct, text, !!result.close);
  }

  function hostApplyGrade(connId, correct, userText, close) {
    // The answer clock stops here however the grade came about (the answer
    // itself, time running out, or the player leaving mid-answer).
    clearHostTimer();
    const p = hostPlayers.get(connId);
    let delta = 0;
    if (correct) {
      delta = 4; if (p) { p.score += 4; p.correct = (p.correct || 0) + 1; p.celSum = (p.celSum || 0) + celerityNow(); p.celN = (p.celN || 0) + 1; }
    } else {
      delta = hostGame.buzzedDuringReading ? -4 : 0;
      // A wrong answer while the question was still being read is a neg (-4).
      const kind = delta < 0 ? 'negs' : 'incorrect';
      if (p) { p.score += delta; p[kind] = (p[kind] || 0) + 1; }
      // With rebuzzes allowed, a wrong answer doesn't lock the player out.
      if (!roomSetting('rebuzz', false)) hostGame.lockedOutIds.add(connId);
    }
    hostGame.lastGrade = { connId, correct, delta, userText };
    // Remember this player's own grade (and the buzz-timing context that
    // determines their incorrect-answer penalty) keyed by connId, not just
    // as "the" last grade - so they can still override THEIR OWN answer
    // later even after someone else has buzzed and been graded too.
    hostGame.gradesByConn.set(connId, { correct, delta, userText, buzzedDuringReading: hostGame.buzzedDuringReading, celerity: celerityNow() });
    const scores = [...hostPlayers.values()].map((pp) => ({ id: pp.id, score: pp.score }));
    const counts = countsOf(p);
    host.broadcast({ type: 'graded', playerId: connId, correct, delta, userText, scores, close, counts });
    applyGradeLocal(connId, correct, delta, scores, userText, false, undefined, close, counts);

    if (correct) {
      hostReveal();
      return;
    }
    const remaining = [...hostPlayers.keys()].filter((id) => !hostGame.lockedOutIds.has(id));
    hostGame.buzzedConnId = null;
    game.liveTypingText = ''; game.liveTypingFrom = null;
    if (!remaining.length) {
      hostReveal();
      return;
    }
    const canResumeReading = hostGame.buzzedDuringReading && revealCtl && !revealCtl.isDone();
    if (canResumeReading) {
      // A wrong buzz mid-reading doesn't end the question: keep revealing
      // the rest of it for whoever's left.
      hostGame.phase = 'reading';
      host.broadcast({ type: 'phase', phase: 'reading', lockedOut: [...hostGame.lockedOutIds] });
      applyPhaseLocal('reading', [...hostGame.lockedOutIds]);
      syncRevealToState();
    } else {
      hostGame.phase = 'buzzwindow';
      host.broadcast({ type: 'phase', phase: 'buzzwindow', lockedOut: [...hostGame.lockedOutIds] });
      applyPhaseLocal('buzzwindow', [...hostGame.lockedOutIds]);
      const full = hostGame.currentFull;
      const fullDurationMs = full.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
      // Resume the buzz-in countdown from where it was interrupted, rather
      // than restarting the whole question's buzz window at full duration.
      const ms = Math.max(AFTER_BUZZ_MS, hostGame.buzzwindowRemainingMs != null
        ? hostGame.buzzwindowRemainingMs
        : fullDurationMs);
      hostGame.buzzwindowRemainingMs = null;
      // Pass the ORIGINAL full duration as the bar's 100% reference (see
      // hostRunTimer) so picking up with, say, 12 of 20 seconds left shows a
      // partially-drained bar - the portion already spent before the first
      // buzz stays visibly "empty" - instead of rendering as a fresh full bar.
      hostRunTimer(ms, 'buzz', () => hostReveal(), Math.max(fullDurationMs, ms));
    }
  }

  // A player's answer counters as the coordinator has them, sent with every
  // grade so each screen (and whoever takes over the room) copies them
  // instead of counting on its own; an override then corrects them too.
  function countsOf(p) {
    if (!p) return null;
    return { correct: p.correct || 0, incorrect: p.incorrect || 0, negs: p.negs || 0, celSum: p.celSum || 0, celN: p.celN || 0 };
  }

  function hostOverrideLastGrade(requesterConnId) {
    // Players can only override their OWN answer (see canOverrideOwn). The
    // button/shortcut only shows when that's allowed, but a message straight
    // from a client could claim anything, so the host checks it again.
    const g = hostGame.gradesByConn.get(requesterConnId);
    const attempts = [...hostGame.gradesByConn].map(([playerId, gr]) => ({ playerId, correct: gr.correct }));
    if (!g || !SBMpRules.canOverrideOwn(attempts, requesterConnId, hostGame.overrideLocked)) return;
    const p = hostPlayers.get(requesterConnId);
    if (p) p.score -= g.delta;
    const nowCorrect = !g.correct;
    // "I was right" after someone else was graded correct: the question is
    // the requester's, so the other answer is marked wrong (no points, and
    // no penalty: they only got to answer because of the misgrade). Taking
    // the override back gives them their correct answer again.
    const regrade = (connId, gr, correct) => {
      const pp = hostPlayers.get(connId);
      const f = gr.celerity == null ? 1 : gr.celerity;
      if (pp) {
        pp.score += correct ? 4 : -4;
        pp.correct = Math.max(0, (pp.correct || 0) + (correct ? 1 : -1));
        pp.incorrect = Math.max(0, (pp.incorrect || 0) + (correct ? -1 : 1));
        pp.celSum = Math.max(0, (pp.celSum || 0) + (correct ? f : -f));
        pp.celN = Math.max(0, (pp.celN || 0) + (correct ? 1 : -1));
      }
      hostGame.gradesByConn.set(connId, { ...gr, correct, delta: correct ? 4 : 0, displacedBy: correct ? null : requesterConnId });
      return { type: 'graded', playerId: connId, correct, delta: correct ? 4 : 0, userText: gr.userText, override: true, by: requesterConnId, counts: countsOf(pp) };
    };
    const regraded = [];
    for (const [connId, gr] of [...hostGame.gradesByConn]) {
      if (connId === requesterConnId) continue;
      if (nowCorrect && gr.correct) regraded.push(regrade(connId, gr, false));
      else if (!nowCorrect && !gr.correct && gr.displacedBy === requesterConnId) regraded.push(regrade(connId, gr, true));
    }
    if (p) {
      const f = g.celerity == null ? 1 : g.celerity;
      const wrong = g.buzzedDuringReading ? 'negs' : 'incorrect';
      if (nowCorrect) { p.correct = (p.correct || 0) + 1; p[wrong] = Math.max(0, (p[wrong] || 0) - 1); p.celSum = (p.celSum || 0) + f; p.celN = (p.celN || 0) + 1; }
      else { p[wrong] = (p[wrong] || 0) + 1; p.correct = Math.max(0, (p.correct || 0) - 1); p.celSum = Math.max(0, (p.celSum || 0) - f); p.celN = Math.max(0, (p.celN || 0) - 1); }
    }
    let delta = 0;
    if (nowCorrect) {
      delta = 4;
    } else {
      // Use THIS attempt's own buzz-timing context (captured when it was
      // originally graded), not whatever the most recent buzz happened to
      // be - otherwise overriding an earlier player's answer could apply
      // the wrong player's reading/buzz-window penalty.
      delta = g.buzzedDuringReading ? -4 : 0;
      hostGame.lockedOutIds.add(requesterConnId);
    }
    if (p) p.score += delta;
    const updated = { ...g, correct: nowCorrect, delta };
    hostGame.gradesByConn.set(requesterConnId, updated);
    hostGame.lastGrade = { connId: requesterConnId, correct: nowCorrect, delta, userText: g.userText };
    // Changed to correct: locked for everyone else. Taken back: unlocked.
    hostGame.overrideLocked = nowCorrect ? requesterConnId : false;
    game.overrideLocked = hostGame.overrideLocked;
    const scores = [...hostPlayers.values()].map((pp) => ({ id: pp.id, score: pp.score }));
    const counts = countsOf(p);
    host.broadcast({ type: 'graded', playerId: requesterConnId, correct: nowCorrect, delta, userText: g.userText, scores, override: true, overrideLocked: hostGame.overrideLocked, counts });
    applyGradeLocal(requesterConnId, nowCorrect, delta, scores, g.userText, true, hostGame.overrideLocked, undefined, counts);
    regraded.forEach((m) => {
      const out = { ...m, scores, overrideLocked: hostGame.overrideLocked };
      host.broadcast(out);
      applyGradeLocal(out.playerId, out.correct, out.delta, scores, out.userText, true, hostGame.overrideLocked, undefined, out.counts, out.by);
    });
    if (game.log.length) game.log[0].category = nowCorrect || regraded.some((m) => m.correct) ? 'correct' : 'incorrect';
    host.broadcast({ type: 'logUpdate', log: game.log });
    if (nowCorrect && hostGame.phase !== 'reveal') hostReveal();
    fullRenderFromState();
  }

  function hostReveal() {
    clearHostTimer();
    hostGame.phase = 'reveal';
    const full = hostGame.currentFull;
    const revealData = {
      // Prefer the MC choice's own full text over the separate answer-text
      // field, which is sometimes truncated in the source data - see
      // SBData.answerDisplayText.
      answerText: SBData.answerDisplayText(full), letter: full.answer.letter || null,
      accept: full.answer.accept, reject: full.answer.reject,
      // The packet link is sent with the answer, not with the question,
      // so nobody can open the packet before the answer is shown.
      sourceUrl: full.sourceUrl || null,
    };
    const grade = hostGame.lastGrade;
    const category = grade && grade.correct ? 'correct' : (hostGame.anyAttempt ? 'incorrect' : 'skipped');
    const answeredByPlayer = grade ? hostPlayers.get(grade.connId) : null;
    const logEntry = {
      question: sanitizeQuestion(full),
      answer: revealData,
      category,
      answeredBy: answeredByPlayer ? answeredByPlayer.name : null,
      userText: grade ? grade.userText : null,
      at: Date.now(),
    };
    game.log.unshift(logEntry);
    host.broadcast({ type: 'reveal', ...revealData, logEntry });
    applyRevealLocal(revealData);
    // Everyone in the room has heard one more question (QB Reader's TUH):
    // it's what makes a player, and a room, count as played in.
    hostPlayers.forEach((p) => { p.heard = (p.heard || 0) + 1; });
    broadcastLobby();
  }

  function hostRunTimer(ms, kind, onExpire, displayTotalMs) {
    clearHostTimer();
    // With the timer off, the buzz window has no end: Next moves on. (The
    // answer timer still runs, hidden, so nobody can stall the room.)
    if (kind === 'buzz' && !roomSetting('timer', true)) return;
    // displayTotalMs lets a resumed countdown (e.g. the buzz window picking
    // back up after a wrong answer) keep the bar's 100%-width reference at
    // the ORIGINAL full duration, rather than at just what's left. Without
    // this, resuming with (say) 12s left of a 20s window reset the bar's own
    // notion of "full" to 12s, so it rendered as a full bar instead of a
    // partially-drained one - it looked like a fresh countdown instead of a
    // pickup, hiding how much time had already been spent before the buzz.
    hostGame.totalMs = displayTotalMs != null ? displayTotalMs : ms;
    hostGame.remainingMs = ms; hostGame.timerKind = kind; hostGame.onExpire = onExpire;
    // Anchored to the wall clock (Date.now()), not to a running tally
    // decremented by a fixed 100ms per interval firing. A backgrounded /
    // inactive browser tab throttles setInterval - sometimes to once a
    // second or slower - and a fixed decrement would assume every
    // firing represented exactly 100ms of real time, so the host's own
    // countdown (and every tick it broadcasts) ran far too SLOW while its
    // tab was in the background. A non-host client interpolates smoothly
    // between ticks based on its own real elapsed time (see onClientTick),
    // so when one of those too-slow ticks finally arrived, it reported a
    // remaining time much HIGHER than what the client had already counted
    // down to on its own - the timer visibly jumping back up. Computing
    // remainingMs from actual elapsed time instead
    // means every tick, however late it fires, reports the true remaining
    // time - it can only ever count down for a client, never jump up.
    hostGame.timerRemainingAtAnchor = ms;
    hostGame.timerAnchorAt = Date.now();
    host.broadcast({ type: 'tick', remainingMs: ms, totalMs: hostGame.totalMs, kind });
    applyTickLocal(ms, hostGame.totalMs, kind);
    hostGame.timer = setInterval(() => {
      if (hostGame.paused) return;
      const elapsed = Date.now() - hostGame.timerAnchorAt;
      hostGame.remainingMs = Math.max(0, hostGame.timerRemainingAtAnchor - elapsed);
      if (hostGame.remainingMs <= 0) {
        hostGame.remainingMs = 0;
        host.broadcast({ type: 'tick', remainingMs: 0, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
        applyTickLocal(0, hostGame.totalMs, hostGame.timerKind);
        clearInterval(hostGame.timer); hostGame.timer = null;
        const fn = hostGame.onExpire; hostGame.onExpire = null;
        if (fn) fn();
        return;
      }
      applyTickLocal(hostGame.remainingMs, hostGame.totalMs, hostGame.timerKind);
      // Broadcast on every firing (rather than every other one, as before)
      // - when the tab is throttled, firings are already sparse, and this
      // is exactly when corrections need to reach clients as soon as they
      // can, not be held back further by a cadence check on top of that.
      host.broadcast({ type: 'tick', remainingMs: hostGame.remainingMs, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
    }, 100);
  }
  function clearHostTimer() {
    if (hostGame.timer) clearInterval(hostGame.timer);
    hostGame.timer = null; hostGame.onExpire = null;
  }

  function hostTogglePause() {
    if (hostGame.phase === 'lobby') return;
    hostGame.paused = !hostGame.paused;
    game.paused = hostGame.paused;
    // Send the pause/resume flag itself before the tick below, so by the
    // time a client applies that tick it already knows whether to hold it
    // frozen or keep counting down from it.
    host.broadcast({ type: 'pauseState', paused: hostGame.paused });
    if (hostGame.timer) {
      if (hostGame.paused) {
        // Freeze the running timer's remaining time at this instant, so the
        // wall-clock-anchored countdown in hostRunTimer doesn't keep
        // counting down against Date.now() while paused.
        const elapsed = Date.now() - hostGame.timerAnchorAt;
        hostGame.timerRemainingAtAnchor = Math.max(0, hostGame.timerRemainingAtAnchor - elapsed);
        hostGame.remainingMs = hostGame.timerRemainingAtAnchor;
      } else {
        // Resuming: re-anchor to now, keeping the frozen remaining value.
        hostGame.timerAnchorAt = Date.now();
      }
      // The interval that normally drives ticks skips its body entirely
      // while paused (see hostRunTimer), so nothing pushes the freshly
      // frozen value out on its own. Push one now so the host's own render
      // and every client's game.lastTick reflect the frozen time right
      // away, instead of showing whatever was last ticked up to 100ms ago.
      host.broadcast({ type: 'tick', remainingMs: hostGame.remainingMs, totalMs: hostGame.totalMs, kind: hostGame.timerKind });
      applyTickLocal(hostGame.remainingMs, hostGame.totalMs, hostGame.timerKind);
    }
    syncRevealToState();
    fullRenderFromState();
  }

  // Anyone can skip a question that's still being read / open for buzzing
  // (not once someone's actively answering) - jumps straight to reveal with
  // no grade, same as the timer naturally expiring with nobody buzzing in.
  function hostSkipQuestion() {
    if (hostGame.phase !== 'reading' && hostGame.phase !== 'buzzwindow') return;
    hostReveal();
  }

  /* ---- host applies its own broadcasts to its local render state (host is also a player) ---- */
  function applyQuestionLocal(index, total, sanitized) {
    if (window.SBQuestionStats) SBQuestionStats.flush(); // the last question's play is final
    hideSettingsOnPhone();
    game.index = index; game.total = total; game.question = sanitized;
    if (sanitized && sanitized.id != null && !game.asked.includes(sanitized.id)) game.asked.push(sanitized.id);
    game.phase = 'reading'; game.buzzedPlayerId = null; game.lockedOut = new Set();
    game.lastGrade = null; game.attempts = [];
    game.overrideLocked = false;
    // A new question is starting - make sure the chat box isn't still
    // holding keyboard focus, so buzz/keyboard shortcuts work immediately
    // without the player having to click away from chat first.
    const chatInput = document.getElementById('mpChatInput');
    if (chatInput && document.activeElement === chatInput) chatInput.blur();
    fullRenderFromState();
  }
  function applyPhaseLocal(phase, lockedOut) {
    game.phase = phase;
    if (lockedOut) game.lockedOut = new Set(lockedOut);
    game.buzzedPlayerId = null;
    fullRenderFromState();
  }
  function playerName(id) {
    const p = game.players.find((pp) => pp.id === id);
    return p ? p.name : (id === myState.myId ? myState.myName : 'Player');
  }
  // The share of the question read at the current buzz (1 once it's all out).
  function celerityNow() { return typeof game.buzzCelerity === 'number' ? game.buzzCelerity : 1; }
  function applyBuzzLocal(playerId, celerity) {
    game.buzzCelerity = typeof celerity === 'number' && celerity >= 0 && celerity <= 1 ? celerity : 1;
    game.buzzedPlayerId = playerId; game.phase = 'answering';
    game.liveTypingText = ''; game.liveTypingFrom = null;
    // A live line with a Buzz chip and what they type (no separate
    // "Bob buzzed" line: the chip already says so).
    liveBuzzLine(playerId, playerName(playerId));
    fullRenderFromState();
  }
  // by: the player whose own override changed this player's grade (their
  // "I was right" takes the question from whoever was graded correct).
  function applyGradeLocal(playerId, correct, delta, scores, userText, isOverride, overrideLocked, close, counts, by) {
    scores.forEach((s) => { const pl = game.players.find((p) => p.id === s.id); if (pl) pl.score = s.score; });
    const pl = game.players.find((pp) => pp.id === playerId);
    const cleanCounts = counts && typeof counts === 'object'
      && ['correct', 'incorrect', 'negs', 'celSum', 'celN'].every((k) => typeof counts[k] === 'number' && isFinite(counts[k]) && counts[k] >= 0);
    if (pl && cleanCounts) {
      ['correct', 'incorrect', 'negs', 'celSum', 'celN'].forEach((k) => { pl[k] = counts[k]; });
    } else if (pl && !isOverride) {
      // (From a coordinator running an older copy, which sends no counters.)
      if (correct) { pl.correct = (pl.correct || 0) + 1; pl.celSum = (pl.celSum || 0) + celerityNow(); pl.celN = (pl.celN || 0) + 1; } else if (delta < 0) pl.negs = (pl.negs || 0) + 1; else pl.incorrect = (pl.incorrect || 0) + 1;
    }
    if (!correct && !roomSetting('rebuzz', false)) game.lockedOut.add(playerId);
    // The answer clock is over once the answer is graded: back to 0, not
    // stopped on (or still counting down from) what was left of it while
    // the question reads on after a wrong interrupt. A buzz window that
    // picks up again sends its own tick after this.
    if (!isOverride) hideTimer();
    game.lastGrade = { playerId, correct, userText };
    if (isOverride && correct && !by && playerId === myState.myId && window.SBReports && game.question) {
      SBReports.logOverride(SBData.byId.get(game.question.id), userText, 'mp');
    }
    if (isOverride) {
      recolorBuzzLine(playerId, correct); renderOverrideLinkSoon();
      if (by && by !== playerId) logEvent(playerName(playerId), `was marked ${correct ? 'correct again' : 'incorrect'}: ${playerName(by)} ${correct ? 'took back their override' : 'was right'}`);
      else logEvent(playerName(playerId), `changed their answer to ${correct ? 'correct' : 'incorrect'}`);
    }
    else finishBuzzLine(playerId, playerName(playerId), correct, userText, close);
    if (overrideLocked !== undefined) game.overrideLocked = overrideLocked || false;
    // Find THIS player's own attempt row to update, rather than assuming an
    // override always targets whichever attempt happens to be last in the
    // list - a player who buzzed earlier (not last) can now override their
    // own answer too, and each player has at most one attempt per question.
    const existing = isOverride ? game.attempts.find((a) => a.playerId === playerId) : null;
    if (existing) {
      existing.correct = correct;
    } else {
      const p = game.players.find((pp) => pp.id === playerId);
      game.attempts.push({ playerId, playerName: p ? p.name : '?', userText, correct, close: !!close });
    }
    renderPlayerList(document.getElementById('mpPlayerList'));
    renderBuzzStatus();
    // Your own answers go to your account's stats.
    if (playerId === myState.myId && game.question && window.SBAccount) {
      recordMyAnswer(correct ? 'correct' : 'incorrect', isOverride, { points: correct ? 4 : (delta < 0 ? -4 : 0), celerity: 1 - celerityNow() });
    }
    // And to the question's community stats (a −4 is an interrupt).
    if (playerId === myState.myId && game.question && window.SBQuestionStats) {
      SBQuestionStats.track(game.question, 'mp', correct ? 'correct' : (delta < 0 ? 'neg' : 'incorrect'), correct ? 1 - celerityNow() : null, game.index);
    }
  }
  // One row per question in your account's stats, for how the question
  // ended for you: a wrong answer then a correct rebuzz ends correct, and an
  // override changes it either way. A question you never buzzed on counts as
  // skipped when it's revealed.
  let statsRecordedFor = null;
  let statsAttempt = null;
  // extra: the points and celerity saved with it (see SBAccount.recordAnswer).
  function recordMyAnswer(result, isOverride, extra) {
    const key = game.question.id + ':' + game.index;
    if (statsRecordedFor === key) {
      if (!statsAttempt || statsAttempt.result === result) return;
      // Later attempts only improve it; an override can go either way.
      if (isOverride || result === 'correct') statsAttempt.update(result, extra);
      return;
    }
    statsRecordedFor = key;
    statsAttempt = SBAccount.recordAnswer(game.question, result, 'mp', extra);
  }
  function applyRevealLocal(revealData) {
    // A question read in full that nobody got, and you didn't buzz on: no
    // answer from you, for its community stats.
    if (game.question && window.SBQuestionStats && game.phase === 'buzzwindow'
        && !game.attempts.some((a) => a.playerId === myState.myId || a.correct)) {
      SBQuestionStats.track(game.question, 'mp', 'unanswered', null, game.index);
    }
    game.phase = 'reveal'; game.lastRevealData = revealData;
    if (game.question && window.SBAccount && !game.attempts.some((a) => a.playerId === myState.myId)) recordMyAnswer('skipped', false, { points: 0, celerity: null });
    fullRenderFromState();
  }
  function applyTickLocal(remainingMs, totalMs, kind) {
    game.lastTick = { remainingMs, totalMs, kind };
    renderTick(remainingMs, totalMs, kind);
  }
  // The questions ran out: back to before the first question, with the
  // same alert Play gives (after the screen has been redrawn).
  function applyEndOfQuestionsLocal(mode) {
    if (revealCtl) { revealCtl.stop(); revealCtl = null; }
    stopClientTickLoop();
    Object.assign(game, { phase: 'lobby', question: null, index: -1, buzzedPlayerId: null, lockedOut: new Set(), lastGrade: null, attempts: [], overrideLocked: false, lastRevealData: null, paused: false, lastTick: null, asked: [] });
    fullRenderFromState();
    const text = mode === 'set' ? 'You have reached the end of the set' : 'You have reached the end of the questions that match the room\'s settings';
    setTimeout(() => window.alert(text), 50);
  }

  /* ================= THE ROOM ================= */
  // A room belongs to nobody. Every player is connected to every other
  // (SBPeer.makeMesh) and keeps the whole live game: players, scores, the
  // players who've left, the log, the chat, the settings, and where the
  // current question stands (phase, buzzes, timers). One player, the
  // longest-standing one still here, rules on buzzes, timers and grading -
  // the "coordinator", which is what the host* functions above do. When they
  // leave, everyone already agrees on who's next (SBMpRules.pickCoordinator),
  // and that player carries on from their own copy at once, mid-question
  // included. Anyone who leaves is simply taken off the leaderboard, their
  // score kept for if they come back.
  //
  // The room's code is only its door: the coordinator holds that peer ID and
  // answers newcomers with the list of players to connect to.
  let client = null;
  let mesh = null;
  let term = 0;
  let coordinatorId = null;
  // The coordinator's last word on what the other players can't see for
  // themselves (penalty context, per-player grades); see engineSnapshot.
  let followerEngine = null;
  // Who's connected and what they joined as (from their 'join').
  const memberInfo = new Map();
  let doorLoopRunning = false;
  const DOOR_RETRY_MS = 3000;
  const DOOR_ATTEMPTS = 40;

  // Messages a coordinator sends carry its term, and all but the frequent
  // ones carry the engine state, so whoever takes over next is never more
  // than one message behind.
  const NO_ENGINE = new Set(['tick', 'typing', 'chat']);
  function engineSnapshot() {
    return {
      buzzedDuringReading: hostGame.buzzedDuringReading,
      anyAttempt: hostGame.anyAttempt,
      buzzwindowRemainingMs: hostGame.buzzwindowRemainingMs,
      grades: [...hostGame.gradesByConn],
    };
  }
  function stamp(msg) {
    const out = { ...msg, term };
    if (!NO_ENGINE.has(msg.type)) out.eng = engineSnapshot();
    return out;
  }
  const hostLink = {
    broadcast(msg) { if (mesh) mesh.broadcast(stamp(msg)); },
    sendTo(id, msg) { if (mesh) mesh.send(id, stamp(msg)); },
  };
  const clientLink = {
    send(msg) { if (mesh && coordinatorId) mesh.send(coordinatorId, msg); },
  };

  function isUp(id) { return !!mesh && (id === mesh.id || mesh.isUp(id)); }
  function memberOrder() {
    return SBMpRules.coordinatorOrder(game.players.map((p) => p.id), [...memberInfo.keys(), mesh ? mesh.id : null].filter(Boolean));
  }

  // This player's connection: made once, as early as there's reason to (the
  // lobby makes it ahead of time, so a room opens without waiting for it).
  // Its TURN logins are asked for alongside (see SBPeer.makeMesh).
  const DISCONNECTED_TEXT = 'Disconnected from server';
  function openMesh() {
    if (!mesh) {
      mesh = SBPeer.makeMesh({
        onMessage: onMeshMessage,
        onLeave: onMemberLeft,
        // As QB Reader does when its connection to the room drops: a
        // message in a dialog on the page, with an OK button.
        onDisconnect: () => { if (myState.role) SBSite.alert(DISCONNECTED_TEXT); },
        // Reconnected: the "Disconnected" dialog, if still up, goes away.
        onReconnect: () => {
          const el = document.getElementById('alert-modal');
          const text = document.getElementById('alert-modal-text');
          if (el && el.classList.contains('show') && text && text.textContent === DISCONNECTED_TEXT) SBSite.hideModal(el);
        },
        doorInfo: () => ({ players: game.players.length, coordinator: coordinatorId, term }),
      });
    }
    return mesh.ready;
  }

  function onMeshMessage(from, data) {
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === 'chatLive') {
      // Straight from the player typing it, not through the game's runner
      // (and not shown at all from a muted player).
      if (isMuted(game.players.find((p) => p.id === from))) return;
      const cid = SBMpRules.cleanChatId(data.cid);
      if (cid && data.text === null) renderLiveChat(from, cid, null);
      else if (cid && typeof data.text === 'string') renderLiveChat(from, cid, data.text.slice(0, SBMpRules.LIMITS.chat));
      return;
    }
    if (data.type === 'join') {
      const msg = SBMpRules.cleanHostMessage(data, SBData.meta);
      if (!msg) return;
      memberInfo.set(from, { name: msg.name, pid: msg.pid || null });
      if (myState.role === 'host') handleHostMessage(from, msg);
      return;
    }
    if ('term' in data) {
      // From a coordinator: follow it, or ignore it (see acceptsCoordinator).
      if (!SBMpRules.acceptsCoordinator({ term, coordinatorId, order: memberOrder(), isUp }, from, data.term)) return;
      if (from !== coordinatorId || data.term !== term) followCoordinator(from, data.term);
      if (data.eng) followerEngine = data.eng;
      handleClientMessage(data);
      return;
    }
    if (myState.role === 'host') handleHostMessage(from, data);
  }

  function followCoordinator(id, newTerm) {
    if (myState.role === 'host' && mesh) {
      clearHostTimer();
      mesh.releaseDoor();
    }
    term = newTerm;
    coordinatorId = id;
    myState.role = 'client';
    host = null;
    client = clientLink;
  }

  function onMemberLeft(id) {
    memberInfo.delete(id);
    const live = liveChatEls.get(id);
    if (live) { live.remove(); liveChatEls.delete(id); }
    if (!mesh || !myState.role) return;
    if (myState.role === 'host') {
      hostPlayerLeft(id);
      return;
    }
    if (id !== coordinatorId) return;
    const next = SBMpRules.pickCoordinator(memberOrder().filter((x) => x !== id), isUp);
    if (!next || next === mesh.id) {
      // Running the game needs the question bank; a player who has only
      // just come in may still be loading it.
      if (bankLoaded()) takeOver();
      else SBData.load().then(() => { if (myState.role === 'client' && coordinatorId === id) takeOver(); }).catch(() => {});
    } else coordinatorId = next; // they take over; their first message has a newer term
  }

  // Carry on the room from this player's own copy, exactly where it stands.
  function takeOver() {
    term += 1;
    coordinatorId = mesh.id;
    myState.role = 'host';
    host = hostLink;
    client = null;
    const tick = game.lastTick;
    stopClientTickLoop();

    // Players: whoever's still connected stays; anyone else has left.
    hostPlayers.clear();
    departedPlayers.clear();
    (game.departed || []).forEach((d) => { if (d && d.pid) departedPlayers.set(d.pid, { ...d }); });
    game.players.forEach((p) => {
      if (isUp(p.id)) hostPlayers.set(p.id, { id: p.id, name: p.name, score: p.score, correct: p.correct || 0, incorrect: p.incorrect || 0, celSum: p.celSum || 0, celN: p.celN || 0, negs: p.negs || 0, heard: p.heard || 0, connId: p.id, pid: p.pid || null, owner: !!p.owner });
      else if (p.pid && SBMpRules.hasActivity(p)) markOffline(p);
    });
    if (!hostPlayers.has(mesh.id)) addPlayer(mesh.id, myState.myName, myState.pid);
    memberInfo.forEach((info, id) => { if (isUp(id) && !hostPlayers.has(id)) addPlayer(id, info.name, info.pid); });
    hostChat.length = 0;
    hostChat.push(...chatMirror);

    // The questions still to come: the room's settings, minus what's been asked.
    if (activeFilterState) withLobbySubjects(activeFilterState);
    const filters = activeFilterState || lobbyFilters(myState.publicLobby || { subjects: SBData.meta.subjects.map((x) => x.key) });
    if (!activeFilterState) activeFilterState = copyFilters(filters);
    const asked = new Set(game.asked);
    const cur = game.question && SBData.byId.get(game.question.id);
    if (cur) asked.add(cur.id);
    // Nothing left is nothing left: the room reaches the end of the
    // questions, as it would have, and starts again only with Start.
    const tail = queueFor(filters).filter((q) => !asked.has(q.id));
    const playing = cur && game.phase !== 'lobby';
    const eng = followerEngine || {};
    clearHostTimer();
    Object.assign(hostGame, {
      queue: playing ? [cur].concat(tail) : tail,
      queueStale: false,
      index: playing ? 0 : -1,
      phase: playing ? game.phase : 'lobby',
      currentFull: playing ? cur : null,
      buzzedConnId: game.buzzedPlayerId || null,
      buzzedDuringReading: !!eng.buzzedDuringReading,
      anyAttempt: !!eng.anyAttempt || game.attempts.length > 0,
      buzzwindowRemainingMs: typeof eng.buzzwindowRemainingMs === 'number' ? eng.buzzwindowRemainingMs : null,
      lockedOutIds: new Set(game.lockedOut),
      gradesByConn: new Map(Array.isArray(eng.grades) ? eng.grades : []),
      overrideLocked: game.overrideLocked || false,
      paused: !!game.paused,
      lastGrade: game.lastGrade ? { connId: game.lastGrade.playerId, correct: game.lastGrade.correct, delta: 0, userText: game.lastGrade.userText } : null,
    });
    game.total = hostGame.queue.length;

    // Pick the question up where it is.
    const left = (kind) => (tick && tick.kind === kind ? tick.remainingMs : null);
    if (hostGame.phase === 'reading') {
      if (!revealCtl || revealCtl.isDone()) hostStartBuzzWindow();
    } else if (hostGame.phase === 'buzzwindow') {
      const full = cur.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
      hostRunTimer(left('buzz') ?? full, 'buzz', () => hostReveal(), tick ? tick.totalMs : full);
    } else if (hostGame.phase === 'answering') {
      const who = hostGame.buzzedConnId;
      if (who && hostPlayers.has(who)) hostRunTimer(left('answer') ?? ANSWER_MS, 'answer', () => answerTimeUp(who), ANSWER_MS);
      else buzzedPlayerGone(who);
    }
    broadcastLobby();
    keepDoor();
  }

  function addPlayer(id, name, pid) {
    const pidInUse = pid && [...hostPlayers.values()].some((p) => p.pid === pid);
    const back = pid && !pidInUse ? departedPlayers.get(pid) : null;
    if (back) departedPlayers.delete(pid);
    hostPlayers.set(id, { id, name: uniqueName(name, id), score: back ? back.score : 0, correct: back ? back.correct || 0 : 0, incorrect: back ? back.incorrect || 0 : 0, celSum: back ? back.celSum || 0 : 0, celN: back ? back.celN || 0 : 0, negs: back ? back.negs || 0 : 0, heard: back ? back.heard || 0 : 0, connId: id, pid: pidInUse ? null : (pid || null) });
  }

  // The coordinator holds the room's code, so newcomers can find the room.
  // When it changes hands, the old holder's ID can take a while to free up
  // (up to a minute if they dropped off rather than leaving), so keep
  // trying. If someone else answers on it, this player has been cut off
  // from the room: rejoin it, score and all.
  async function keepDoor() {
    if (doorLoopRunning) return;
    doorLoopRunning = true;
    try {
      for (let i = 0; i < DOOR_ATTEMPTS && myState.role === 'host' && mesh && !mesh.holdsDoor(); i++) {
        try {
          await mesh.claimDoor(myState.roomId);
          if (myState.role !== 'host') mesh.releaseDoor();
          return;
        } catch (err) {
          if (err && err.type === 'unavailable-id' && myState.role === 'host') {
            try {
              const info = await mesh.join(myState.roomId);
              if (info.coordinator && info.coordinator !== mesh.id && !hostPlayers.has(info.coordinator) && myState.role === 'host') {
                rejoinRoom(info);
                return;
              }
            } catch (e) { /* nobody there yet */ }
          }
        }
        await sleep(DOOR_RETRY_MS);
      }
    } finally {
      doorLoopRunning = false;
    }
  }
  function rejoinRoom(info) {
    followCoordinator(info.coordinator, typeof info.term === 'number' ? info.term : term);
    sendJoin(myState.myName);
  }

  // A player who leaves while answering just stops answering: no penalty,
  // and the question goes on for everyone else.
  function buzzedPlayerGone(connId) {
    hostGame.buzzedDuringReading = false;
    hostApplyGrade(connId, false, '', false);
  }
  function answerTimeUp(connId) {
    let text = game.liveTypingFrom === connId ? game.liveTypingText : '';
    if (connId === myState.myId) text = document.getElementById('mpAnswerInput').value;
    hostHandleAnswer(connId, text);
  }

  // The room's key in the room list: its name, or pub-<key> for a built-in room.
  function roomKey() { return myState.publicLobby ? SBRooms.key('', myState.publicLobby.key) : myState.roomName; }

  function enterRoomAs(roomId, name, lobby) {
    myState.myId = mesh.id;
    myState.myName = name;
    myState.publicLobby = lobby || null;
    myState.roomId = roomId;
    enterGameScreen();
    showRoomCode();
    document.getElementById('mpUsername').value = name;
    // Put the room in the address bar, so reloading rejoins it and the URL
    // can be shared as is.
    try { history.replaceState(null, '', inviteLink()); } catch (e) { /* e.g. file:// */ }
    startHeartbeat();
    SBData.load().then(onBankLoaded).catch((err) => setMatchCountText(`Couldn't load the questions: ${err.message}`));
  }

  // Tells the room list (when there is one) that this player is here, with
  // their name and score; repeated every 30 seconds.
  let heartbeatTimer = null;
  function beat() {
    if (!myState.role) return;
    const me = game.players.find((p) => p.id === myState.myId) || { name: myState.myName, score: 0 };
    SBRooms.heartbeat(roomKey(), {
      isPublic: myState.publicLobby ? true : roomSetting('isPublic', true),
      isPermanent: !!myState.publicLobby,
    }, { pid: myState.pid, name: me.name || myState.myName, score: me.score || 0, correct: me.correct || 0, incorrect: me.incorrect || 0, negs: me.negs || 0, celSum: me.celSum || 0, celN: me.celN || 0, heard: me.heard || 0 }).catch(() => {});
  }
  // After a settings change (a dragged slider makes many): one heartbeat,
  // a second after the last.
  let beatTimer = null;
  function beatSoon() { clearTimeout(beatTimer); beatTimer = setTimeout(beat, 1000); }
  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(beat, 300);
    heartbeatTimer = setInterval(beat, 30 * 1000);
  }

  function savedRate() {
    return SBMpRules.readingSpeed((() => { try { return localStorage.getItem('sb_reading_speed'); } catch (e) { return null; } })());
  }

  // Opens the room under `roomId`, with this player first in it, once this
  // player holds its door (enterRoomByDoor). `info` is what the room list
  // keeps about it (SBRooms.roomInfo), or null.
  async function startRoom({ roomId, filters, name, rate, lobby, info }) {
    term = 1;
    coordinatorId = mesh.id;
    myState.role = 'host';
    host = hostLink;
    client = null;
    myState.rate = rate;
    resetHostGame();
    game.log = [];
    game.asked = [];
    hostPlayers.clear();
    departedPlayers.clear();
    hostChat.length = 0;
    activeFilterState = copyFilters(filters);
    // A room the list knows keeps whether it's listed (not what a link says).
    if (!lobby && info && info.exists && typeof info.isPublic === 'boolean') activeFilterState.isPublic = info.isPublic;
    // The questions are picked when the game starts (rebuildQueue), which
    // waits for the question bank if it's still loading.
    hostGame.queue = [];
    hostGame.queueStale = true;
    game.total = hostGame.queue.length;
    myState.myName = name;
    const me = { id: mesh.id, name, score: 0, correct: 0, incorrect: 0, negs: 0, celSum: 0, celN: 0, heard: 0, connId: mesh.id, pid: myState.pid, owner: false };

    // The owner (named rooms only): the one the room list has, or this
    // player, for a room that's new (or, with no room list, one starting up).
    game.ownerKey = null; game.banned = []; game.bannedAt = {}; game.muted = [];
    if (!lobby) {
      if (info && info.ownerKey) game.ownerKey = info.ownerKey;
      else if (!info || info.legacy || !info.exists) {
        const k = await myOwnerKey(true);
        if (k) game.ownerKey = k.pub;
      } else {
        // A room from before room owners: its creator's browser can claim it.
        const k = await myOwnerKey(true);
        if (k && await within(SBRooms.saveRoom(myState.roomName, { isPublic: activeFilterState.isPublic, ownerKey: k.pub, banned: info.banned, controlled: false }), 3000, null)) game.ownerKey = k.pub;
      }
      if (info && !info.legacy) {
        game.banned = (info.banned || []).slice();
        game.bannedAt = { ...(info.bannedAt || {}) };
        pruneBans();
      }
      const mine = await myOwnerKey(false);
      me.owner = !!(game.ownerKey && mine && mine.pub === game.ownerKey);
      // Only a private room can be controlled (as on QB Reader).
      activeFilterState.controlled = !!game.ownerKey && activeFilterState.isPublic === false
        && (!!(info && info.controlled) || (!!filters.controlled && me.owner && !(info && info.exists)));
    } else {
      activeFilterState.controlled = false;
    }

    // As on QB Reader, a room keeps its players after they leave: anyone the
    // room list has seen here comes back as offline, with their score.
    ((info && info.players) || []).forEach((r) => {
      if (!r || !SBMpRules.cleanPid(r.pid) || game.banned.includes(r.pid)) return;
      // Negs and celerity come back too (they're 0 on a project whose
      // schema predates them).
      const stats = { score: r.score || 0, correct: r.correct || 0, incorrect: r.incorrect || 0, negs: r.negs || 0, celSum: r.cel_sum || 0, celN: r.cel_n || 0, heard: r.heard || 0 };
      if (r.pid === myState.pid) { Object.assign(me, stats); return; }
      const entry = { pid: r.pid, name: r.username, ...stats, leftAt: Date.parse(r.last_seen) || Date.now() };
      if (SBMpRules.stillOffline(entry, Date.now())) departedPlayers.set(r.pid, entry);
    });
    hostPlayers.set(mesh.id, me);
    enterRoomAs(roomId, name, lobby);
    showSettingsFromState();
    broadcastLobby();
    // The room's first line, as for everyone who comes in after.
    hostEvent(mesh.id, 'joined the game');
    fullRenderFromState();
  }

  // Joins the room behind `roomId` through its door. Needs no questions:
  // the room sends what's on screen.
  async function joinExisting(roomId, name, lobby) {
    const info = await mesh.join(roomId);
    if (!info.coordinator || !isUp(info.coordinator)) {
      throw new Error('Could not connect to the players in that room. Try again, or try a different network.');
    }
    followCoordinator(info.coordinator, typeof info.term === 'number' ? info.term : 0);
    enterRoomAs(roomId, name, lobby);
    await sendJoin(name);
    fullRenderFromState();
  }
  // Tells the room who this is (and, for its owner, proves it).
  async function sendJoin(name) {
    const owner = await ownerProof();
    const msg = { type: 'join', name, pid: myState.pid };
    if (owner) msg.owner = owner;
    mesh.broadcast(msg);
  }

  // The questions arrived after the room opened: the queue (for whoever
  // runs the game) and the sidebar's count catch up.
  function onBankLoaded() {
    if (myState.role === 'host' && hostGame.index < 0) hostGame.queueStale = true;
    if (midGameSettingsWired) updateMidGameMatchCount();
  }

  /* ================= ENTERING A ROOM ================= */
  // Every room's door is a fixed PeerJS ID: sbowl-room-<name> for a named
  // room, sbowl-pub-<key> for a built-in one (SBMpRules). Entering first
  // tries to claim the door and open the room; if someone already holds it,
  // this browser joins them instead. A failed join usually means the holder
  // just left (or the broker hasn't noticed yet), so it goes round again
  // after a short, random wait.
  //
  // Everything that can happen at once does: this player's own connection,
  // the claim on the door, the room's record from the room list and the
  // question bank all start together, and joining someone else's room
  // waits for none of the last two.
  const ROOM_ATTEMPTS = 4;
  let lobbyList = [];
  let joining = false;

  function lobbyLabel(lobby) {
    return lobby.key === 'all' ? 'General' : labelFor(lobby.key);
  }
  function lobbyFilters(lobby) {
    return { ...defaultFilters(true), subjects: new Set(lobby.subjects) };
  }
  function setJoinStatus(text, isError) {
    const el = document.getElementById('joinStatus');
    el.textContent = text;
    el.classList.toggle('status-error', !!isError);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // While connecting, the room is already on screen, saying so.
  function showConnecting(text) {
    enterGameScreen();
    document.getElementById('mpUsername').value = myName();
    const q = document.getElementById('mpQDisplay');
    q.classList.add('mp-waiting-text');
    q.textContent = text;
    ['mpNextBtn', 'mpBuzzBtn', 'mpPauseBtn'].forEach((id) => { document.getElementById(id).disabled = true; });
  }
  // Couldn't get in: back to the lobby, with the reason.
  function backToLobby(text) {
    myState.publicLobby = null;
    myState.roomName = '';
    document.documentElement.classList.remove('mp-direct');
    document.getElementById('mpGameScreen').style.display = 'none';
    document.getElementById('mpButtonBar').style.display = 'none';
    document.getElementById('lobbyScreen').style.display = '';
    document.getElementById('mpQDisplay').textContent = '';
    document.title = 'SBReader - Multiplayer';
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* e.g. file:// */ }
    setJoinStatus(text, true);
    if (!lobbyRendered) { lobbyRendered = true; renderRoomLists(); }
  }

  async function enterRoomByDoor({ peerId, label, lobby, filters, key }) {
    if (joining || myState.role) return;
    joining = true;
    setJoinStatus('');
    showConnecting(`Connecting to ${label}…`);
    document.title = `SBReader - Multiplayer - ${label}`;
    const infoP = within(SBRooms.roomInfo(key), 4000, null);
    const name = myName();
    let lastErr = null;
    openMesh().catch(() => {});
    for (let attempt = 0; attempt < ROOM_ATTEMPTS; attempt++) {
      if (attempt) showConnecting(`Still connecting to ${label}…`);
      const [door, self] = await Promise.allSettled([mesh.claimDoor(peerId), mesh.ready]);
      if (self.status === 'rejected') {
        // The connection service couldn't be reached: start afresh next time.
        try { mesh.leave(); } catch (e) { /* never opened */ }
        mesh = null;
        lastErr = self.reason;
        break;
      }
      if (door.status === 'fulfilled') {
        // Nobody's here: this player opens the room.
        const info = await infoP;
        if (info && info.banned && info.banned.includes(myState.pid)) {
          mesh.releaseDoor();
          joining = false;
          backToLobby('You were banned from that room by its owner.');
          return;
        }
        try {
          await startRoom({ roomId: peerId, filters, name, rate: savedRate(), lobby, info });
          joining = false;
          return;
        } catch (err) {
          mesh.releaseDoor();
          lastErr = err;
          break;
        }
      }
      lastErr = door.reason;
      if (!lastErr || lastErr.type !== 'unavailable-id') break;
      try {
        await joinExisting(peerId, name, lobby);
        joining = false;
        return;
      } catch (err) {
        lastErr = err;
        if (!err || !(err.type === 'peer-unavailable' || err.isTimeout)) break;
      }
      await sleep(500 + Math.random() * 1000);
    }
    joining = false;
    backToLobby(`Couldn't open ${label}. ${SBPeer.friendlyPeerError(lastErr)}`);
  }
  function joinPublicLobby(lobby) {
    myState.publicLobby = lobby;
    return enterRoomByDoor({ peerId: lobby.peerId, label: lobbyLabel(lobby), lobby, filters: lobbyFilters(lobby), key: SBRooms.key('', lobby.key) });
  }
  // A named room: opened public unless the link says private=true, and
  // controlled when it says controlled=true (for a new room). As on QB
  // Reader, a controlled room is private too.
  function joinNamedRoom(name, isPrivate, isControlled) {
    myState.roomName = name;
    return enterRoomByDoor({ peerId: SBMpRules.roomPeerId(name), label: name, lobby: null, filters: { ...defaultFilters(!isPrivate && !isControlled), controlled: !!isControlled }, key: name });
  }

  function initPublicLobbies() {
    lobbyList = SBMpRules.publicLobbies(SBData.meta);
  }

  function handleClientMessage(msg) {
    if (msg.type === 'lobby') {
      game.players = msg.players;
      game.departed = Array.isArray(msg.departed) ? msg.departed : [];
      if (Array.isArray(msg.kicked)) game.kicked = msg.kicked;
      if ('ownerKey' in msg) game.ownerKey = typeof msg.ownerKey === 'string' ? msg.ownerKey : null;
      if (Array.isArray(msg.banned)) {
        game.banned = msg.banned.filter((x) => typeof x === 'string');
        const at = msg.bannedAt && typeof msg.bannedAt === 'object' ? msg.bannedAt : {};
        const now = Date.now();
        const mine = game.bannedAt || {};
        game.bannedAt = {};
        game.banned.forEach((pid) => { game.bannedAt[pid] = typeof at[pid] === 'number' ? at[pid] : (typeof mine[pid] === 'number' ? mine[pid] : now); });
      }
      if (Array.isArray(msg.muted)) game.muted = msg.muted.filter((x) => typeof x === 'string');
      const me = game.players.find((p) => p.id === myState.myId);
      if (me) myState.myName = me.name;
      renderPlayerList(document.getElementById('mpPlayerList'));
      refreshOwnerControls();
      return;
    }
    if (msg.type === 'sync') {
      // Joined mid-game: catch up instantly instead of sitting on a waiting screen.
      game.index = msg.index; game.total = msg.total; game.question = msg.question;
      game.phase = msg.phase; game.buzzedPlayerId = msg.buzzedPlayerId;
      game.lockedOut = new Set(msg.lockedOut || []);
      game.paused = msg.paused;
      game.log = msg.log || [];
      // (A player on an older copy sends no list: what the log shows.)
      game.asked = Array.isArray(msg.asked) ? msg.asked.slice() : game.log.map((e) => e.question && e.question.id).filter((x) => x != null);
      game.lastRevealData = msg.lastRevealData || null;
      game.lastGrade = msg.lastGrade || null;
      game.attempts = msg.attempts || [];
      game.overrideLocked = msg.overrideLocked || false;
      game.liveTypingText = ''; game.liveTypingFrom = null;
      myState.rate = SBMpRules.readingSpeed(msg.rate);
      if (msg.settings) { applySettingsStateLocal(msg.settings); showSettingsFromState(); }
      // Rebuild the history from the room's chat and question log together,
      // oldest first, so it reads in the order things happened.
      historyEl().innerHTML = '';
      carded.clear();
      chatMirror = [];
      const items = (msg.chat || []).map((c) => ({ t: c.ts || 0, chat: c }))
        .concat((game.log || []).slice(game.phase === 'reveal' ? 1 : 0).map((e) => ({ t: e.at || 0, entry: e })));
      items.sort((x, y) => x.t - y.t).forEach((it) => { if (it.chat) renderChatAppend(it.chat); else addHistoryCard(it.entry); });
      if (msg.scores) {
        msg.scores.forEach((s) => { const pl = game.players.find((p) => p.id === s.id); if (pl) pl.score = s.score; });
      }
      const midRead = game.question && (game.phase === 'reading' || game.phase === 'answering')
        && typeof msg.readUnits === 'number' && isFinite(msg.readUnits) && msg.readUnits >= 0;
      if (midRead) {
        // Read on from where the room is; whoever runs the game opens
        // buzzing when their reading finishes, as on a 'question'.
        startLocalReveal(game.question, false, () => hostStartBuzzWindow(), msg.readUnits);
        // Someone is answering mid-question: the reading waits for them.
        if (game.phase === 'answering' && revealCtl) revealCtl.pause();
      } else if (game.question) startLocalReveal(game.question, true);
      fullRenderFromState();
      return;
    }
    if (msg.type === 'question') {
      if (window.SBQuestionStats) SBQuestionStats.flush(); // the last question's play is final
      hideSettingsOnPhone();
      game.index = msg.index; game.total = msg.total; game.question = msg.question;
      if (msg.question && msg.question.id != null && !game.asked.includes(msg.question.id)) game.asked.push(msg.question.id);
      game.phase = 'reading'; game.buzzedPlayerId = null; game.lockedOut = new Set();
      game.liveTypingText = ''; game.liveTypingFrom = null;
      game.lastGrade = null; game.attempts = [];
      game.overrideLocked = false;
      myState.rate = SBMpRules.readingSpeed(msg.rate);
      fullRenderFromState();
      // Whoever runs the game opens buzzing when their reading finishes;
      // that can become this player at any moment.
      startLocalReveal(msg.question, false, () => hostStartBuzzWindow());
      return;
    }
    if (msg.type === 'phase') {
      game.phase = msg.phase;
      if (msg.lockedOut) game.lockedOut = new Set(msg.lockedOut);
      game.buzzedPlayerId = null;
      if (msg.phase === 'reading') {
        syncRevealToState();
      } else if (revealCtl && !revealCtl.isDone()) {
        // The reading window is over one way or another — make sure the full
        // text is showing, regardless of any local animation drift (this is
        // also what keeps a backgrounded/throttled tab from looking stuck).
        revealCtl.skipToEnd();
      }
      fullRenderFromState();
      return;
    }
    if (msg.type === 'buzzAccepted') {
      if (revealCtl && !revealCtl.isDone()) revealCtl.pause();
      applyBuzzLocal(msg.playerId, msg.celerity);
      return;
    }
    if (msg.type === 'typing') {
      game.liveTypingText = msg.text; game.liveTypingFrom = msg.playerId;
      renderBuzzStatus();
      return;
    }
    if (msg.type === 'chat') {
      renderChatAppend(msg.entry);
      return;
    }
    if (msg.type === 'kicked') {
      if (msg.playerId === myState.myId) leaveKicked(!!msg.banned);
      return;
    }
    if (msg.type === 'votekickRefused' || msg.type === 'notice') {
      if (typeof msg.text === 'string') logEvent('You', msg.text.slice(0, 120));
      return;
    }
    if (msg.type === 'graded') {
      applyGradeLocal(msg.playerId, msg.correct, msg.delta, msg.scores, msg.userText, msg.override, msg.overrideLocked, msg.close, msg.counts, typeof msg.by === 'string' ? msg.by : undefined);
      if (game.phase === 'reveal') { showReveal(); renderOverrideLink(); }
      return;
    }
    if (msg.type === 'reveal') {
      if (msg.logEntry) game.log.unshift(msg.logEntry);
      applyRevealLocal(msg);
      return;
    }
    if (msg.type === 'logUpdate') {
      game.log = msg.log;
      renderQuestionLog();
      return;
    }
    if (msg.type === 'tick') {
      onClientTick(msg.remainingMs, msg.totalMs, msg.kind);
      return;
    }
    if (msg.type === 'pauseState') {
      game.paused = msg.paused;
      syncRevealToState();
      setClientTickPaused(game.paused);
      fullRenderFromState();
      return;
    }
    if (msg.type === 'endOfQuestions') {
      applyEndOfQuestionsLocal(msg.mode === 'set' ? 'set' : 'random');
      return;
    }
    if (msg.type === 'settingsState') {
      applySettingsStateLocal(msg);
      // An echo of an older change of ours: newer ones are on their way.
      if (msg.by === myState.myId && typeof msg.seq === 'number' && msg.seq < settingsSeq) return;
      // The settings in the sidebar show what the room is using now,
      // including a change someone else just made.
      showSettingsFromState();
      return;
    }
  }

  // Keeps this client's local mirror of the room's settings (activeFilterState
  // + myState.rate) in sync with whatever the host last broadcast - used for
  // both the 'settingsState' message and the 'settings' field folded into
  // 'sync'. The host is the only one who ever actually recomputes the
  // question queue from these values (see hostApplySettingsFromValues); this
  // is just every other client's read-only copy, kept fresh so their own
  // settings panel always seeds from the room's real current values instead
  // of stale or default ones.
  // A one-subject public room always uses its subject, whatever settings the
  // room carried over. General's subjects are the room's to pick.
  function fixedSubjectLobby() { return !!myState.publicLobby && myState.publicLobby.key !== 'all'; }
  function withLobbySubjects(f) {
    if (fixedSubjectLobby()) f.subjects = new Set(myState.publicLobby.subjects);
    return f;
  }

  function applySettingsStateLocal(s) {
    activeFilterState = withLobbySubjects(copyFilters(s));
    myState.rate = SBMpRules.readingSpeed(s.rate);
    // Live-apply to whatever's currently typing itself onto the screen, not
    // just the next question, so "change speed mid-question" actually works.
    if (revealCtl && !revealCtl.isDone()) revealCtl.setRate(myState.rate);
  }

  /* ================= SHARED ACTIONS ================= */
  function doBuzz() {
    if (game.paused) return;
    if (game.phase !== 'reading' && game.phase !== 'buzzwindow') return;
    if (game.lockedOut.has(myState.myId)) return;
    if (myState.role === 'host') hostHandleBuzz(myState.myId);
    else if (client) client.send({ type: 'buzz' });
  }
  function doSubmitAnswer(text) {
    if (game.phase !== 'answering' || game.buzzedPlayerId !== myState.myId) return;
    if (myState.role === 'host') hostHandleAnswer(myState.myId, text);
    else if (client) client.send({ type: 'submitAnswer', text });
  }
  function doNext() {
    if (game.phase !== 'reveal' && game.phase !== 'lobby') return;
    ensureSomeSubjects();
    if (myState.role === 'host') { if (game.phase === 'lobby') hostEvent(myState.myId, 'started the game'); hostNextQuestion(); }
    else if (client) client.send({ type: 'next' });
  }
  function doSkip() {
    if (game.phase !== 'reading' && game.phase !== 'buzzwindow') return;
    if (!canSkip()) return;
    if (myState.role === 'host') { if (isRealSkip()) hostEvent(myState.myId, 'skipped the question'); hostSkipQuestion(); }
    else if (client) client.send({ type: 'skip' });
  }
  function handleNextBtn() {
    const mode = document.getElementById('mpNextBtn').dataset.mode;
    if (mode === 'skip') doSkip();
    else doNext();
  }
  // On the keyboard, n starts the game or goes on to the next question and
  // never skips one that isn't over; s only skips. With the timer off, a
  // question read in full waits for the button (which says Next there), so
  // either key ends it.
  function nextKey() {
    if (game.phase === 'buzzwindow' && !isRealSkip()) doSkip();
    else doNext();
  }
  function doTogglePause() {
    if (game.phase === 'lobby' || game.phase === 'reveal') return;
    if (myState.role === 'host') { hostEvent(myState.myId, game.paused ? 'unpaused the game' : 'paused the game'); hostTogglePause(); }
    else if (client) client.send({ type: 'togglePause' });
  }
  function doOverride() {
    // Anyone who buzzed this question can override their own graded
    // answer, whenever it happened - the button/shortcut is only ever
    // shown when you have an attempt this question and nobody's overridden
    // to correct yet (see fullRenderFromState), and hostOverrideLastGrade()
    // enforces the same restrictions again on the host side for a message
    // sent straight over the wire.
    if (myState.role === 'host') hostOverrideLastGrade(myState.myId);
    else if (client) client.send({ type: 'override' });
  }

  let typingThrottled = false;
  let pendingTypingText = null;
  function sendTypingUpdate(text) {
    if (myState.role === 'host') {
      game.liveTypingText = text; game.liveTypingFrom = myState.myId;
      host.broadcast({ type: 'typing', playerId: myState.myId, text });
      renderBuzzStatus();
    } else if (client) {
      client.send({ type: 'typing', text });
    }
  }
  function doTypingInput(text) {
    if (game.phase !== 'answering' || game.buzzedPlayerId !== myState.myId) return;
    // Your own live line follows every keystroke.
    game.liveTypingText = text; game.liveTypingFrom = myState.myId;
    renderBuzzStatus();
    if (typingThrottled) {
      // Don't drop this keystroke, or what others see can lag behind what
      // was actually typed: bank the latest text and flush it the moment
      // the cooldown ends.
      pendingTypingText = text;
      return;
    }
    typingThrottled = true;
    sendTypingUpdate(text);
    setTimeout(() => {
      typingThrottled = false;
      if (pendingTypingText !== null) {
        const t = pendingTypingText;
        pendingTypingText = null;
        doTypingInput(t);
      }
    }, TYPING_THROTTLE_MS);
  }

  /* ================= ROOM SETTINGS (the sidebar; anyone in the room) ================= */
  // The sidebar shows the room's settings the whole time you're in a room
  // and anyone can change them. midGameFilterState is what the controls
  // show; a change is sent to whoever runs the game (requestApplySettings),
  // applied there (hostApplySettingsFromValues) and sent back to everyone.
  const midGameFilterState = copyFilters({ subjects: [] });
  let midGameRoundSliderApi = null;
  let midGameYearSliderApi = null;
  let categories = null;
  let midGameSettingsWired = false;
  // Set while the controls are repainted FROM the room's settings, so that
  // repaint (the round slider's setRange fires onChange) isn't sent back out
  // as a change, which would bounce between players forever.
  let suppressSettingsApplyEcho = false;

  // Copies a full set of settings into midGameFilterState in place (the
  // subject toggles hold on to its subjects Set).
  function loadMidGameState(from) {
    const f = copyFilters(from);
    Object.keys(f).forEach((k) => {
      if (k === 'subjects') { midGameFilterState.subjects.clear(); f.subjects.forEach((x) => midGameFilterState.subjects.add(x)); }
      else midGameFilterState[k] = f[k];
    });
  }

  function tournamentBySlug(slug) { return SBData.meta.tournaments.find((t) => t.slug === slug) || null; }

  function setMatchCountText(text) { document.getElementById('mpSettingsMatchCount').textContent = text; }
  // How many questions a set of settings matches: a plain filter (no
  // shuffling), and the last answer is kept, since one change asks several
  // times (this player's click, the room's echo, the repaint).
  const countCache = { key: null, n: 0 };
  function countFor(v) {
    const key = JSON.stringify([v.mode, v.setName, v.packetNumbers, [...v.subjects].sort(), [...(v.tournaments || [])].sort(), v.roundRange, v.yearRange, v.includeUnlabeled !== false]);
    if (countCache.key === key) return countCache.n;
    const n = SBData.filterQuestions({
      subjects: v.subjects, roundRange: v.roundRange, yearRange: v.yearRange, includeUnlabeled: v.includeUnlabeled !== false, tournaments: v.tournaments,
    }).length;
    countCache.key = key;
    countCache.n = n;
    return n;
  }
  function updateMidGameMatchCount() {
    const moved = midGameRoundSliderApi && midGameRoundSliderApi.setMax(SBData.maxRoundFor(midGameFilterState.tournaments));
    if (moved) midGameFilterState.roundRange = moved;
    // Until the question bank is here, there's nothing to count yet.
    if (!bankLoaded()) { setMatchCountText('Loading questions…'); return; }
    const n = countFor(midGameFilterState);
    setMatchCountText(`${n.toLocaleString()} question${n === 1 ? '' : 's'} match the room's settings`);
  }
  function onSettingChange() {
    updateMidGameMatchCount();
    requestApplySettings();
  }

  // "Henry changed the rounds to 6-20", once the round slider is let go (the
  // range itself goes out quietly while it's dragged).
  function announceRounds() {
    if (myState.role === 'host') hostAnnounceRounds(myState.myId);
    else if (client) client.send({ type: 'announceRounds' });
  }
  function hostAnnounceRounds(connId) {
    if (myState.role !== 'host' || !activeFilterState) return;
    const max = SBData.maxRoundFor(activeFilterState.tournaments);
    const r = activeFilterState.roundRange || [1, max];
    hostEvent(connId, `changed the rounds to ${Math.max(1, r[0])}-${Math.min(r[1], max)}`);
  }

  // "Henry changed the years to 2015-2026", the same way, from the year slider.
  function announceYears() {
    if (myState.role === 'host') hostAnnounceYears(myState.myId);
    else if (client) client.send({ type: 'announceYears' });
  }
  function hostAnnounceYears(connId) {
    if (myState.role !== 'host' || !activeFilterState) return;
    const [first, last] = SBData.yearSpan();
    const r = activeFilterState.yearRange || [first, last];
    hostEvent(connId, r[0] === r[1] ? `changed the years to ${r[0]}` : `changed the years to ${r[0]}-${r[1]}`);
  }

  // Clear all filters: every tournament, year, round and subject (General: back to
  // its default; a one-subject room keeps its subject), questions with no
  // round number included, and all of a set's packets; sent as one change.
  function clearRoomFilters() {
    const f = midGameFilterState;
    suppressSettingsApplyEcho = true;
    try {
      f.tournaments = new Set();
      document.getElementById('mpSettingsTournamentSelect').setMultiValues([]);
      if (!fixedSubjectLobby()) {
        f.subjects.clear();
        (myState.publicLobby ? myState.publicLobby.subjects : SBData.meta.subjects.map((x) => x.key)).forEach((k) => f.subjects.add(k));
        if (categories) categories.sync();
      }
      f.includeUnlabeled = true;
      document.getElementById('mpToggleUnlabeled').checked = true;
      f.packetNumbers = '';
      if (midGameRoundSliderApi) { midGameRoundSliderApi.setMax(SBData.maxRoundFor(f.tournaments)); midGameRoundSliderApi.reset(); }
      f.roundRange = null;
      if (midGameYearSliderApi) midGameYearSliderApi.reset();
      f.yearRange = null;
    } finally {
      suppressSettingsApplyEcho = false;
    }
    onSettingChange();
  }


  function initMidGameSettings() {
    if (midGameSettingsWired) return;
    midGameSettingsWired = true;
    // Wiring the controls fires their change handlers (the round slider
    // reports its starting range); none of that is anyone's edit.
    suppressSettingsApplyEcho = true;
    try { wireMidGameSettings(); } finally { suppressSettingsApplyEcho = false; }
  }
  function wireMidGameSettings() {

    categories = SBPlay.subjectButtons(document.getElementById('mpSubjectButtons'), SBData.meta.subjects, midGameFilterState.subjects, () => { if (!suppressSettingsApplyEcho) onSettingChange(); });

    const tSelect = document.getElementById('mpSettingsTournamentSelect');
    SBData.meta.tournaments.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.slug; opt.textContent = `${t.name} (${t.count})`;
      tSelect.appendChild(opt);
    });
    tSelect.addEventListener('change', () => { midGameFilterState.tournaments = new Set(tSelect.getMultiValues()); onSettingChange(); });
    SBData.enhanceMultiSelect(tSelect);
    const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
    midGameRoundSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('mpSettingsRoundMin'),
      maxInput: document.getElementById('mpSettingsRoundMax'),
      fillEl: document.getElementById('mpSettingsRoundSliderFill'),
      labelEl: document.getElementById('mpSettingsRoundRangeLabel'),
      maxRound,
      onChange: (lo, hi) => { midGameFilterState.roundRange = [lo, hi]; onSettingChange(); },
      // The room hears about it once, when the handle is let go.
      onCommit: () => { if (!suppressSettingsApplyEcho) announceRounds(); },
    });
    // Year range, as on QB Reader: the tournaments' years.
    const [firstYear, lastYear] = SBData.yearSpan();
    midGameYearSliderApi = SBData.wireRoundRangeSlider({
      minInput: document.getElementById('mpSettingsYearMin'),
      maxInput: document.getElementById('mpSettingsYearMax'),
      fillEl: document.getElementById('mpSettingsYearSliderFill'),
      labelEl: document.getElementById('mpSettingsYearRangeLabel'),
      min: firstYear,
      maxRound: lastYear,
      label: SBPlay.yearLabel,
      onChange: (lo, hi) => { midGameFilterState.yearRange = lo === firstYear && hi === lastYear ? null : [lo, hi]; onSettingChange(); },
      onCommit: () => { if (!suppressSettingsApplyEcho) announceYears(); },
    });

    document.getElementById('mpClearFilters').addEventListener('click', (e) => { e.currentTarget.blur(); clearRoomFilters(); });
    document.getElementById('mpClearStats').addEventListener('click', (e) => { e.preventDefault(); e.currentTarget.blur(); doClearStats(); });

    // Room switches (shared).
    [['mpTogglePublic', 'isPublic'], ['mpToggleControlled', 'controlled'], ['mpToggleRebuzz', 'rebuzz'], ['mpToggleSkip', 'skip'], ['mpToggleTimer', 'timer'], ['mpToggleUnlabeled', 'includeUnlabeled']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => { midGameFilterState[key] = el.checked; el.blur(); onSettingChange(); });
    });
    const offline = document.getElementById('toggleOfflinePlayers');
    offline.checked = showOffline;
    offline.addEventListener('change', () => {
      showOffline = offline.checked;
      offline.blur();
      try { localStorage.setItem(OFFLINE_KEY, showOffline ? '1' : '0'); } catch (e) { /* not saved */ }
      renderPlayerList(document.getElementById('mpPlayerList'));
    });

    const rateSlider = document.getElementById('mpSettingsRateSlider');
    rateSlider.addEventListener('input', () => {
      document.getElementById('mpSettingsRateValue').textContent = String(SBMpRules.readingSpeed(rateSlider.value));
    });
    rateSlider.addEventListener('change', () => { rateSlider.blur(); requestApplySettings(); });
  }

  // Paints the sidebar from the room's current settings: on entering, and
  // whenever they change (activeFilterState is every player's live copy).
  function showSettingsFromState() {
    if (!activeFilterState) return;
    loadMidGameState(activeFilterState);
    initMidGameSettings();
    refreshSettingsPanelFromState();
  }

  function refreshSettingsPanelFromState() {
    const f = midGameFilterState;
    const rateSlider = document.getElementById('mpSettingsRateSlider');
    rateSlider.value = myState.rate;
    document.getElementById('mpSettingsRateValue').textContent = String(myState.rate);
    suppressSettingsApplyEcho = true;
    try {
      document.getElementById('mpSettingsTournamentSelect').setMultiValues(Array.from(f.tournaments));
      if (midGameRoundSliderApi && f.roundRange) midGameRoundSliderApi.setRange(f.roundRange[0], f.roundRange[1]);
      if (midGameYearSliderApi) { const ys = SBData.yearSpan(); const yr = f.yearRange || ys; midGameYearSliderApi.setRange(yr[0], yr[1]); }
      document.getElementById('mpTogglePublic').checked = f.isPublic;
      document.getElementById('mpToggleRebuzz').checked = f.rebuzz;
      document.getElementById('mpToggleSkip').checked = f.skip !== false;
      document.getElementById('mpToggleTimer').checked = f.timer;
      // A built-in public room keeps its subject and stays public.
      const lobby = myState.publicLobby;
      document.getElementById('mpTogglePublic').disabled = !!lobby;
      // A one-subject room shows its subject switched on, and can't change it.
      categories.setDisabled(fixedSubjectLobby());
      document.getElementById('mpToggleUnlabeled').checked = f.includeUnlabeled !== false;
      categories.sync();
    } finally {
      suppressSettingsApplyEcho = false;
    }
    updateMidGameMatchCount();
    refreshOwnerControls();
    fullRenderFromState();
  }

  // Every subject switched off would match nothing, so before the next
  // question the room goes back to all subjects, sent out like any change.
  function ensureSomeSubjects() {
    if (midGameFilterState.subjects.size === 0) {
      (myState.publicLobby ? myState.publicLobby.subjects : SBData.meta.subjects.map((x) => x.key)).forEach((k) => midGameFilterState.subjects.add(k));
      if (categories) categories.sync();
      updateMidGameMatchCount();
      requestApplySettings();
    }
  }

  // What changed, as the room hears it ("Bob made the room private").
  function describeChanges(before, after, rateBefore, rateAfter) {
    const out = [];
    const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    if (before.packetNumbers !== after.packetNumbers) out.push(after.packetNumbers ? `changed the packet numbers to ${after.packetNumbers}` : 'cleared the packet numbers');
    if (!sameSet(before.subjects, after.subjects)) {
      const names = SBData.meta.subjects.filter((x) => after.subjects.has(x.key)).map((x) => x.label);
      out.push(names.length === SBData.meta.subjects.length ? 'turned on every subject' : `changed the subjects to ${names.join(', ') || 'none'}`);
    }
    if (!sameSet(before.tournaments, after.tournaments)) out.push(after.tournaments.size ? 'changed the tournaments' : 'cleared the tournaments');
    if (before.rebuzz !== after.rebuzz) out.push(`${after.rebuzz ? 'enabled' : 'disabled'} multiple buzzes`);
    if (before.skip !== after.skip) out.push(`${after.skip ? 'enabled' : 'disabled'} skipping`);
    if (before.controlled !== after.controlled) out.push(after.controlled ? 'made the room controlled (only the owner can change the settings)' : 'made the room uncontrolled');
    if (before.timer !== after.timer) out.push(`${after.timer ? 'enabled' : 'disabled'} the timer`);
    if (before.isPublic !== after.isPublic) out.push(`made the room ${after.isPublic ? 'public' : 'private'}`);
    if (rateBefore !== rateAfter) out.push(`changed the reading speed to ${rateAfter}`);
    return out;
  }

  // Applies a full set of room settings, wherever they came from: this
  // player's own sidebar, or another player's 'updateSettings'. The queue's
  // not-yet-asked part is rebuilt (unless nothing would match).
  function hostApplySettingsFromValues(values, byConnId) {
    // A built-in public room keeps its subject and stays public.
    if (myState.publicLobby) values = { ...values, isPublic: true };
    if (fixedSubjectLobby()) values = { ...values, subjects: new Set(myState.publicLobby.subjects) };
    const before = activeFilterState ? copyFilters(activeFilterState) : copyFilters(defaultFilters(true));
    // A controlled room's settings are its owner's to change, and so is the
    // switch itself; a room without an owner can't be controlled. As on QB
    // Reader, only a private room can be (or have) an owner's: a public room
    // is never controlled, and a controlled one stays private until it's made
    // uncontrolled.
    const sender = hostPlayers.get(byConnId || myState.myId);
    const byOwner = !!(sender && sender.owner);
    const wasControlled = before.controlled && before.isPublic === false;
    if (wasControlled && !byOwner) {
      const text = 'can\'t change the settings: only the room owner can in a controlled room';
      if ((byConnId || myState.myId) === myState.myId) logEvent('You', text);
      else host.sendTo(byConnId, { type: 'notice', text });
      // Everyone's sidebar shows the room's settings again.
      broadcastSettingsState(null, 0);
      showSettingsFromState();
      return;
    }
    if (wasControlled && values.controlled) values = { ...values, isPublic: false };
    const mayControl = byOwner && !!game.ownerKey && before.isPublic === false && values.isPublic === false;
    values = { ...values, controlled: mayControl && !!values.controlled };
    const rateBefore = myState.rate;
    myState.rate = SBMpRules.readingSpeed(values.rate);
    if (revealCtl && !revealCtl.isDone()) revealCtl.setRate(myState.rate);

    const next = copyFilters(values);
    if (!bankLoaded()) {
      // The questions aren't here yet: take the settings as they are, and
      // the queue is made from them once they arrive (onBankLoaded).
      activeFilterState = next;
    } else if (countFor(next) > 0) {
      // The questions still to come are made from these settings when the
      // next question is due (rebuildQueue), not on every click: shuffling
      // the whole bank each time made the sidebar lag.
      activeFilterState = next;
      hostGame.queueStale = true;
    } else {
      // Nothing matches yet (someone is still choosing, say a set name not
      // typed yet): the room takes the settings as they are, subjects
      // included, but the questions still to come stay as they were until a
      // change matches some. (Keeping the old filters here undid every
      // subject click while the set name was blank.)
      activeFilterState = next;
    }
    describeChanges(before, activeFilterState, rateBefore, myState.rate).forEach((text) => hostEvent(byConnId || myState.myId, text));
    // The timer switched during the buzz window: on, the countdown starts
    // (a full one: the question has been read); off, it stops, and the
    // question waits for Next.
    if (before.timer !== activeFilterState.timer && hostGame.phase === 'buzzwindow' && hostGame.currentFull) {
      if (activeFilterState.timer) {
        if (!hostGame.timer) {
          const full = hostGame.currentFull.qtype === 'bonus' ? BONUS_BUZZ_MS : TOSSUP_BUZZ_MS;
          hostRunTimer(full, 'buzz', () => hostReveal());
        }
      } else if (hostGame.timer) {
        clearHostTimer();
        host.broadcast({ type: 'tick', remainingMs: 0, totalMs: hostGame.totalMs, kind: 'buzz' });
        applyTickLocal(0, hostGame.totalMs, 'buzz');
      }
    }
    broadcastSettingsState(byConnId, values.seq);
    showSettingsFromState();
    beatSoon();
  }

  // The not-yet-asked part of the queue, from the room's current settings
  // (after they've changed; see hostApplySettingsFromValues).
  function rebuildQueue() {
    hostGame.queueStale = false;
    if (!bankLoaded() || !activeFilterState) return;
    const done = hostGame.queue.slice(0, hostGame.index + 1);
    const asked = new Set([...game.asked, ...done.map((q) => q.id)]);
    hostGame.queue = done.concat(queueFor(activeFilterState).filter((q) => !asked.has(q.id)));
    game.total = hostGame.queue.length;
  }

  // Sends the sidebar's settings to whoever runs the game (or applies them,
  // if that's this player).
  // Each change this player sends is numbered. The room echoes every change
  // back; an echo of an older change of ours (we've clicked again since) must
  // not repaint the sidebar, or a quick second click would seem undone and
  // the next click would act on the wrong state.
  let settingsSeq = 0;
  function requestApplySettings() {
    if (suppressSettingsApplyEcho) return;
    const f = midGameFilterState;
    const values = { ...copyFilters(f), rate: SBMpRules.readingSpeed(document.getElementById('mpSettingsRateSlider').value) };
    if (myState.role === 'host') {
      hostApplySettingsFromValues(values, myState.myId);
    } else if (client) {
      settingsSeq++;
      client.send({
        type: 'updateSettings', seq: settingsSeq,
        mode: values.mode, setName: values.setName, packetNumbers: values.packetNumbers,
        rebuzz: values.rebuzz, skip: values.skip, controlled: values.controlled, timer: values.timer, isPublic: values.isPublic,
        subjects: [...values.subjects], qtypes: [], formats: [], levels: [], visuals: [],
        tournaments: [...values.tournaments], roundRange: values.roundRange, yearRange: values.yearRange, includeUnlabeled: values.includeUnlabeled,
        rate: values.rate,
      });
    }
  }

  /* ================= SIDEBAR AND CHAT BOX ================= */
  // As in Play: the sidebar is open beside the question on wide screens and
  // folded to the timer above it on narrow ones; the gear (or e) toggles it.
  const WIDE = window.matchMedia('(min-width: 992px)');
  function toggleSidebar() {
    const el = document.getElementById('settings');
    if (WIDE.matches) {
      // As on QB Reader, the question and the button bar widen into the
      // space the sidebar leaves.
      el.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', el.classList.contains('collapsed'));
    } else el.classList.toggle('show');
  }
  // On a phone, as on QB Reader, a new question closes the settings.
  function hideSettingsOnPhone() {
    if (!window.matchMedia('(min-width: 992px)').matches) document.getElementById('settings').classList.remove('show');
  }
  function showChatRow() {
    const row = document.getElementById('mpChatRow');
    row.classList.remove('d-none');
    document.getElementById('mpChatInput').focus();
    startLiveChat();
  }
  function hideChatRow() {
    endLiveChat(true);
    document.getElementById('mpChatRow').classList.add('d-none');
    document.getElementById('mpChatInput').value = '';
    document.getElementById('mpChatInput').blur();
  }

  function doClearStats() {
    if (myState.role === 'host') hostClearStats(myState.myId);
    else if (client) client.send({ type: 'clearStats' });
  }

  /* ================= YOUR NAME ================= */
  // The username box in the sidebar, as on QB Reader: changing it renames
  // you for everyone ("Bob changed their username to Rob").
  function submitRename(raw) {
    const name = (raw || '').trim().slice(0, SBMpRules.LIMITS.name);
    if (!name) { document.getElementById('mpUsername').value = myState.myName; return; }
    saveName(name);
    if (myState.role === 'host') hostRenamePlayer(myState.myId, name);
    else if (client) client.send({ type: 'rename', name });
    setTimeout(beat, 500);
  }

  // multiplayer.html?room=NAME (&private=true for a new private room) and
  // multiplayer.html?lobby=KEY open that room straight away. With neither,
  // this is the lobby page.
  function joinFromLink() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return false; }
    if (params.get('kicked') === '1' || params.get('banned') === '1') {
      setJoinStatus(params.get('banned') === '1' ? 'You were banned from that room by its owner.' : 'You were vote kicked from that room.', true);
      history.replaceState(null, '', location.pathname);
    }
    const lobbyKey = params.get('lobby');
    if (lobbyKey) {
      const lobby = SBMpRules.findPublicLobby(SBData.meta, lobbyKey);
      if (!lobby) { document.documentElement.classList.remove('mp-direct'); setJoinStatus('That room doesn’t exist. Pick one below.', true); return false; }
      joinPublicLobby(lobbyList.find((l) => l.key === lobby.key) || lobby);
      return true;
    }
    const name = SBMpRules.cleanRoomName(params.get('room') || '');
    if (!name) { document.documentElement.classList.remove('mp-direct'); return false; }
    joinNamedRoom(name, params.get('private') === 'true', params.get('controlled') === 'true');
    return true;
  }

  function wireGameControls() {
    document.getElementById('mpUsername').addEventListener('change', (e) => submitRename(e.target.value));
    document.getElementById('mpUsername').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    document.getElementById('mpBuzzBtn').addEventListener('click', function () { this.blur(); doBuzz(); });
    document.getElementById('mpNextBtn').addEventListener('click', function () { this.blur(); handleNextBtn(); });
    document.getElementById('mpOverrideBtn').addEventListener('click', (e) => { e.preventDefault(); doOverride(); });
    document.getElementById('mpPauseBtn').addEventListener('click', function () { this.blur(); doTogglePause(); });
    document.getElementById('mpSettingsBtn').addEventListener('click', function () { this.blur(); toggleSidebar(); });
    document.getElementById('mpSettingsBtn').innerHTML = SBIcons.gear;
    document.getElementById('mpChatBtn').addEventListener('click', function () {
      this.blur();
      if (document.getElementById('mpChatRow').classList.contains('d-none')) showChatRow(); else hideChatRow();
    });
    document.getElementById('mpRoomCodeDisplay').addEventListener('click', copyRoomCode);
    document.getElementById('mpRoomCodeDisplay').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyRoomCode(); }
    });
    document.getElementById('mpSubmitBtn').addEventListener('click', () => doSubmitAnswer(document.getElementById('mpAnswerInput').value));
    document.getElementById('mpAnswerInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmitAnswer(document.getElementById('mpAnswerInput').value); }
    });
    document.getElementById('mpAnswerInput').addEventListener('input', (e) => doTypingInput(e.target.value));
    document.querySelectorAll('#mpChoicesDisplay .choice-box').forEach((el) => {
      el.addEventListener('click', () => {
        if (!el.classList.contains('clickable')) return;
        doSubmitAnswer(el.dataset.letter);
      });
    });
    const sendFromBox = () => {
      const input = document.getElementById('mpChatInput');
      sendChat(input.value);
      hideChatRow();
    };
    document.getElementById('mpChatSendBtn').addEventListener('click', sendFromBox);
    document.getElementById('mpChatInput').addEventListener('input', (e) => onChatTyping(e.target.value));
    document.getElementById('mpChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendFromBox(); }
      if (e.key === 'Escape') { e.preventDefault(); hideChatRow(); }
    });
    // The keys: space buzz, n next, s skip, p pause, e settings, enter
    // chat, k show/hide the last question, t star/unstar it; q override.
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('mpGameScreen').style.display === 'none') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (window.SBSite && SBSite.modalOpen()) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch ((e.key || '').toLowerCase()) {
        case ' ':
          // Nothing focused (a history card, its star) acts on this Space too.
          e.preventDefault();
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
          doBuzz();
          return;
        case 'n': nextKey(); return;
        case 's': doSkip(); return;
        case 'p': doTogglePause(); return;
        case 'e': toggleSidebar(); return;
        case 'k': SBPlay.toggleLatest(historyEl()); return;
        case 't': SBPlay.starLatest(historyEl()); return;
        case 'q': doOverride(); return;
        case 'enter': case '/': e.preventDefault(); showChatRow(); return;
        default:
      }
    });
    // Safety net for the tab-throttling desync bug: when the tab regains
    // focus, force the reveal to catch up to whatever phase we're actually in.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // (Not while someone answers: the reading waits there, mid-question.)
      if (game.phase !== 'reading' && game.phase !== 'answering' && game.phase !== 'lobby' && revealCtl && !revealCtl.isDone()) {
        revealCtl.skipToEnd();
      }
      fullRenderFromState();
    });
  }

  // Leaving on purpose (closing the tab, navigating away): say goodbye, so
  // everyone takes this player off at once instead of waiting to notice,
  // and free the room's door if this player held it.
  window.addEventListener('pagehide', () => {
    try { if (mesh) mesh.leave(); } catch (e) { /* the page is going anyway */ }
  });

  // The lobby needs only meta.json, so it shows at once; the question bank
  // (SBData.load, started from <head>) keeps downloading and is waited for
  // only on entering a room.
  let lobbyRendered = false;
  SBData.loadMeta().then(() => {
    myState.pid = myPid();
    initPublicLobbies();
    initLobby();
    wireGameControls();
    if (!joinFromLink()) {
      lobbyRendered = true;
      renderRoomLists();
      // Get ready to play while the lobby is read: the TURN logins and this
      // player's connection, so picking a room only has the room to reach.
      const soon = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
      soon(() => { if (!myState.role) openMesh().catch(() => {}); });
    }
  }).catch((err) => {
    document.documentElement.classList.remove('mp-direct');
    const msg = document.createElement('p');
    msg.textContent = 'Failed to load question data: ' + err.message;
    document.getElementById('lobbyScreen').replaceChildren(msg);
  });
})();
