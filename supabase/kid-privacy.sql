-- ============================================================================
-- Roll for Rating — 13-and-under privacy hardening
-- Run after managed-juniors.sql. Safe to re-run.
--
-- Guarantees a managed junior's record holds NO identifying last name: the
-- profile trigger reduces a junior's display_name to a first name only, on
-- every insert/update, and existing juniors are backfilled. Combined with:
-- kids are never public, never searchable, never on the Overall board / Watch
-- feed, and the 13-&-under board + challenges only ever expose a first name.
-- (birthdate is kept only for age-gating and is never displayed.)
-- ============================================================================

create or replace function public.enforce_minor_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.age_tier := public.tier_for(new.birthdate);
  new.is_minor := new.age_tier <> 'adult';

  if new.managed_by is not null then
    -- Managed junior: keep FIRST NAME ONLY; consent is inherent (guardian holds it).
    new.display_name := coalesce(nullif(split_part(trim(coalesce(new.display_name, '')), ' ', 1), ''), 'Junior');
    new.consent_status := 'verified';
  elsif tg_op = 'INSERT' then
    if new.is_minor then
      if coalesce(new.consent_status, 'not_required') = 'not_required' then
        new.consent_status := 'pending';
      end if;
    else
      new.consent_status := 'not_required';
    end if;
  else
    if not new.is_minor then
      new.consent_status := 'not_required';
    elsif new.consent_status is null then
      new.consent_status := 'pending';
    end if;
  end if;

  if new.age_tier = 'kid' or (new.is_minor and new.consent_status <> 'verified') then
    new.open_for_challenge := false;
  end if;

  return new;
end; $$;
drop trigger if exists trg_minor_profile on public.profiles;
create trigger trg_minor_profile before insert or update on public.profiles
  for each row execute function public.enforce_minor_profile();

-- Backfill: reduce any existing managed-junior names to first name only.
update public.profiles
   set display_name = coalesce(nullif(split_part(trim(display_name), ' ', 1), ''), 'Junior')
 where managed_by is not null;
