-- ============================================================================
-- Roll for Rating — "Biggest Pots" leaderboard (Elo won via wagers)
-- Run after challenges.sql. Safe to re-run.
-- ============================================================================
create or replace function public.wager_leaderboard(p_limit integer default 50)
returns table (
  user_id      uuid,
  display_name text,
  belt_rank    belt_rank,
  rating       integer,
  pot_won      bigint,
  wagered_wins bigint
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.display_name, p.belt_rank, p.rating,
         coalesce(sum(m.wager), 0)::bigint as pot_won,
         count(*)::bigint as wagered_wins
  from public.matches m
  join public.profiles p on p.id = m.winner_id
  where m.status = 'completed' and m.wager > 0 and m.winner_id is not null
  group by p.id, p.display_name, p.belt_rank, p.rating
  order by pot_won desc
  limit p_limit;
$$;
