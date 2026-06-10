-- ============================================================================
-- Roll for Rating — Warrior avatars (non-photographic identity, safe for minors)
-- Run after avatars.sql. Safe to re-run.
--
-- Minors never upload photos; they pick a historical-warrior emblem rendered
-- on-device (no image is ever captured, stored, or sent). Adults may pick a
-- warrior OR a real photo. A warrior satisfies the "needs an avatar" rule.
-- ============================================================================

alter table public.profiles add column if not exists avatar_warrior text;  -- e.g. 'samurai'
alter table public.profiles add column if not exists avatar_color   text;  -- hex bg, e.g. '#2f6fed'

grant update (avatar_warrior, avatar_color) on public.profiles to authenticated;

-- A profile photo OR a warrior counts as having an avatar to compete.
create or replace function public.enforce_avatar_required()
returns trigger language plpgsql security definer set search_path = public as $$
declare has_avatar boolean;
begin
  select (avatar_path is not null and btrim(avatar_path) <> '')
      or (avatar_warrior is not null and btrim(avatar_warrior) <> '')
    into has_avatar from public.profiles where id = new.challenger_id;
  if not coalesce(has_avatar, false) then
    raise exception 'Add a profile avatar before you can compete.';
  end if;
  return new;
end; $$;
