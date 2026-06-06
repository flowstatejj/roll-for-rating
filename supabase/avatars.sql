-- ============================================================================
-- Roll for Rating — Profile photos (avatars) with minor-safe visibility
-- Run after schema.sql, minors.sql, managed-juniors.sql. Safe to re-run.
--
--  • profiles.avatar_path → path in a PRIVATE storage bucket.
--  • Adults' photos are viewable by any signed-in user.
--  • A MINOR's / TEEN's photo is viewable ONLY by: themselves, their guardian,
--    or someone who has an ACCEPTED match with them (opponent or referee on a
--    match past the pending-opponent stage). Strangers can't fetch it.
--  • A profile photo is REQUIRED to create a match (enforced by a trigger).
-- Photos are served via short-lived signed URLs, so the storage read policy
-- below is what actually gates access.
-- ============================================================================

alter table public.profiles add column if not exists avatar_path text;

-- profiles has column-level UPDATE grants (see challenges.sql); allow users to
-- set their own avatar_path too. (Grants are additive — this just adds the column.)
grant update (avatar_path) on public.profiles to authenticated;

-- Private bucket (no public URLs — access only via signed URLs gated by RLS).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do update set public = false;

-- Path convention: '<profile_id>/avatar.<ext>'. The first folder is the profile
-- the photo belongs to (note: a guardian uploads a junior's photo, so we key on
-- the path, not the uploader).

-- ---- Write: you may write your own avatar, or one of your managed juniors' ----
drop policy if exists "avatar_write_own" on storage.objects;
create policy "avatar_write_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_my_junior(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_my_junior(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "avatar_delete_own" on storage.objects;
create policy "avatar_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_my_junior(((storage.foldername(name))[1])::uuid)
    )
  );

-- ---- Read: gated by adult-vs-minor + accepted-match relationship ----
drop policy if exists "avatar_read_gated" on storage.objects;
create policy "avatar_read_gated" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      -- your own photo
      (storage.foldername(name))[1] = auth.uid()::text
      -- an adult's photo (visible to any signed-in user)
      or exists (
        select 1 from public.profiles p
        where p.id = ((storage.foldername(name))[1])::uuid and p.is_minor = false
      )
      -- a junior you manage
      or public.is_my_junior(((storage.foldername(name))[1])::uuid)
      -- someone you have an ACCEPTED match with (you're opponent or referee, or
      -- they are, on a match past the pending-opponent stage)
      or exists (
        select 1 from public.matches m
        where m.status in ('pending_referee', 'pending_confirmation', 'completed')
          and ((storage.foldername(name))[1])::uuid in (m.challenger_id, m.opponent_id, m.referee_id)
          and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Require a profile photo to create a match (the challenger must have one).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_avatar_required()
returns trigger language plpgsql security definer set search_path = public as $$
declare has_photo boolean;
begin
  select avatar_path is not null and btrim(avatar_path) <> ''
    into has_photo from public.profiles where id = new.challenger_id;
  if not coalesce(has_photo, false) then
    raise exception 'Add a profile photo before you can compete.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_avatar_required on public.matches;
create trigger trg_avatar_required before insert on public.matches
  for each row execute function public.enforce_avatar_required();
