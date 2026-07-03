-- ============================================================================
-- Roll for Rating — Match videos
-- Run this in the Supabase SQL Editor after schema.sql AND public-matches.sql
-- (the read policies reference matches.is_public). Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket for match videos — PRIVATE. A match video can show a minor, so
-- files must never be world-downloadable via a public URL. The app fetches
-- time-limited signed URLs, gated by the RLS read policy below. (do update so
-- re-running flips an existing public bucket to private.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('match-videos', 'match-videos', false)
on conflict (id) do update set public = false;

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

-- Read a match video's file only if the match is public (Watch feed) or you are
-- a participant. This is what gates signed-URL issuance, so a minor's private
-- match video can never be pulled by an unrelated user. Path = <match_id>/<file>.
drop policy if exists "match video read" on storage.objects;
create policy "match video read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'match-videos'
    and exists (
      select 1 from public.matches m
      where m.id = ((storage.foldername(name))[1])::uuid
        and (m.is_public or auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id))
    )
  );

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

-- Readable only if the match is public (Watch feed) or you are a participant —
-- mirrors the storage read policy so a minor's private match video row (and its
-- path) isn't exposed to unrelated users.
drop policy if exists "match_videos_read" on public.match_videos;
create policy "match_videos_read" on public.match_videos
  for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.is_public or auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id))
    )
  );

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
