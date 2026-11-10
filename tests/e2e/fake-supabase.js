// An in-memory stand-in for the Supabase client (tests/e2e/account.e2e.js),
// signed in as one user (verified email, password "old-password"), with each answers insert delayed by
// window.__INSERT_DELAYS (ms, one per insert, in order) so tests can make
// inserts finish late or out of order. window.__db holds the tables. A read
// returns at most window.__MAX_ROWS rows (1,000, as Supabase does).
(function () {
  const db = window.__db = window.__db || { answers: [], bookmarks: [], user_settings: [] };
  let nextId = 1;
  const user = { id: 'user-1', email: 't@example.com', email_confirmed_at: '2026-11-01T00:00:00Z', user_metadata: { username: 'Tester' } };
  const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  function query(table) {
    const rows = () => db[table];
    let filter = () => true;
    let action = { kind: 'select' };
    let sort = null;
    let max = Infinity;
    const q = {
      select() { if (action.kind === 'select') action = { kind: 'select' }; else action.returning = true; return q; },
      insert(row) { action = { kind: 'insert', row }; return q; },
      upsert(r) { action = { kind: 'upsert', rows: [].concat(r) }; return q; },
      update(patch) { action = { kind: 'update', patch }; return q; },
      delete() { action = { kind: 'delete' }; return q; },
      eq(k, v) { const f = filter; filter = (r) => f(r) && r[k] === v; return q; },
      in(k, vs) { const f = filter; filter = (r) => f(r) && vs.includes(r[k]); return q; },
      gt(k, v) { const f = filter; filter = (r) => f(r) && r[k] > v; return q; },
      lt(k, v) { const f = filter; filter = (r) => f(r) && r[k] < v; return q; },
      order(k, o) { const asc = !o || o.ascending !== false; sort = (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1); return q; },
      limit(n) { max = n; return q; },
      single() { action.single = true; return q; },
      then(ok, bad) { return run().then(ok, bad); },
    };
    async function run() {
      if (action.kind === 'insert') {
        const delays = window.__INSERT_DELAYS || [];
        // (window.__OLD_ANSWERS: a project whose answers table has no
        // points or celerity column yet refuses a row that names them.)
        if (window.__OLD_ANSWERS && table === 'answers' && ('points' in action.row || 'celerity' in action.row)) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'celerity' column of 'answers' in the schema cache" } };
        }
        const row = { id: nextId++, user_id: user.id, created_at: new Date().toISOString(), ...action.row };
        await later(delays.length ? delays.shift() : 0);
        rows().push(row);
        return { data: action.single ? { id: row.id } : [row], error: null };
      }
      if (action.kind === 'upsert') {
        action.rows.forEach((r) => {
          const row = { user_id: user.id, ...r };
          const i = rows().findIndex((x) => (table === 'bookmarks' ? x.question_id === row.question_id : x.user_id === row.user_id));
          if (i >= 0) rows()[i] = row; else rows().push(row);
        });
        return { data: null, error: null };
      }
      if (action.kind === 'update') { rows().filter(filter).forEach((r) => Object.assign(r, action.patch)); return { data: null, error: null }; }
      if (action.kind === 'delete') { db[table] = rows().filter((r) => !filter(r)); return { data: null, error: null }; }
      const found = rows().filter(filter);
      if (sort) found.sort(sort);
      const cap = Math.min(max, window.__MAX_ROWS || 1000);
      return { data: found.slice(0, cap).map((r) => ({ ...r })), error: null };
    }
    return q;
  }
  window.supabase = {
    createClient: () => ({
      from: query,
      auth: {
        getSession: async () => ({ data: { session: window.__signedOut ? null : { user } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
        // The account's password is "old-password" (the Edit password page).
        signInWithPassword: async ({ password }) => (password === 'old-password' ? { data: { user }, error: null } : { data: null, error: new Error('Invalid login credentials') }),
        updateUser: async (patch) => {
          (window.__authUpdates = window.__authUpdates || []).push(patch);
          if (patch.data) Object.assign(user.user_metadata, patch.data);
          return { data: { user }, error: null };
        },
      },
      functions: { invoke: async () => ({ data: null, error: new Error('no functions') }) },
    }),
  };
})();
