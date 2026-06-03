-- ============================================================================
-- Rollr — Submission Hunt (collect submission types for bonus Elo)
-- Run in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

-- The canonical submission the referee picks for a finish.
alter table public.matches add column if not exists submission_type text;

-- Referee tags the finish type after recording the result.
create or replace function public.set_submission_type(p_match_id uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if m.referee_id <> auth.uid() then raise exception 'Only the referee can tag the finish'; end if;
  update public.matches set submission_type = nullif(trim(p_type), '') where id = p_match_id;
end; $$;

-- One row per submission type a user has already been rewarded for.
create table if not exists public.submission_rewards (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  submission_type text not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, submission_type)
);
alter table public.submission_rewards enable row level security;
drop policy if exists "submission_rewards_read_own" on public.submission_rewards;
create policy "submission_rewards_read_own" on public.submission_rewards for select to authenticated using (user_id = auth.uid());

-- Grant +15 Elo for each NEW submission type the user has won with.
create or replace function public.claim_submission_rewards()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bonus  constant integer := 15;
  rec    record;
  gained integer := 0;
  claimed text[] := '{}';
begin
  for rec in
    select distinct m.submission_type as st
    from public.matches m
    where m.status = 'completed'
      and m.winner_id = auth.uid()
      and m.submission_type is not null
      and not exists (
        select 1 from public.submission_rewards r
        where r.user_id = auth.uid() and r.submission_type = m.submission_type
      )
  loop
    insert into public.submission_rewards (user_id, submission_type) values (auth.uid(), rec.st)
      on conflict do nothing;
    gained := gained + bonus;
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
