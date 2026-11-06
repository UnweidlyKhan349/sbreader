// Accounts (log in, synced bookmarks, stats, synced settings) and the
// Multiplayer room list use a Supabase project. Fill in its Project URL
// (the Connect button at the top of the Supabase dashboard, or Project
// Settings -> Data API) and its publishable key (Project Settings -> API
// Keys; a legacy "anon" key works too). Both are meant to be public; the
// tables' row-level security (supabase/schema.sql) is what keeps each
// account's data private. Never put the secret / service_role key here.
// With either left empty, everything else works; "Log in" opens a page
// saying accounts aren't switched on yet.
window.SB_CONFIG = {
  supabaseUrl: 'https://jvgshmtoinzgegfwwjah.supabase.co',
  supabaseAnonKey: 'sb_publishable_lTGIdlxla6oXT77TTHjsJA_o_WHAO0u',
};
