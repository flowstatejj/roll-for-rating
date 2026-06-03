-- ============================================================================
-- Roll for Rating — Daily activity streak + weekly Quests
-- Run in the Supabase SQL Editor (after schema.sql + puzzles.sql). Re-runnable.
-- ============================================================================

alter table public.profiles add column if not exists last_active_date date;
alter table public.profiles add column if not exists activity_streak integer not null default 0;

-- Call on app open: bump the daily streak (or reset if a day was missed).
create or replace function public.ping_activity()
returns integer language plpgsql security definer set search_path = public as $$
declare la date; s integer;
begin
  select last_active_date, activity_streak into la, s from public.profiles where id = auth.uid();
  if la = current_date then
    return coalesce(s, 0);
  elsif la = current_date - 1 then
    s := coalesce(s, 0) + 1;
  else
    s := 1;
  end if;
  update public.profiles set last_active_date = current_date, activity_streak = s where id = auth.uid();
  return s;
end; $$;

-- ---------------------------------------------------------------------------
-- Weekly quests
-- ---------------------------------------------------------------------------
create table if not exists public.quest_claims (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  quest_key  text not null,
  period_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, quest_key, period_key)
);
alter table public.quest_claims enable row level security;
drop policy if exists "quest_claims_read_own" on public.quest_claims;
create policy "quest_claims_read_own" on public.quest_claims for select to authenticated using (user_id = auth.uid());

-- Progress + claimed-state for all quests this week.
create or replace function public.quest_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk timestamptz := date_trunc('week', now());
  period text := to_char(date_trunc('week', now()), 'IYYY-IW');
  w2 integer; p5 integer; pub1 integer; f1 integer;
begin
  select count(*) into w2 from public.matches where status = 'completed' and winner_id = uid and completed_at >= wk;
  select count(*) into p5 from public.puzzle_attempts where user_id = uid and is_correct and created_at >= wk;
  select count(*) into pub1 from public.matches where status = 'completed' and is_public and completed_at >= wk and (challenger_id = uid or opponent_id = uid);
  select count(*) into f1 from public.matches where status = 'completed' and winner_id = uid and result = 'submission' and completed_at >= wk;
  return jsonb_build_array(
    jsonb_build_object('key','wins2','title','Win 2 matches','progress',w2,'target',2,'reward',20,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='wins2' and period_key=period)),
    jsonb_build_object('key','puzzles5','title','Solve 5 puzzles','progress',p5,'target',5,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='puzzles5' and period_key=period)),
    jsonb_build_object('key','public1','title','Compete in a public match','progress',pub1,'target',1,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='public1' and period_key=period)),
    jsonb_build_object('key','finish1','title','Win by submission','progress',f1,'target',1,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='finish1' and period_key=period))
  );
end; $$;

-- Claim a completed quest's reward (server re-verifies progress).
create or replace function public.claim_quest(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk timestamptz := date_trunc('week', now());
  period text := to_char(date_trunc('week', now()), 'IYYY-IW');
  progress integer; target integer; reward integer;
begin
  if exists(select 1 from public.quest_claims where user_id=uid and quest_key=p_key and period_key=period) then
    return jsonb_build_object('ok', false, 'reason', 'Already claimed this week');
  end if;
  if p_key = 'wins2' then target:=2; reward:=20;
    select count(*) into progress from public.matches where status='completed' and winner_id=uid and completed_at>=wk;
  elsif p_key = 'puzzles5' then target:=5; reward:=15;
    select count(*) into progress from public.puzzle_attempts where user_id=uid and is_correct and created_at>=wk;
  elsif p_key = 'public1' then target:=1; reward:=15;
    select count(*) into progress from public.matches where status='completed' and is_public and completed_at>=wk and (challenger_id=uid or opponent_id=uid);
  elsif p_key = 'finish1' then target:=1; reward:=15;
    select count(*) into progress from public.matches where status='completed' and winner_id=uid and result='submission' and completed_at>=wk;
  else
    raise exception 'Unknown quest';
  end if;
  if progress < target then
    return jsonb_build_object('ok', false, 'reason', 'Not complete yet');
  end if;
  insert into public.quest_claims(user_id, quest_key, period_key) values (uid, p_key, period);
  update public.profiles set rating = rating + reward where id = uid;
  return jsonb_build_object('ok', true, 'reward', reward, 'new_rating', (select rating from public.profiles where id = uid));
end; $$;
