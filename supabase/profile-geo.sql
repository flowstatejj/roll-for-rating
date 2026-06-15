-- ============================================================================
-- Roll for Rating — Profile geography
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The geographic leaderboards (city / state / country / continent) only ever
-- derived location from a member's GYM, and almost no gym has that filled in —
-- so those boards were empty. Profiles already store `city`; this adds `state`
-- and `country` so a member's own location drives the boards (continent is
-- derived from country in the app). Gym location remains a fallback.
-- ============================================================================

alter table public.profiles add column if not exists state   text;
alter table public.profiles add column if not exists country text;

-- Let members set these on their own profile (column-level grant, like city).
grant update (state, country) on public.profiles to authenticated;

create index if not exists profiles_country_idx on public.profiles (lower(country));

select 'profile-geo-installed' as ok;
