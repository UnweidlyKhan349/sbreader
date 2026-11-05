// Accounts (log in, synced bookmarks, stats, synced settings) use a Supabase
// project. Fill in your project's URL and anon (public) key from Supabase:
// Project Settings -> API. Both are meant to be public; the tables' row-level
// security (supabase/schema.sql) is what keeps each account's data private.
// Left empty, everything else works; "Log in" opens a page saying accounts
// aren't switched on yet.
window.SB_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
