// Accounts, through Supabase (see js/config.js and supabase/schema.sql).
//
// window.SBAccount works on every page whether accounts are set up or not:
// with no project configured, `enabled` is false, nothing is loaded, and
// every call quietly does nothing. With one, the Supabase library is loaded
// on demand, the navbar shows "Log in" or your name, and a logged-in
// account keeps:
//   - bookmarks: every star mirrored to the account; at login this
//     device's and the account's are merged (nothing is lost on either side)
//   - answers: each question answered in Play or Multiplayer, for Stats
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
  let lastAnswerId = null;
  const listeners = [];

  const here = document.currentScript ? document.currentScript.src : '';
  const libUrl = here ? here.replace(/account\.js(\?.*)?$/, 'vendor/supabase.min.js') : 'js/vendor/supabase.min.js';
  // account.html sits beside this page, wherever the site is hosted.
  function pageUrl(name) { return new URL(name, location.href).href; }

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = libUrl;
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
  // A "Log in" link, or your name with Stats / Account / Log out, in the
  // navbar's #navAccount slot.
  function renderNav() {
    const slot = document.getElementById('navAccount');
    if (!slot || !enabled) return;
    slot.hidden = false;
    if (!user) {
      slot.className = 'nav-item';
      slot.innerHTML = `<a class="nav-link" href="${pageUrl('account.html')}" id="login-link">Log in</a>`;
      return;
    }
    slot.className = 'nav-item dropdown';
    slot.innerHTML = '<a class="nav-link dropdown-toggle" href="#" role="button" data-sb-dropdown></a>'
      + '<div class="dropdown-menu dropdown-menu-end">'
      + `<a class="dropdown-item" href="${pageUrl('stats.html')}">Stats</a>`
      + `<a class="dropdown-item" href="${pageUrl('account.html')}">Account</a>`
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

  async function syncOnLogin() {
    if (!client || !user) return;
    // Bookmarks: union of both sides.
    if (window.SBData && window.SBData.bookmarks) {
      const { data, error } = await client.from('bookmarks').select('question_id');
      if (!error) {
        const local = [...window.SBData.bookmarks.getAll()];
        const merged = core.mergeBookmarks(local, (data || []).map((r) => r.question_id));
        if (merged.toUpload.length) {
          await client.from('bookmarks').upsert(merged.toUpload.map((id) => ({ question_id: id })), { onConflict: 'user_id,question_id' });
        }
        window.SBData.bookmarks.replaceAll(merged.all);
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
      await pushSettings();
    }
    lastSettings = JSON.stringify(readLocalSettings());
  }

  async function pushSettings() {
    if (!client || !user) return;
    const now = new Date().toISOString();
    setLocalStamp(now);
    await client.from('user_settings').upsert({ data: readLocalSettings(), updated_at: now }, { onConflict: 'user_id' });
  }

  // Settings are written by several pages' own code; rather than hook each
  // of them, the set is compared every few seconds and pushed when it moves.
  let lastSettings = null;
  if (enabled) {
    setInterval(() => {
      if (!user) return;
      const now = JSON.stringify(readLocalSettings());
      if (lastSettings !== null && now !== lastSettings) pushSettings().catch(() => {});
      lastSettings = now;
    }, 3000);
  }

  function watchBookmarks() {
    if (!window.SBData || !window.SBData.bookmarks || !window.SBData.bookmarks.onChange) return;
    window.SBData.bookmarks.onChange((id, on) => {
      if (!client || !user) return;
      const q = on
        ? client.from('bookmarks').upsert({ question_id: id }, { onConflict: 'user_id,question_id' })
        : client.from('bookmarks').delete().eq('question_id', id);
      q.then(({ error }) => { if (error) console.warn('Bookmark not saved to your account:', error.message); });
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

  /* ---------------- Answers and stats ---------------- */
  function recordAnswer(q, result, mode) {
    lastAnswerId = null;
    if (!client || !user || !q) return;
    client.from('answers').insert({
      question_id: q.id, mode, result,
      subject: q.subject || null, qtype: q.qtype || null, format: q.format || null, tournament: q.tournament || null,
    }).select('id').single().then(({ data, error }) => {
      if (error) { console.warn('Answer not saved to your stats:', error.message); return; }
      lastAnswerId = data.id;
    });
  }
  // A grading override changes the answer just recorded.
  function updateLastAnswer(result) {
    if (!client || !user || lastAnswerId == null) return;
    client.from('answers').update({ result }).eq('id', lastAnswerId).then(() => {});
  }
  async function fetchAnswers(limit) {
    const c = await needClient();
    if (!user) return [];
    const { data, error } = await c.from('answers').select('*').order('created_at', { ascending: false }).limit(limit || 10000);
    if (error) throw error;
    return data || [];
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
  }

  window.SBAccount = {
    enabled,
    ready,
    user: () => user,
    displayName,
    onChange(fn) { listeners.push(fn); },
    signUp, signIn, signOut, resetPassword, updatePassword, updateUsername,
    recordAnswer, updateLastAnswer, fetchAnswers, resetStats, deleteMyData,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNav);
  else renderNav();
})();
