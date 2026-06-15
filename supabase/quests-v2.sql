-- ============================================================================
-- Roll for Rating — Quests v2: roll streaks + submission hunter challenges
-- Run in the Supabase SQL editor (after daily-quests.sql + submission-values.sql).
-- Safe to re-run. Replaces quest_status / claim_quest with the expanded set.
--
-- Removes the daily-login streak from the quest experience; adds weekly "rolled
-- for rating" streak milestones (10/20/30/40 weeks + all-year=52) and rolling-
-- window hunter challenges (all leg locks / all chokes in 30d, all triangles in
-- 7d). New quests are ONE-TIME (period_key = 'once'); the original four stay
-- weekly. Reward range 10-20, except the year-long streak (100).
-- ============================================================================

-- Tag each submission with its category so hunter quests can count by group.
alter table public.submission_values add column if not exists category text;
update public.submission_values set category = 'choke' where name in (
  'Rear naked choke','Guillotine','Arm-in guillotine','Mounted triangle','Side triangle',
  'Reverse triangle','Inverted triangle','Ezekiel','Bow and arrow','Cross collar','Clock choke',
  'Loop choke','Baseball bat choke','Paper cutter','Arm triangle','D''Arce/Brabo','Anaconda',
  'North-south','Peruvian necktie','Japanese necktie','Von Flue','Bulldog','Gogoplata','Buggy choke',
  'Murder choke','Smother','Mother''s milk','Short choke');
update public.submission_values set category = 'arm' where name in (
  'Armbar','Kimura','Americana','Omoplata','Monoplata','Bicep slicer','Wrist lock','Thunder lock',
  'Violin armbar','Shotgun armbar','Choi bar','Straight arm lock','Reverse omoplata');
update public.submission_values set category = 'leg' where name in (
  'Straight ankle lock','Kneebar','Toe hold','Heel hook','Calf slicer','Aoki lock','Z-lock',
  'Banana split/electric chair','Woj lock','Texas cloverleaf','Mikey lock');
update public.submission_values set category = 'spine' where name in ('Twister');

-- Current consecutive-week "rolled for rating" streak (a week counts if you
-- finished >=1 match). Anchored at the current week, or the previous week if the
-- current one isn't active yet (so a streak isn't "broken" mid-week).
create or replace function public.weekly_roll_streak(p_uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  with weeks as (
    select distinct date_trunc('week', completed_at) as wk
    from public.matches
    where status = 'completed' and completed_at is not null
      and (challenger_id = p_uid or opponent_id = p_uid)
  ),
  anchor as (
    select case
      when exists (select 1 from weeks where wk = date_trunc('week', now())) then date_trunc('week', now())
      when exists (select 1 from weeks where wk = date_trunc('week', now()) - interval '1 week') then date_trunc('week', now()) - interval '1 week'
      else null end as a
  ),
  gaps as (
    select g.i
    from generate_series(0, 60) as g(i)
    where (select a from anchor) is not null
      and not exists (select 1 from weeks w where w.wk = (select a from anchor) - (g.i || ' weeks')::interval)
  )
  select case when (select a from anchor) is null then 0
              else coalesce((select min(i) from gaps), 61) end;
$$;
grant execute on function public.weekly_roll_streak(uuid) to authenticated;

-- Distinct submissions in a category the caller has won with inside a window.
create or replace function public.hunter_progress(p_uid uuid, p_category text, p_days integer)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct m.submission_type)::integer
  from public.matches m
  where m.status = 'completed' and m.winner_id = p_uid and m.submission_type is not null
    and m.completed_at >= now() - (p_days || ' days')::interval
    and m.submission_type in (select name from public.submission_values where category = p_category);
$$;
grant execute on function public.hunter_progress(uuid, text, integer) to authenticated;

-- Triangle set for Shape Shifter (the 4 positional triangles).
create or replace function public.triangle_progress(p_uid uuid, p_days integer)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct m.submission_type)::integer
  from public.matches m
  where m.status = 'completed' and m.winner_id = p_uid and m.submission_type is not null
    and m.completed_at >= now() - (p_days || ' days')::interval
    and m.submission_type in ('Mounted triangle','Side triangle','Reverse triangle','Inverted triangle');
