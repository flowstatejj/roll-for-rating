-- ============================================================================
-- Roll for Rating — Competition record: one update per source per 30 days
-- Run AFTER competitions.sql. Safe to re-run.
--
-- Records are now read automatically from the athlete's profile link (no manual
-- W/L entry), and a member can refresh a given source's record at most once a
-- month. Re-importing the same source still REPLACES the previous contribution;
-- the 30-day window just stops repeated refreshes / rating churn.
-- ============================================================================

create or replace function public.import_competition_record(
  p_source comp_source,
  p_profile_url text,
  p_wins integer,
  p_losses integer,
  p_verified boolean default false
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  win_pts  constant integer := 15;
  loss_pts constant integer := 10;
  prev     public.competition_records;
  delta    integer;
  new_rating integer;
begin
  if p_wins < 0 or p_losses < 0 then raise exception 'Wins/losses cannot be negative'; end if;

  select * into prev from public.competition_records
   where user_id = auth.uid() and source = p_source
   order by created_at desc limit 1;

  -- One update per source per 30 days.
  if found and prev.created_at > now() - interval '30 days' then
    raise exception 'You can update your % record once a month. Next update available %.',
      p_source, to_char((prev.created_at + interval '30 days') at time zone 'UTC', 'Mon DD');
  end if;

  -- Undo any previous import from this source so re-importing refreshes it.
  if found then
    update public.profiles
       set rating = rating - prev.rating_delta,
           wins   = greatest(0, wins - prev.wins),
           losses = greatest(0, losses - prev.losses)
     where id = auth.uid();
    delete from public.competition_records where id = prev.id;
  end if;

  delta := p_wins * win_pts - p_losses * loss_pts;

  update public.profiles
     set rating = rating + delta,
         wins   = wins + p_wins,
         losses = losses + p_losses
   where id = auth.uid()
   returning rating into new_rating;

  insert into public.competition_records (user_id, source, profile_url, wins, losses, verified, rating_delta)
  values (auth.uid(), p_source, p_profile_url, p_wins, p_losses, p_verified, delta);

  return jsonb_build_object(
    'source', p_source,
    'wins', p_wins,
    'losses', p_losses,
    'rating_delta', delta,
    'new_rating', new_rating
  );
end;
$$;

notify pgrst, 'reload schema';
select 'competition-rate-limit installed' as ok;
