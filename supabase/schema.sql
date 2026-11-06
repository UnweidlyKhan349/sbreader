-- SB Reader's Supabase project: run this once in the project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run). It's safe to run
-- again; it only adds what's missing.
--
-- The site has no accounts (they were removed in November 2026). A project
-- set up before then also has account tables, which nothing uses any more;
-- to remove them, run:
--   drop table if exists public.bookmarks, public.answers, public.user_settings;
-- and delete any users under Authentication -> Users.

-- Multiplayer room list. Games themselves run browser to browser;
-- these two tables only let the lobby page list rooms with their player
-- counts ("12 players - 3 online"), keep a room's players (and scores) after
-- everyone has left, and tell public rooms from private ones. There are no
-- accounts, so anyone may read and write them; the checks keep each
-- row small and well formed.
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

alter table public.mp_rooms enable row level security;
alter table public.mp_players enable row level security;

drop policy if exists "anyone reads rooms" on public.mp_rooms;
create policy "anyone reads rooms" on public.mp_rooms for select using (true);
drop policy if exists "anyone lists a room" on public.mp_rooms;
create policy "anyone lists a room" on public.mp_rooms for insert with check (true);
drop policy if exists "anyone updates a room" on public.mp_rooms;
create policy "anyone updates a room" on public.mp_rooms for update using (true) with check (true);

drop policy if exists "anyone reads players" on public.mp_players;
create policy "anyone reads players" on public.mp_players for select using (true);
drop policy if exists "anyone adds a player" on public.mp_players;
create policy "anyone adds a player" on public.mp_players for insert with check (true);
drop policy if exists "anyone updates a player" on public.mp_players;
create policy "anyone updates a player" on public.mp_players for update using (true) with check (true);
