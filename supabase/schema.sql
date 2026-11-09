-- SB Reader accounts: run this once in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Sign-up and login are Supabase Auth's own (email + password). These
-- tables hold what an account keeps: bookmarks, answers (for the Stats
-- page) and settings. Row-level security lets each person read and change
-- only their own rows; the anon key in js/config.js can't see anyone else's.

create table if not exists public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  question_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.answers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  question_id integer not null,
  mode text not null check (mode in ('solo', 'mp')),
  result text not null check (result in ('correct', 'incorrect', 'skipped')),
  subject text,
  qtype text,
  format text,
  tournament text,
  created_at timestamptz not null default now()
);
create index if not exists answers_user_created on public.answers (user_id, created_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bookmarks enable row level security;
alter table public.answers enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own bookmarks" on public.bookmarks;
create policy "own bookmarks" on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own answers" on public.answers;
create policy "own answers" on public.answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Multiplayer room list (optional). Games themselves run browser to browser;
-- these two tables only let the lobby page list rooms with their player
-- counts ("12 players - 3 online"), keep a room's players (and scores) after
-- everyone has left, and tell public rooms from private ones. Players don't
-- need an account; see "Who may change what" below for how rows are
-- protected. The checks keep each row small and well formed.
create table if not exists public.mp_rooms (
  name text primary key check (name ~ '^[a-z0-9-]{1,32}$' or name ~ '^pub-[a-z]{1,16}$'),
  is_public boolean not null default true,
  is_permanent boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.mp_players (
  room text not null references public.mp_rooms (name) on delete cascade,
  pid text not null check (pid ~ '^[A-Za-z0-9_-]{8,40}$'),
  username text not null check (char_length(username) between 1 and 24),
  score integer not null default 0 check (score between -100000 and 100000),
  correct integer not null default 0 check (correct between 0 and 100000),
  incorrect integer not null default 0 check (incorrect between 0 and 100000),
  negs integer not null default 0 check (negs between 0 and 100000),
  cel_sum real not null default 0 check (cel_sum between 0 and 100000),
  cel_n integer not null default 0 check (cel_n between 0 and 100000),
  last_seen timestamptz not null default now(),
  primary key (room, pid)
);
-- Added November 2026 (negs, and celerity as a sum and count): a project
-- set up from an earlier copy of this file gets the columns when it's run
-- again.
alter table public.mp_players add column if not exists negs integer not null default 0 check (negs between 0 and 100000);
alter table public.mp_players add column if not exists cel_sum real not null default 0 check (cel_sum between 0 and 100000);
alter table public.mp_players add column if not exists cel_n integer not null default 0 check (cel_n between 0 and 100000);
create index if not exists mp_players_last_seen on public.mp_players (last_seen desc);
create index if not exists mp_rooms_updated_at on public.mp_rooms (updated_at);

alter table public.mp_rooms enable row level security;
alter table public.mp_players enable row level security;

-- Who may change what (rewritten November 2026). Players have no account,
-- so ownership is a secret each browser keeps (localStorage sb_mp_secret):
-- a player row stores a hash of its browser's secret and only that secret
-- can update it; a room stores its creator's, and only the creator can make
-- it public or private. The tables can't be read or written directly any
-- more; the site calls the three functions below, which:
--   mp_list()        lists public rooms (never private ones) with counts
--   mp_roster(room)  a room's players, by its exact name (no secrets)
--   mp_heartbeat(..) adds or updates this browser's own row; the server
--                    sets last_seen, and a room's "permanent" flag follows
--                    its name (only the built-in pub-* rooms are)
alter table public.mp_rooms add column if not exists owner_hash text;
alter table public.mp_players add column if not exists secret_hash text;

drop policy if exists "anyone reads rooms" on public.mp_rooms;
drop policy if exists "anyone lists a room" on public.mp_rooms;
drop policy if exists "anyone updates a room" on public.mp_rooms;
drop policy if exists "anyone reads players" on public.mp_players;
drop policy if exists "anyone adds a player" on public.mp_players;
drop policy if exists "anyone updates a player" on public.mp_players;
-- (With row-level security on and no policies, nobody gets at the rows
-- except through the functions.)
revoke all on public.mp_rooms, public.mp_players from anon, authenticated;

create or replace function public.mp_list()
returns table (name text, is_public boolean, is_permanent boolean, players integer, online integer)
language sql stable security definer set search_path = public as $$
  select r.name, r.is_public, r.is_permanent,
         count(p.pid)::integer,
         count(p.pid) filter (where p.last_seen > now() - interval '90 seconds')::integer
  from mp_rooms r left join mp_players p on p.room = r.name
  where r.is_public
  group by r.name, r.is_public, r.is_permanent;
$$;

create or replace function public.mp_roster(p_room text)
returns table (pid text, username text, score integer, correct integer, incorrect integer,
               negs integer, cel_sum real, cel_n integer, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select pid, username, score, correct, incorrect, negs, cel_sum, cel_n, last_seen
  from mp_players where room = p_room;
$$;

-- The built-in rooms, by name (General and one per subject but Energy; see
-- publicLobbies in js/mp-rules.js, and add a row here with a new subject).
-- Only these are public and permanent; other "pub-" names are refused (the
-- site never makes one: SBMpRules.cleanRoomName drops the prefix), so a
-- named room can't share a built-in room's record.
create or replace function public.mp_is_builtin(p_room text)
returns boolean
language sql immutable set search_path = public as $$
  select p_room in ('pub-all', 'pub-bio', 'pub-chem', 'pub-ess', 'pub-math', 'pub-phys');
$$;

-- Records from before the allowlist: a named "pub-..." room isn't a
-- built-in one.
delete from public.mp_rooms where name like 'pub-%' and not public.mp_is_builtin(name);
update public.mp_rooms set is_permanent = public.mp_is_builtin(name), is_public = is_public or public.mp_is_builtin(name)
  where is_permanent <> public.mp_is_builtin(name);

create or replace function public.mp_heartbeat(
  p_room text, p_is_public boolean, p_pid text, p_secret text, p_username text,
  p_score integer, p_correct integer, p_incorrect integer, p_negs integer, p_cel_sum real, p_cel_n integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  h text;
  existing text;
begin
  if p_secret is null or char_length(p_secret) not between 16 and 128 then
    raise exception 'bad secret';
  end if;
  if p_room like 'pub-%' and not mp_is_builtin(p_room) then
    raise exception 'reserved room name';
  end if;
  h := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  -- Rooms nobody has been in for 30 days are deleted, with their players
  -- (added November 2026). The built-in pub-* rooms are kept. It runs on
  -- every heartbeat; with the index on updated_at it costs next to nothing
  -- when there's nothing to delete.
  delete from mp_rooms where not is_permanent and updated_at < now() - interval '30 days';
  -- And players who haven't been seen for a day, in every room (the site
  -- takes offline players off the leaderboard after a day too).
  delete from mp_players where last_seen < now() - interval '1 day';
  -- The room: created by the first player to report it; only that player
  -- can change whether it's listed. Built-in rooms are always public.
  insert into mp_rooms (name, is_public, is_permanent, owner_hash, updated_at)
  values (p_room, p_is_public or mp_is_builtin(p_room), mp_is_builtin(p_room), h, now())
  on conflict (name) do update set
    is_public = case when mp_rooms.owner_hash = h and not mp_is_builtin(mp_rooms.name)
                     then excluded.is_public else mp_rooms.is_public end,
    owner_hash = coalesce(mp_rooms.owner_hash, excluded.owner_hash),
    updated_at = now();
  -- The player: this browser's own row only.
  select secret_hash into existing from mp_players where room = p_room and pid = p_pid;
  if found and existing is not null and existing <> h then
    return false;
  end if;
  insert into mp_players (room, pid, username, score, correct, incorrect, negs, cel_sum, cel_n, last_seen, secret_hash)
  values (p_room, p_pid, p_username, p_score, p_correct, p_incorrect, p_negs, p_cel_sum, p_cel_n, now(), h)
  on conflict (room, pid) do update set
    username = excluded.username, score = excluded.score, correct = excluded.correct,
    incorrect = excluded.incorrect, negs = excluded.negs, cel_sum = excluded.cel_sum,
    cel_n = excluded.cel_n, last_seen = now(), secret_hash = excluded.secret_hash;
  return true;
end;
$$;

revoke all on function public.mp_list(), public.mp_roster(text),
  public.mp_heartbeat(text, boolean, text, text, text, integer, integer, integer, integer, real, integer) from public;
grant execute on function public.mp_list(), public.mp_roster(text),
  public.mp_heartbeat(text, boolean, text, text, text, integer, integer, integer, integer, real, integer) to anon, authenticated;

-- Room owners (added November 2026). A named room's owner is the browser
-- that created it, as on QB Reader: it shows a crown, can mute and ban
-- players, and can make the room "controlled" (only the owner changes the
-- settings). The owner proves who they are to the other players by signing
-- with a key only their browser holds; owner_key is its public half. These
-- columns keep a room's owner, bans and controlled switch after everyone has
-- left, so the room comes back the same.
--   mp_room(room)        the room's listing, owner key, bans, controlled
--                        switch and players, in one call (null: no such room)
--   mp_set_room(..)      the creator's browser (owner_hash) records its key,
--                        bans and controlled switch; creates the room if new
alter table public.mp_rooms add column if not exists owner_key text check (char_length(owner_key) <= 200);
alter table public.mp_rooms add column if not exists banned text[] not null default '{}' check (cardinality(banned) <= 500);
alter table public.mp_rooms add column if not exists controlled boolean not null default false;

create or replace function public.mp_room(p_room text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_public', r.is_public, 'owner_key', r.owner_key, 'banned', to_jsonb(r.banned), 'controlled', r.controlled,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'pid', p.pid, 'username', p.username, 'score', p.score, 'correct', p.correct, 'incorrect', p.incorrect,
        'negs', p.negs, 'cel_sum', p.cel_sum, 'cel_n', p.cel_n, 'last_seen', p.last_seen))
      from mp_players p where p.room = r.name), '[]'::jsonb))
  from mp_rooms r where r.name = p_room;
