-- ============================================================================
-- Roll for Rating - trigram indexes for ILIKE search (100k audit, Tier 2)
-- Purely additive: new extension + new indexes only. No RLS, function, or
-- client changes - zero behavior change, only query speed. Safe to re-run.
--
-- The app searches several columns with ILIKE (some wildcarded '%q%', some
-- exact-match case-insensitive filters from dropdowns). Postgres does NOT use
-- a plain btree - or even an existing functional lower(col) index - to satisfy
-- an ILIKE predicate; only a trigram (pg_trgm) GIN index does, and it covers
-- BOTH exact-match and wildcard ILIKE through the same operator class. So the
-- existing lower(city)-style btree indexes on gyms/open_mats/tournaments are
-- dead weight for the actual queries the app runs (left in place - harmless,
-- and useful if anything ever does a real equality lookup).
-- ============================================================================
create extension if not exists pg_trgm;

-- profiles: searchProfiles (username/display_name, matches.ts) + open-challenger
-- city filter (social.ts) + champion city lookup (titles.ts).
create index if not exists idx_profiles_username_trgm      on public.profiles using gin (username gin_trgm_ops);
create index if not exists idx_profiles_display_name_trgm  on public.profiles using gin (display_name gin_trgm_ops);
create index if not exists idx_profiles_city_trgm          on public.profiles using gin (city gin_trgm_ops);

-- gyms: fetchGyms search (name + city).
create index if not exists idx_gyms_name_trgm on public.gyms using gin (name gin_trgm_ops);
create index if not exists idx_gyms_city_trgm on public.gyms using gin (city gin_trgm_ops);

-- open_mats: fetchOpenMats search (title/address) + exact-match location filters.
create index if not exists idx_open_mats_title_trgm   on public.open_mats using gin (title gin_trgm_ops);
create index if not exists idx_open_mats_address_trgm on public.open_mats using gin (address gin_trgm_ops);
create index if not exists idx_open_mats_city_trgm    on public.open_mats using gin (city gin_trgm_ops);
create index if not exists idx_open_mats_state_trgm   on public.open_mats using gin (state gin_trgm_ops);
create index if not exists idx_open_mats_country_trgm on public.open_mats using gin (country gin_trgm_ops);

-- leagues: fetchOpenLeagues city filter (no index at all previously).
create index if not exists idx_leagues_city_trgm on public.leagues using gin (city gin_trgm_ops);

-- tournaments: fetchTournaments city filter.
create index if not exists idx_tournaments_city_trgm on public.tournaments using gin (city gin_trgm_ops);
