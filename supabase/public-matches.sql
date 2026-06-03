-- ============================================================================
-- Roll for Rating — Public matches: publish toggle, views, reactions
-- Run in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

-- Competitors decide before the match whether it's public.
alter table public.matches add column if not exists is_public boolean not null default false;
create index if not exists matches_public_idx on public.matches (is_public, completed_at desc) where is_public;

-- ---------------------------------------------------------------------------
-- match_views — one row per unique viewer (for the view count)
-- ---------------------------------------------------------------------------
create table if not exists public.match_views (
  match_id   uuid not null references public.matches (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, viewer_id)
);

alter table public.match_views enable row level security;

drop policy if exists "match_views_read" on public.match_views;
create policy "match_views_read" on public.match_views for select to authenticated using (true);

drop policy if exists "match_views_insert" on public.match_views;
create policy "match_views_insert" on public.match_views
  for insert to authenticated with check (
    viewer_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and m.is_public)
  );

-- ---------------------------------------------------------------------------
-- match_reactions — one emoji reaction per member per match (no comments)
-- ---------------------------------------------------------------------------
create table if not exists public.match_reactions (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   text not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.match_reactions enable row level security;

drop policy if exists "match_reactions_read" on public.match_reactions;
create policy "match_reactions_read" on public.match_reactions for select to authenticated using (true);

drop policy if exists "match_reactions_write" on public.match_reactions;
create policy "match_reactions_write" on public.match_reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and m.is_public)
  );

drop policy if exists "match_reactions_update" on public.match_reactions;
create policy "match_reactions_update" on public.match_reactions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "match_reactions_delete" on public.match_reactions;
create policy "match_reactions_delete" on public.match_reactions
  for delete to authenticated using (user_id = auth.uid());
