-- ============================================================================
-- Roll for Rating — Submission Hunt eligibility
-- Run in the Supabase SQL editor (after submission-values.sql). Safe to re-run.
--
-- Two rules:
--  1) A win only counts toward a badge if the LOSER's rating was within 25% of
--     the winner's (loser >= winner * 0.75) — no farming weak newbies. Beating
--     someone stronger always counts. Uses match-time rating snapshots, falling
--     back to current ratings when a snapshot is missing.
--  2) Each badge is one-time per account (enforced by submission_rewards' PK).
-- ============================================================================

-- Eligible (gated) submission wins for the caller, plus which are already rewarded.
create or replace function public.my_submission_collection()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'won', coalesce((
      select to_jsonb(array_agg(distinct st)) from (
        select m.submission_type as st
        from public.matches m
        join public.profiles wp on wp.id = m.winner_id
        join public.profiles lp on lp.id = case when m.winner_id = m.challenger_id
                                                 then m.opponent_id else m.challenger_id end
        where m.status = 'completed'
          and m.winner_id = auth.uid()
          and m.submission_type is not null
          and coalesce(case when m.winner_id = m.challenger_id
                            then m.opponent_rating_before else m.challenger_rating_before end, lp.rating)
              >= coalesce(case when m.winner_id = m.challenger_id
                               then m.challenger_rating_before else m.opponent_rating_before end, wp.rating) * 0.75
      ) q
    ), '[]'::jsonb),
    'rewarded', coalesce((
      select to_jsonb(array_agg(submission_type))
      from public.submission_rewards where user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.my_submission_collection() to authenticated;

-- Claim: award each NEW eligible submission's own RoR value (one-time per account).
create or replace function public.claim_submission_rewards()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec    record;
  gained integer := 0;
  claimed text[] := '{}';
begin
  for rec in
    select distinct m.submission_type as st
    from public.matches m
    join public.profiles wp on wp.id = m.winner_id
    join public.profiles lp on lp.id = case when m.winner_id = m.challenger_id
                                             then m.opponent_id else m.challenger_id end
    where m.status = 'completed'
      and m.winner_id = auth.uid()
      and m.submission_type is not null
      and coalesce(case when m.winner_id = m.challenger_id
                        then m.opponent_rating_before else m.challenger_rating_before end, lp.rating)
          >= coalesce(case when m.winner_id = m.challenger_id
                           then m.challenger_rating_before else m.opponent_rating_before end, wp.rating) * 0.75
      and not exists (
        select 1 from public.submission_rewards r
        where r.user_id = auth.uid() and r.submission_type = m.submission_type
      )
  loop
    insert into public.submission_rewards (user_id, submission_type) values (auth.uid(), rec.st)
      on conflict do nothing;
    gained := gained + coalesce((select ror from public.submission_values where name = rec.st), 15);
    claimed := array_append(claimed, rec.st);
  end loop;

  if gained > 0 then
    update public.profiles set rating = rating + gained where id = auth.uid();
  end if;

  return jsonb_build_object(
    'gained', gained,
    'claimed', to_jsonb(claimed),
    'new_rating', (select rating from public.profiles where id = auth.uid())
  );
end; $$;

select 'submission-eligibility-installed' as ok;
