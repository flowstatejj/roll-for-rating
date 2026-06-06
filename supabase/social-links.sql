-- ============================================================================
-- Roll for Rating — Social links on profiles (Instagram / TikTok / YouTube / FB)
-- Run after schema.sql. Safe to re-run.
--
--  • Four optional text columns holding a handle (e.g. "johndoe") or a full URL.
--  • Column-level UPDATE grant so users can set their own (profiles uses
--    column-level grants — see challenges.sql / avatars.sql).
--  • The app only writes/shows these for ADULT profiles; minors' profiles leave
--    them null (a kid's other socials shouldn't be discoverable here).
-- ============================================================================

alter table public.profiles
  add column if not exists instagram text,
  add column if not exists tiktok    text,
  add column if not exists youtube   text,
  add column if not exists facebook  text;

grant update (instagram, tiktok, youtube, facebook) on public.profiles to authenticated;
