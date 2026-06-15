-- ============================================================================
-- Roll for Rating — Non-referee result reporting + disputes
-- Run in the Supabase SQL editor (after match-waive-and-wager.sql).
-- NOTE: run the ALTER TYPE (step 1) on its own first — a new enum value can't be
-- used in the same transaction that adds it. Then run the rest. Safe to re-run.
--
-- Waived (no-referee) matches: each competitor reports who won + the submission.
-- If both reports agree (winner AND submission) the match settles normally; if
-- anything differs it becomes 'disputed' and the admins are notified to review
-- the video and set the official result. Referee'd matches are unchanged.
-- ============================================================================

-- Step 1 (run alone):
alter type match_status add value if not exists 'disputed';

-- ---------------------------------------------------------------------------
-- Step 2 (run after step 1 has committed):
-- ---------------------------------------------------------------------------
create table if not exists public.match_reports (
  match_id        uuid not null references public.matches(id) on delete cascade,
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  winner_id       uuid references public.profiles(id),       -- null = draw
  result          result_type not null,
  submission_type text,
  method          text,
  created_at      timestamptz not null default now(),
  primary key (match_id, reporter_id)
);
alter table public.match_reports enable row level security;
drop policy if exists "match_reports_read" on public.match_reports;
create policy "match_reports_read" on public.match_reports for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.matches m where m.id = match_id and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
  ));

-- A competitor reports their version of a waived match's result.
create or replace function public.report_match_result(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_submission_type text default null, p_method text default null, p_notes text default null
) returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; n_videos int; r1 public.match_reports; r2 public.match_reports;
        agree boolean; cname text; oname text;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if not m.referee_waived then raise exception 'A referee scores this match.'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id) then raise exception 'Only a competitor can report this match.'; end if;
  if m.status not in ('pending_referee', 'pending_confirmation') then raise exception 'This match is not open for reporting.'; end if;
  select count(*) into n_videos from public.match_videos where match_id = m.id;
  if n_videos = 0 then raise exception 'A video of the match is required to report it without a referee.'; end if;

  insert into public.match_reports (match_id, reporter_id, winner_id, result, submission_type, method)
  values (p_match_id, auth.uid(), p_winner_id, p_result, nullif(btrim(p_submission_type), ''), nullif(btrim(p_method), ''))
  on conflict (match_id, reporter_id) do update
    set winner_id = excluded.winner_id, result = excluded.result,
        submission_type = excluded.submission_type, method = excluded.method, created_at = now();

  select * into r1 from public.match_reports where match_id = m.id and reporter_id = m.challenger_id;
  select * into r2 from public.match_reports where match_id = m.id and reporter_id = m.opponent_id;

  -- Only one competitor has reported so far — wait for the other.
  if r1.match_id is null or r2.match_id is null then
    update public.matches set status = 'pending_confirmation' where id = m.id returning * into m;
    return m;
  end if;

  -- Both reported. Agreement requires the same winner AND the same submission.
  agree := (r1.winner_id is not distinct from r2.winner_id)
       and (lower(coalesce(r1.submission_type, '')) = lower(coalesce(r2.submission_type, '')));

  if agree then
    m := public._settle_match(m.id, r1.winner_id, r1.result, coalesce(r1.method, r2.method), p_notes);
    update public.matches set submission_type = r1.submission_type where id = m.id returning * into m;
    return m;
  end if;

  -- Conflict → dispute. Keep the video as evidence; notify every admin.
  update public.matches set status = 'disputed', result_proposed_by = null where id = m.id returning * into m;
  select display_name into cname from public.profiles where id = m.challenger_id;
  select display_name into oname from public.profiles where id = m.opponent_id;
  insert into public.notifications (user_id, type, title, body, data, match_id)
  select p.id, 'match_disputed', 'Match dispute',
         cname || ' vs ' || oname || ' — the reported results conflict. Review the video.',
         jsonb_build_object('k', 'match.disputed'), m.id
  from public.profiles p where p.is_admin;
  return m;
end; $$;
grant execute on function public.report_match_result(uuid, uuid, result_type, text, text, text) to authenticated;

-- Disputed matches for the admin screen: both reports + names + video count.
create or replace function public.admin_disputes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(d), '[]'::jsonb) from (
    select jsonb_build_object(
      'match_id', m.id,
      'created_at', m.created_at,
      'challenger', jsonb_build_object('id', m.challenger_id, 'name', cp.display_name),
      'opponent',   jsonb_build_object('id', m.opponent_id,  'name', op.display_name),
      'video_count', (select count(*) from public.match_videos v where v.match_id = m.id),
      'reports', (select jsonb_agg(jsonb_build_object(
                    'reporter_id', r.reporter_id, 'winner_id', r.winner_id, 'result', r.result,
                    'submission_type', r.submission_type, 'method', r.method))
                  from public.match_reports r where r.match_id = m.id)
    ) as d
    from public.matches m
    join public.profiles cp on cp.id = m.challenger_id
    join public.profiles op on op.id = m.opponent_id
    where m.status = 'disputed' and public.is_admin()
    order by m.created_at desc
  ) q;
$$;
grant execute on function public.admin_disputes() to authenticated;

-- Admin sets the official result on a disputed match (applies ratings).
create or replace function public.admin_resolve_dispute(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_submission_type text default null, p_method text default null
) returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'disputed' then raise exception 'This match is not disputed.'; end if;
  m := public._settle_match(m.id, p_winner_id, p_result, p_method, null);
  update public.matches set submission_type = nullif(btrim(p_submission_type), '') where id = m.id returning * into m;
  return m;
end; $$;
grant execute on function public.admin_resolve_dispute(uuid, uuid, result_type, text, text) to authenticated;

select 'match-disputes-installed' as ok;
