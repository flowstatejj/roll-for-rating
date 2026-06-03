-- ============================================================================
-- Roll for Rating — Open Mat location filtering (city / state / country)
-- Adds state + country to open_mats, keeps them in sync with the linked gym,
-- backfills existing rows, and indexes the columns for fast filtering at scale.
-- Run in the Supabase SQL Editor (after social.sql + geo-leaderboard.sql).
-- Safe to re-run.
-- ============================================================================

alter table public.open_mats add column if not exists state   text;
alter table public.open_mats add column if not exists country text;

-- Keep an open mat's location in sync with its linked gym. A poster can still
-- override any field (a one-off mat at a different venue); we only fill blanks.
create or replace function public.open_mats_fill_geo()
returns trigger language plpgsql as $$
declare g record;
begin
  if new.gym_id is not null then
    select city, state, country into g from public.gyms where id = new.gym_id;
    if found then
      new.city    := coalesce(nullif(btrim(new.city), ''),    g.city);
      new.state   := coalesce(nullif(btrim(new.state), ''),   g.state);
      new.country := coalesce(nullif(btrim(new.country), ''), g.country);
    end if;
  end if;
  -- Normalize empty strings to NULL so filters/indexes stay clean.
  new.city    := nullif(btrim(new.city), '');
  new.state   := nullif(btrim(new.state), '');
  new.country := nullif(btrim(new.country), '');
  return new;
end; $$;

drop trigger if exists trg_open_mats_fill_geo on public.open_mats;
create trigger trg_open_mats_fill_geo
  before insert or update on public.open_mats
  for each row execute function public.open_mats_fill_geo();

-- Backfill existing gym-linked mats from their gym.
update public.open_mats o set
  city    = coalesce(nullif(btrim(o.city), ''),    g.city),
  state   = coalesce(nullif(btrim(o.state), ''),   g.state),
  country = coalesce(nullif(btrim(o.country), ''), g.country)
from public.gyms g
where o.gym_id = g.id;

-- Case-insensitive indexes for the location filters.
create index if not exists open_mats_country_idx on public.open_mats (lower(country));
create index if not exists open_mats_state_idx   on public.open_mats (lower(state));
create index if not exists open_mats_city_idx    on public.open_mats (lower(city));