$$;

create or replace function public.mp_set_room(
  p_room text, p_secret text, p_is_public boolean, p_owner_key text, p_banned text[], p_controlled boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  h text;
  n integer;
begin
  if p_secret is null or char_length(p_secret) not between 16 and 128 then
    raise exception 'bad secret';
  end if;
  if p_room like 'pub-%' then
    return false; -- the built-in rooms have no owner, and no other room is named pub-*
  end if;
  if p_owner_key is not null and p_owner_key !~ '^[A-Za-z0-9_-]{20,100}\.[A-Za-z0-9_-]{20,100}$' then
    raise exception 'bad owner key';
  end if;
  if exists (select 1 from unnest(coalesce(p_banned, '{}')) b where b !~ '^[A-Za-z0-9_-]{8,40}$') then
    raise exception 'bad ban list';
  end if;
  h := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  insert into mp_rooms (name, is_public, is_permanent, owner_hash, owner_key, banned, controlled, updated_at)
  values (p_room, coalesce(p_is_public, true), false, h, p_owner_key,
          coalesce(p_banned[1:500], '{}'), coalesce(p_controlled, false), now())
  on conflict (name) do update set
    -- The key is set once; after that only the bans and the switch change.
    owner_key = coalesce(mp_rooms.owner_key, excluded.owner_key),
    owner_hash = coalesce(mp_rooms.owner_hash, excluded.owner_hash),
    banned = excluded.banned,
    controlled = excluded.controlled
  where mp_rooms.owner_hash is null or mp_rooms.owner_hash = h;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.mp_room(text), public.mp_set_room(text, text, boolean, text, text[], boolean) from public;
grant execute on function public.mp_room(text), public.mp_set_room(text, text, boolean, text, text[], boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Problem reports and "I was right" clicks (added November 2026).
-- Anyone can add a row (logged in or not); nobody can read them through the
-- site: read them in the dashboard (Table Editor, or the queries in the
-- README's "Reports" section). Running this file again is safe.

create table if not exists public.question_reports (
  id bigint generated always as identity primary key,
  question_id integer not null check (question_id > 0),
  reason text not null check (reason in ('answer', 'question', 'figure', 'subject', 'other')),
  note text check (char_length(note) <= 500),
  page text check (char_length(page) <= 40),
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists question_reports_question on public.question_reports (question_id);

-- A player overrode a wrong grade to correct: what they typed and the key.
-- An answer that keeps showing up here belongs in the accept list.
create table if not exists public.answer_overrides (
  id bigint generated always as identity primary key,
  question_id integer not null check (question_id > 0),
  typed text not null check (char_length(typed) between 1 and 200),
  answer_key text check (char_length(answer_key) <= 300),
  mode text not null check (mode in ('solo', 'mp')),
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists answer_overrides_question on public.answer_overrides (question_id);

alter table public.question_reports enable row level security;
alter table public.answer_overrides enable row level security;

-- Insert only, and only as yourself (or as nobody, logged out).
drop policy if exists "anyone reports" on public.question_reports;
create policy "anyone reports" on public.question_reports
  for insert with check (user_id is null or user_id = auth.uid());
drop policy if exists "anyone logs an override" on public.answer_overrides;
create policy "anyone logs an override" on public.answer_overrides
  for insert with check (user_id is null or user_id = auth.uid());
