-- ============================================================================
-- Roll for Rating — Match videos
-- Run this in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket for match videos (public-read for now).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('match-videos', 'match-videos', true)
on conflict (id) do nothing;

-- Only participants of a match may UPLOAD into that match's folder.
-- Files live at:  match-videos/<match_id>/<filename>
drop policy if exists "match video upload" on storage.objects;
create policy "match video upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-videos'
    and exists (
      select 1 from public.matches m
      where m.id = ((storage.foldername(name))[1])::uuid
        and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
    )
  );

-- Anyone signed in can read objects in this bucket (it's also public via URL).
drop policy if exists "match video read" on storage.objects;
create policy "match video read" on storage.objects
  for select to authenticated
  using (bucket_id = 'match-videos');

-- ---------------------------------------------------------------------------
-- match_videos — links an uploaded file to a match
-- ---------------------------------------------------------------------------
create table if not exists public.match_videos (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  path        text not null,           -- storage path within the bucket
  created_at  timestamptz not null default now()
);
create index if not exists match_videos_match_idx on public.match_videos (match_id);

alter table public.match_videos enable row level security;

-- Readable by anyone signed in (matches themselves are public-readable).
drop policy if exists "match_videos_read" on public.match_videos;
create policy "match_videos_read" on public.match_videos
  for select to authenticated using (true);

-- Only a participant may record that they uploaded a video for the match.
drop policy if exists "match_videos_insert" on public.match_videos;
create policy "match_videos_insert" on public.match_videos
  for insert to authenticated
  with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
    )
  );

-- A participant may delete a video row (the file cleanup is best-effort).
drop policy if exists "match_videos_delete" on public.match_videos;
create policy "match_videos_delete" on public.match_videos
  for delete to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
    )
  );
