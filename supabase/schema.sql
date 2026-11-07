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
-- need an account, so anyone may read and write them; the checks keep each
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
