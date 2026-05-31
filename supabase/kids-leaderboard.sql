-- ============================================================================
-- Roll for Rating — 13-and-under leaderboard
-- Run after managed-juniors.sql. Safe to re-run.
--
-- A GLOBAL ranking of under-14 members that exposes ONLY a first name + rating.
-- Full kid profiles stay private (the profiles RLS is unchanged) — this
-- SECURITY DEFINER function returns just a sanitized projection. No id, no
-- username, no last name, no gym, no photo, so a child can't be identified,
-- searched, or contacted from the board. Only kids who have actually competed
-- (>= 1 recorded match) are listed.
--
-- VISIBILITY: only returns rows to MINOR accounts (teens) and to adults who
-- manage at least one junior (parents/guardians). Unrelated adults get nothing.
-- ============================================================================

create or replace function public.kids_leaderboard(p_limit int default 100)
returns table(rank bigint, first_name text, rating integer)
language sql stable security definer set search_path = public as $$
  with viewer as (
    select
      pr.age_tier,
      exists (select 1 from public.profiles j where j.managed_by = auth.uid()) as is_guardian
    from public.profiles pr
    where pr.id = auth.uid()
  )
  select
    row_number() over (order by p.rating desc, p.created_at asc) as rank,
    split_part(p.display_name, ' ', 1) as first_name,
    p.rating
  from public.profiles p
  where p.age_tier = 'kid'
    and (p.wins + p.losses + p.draws) > 0
    -- gate: caller must be a minor, or a guardian who manages a junior
    and coalesce((select (v.age_tier <> 'adult') or v.is_guardian from viewer v), false)
  order by p.rating desc, p.created_at asc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.kids_leaderboard(int) from public, anon;
grant execute on function public.kids_leaderboard(int) to authenticated;
