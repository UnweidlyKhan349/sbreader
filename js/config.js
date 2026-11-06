// The Supabase project behind the Multiplayer room list (public rooms with
// "N players - M online", and players kept with their scores after they
// leave). The URL and publishable key are meant to be public; the tables
// (supabase/schema.sql) only hold room names, player names and practice
// scores. Never put the secret key here. With either left empty, everything
// still works and the lobby just shows the built-in rooms.
window.SB_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