$$;
grant execute on function public.triangle_progress(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- quest_status — weekly tasks + one-time challenges
-- ---------------------------------------------------------------------------
create or replace function public.quest_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk timestamptz := date_trunc('week', now());
  wkp text := to_char(date_trunc('week', now()), 'IYYY-IW');
  w2 integer; pub1 integer; f1 integer;
  strk integer; legc integer; chokec integer; tric integer;
  legtot integer; choketot integer;
begin
  select count(*) into w2 from public.matches where status='completed' and winner_id=uid and completed_at>=wk;
  select count(*) into pub1 from public.matches where status='completed' and is_public and completed_at>=wk and (challenger_id=uid or opponent_id=uid);
  select count(*) into f1 from public.matches where status='completed' and winner_id=uid and result='submission' and completed_at>=wk;
  strk := public.weekly_roll_streak(uid);
  legc := public.hunter_progress(uid, 'leg', 30);
  chokec := public.hunter_progress(uid, 'choke', 30);
  tric := public.triangle_progress(uid, 7);
  select count(*) into legtot from public.submission_values where category='leg';
  select count(*) into choketot from public.submission_values where category='choke';

  return jsonb_build_array(
    -- Weekly tasks (repeat each week)
    jsonb_build_object('key','wins2','period','week','title','Win 2 matches','progress',w2,'target',2,'reward',20,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='wins2' and period_key=wkp)),
    jsonb_build_object('key','public1','period','week','title','Compete in a public match','progress',pub1,'target',1,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='public1' and period_key=wkp)),
    jsonb_build_object('key','finish1','period','week','title','Win by submission','progress',f1,'target',1,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='finish1' and period_key=wkp)),
    -- One-time challenges (period 'once')
    jsonb_build_object('key','shapeShifter','period','once','title','Shape Shifter — all triangles in 7 days','progress',tric,'target',4,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='shapeShifter' and period_key='once')),
    jsonb_build_object('key','legHunter','period','once','title','Leg Hunter — all leg locks in 30 days','progress',legc,'target',legtot,'reward',18,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='legHunter' and period_key='once')),
    jsonb_build_object('key','headHunter','period','once','title','Head Hunter — all chokes in 30 days','progress',chokec,'target',choketot,'reward',20,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='headHunter' and period_key='once')),
    jsonb_build_object('key','streak10','period','once','title','Rolled 10 weeks in a row','progress',least(strk,10),'target',10,'reward',10,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak10' and period_key='once')),
    jsonb_build_object('key','streak20','period','once','title','Rolled 20 weeks in a row','progress',least(strk,20),'target',20,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak20' and period_key='once')),
    jsonb_build_object('key','streak30','period','once','title','Rolled 30 weeks in a row','progress',least(strk,30),'target',30,'reward',15,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak30' and period_key='once')),
    jsonb_build_object('key','streak40','period','once','title','Rolled 40 weeks in a row','progress',least(strk,40),'target',40,'reward',20,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak40' and period_key='once')),
    jsonb_build_object('key','streak52','period','once','title','All Year — rolled 52 weeks in a row','progress',least(strk,52),'target',52,'reward',100,
      'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak52' and period_key='once'))
  );
end; $$;

-- ---------------------------------------------------------------------------
-- claim_quest — re-verify + award (weekly keys are weekly, the rest one-time)
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk timestamptz := date_trunc('week', now());
  period text;
  progress integer; target integer; reward integer;
begin
  if p_key in ('wins2','public1','finish1') then
    period := to_char(date_trunc('week', now()), 'IYYY-IW');
  else
    period := 'once';
  end if;

  if exists (select 1 from public.quest_claims where user_id=uid and quest_key=p_key and period_key=period) then
    return jsonb_build_object('ok', false, 'reason', 'Already claimed');
  end if;

  if p_key='wins2' then target:=2; reward:=20;
    select count(*) into progress from public.matches where status='completed' and winner_id=uid and completed_at>=wk;
  elsif p_key='puzzles5' then target:=5; reward:=15;
    select count(*) into progress from public.puzzle_attempts where user_id=uid and is_correct and created_at>=wk;
  elsif p_key='public1' then target:=1; reward:=15;
    select count(*) into progress from public.matches where status='completed' and is_public and completed_at>=wk and (challenger_id=uid or opponent_id=uid);
  elsif p_key='finish1' then target:=1; reward:=15;
    select count(*) into progress from public.matches where status='completed' and winner_id=uid and result='submission' and completed_at>=wk;
  elsif p_key='shapeShifter' then target:=4; reward:=15; progress:=public.triangle_progress(uid,7);
  elsif p_key='legHunter' then reward:=18; select count(*) into target from public.submission_values where category='leg'; progress:=public.hunter_progress(uid,'leg',30);
  elsif p_key='headHunter' then reward:=20; select count(*) into target from public.submission_values where category='choke'; progress:=public.hunter_progress(uid,'choke',30);
  elsif p_key='streak10' then target:=10; reward:=10; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak20' then target:=20; reward:=15; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak30' then target:=30; reward:=15; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak40' then target:=40; reward:=20; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak52' then target:=52; reward:=100; progress:=public.weekly_roll_streak(uid);
  else raise exception 'Unknown quest';
  end if;

  if progress < target then
    return jsonb_build_object('ok', false, 'reason', 'Not complete yet');
  end if;
  insert into public.quest_claims(user_id, quest_key, period_key) values (uid, p_key, period);
  update public.profiles set rating = rating + reward where id = uid;
  return jsonb_build_object('ok', true, 'reward', reward, 'new_rating', (select rating from public.profiles where id = uid));
end; $$;

select 'quests-v2-installed' as ok;
