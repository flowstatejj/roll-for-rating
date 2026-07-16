-- ============================================================================
-- Roll for Rating - Season points: exclude guest competitors
-- Run in the Supabase SQL editor AFTER seasons.sql AND leagues.sql. Safe to re-run.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS public.accrue_season_points. It supersedes the versions in
-- seasons.sql (base) and leagues.sql (adds the league exclusion). If either of
-- those files is ever re-run, re-run THIS file afterwards.
--
-- WHY: host-entered GUEST competitors (is_guest) are phantom profiles; a guest
-- winning a tournament bout must not accrue global season points, or the season
-- race fills with rows for accounts that are not real members. Everything else
-- (league matches excluded, +10 per decisive win to the winner) is unchanged
-- from the leagues.sql version.
-- ============================================================================

create or replace function public.accrue_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status = 'completed' and (old.status is distinct from new.status)
     and new.result <> 'draw' and new.winner_id is not null
     and new.league_id is null   -- league matches don't feed the global season
     and not exists (            -- guest winners don't either
       select 1 from public.profiles p
       where p.id = new.winner_id and coalesce(p.is_guest, false)
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
