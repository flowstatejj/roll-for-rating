-- ============================================================================
-- Roll for Rating — Referee rules for matches involving a minor
-- Run after managed-juniors.sql (re-declares enforce_minor_match). Safe to re-run.
--
-- Adds: a match involving a minor must be refereed by a BLUE BELT OR HIGHER who
-- is NOT a parent/guardian of either competitor. (The not-a-parent rule was
-- already enforced; this adds the belt floor.)
-- ============================================================================

create or replace function public.enforce_minor_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record; o record; rbelt public.belt_rank;
begin
  select is_minor, age_tier, consent_status, managed_by into c
    from public.profiles where id = new.challenger_id;
  select is_minor, age_tier, consent_status, managed_by into o
    from public.profiles where id = new.opponent_id;
  select belt_rank into rbelt from public.profiles where id = new.referee_id;

  -- A minor can't compete until consent is verified (managed juniors auto-verified).
  if c.is_minor and c.consent_status <> 'verified' then
    raise exception 'This account is pending parental consent and cannot start matches yet.';
  end if;
  if o.is_minor and o.consent_status <> 'verified' then
    raise exception 'That opponent''s account is pending parental consent and cannot be matched yet.';
  end if;

  -- Conflict of interest: a managing parent/guardian may not referee a match
  -- their own (or the opponent's) junior competes in.
  if new.referee_id = c.managed_by or new.referee_id = o.managed_by then
    raise exception 'A managing parent/guardian cannot referee their own junior''s match. Use a neutral referee.';
  end if;

  -- Matches involving a minor must be refereed by a blue belt or higher.
  -- (belt_rank enum is ordered white < blue < purple < brown < black.)
  if (c.is_minor or o.is_minor) and rbelt < 'blue' then
    raise exception 'Matches involving a minor must be refereed by a blue belt or higher.';
  end if;

  -- Wagering is adults-only (teens included).
  if c.is_minor or o.is_minor then
    new.wager := 0;
  end if;

  -- Under-14 (kid): never public, and can only face other minors.
  if c.age_tier = 'kid' or o.age_tier = 'kid' then
    new.is_public := false;
    if not (c.is_minor and o.is_minor) then
      raise exception 'Under-14 members can only be matched against other under-18 members.';
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_minor_match on public.matches;
create trigger trg_minor_match before insert on public.matches
  for each row execute function public.enforce_minor_match();
