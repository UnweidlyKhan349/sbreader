// Accounts, through Supabase (see js/config.js and supabase/schema.sql).
//
// window.SBAccount works on every page whether accounts are set up or not:
// with no project configured, `enabled` is false, nothing is loaded, and
// every call quietly does nothing. With one, the Supabase library is loaded
// on demand, the navbar shows "Log in" or your name, and a logged-in
// account keeps:
//   - bookmarks: every star mirrored to the account; at login this
//     device's and the account's are merged (nothing is lost on either side)
//   - answers: each question answered in Play or Multiplayer, with its
//     points and celerity, for the stats and graphs pages
//   - settings: theme, reading speed, multiplayer name and "hide answers";
//     at login the newer copy wins, and changes are pushed as they happen
(function () {
  const cfg = window.SB_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const core = window.SBAccountCore;
  const SETTINGS_STAMP = 'sb_settings_updated';

  let client = null;
  let user = null;
  let syncedFor = null;
  let lastAttempt = null; // the most recent recordAnswer() handle
  const listeners = [];

  const here = document.currentScript ? document.currentScript.src : '';
  // supabase-js from the jsDelivr CDN, at a fixed version, checked against
  // its hash (Subresource Integrity) so a changed file is refused.
  const LIB = {
    url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js',
    integrity: 'sha384-CLZeq1dk8+Uzrs7TVvBUdlFoV5F0DMqgRoeHa8g5wJcuPe5SkVfEvdxB0ZuzlnBQ',
  };
  // The account pages sit beside this page, wherever the site is hosted.
  // Links leave off ".html" (GitHub Pages serves /account as account.html);
  // the confirmation and reset emails still name account.html, the address
  // in the Supabase project's redirect allowlist.
  // Resolved from this script's own address (js/account.js, one level
  // below the site root), so the generated /sets/<slug>/<n> pages link to
  // /account, not /sets/<slug>/account.
  function pageUrl(name) { return new URL('../' + name, here || document.baseURI).href; }

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB.url;
      s.integrity = LIB.integrity;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the account library.'));
      document.head.appendChild(s);
    });
  }

  function emit() {
    listeners.forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });
  }

  function displayName(u) {
    u = u || user;
    if (!u) return '';
    return (u.user_metadata && u.user_metadata.username) || (u.email || '').split('@')[0] || 'Account';
  }

  function setUser(u) {
    user = u || null;
    if (user && syncedFor !== user.id) {
      syncedFor = user.id;
      syncOnLogin().catch((e) => console.warn('Account sync failed:', e));
    }
    if (!user) syncedFor = null;
    renderNav();
    emit();
  }

  const ready = !enabled ? Promise.resolve(null) : loadLib().then(async () => {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data } = await client.auth.getSession();
    setUser(data && data.session ? data.session.user : null);
    client.auth.onAuthStateChange((event, session) => {
      // Let the library finish its own work before calling back into it.
      setTimeout(() => setUser(session ? session.user : null), 0);
    });
    return client;
  }).catch((e) => {
    console.warn(e);
    return null;
  });

  /* ---------------- Navbar ---------------- */
  // A "Log in" link, or your name with the account pages and Log out, in
  // the navbar's #navAccount slot.
  function renderNav() {
    const slot = document.getElementById('navAccount');
    if (!slot || !enabled) return;
    slot.hidden = false;
    if (!user) {
      slot.className = 'nav-item';
      slot.innerHTML = `<a class="nav-link" href="${pageUrl('login')}" id="login-link">Log in</a>`;
      return;
    }
    slot.className = 'nav-item dropdown';
    slot.innerHTML = '<a class="nav-link dropdown-toggle" href="#" role="button" data-sb-dropdown></a>'
      + '<div class="dropdown-menu dropdown-menu-end" data-bs-popper="static">'
      + `<a class="dropdown-item" href="${pageUrl('account')}">Account</a>`
      + `<a class="dropdown-item" href="${pageUrl('stats')}">Stats</a>`
      + `<a class="dropdown-item" href="${pageUrl('graphs')}">Graphs</a>`
      + `<a class="dropdown-item" href="${pageUrl('stars')}">Starred Questions</a>`
      + '<hr class="dropdown-divider">'
      + '<button class="dropdown-item" type="button" data-sb-logout>Log out</button></div>';
    slot.querySelector('[data-sb-dropdown]').textContent = displayName();
    slot.querySelector('[data-sb-logout]').addEventListener('click', () => signOut());
    if (window.SBSite) window.SBSite.wireDropdown(slot.querySelector('[data-sb-dropdown]'));
  }

  /* ---------------- Sync ---------------- */
  function readLocalSettings() {
    const out = {};
    core.SETTINGS_KEYS.forEach((k) => {
      try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch (e) { /* unreadable */ }
    });
    return out;
  }
  function writeLocalSettings(data) {
    core.SETTINGS_KEYS.forEach((k) => {
      if (data[k] == null) return;
      try { localStorage.setItem(k, data[k]); } catch (e) { /* not saved */ }
    });
    if (data.sb_theme && window.SBSite) window.SBSite.setTheme(data.sb_theme);
  }
  function localStamp() {
    try { return localStorage.getItem(SETTINGS_STAMP); } catch (e) { return null; }
  }
  function setLocalStamp(iso) {
    try { localStorage.setItem(SETTINGS_STAMP, iso); } catch (e) { /* not saved */ }
  }

  // The bookmarks this device and the account agreed on at the last sync,
  // per account (see mergeBookmarks).
  function baseKey() { return user ? 'sb_bookmarks_synced_' + user.id : null; }
  function readBase() {
    try { const v = baseKey() && localStorage.getItem(baseKey()); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function writeBase(ids) {
    try { if (baseKey()) localStorage.setItem(baseKey(), JSON.stringify([...ids])); } catch (e) { /* not saved */ }
  }
  function updateBase(id, on) {
    const base = readBase();
    if (!base) return;
    const set = new Set(base);
    if (on) set.add(id); else set.delete(id);
    writeBase(set);
  }

  // Every bookmark in the account, or null if any page failed. The server
  // hands back at most a set number of rows per request (1,000 by default),
  // and a cut-off list would read as bookmarks deleted elsewhere, so the
  // rows are read in pages, in question order, until a page comes back
  // empty (a page shorter than asked for isn't the end: the server's own
  // limit may be lower).
  const BOOKMARK_PAGE = 1000;
  async function fetchAllBookmarks() {
    const ids = [];
    let after = null;
    for (let page = 0; page < 1000; page++) {
      let q = client.from('bookmarks').select('question_id').order('question_id', { ascending: true }).limit(BOOKMARK_PAGE);
      if (after !== null) q = q.gt('question_id', after);
      const { data, error } = await q;
      if (error || !Array.isArray(data)) return null;
      if (!data.length) return ids;
      data.forEach((r) => ids.push(r.question_id));
      after = data[data.length - 1].question_id;
    }
    return null;
  }

  async function syncOnLogin() {
    if (!client || !user) return;
    // Bookmarks: merged against what both sides held at this device's last
    // sync, so a removal on either side sticks (see mergeBookmarks). Only a
    // complete list is merged; without one, nothing is changed this time.
    if (window.SBData && window.SBData.bookmarks) {
      const remote = await fetchAllBookmarks();
      if (remote) {
        const local = [...window.SBData.bookmarks.getAll()];
        const merged = core.mergeBookmarks(local, remote, readBase());
        let ok = true;
        if (merged.toUpload.length) {
          const r = await client.from('bookmarks').upsert(merged.toUpload.map((id) => ({ question_id: id })), { onConflict: 'user_id,question_id' });
          if (r.error) ok = false;
        }
        // (In batches, so a long list doesn't make too long an address.)
        for (let i = 0; i < merged.toDelete.length; i += 200) {
          const r = await client.from('bookmarks').delete().in('question_id', merged.toDelete.slice(i, i + 200));
          if (r.error) ok = false;
        }
        window.SBData.bookmarks.replaceAll(merged.all);
        if (ok) writeBase(merged.all);
        window.dispatchEvent(new CustomEvent('sb-bookmarks-synced'));
      }
    }
    // Settings: the newer copy wins.
    const { data: rows } = await client.from('user_settings').select('data, updated_at');
    const remote = rows && rows[0];
    const pick = core.pickSettings(readLocalSettings(), localStamp(), remote && remote.data, remote && remote.updated_at);
    if (pick.from === 'remote') {
      writeLocalSettings(pick.data);
      setLocalStamp(remote.updated_at);
    } else {
      settingsDirty = true;
      await pushSettings().catch(() => {}); // retried by the watcher
    }
    lastSettings = JSON.stringify(readLocalSettings());
  }

  // Pushes this browser's settings. The stamp is when they last changed here
  // (set by the watcher below), not when they were pushed, so a change made
  // while logged out still beats an older copy in the account. Throws if the
  // save failed, so the watcher keeps it pending and tries again.
  async function pushSettings() {
    if (!client || !user) return;
    const stamp = localStamp() || new Date().toISOString();
    const { error } = await client.from('user_settings').upsert({ data: readLocalSettings(), updated_at: stamp }, { onConflict: 'user_id' });
    if (error) throw error;
    settingsDirty = false;
  }

  // Settings are written by several pages' own code; rather than hook each
  // of them, the set is compared every few seconds. A change is stamped with
  // its time (logged in or not) and, when logged in, pushed; a failed push
  // stays pending and is retried every 15 seconds.
  let lastSettings = null;
  let settingsDirty = false;
  let lastPushTry = 0;
  if (enabled) {
    setInterval(() => {
      const now = JSON.stringify(readLocalSettings());
      if (lastSettings !== null && now !== lastSettings) {
        setLocalStamp(new Date().toISOString());
        settingsDirty = true;
        lastPushTry = 0;
      }
      lastSettings = now;
      if (!user || !settingsDirty || Date.now() - lastPushTry < 15000) return;
      lastPushTry = Date.now();
      pushSettings().catch((e) => console.warn('Settings not saved to your account yet:', e.message || e));
    }, 3000);
  }

  function watchBookmarks() {
    if (!window.SBData || !window.SBData.bookmarks || !window.SBData.bookmarks.onChange) return;
    window.SBData.bookmarks.onChange((id, on) => {
      if (!client || !user) return;
      const q = on
        ? client.from('bookmarks').upsert({ question_id: id }, { onConflict: 'user_id,question_id' })
        : client.from('bookmarks').delete().eq('question_id', id);
      q.then(({ error }) => {
        if (error) console.warn('Bookmark not saved to your account:', error.message);
        else updateBase(id, on);
      });
    });
  }
  if (enabled) watchBookmarks();

  /* ---------------- Auth ---------------- */
  async function needClient() {
    await ready;
    if (!client) throw new Error('Accounts aren\'t available right now.');
    return client;
  }
  async function signUp(email, password, username) {
    const c = await needClient();
    const { data, error } = await c.auth.signUp({
      email, password,
      options: { data: { username }, emailRedirectTo: pageUrl('account.html') },
    });
    if (error) throw error;
    return data;
  }
  async function signIn(email, password) {
    const c = await needClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }
  async function signOut() {
    const c = await needClient();
    await c.auth.signOut();
  }
  async function resetPassword(email) {
    const c = await needClient();
    const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('account.html') });
    if (error) throw error;
  }
  async function updatePassword(password) {
    const c = await needClient();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw error;
  }
  async function updateUsername(username) {
    const c = await needClient();
    const { data, error } = await c.auth.updateUser({ data: { username } });
    if (error) throw error;
    setUser(data.user);
  }
  // Edit profile: the username, and the email when it changed. A new email
  // takes effect once the link sent to it is clicked; returns whether one
  // was sent.
  async function updateProfile(username, email) {
    const c = await needClient();
    const patch = { data: { username } };
    const emailChanged = !!email && !!user && email.toLowerCase() !== (user.email || '').toLowerCase();
    if (emailChanged) patch.email = email;
    const { data, error } = await c.auth.updateUser(patch, { emailRedirectTo: pageUrl('account.html') });
    if (error) throw error;
    setUser(data.user);
    return { emailChanged };
  }
  // Edit password asks for the current one: checked by logging in with it.
  async function checkPassword(password) {
    const c = await needClient();
    if (!user || !user.email) throw new Error('Log in first.');
    const { error } = await c.auth.signInWithPassword({ email: user.email, password });
    if (error) throw new Error('Your current password is incorrect.');
  }
  function emailVerified(u) {
    u = u || user;
    return !!(u && (u.email_confirmed_at || u.confirmed_at));
  }
  async function resendVerification() {
    const c = await needClient();
    const { error } = await c.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: pageUrl('account.html') } });
    if (error) throw error;
  }

  /* ---------------- Answers and stats ---------------- */
  // Each recorded answer gets its own handle: its row id arrives with the
  // insert, and a later change (an override, or a correct rebuzz in
  // Multiplayer) waits for that insert and updates that row, whatever order
  // inserts finish in.
  //   extra: { points, celerity }: what the answer scored (4, 0 or -4) and
  //   the share of the question still unread at the buzz (0-1; none for a
  //   question you didn't buzz on).
  // A project whose answers table predates those two columns (see
  // supabase/schema.sql) refuses them; the answer is then saved without.
  let extraColumns = true;
  function extraFields(extra) {
    if (!extraColumns || !extra) return {};
    const c = extra.celerity;
    return {
      points: typeof extra.points === 'number' ? extra.points : null,
      celerity: typeof c === 'number' && c >= 0 && c <= 1 ? Math.round(c * 1000) / 1000 : null,
    };
  }
  function missingColumn(error) {
    return !!error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message || ''));
  }
  // Runs write(fields); if the new columns are refused, once more without.
  function withExtra(extra, write) {
    return write(extraFields(extra)).then((res) => {
      if (extraColumns && extra && missingColumn(res.error)) { extraColumns = false; return write({}); }
      return res;
    });
  }
  function recordAnswer(q, result, mode, extra) {
    if (!client || !user || !q) { lastAttempt = null; return null; }
    const insert = withExtra(extra, (fields) => client.from('answers').insert({
      question_id: q.id, mode, result,
      subject: q.subject || null, qtype: q.qtype || null, format: q.format || null, tournament: q.tournament || null,
      ...fields,
    }).select('id').single()).then(({ data, error }) => {
      if (error) { console.warn('Answer not saved to your stats:', error.message); return null; }
      return data.id;
    }, () => null);
    let chain = insert;
    const attempt = {
      result,
      update(newResult, newExtra) {
        attempt.result = newResult;
        const turn = attempt.turn = (attempt.turn || 0) + 1;
        chain = chain.then(() => insert).then((id) => {
          if (id == null || attempt.turn !== turn) return;
          return withExtra(newExtra, (fields) => client.from('answers').update({ result: newResult, ...fields }).eq('id', id)).then(({ error }) => {
            if (error) console.warn('Answer change not saved to your stats:', error.message);
          });
        });
        return chain;
      },
    };
    lastAttempt = attempt;
    return attempt;
  }
  // A grading override changes the answer just recorded.
  function updateLastAnswer(result, extra) {
    if (lastAttempt) lastAttempt.update(result, extra);
  }
  // Every answer in the account, newest first. The server hands back at most
  // a set number of rows per request (1,000 by default), so they're read in
  // pages until one comes back empty; `limit` stops early.
  const ANSWER_PAGE = 1000;
  async function fetchAnswers(limit) {
    const c = await needClient();
    if (!user) return [];
    const max = limit || 100000;
    const rows = [];
    let before = null;
    while (rows.length < max) {
      let q = c.from('answers').select('*').order('id', { ascending: false }).limit(Math.min(ANSWER_PAGE, max - rows.length));
      if (before !== null) q = q.lt('id', before);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach((r) => rows.push(r));
      before = data[data.length - 1].id;
    }
    return rows;
  }
  async function resetStats() {
    const c = await needClient();
    const { error } = await c.from('answers').delete().eq('user_id', user.id);
    if (error) throw error;
  }
  async function deleteMyData() {
    const c = await needClient();
    for (const table of ['answers', 'bookmarks', 'user_settings']) {
      const { error } = await c.from(table).delete().eq('user_id', user.id);
      if (error) throw error;
    }
    // This browser's copy of the account's stars goes too, or the next login
    // would upload them again. (Theme and reading speed stay: they're this
    // browser's own settings, and the site needs them.)
    if (window.SBData && window.SBData.bookmarks) {
      window.SBData.bookmarks.replaceAll([]);
      window.dispatchEvent(new CustomEvent('sb-bookmarks-synced'));
    }
    writeBase([]);
    lastAttempt = null;
  }

  // The browser's own network errors ("Failed to fetch", "NetworkError when
  // attempting to fetch resource.", "Load failed") mean the account service
  // couldn't be reached; anything else is the service's own message.
  function friendlyError(err) {
    const text = (err && err.message) || String(err);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
      return "Couldn't reach the account service. Check your internet connection and try again.";
    }
    return text;
  }

  window.SBAccount = {
    friendlyError,
    enabled,
    ready,
    user: () => user,
    displayName,
    onChange(fn) { listeners.push(fn); },
    signUp, signIn, signOut, resetPassword, updatePassword, updateUsername,
    updateProfile, checkPassword, emailVerified, resendVerification, pageUrl,
    recordAnswer, updateLastAnswer, fetchAnswers, resetStats, deleteMyData,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNav);
  else renderNav();
})();
