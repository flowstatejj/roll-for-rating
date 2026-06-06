-- ============================================================================
-- Roll for Rating — Cap a single wager at 10% of the challenger's ROR
-- Run after match-waive-and-wager.sql. Safe to re-run.
--
-- Replaces the old "all-in" behaviour: you can stake at most 10% of your ROR on
-- one match (and still only against an opponent within 10% of your ROR).
-- ============================================================================
create or replace function public.enforce_wager_band()
returns trigger language plpgsql security definer set search_path = public as $$
declare c_rating integer; o_rating integer; cap integer;
begin
  if coalesce(new.wager, 0) > 0 then
    select rating into c_rating from public.profiles where id = new.challenger_id;
    select rating into o_rating from public.profiles where id = new.opponent_id;
    if c_rating is not null and o_rating is not null and abs(o_rating - c_rating) > 0.10 * c_rating then
      raise exception 'Wagers are only allowed against players within 10%% of your ROR.';
    end if;
    cap := floor(0.10 * coalesce(c_rating, 0));
    if new.wager > cap then
      raise exception 'Wagers are capped at 10%% of your ROR (max %).', cap;
    end if;
  end if;
  return new;
end; $$;
