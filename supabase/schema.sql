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
