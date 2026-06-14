-- ============================================================================
-- Roll for Rating — Tournament location
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Adds a free-text city to tournaments so they're findable by location, the
-- same way leagues, gyms and open mats already are. Indexed on lower(city)
-- for case-insensitive search.
-- ============================================================================

alter table public.tournaments add column if not exists city text;
create index if not exists tournaments_city_idx on public.tournaments (lower(city));

select 'tournament-location-installed' as ok;
