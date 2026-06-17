-- ============================================================================
-- Roll for Rating — Belt-based starting rating
-- Run in the Supabase SQL editor (after schema.sql). Safe to re-run.
--
-- New accounts start at a rating seeded by the belt they sign up with:
--   black 2000 · brown 1600 · purple 1200 · blue 800 · white 400
-- Earned ratings are never touched — this only sets the INITIAL value.
-- ============================================================================

-- Starting rating for a belt.
create or replace function public.starting_rating(p_belt belt_rank)
returns integer language sql immutable as $$
  select case p_belt
    when 'black'  then 2000
    when 'brown'  then 1600
    when 'purple' then 1200
    when 'blue'   then 800
    when 'white'  then 400
    else 400
  end;
$$;

-- Seed a new profile's rating from its belt at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare v_belt belt_rank := coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white');
begin
  insert into public.profiles (id, username, display_name, belt_rank, rating)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    v_belt,
    public.starting_rating(v_belt)
  );
  return new;
end;
$$;

-- OPTIONAL backfill: fix EXISTING accounts that haven't competed yet (0 matches),
-- so current test / early accounts get the belt-based start. Skips anyone who has
-- already played, so no earned rating is ever reset. Delete this block if unwanted.
update public.profiles p
   set rating = public.starting_rating(p.belt_rank)
 where p.wins = 0 and p.losses = 0 and p.draws = 0
   and p.rating <> public.starting_rating(p.belt_rank);

select 'belt-starting-rating installed' as ok;
