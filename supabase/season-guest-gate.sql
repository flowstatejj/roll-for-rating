-- ============================================================================
-- Roll for Rating - Season points: exclude guests + keep both existing exclusions
-- Run in the Supabase SQL editor AFTER seasons.sql, leagues.sql AND
-- tournaments-pro.sql. Safe to re-run.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS public.accrue_season_points. THREE other files also define it
-- and would silently clobber this version if re-run:
--   seasons.sql          (base: every decisive win accrues)
--   leagues.sql          (adds: league matches excluded)
--   tournaments-pro.sql  (adds: tournament matches excluded - 'keep season race clean')
-- If ANY of those is ever re-run, re-run THIS file afterwards.
--
-- This version is the UNION of every prior exclusion plus the guest gate:
--   * league matches never accrue          (leagues.sql behavior, kept)
--   * tournament matches never accrue      (tournaments-pro.sql behavior, kept)
--   * matches involving a GUEST competitor never accrue (new): guests are
--     phantom profiles - a guest must not earn points, and a member must not be
--     able to farm points off self-created guests. Mirrors _settle_match's
--     either-participant is_guest -> casual rule.
-- ============================================================================

create or replace function public.accrue_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status = 'completed' and (old.status is distinct from new.status)
     and new.result <> 'draw' and new.winner_id is not null
     and new.league_id is null       -- league matches don't feed the global season
     and new.tournament_id is null   -- tournament bouts don't either (keep the race clean)
     and not exists (                -- nor does anything involving a guest
       select 1 from public.profiles p
       where p.id in (new.challenger_id, new.opponent_id) and coalesce(p.is_guest, false)
     ) then
    sid := public.current_season();
    if sid is not null then
      insert into public.season_scores (season_id, user_id, points, wins)
      values (sid, new.winner_id, 10, 1)
      on conflict (season_id, user_id)
        do update set points = public.season_scores.points + 10, wins = public.season_scores.wins + 1;
    end if;
  end if;
  return new;
end; $$;

-- Clean out any phantom rows already accrued by guest wins (demo tournaments).
delete from public.season_scores ss
using public.profiles p
where p.id = ss.user_id and coalesce(p.is_guest, false);

notify pgrst, 'reload schema';
select 'season guest gate installed' as ok;
