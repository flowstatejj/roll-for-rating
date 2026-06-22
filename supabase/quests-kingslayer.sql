-- ============================================================================
-- Roll for Rating — Quests batch 2: King Slayer (6 tiers) + Globe Trotter
-- Run in the Supabase SQL editor (after quests-v2.sql). Safe to re-run.
--
-- King Slayer: beat the current #1-rated person within a scope (gym / town /
-- state / country / continent / world). Globe Trotter: roll opponents from all
-- 6 inhabited continents. Geo is resolved profile-first with gym fallback;
-- continent is derived from country. New quests are one-time (period 'once').
-- These are returned by quest_status, so the app renders them with no update.
-- ============================================================================

-- Country -> continent (mirrors src/lib/geo.ts continentForCountry).
create or replace function public.continent_for_country(p_country text)
returns text language sql immutable as $$
  select c from (values
    ('united states','North America'),('usa','North America'),('us','North America'),
    ('united states of america','North America'),('canada','North America'),('mexico','North America'),
    ('guatemala','North America'),('costa rica','North America'),('panama','North America'),
    ('cuba','North America'),('dominican republic','North America'),('jamaica','North America'),
    ('brazil','South America'),('brasil','South America'),('argentina','South America'),
    ('chile','South America'),('colombia','South America'),('peru','South America'),
    ('uruguay','South America'),('paraguay','South America'),('venezuela','South America'),
    ('ecuador','South America'),('bolivia','South America'),
    ('united kingdom','Europe'),('uk','Europe'),('england','Europe'),('scotland','Europe'),
    ('wales','Europe'),('ireland','Europe'),('france','Europe'),('germany','Europe'),
    ('spain','Europe'),('portugal','Europe'),('italy','Europe'),('netherlands','Europe'),
    ('belgium','Europe'),('switzerland','Europe'),('austria','Europe'),('sweden','Europe'),
    ('norway','Europe'),('denmark','Europe'),('finland','Europe'),('poland','Europe'),
    ('czech republic','Europe'),('czechia','Europe'),('greece','Europe'),('russia','Europe'),
    ('ukraine','Europe'),('romania','Europe'),('hungary','Europe'),('iceland','Europe'),
    ('croatia','Europe'),('serbia','Europe'),('bulgaria','Europe'),
    ('japan','Asia'),('china','Asia'),('south korea','Asia'),('korea','Asia'),('india','Asia'),
    ('thailand','Asia'),('vietnam','Asia'),('philippines','Asia'),('indonesia','Asia'),
    ('malaysia','Asia'),('singapore','Asia'),('taiwan','Asia'),('hong kong','Asia'),
    ('kazakhstan','Asia'),('pakistan','Asia'),('israel','Asia'),('turkey','Asia'),
    ('saudi arabia','Asia'),('united arab emirates','Asia'),('uae','Asia'),('qatar','Asia'),
    ('jordan','Asia'),('lebanon','Asia'),
    ('australia','Oceania'),('new zealand','Oceania'),('fiji','Oceania'),
    ('south africa','Africa'),('egypt','Africa'),('morocco','Africa'),('nigeria','Africa'),
    ('kenya','Africa'),('ghana','Africa'),('tunisia','Africa'),('algeria','Africa'),('angola','Africa')
  ) as m(country, c)
  where m.country = lower(btrim(coalesce(p_country, '')))
  limit 1;
$$;
grant execute on function public.continent_for_country(text) to authenticated;

-- A profile's resolved location (profile fields first, gym fallback).
create or replace function public.resolved_geo(p_uid uuid)
returns table(city text, state text, country text, continent text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(btrim(p.city), ''), g.city),
    coalesce(nullif(btrim(p.state), ''), g.state),
    coalesce(nullif(btrim(p.country), ''), g.country),
    coalesce(public.continent_for_country(coalesce(nullif(btrim(p.country), ''), g.country)), g.continent)
  from public.profiles p
  left join public.gyms g on g.id = p.gym_id
  where p.id = p_uid;
$$;
grant execute on function public.resolved_geo(uuid) to authenticated;

-- 1 if the caller has beaten the current #1-rated person within a scope, else 0.
create or replace function public.king_slayer_progress(p_uid uuid, p_level text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  ucity text; ustate text; ucountry text; ucont text; ugym uuid; king uuid;
begin
  select rg.city, rg.state, rg.country, rg.continent into ucity, ustate, ucountry, ucont
    from public.resolved_geo(p_uid) rg;
  select gym_id into ugym from public.profiles where id = p_uid;

  with cand as (
    select p.id, p.rating, p.gym_id,
      coalesce(nullif(btrim(p.city), ''), g.city) as city,
      coalesce(nullif(btrim(p.state), ''), g.state) as state,
      coalesce(nullif(btrim(p.country), ''), g.country) as country,
      coalesce(public.continent_for_country(coalesce(nullif(btrim(p.country), ''), g.country)), g.continent) as continent
    from public.profiles p
    left join public.gyms g on g.id = p.gym_id
    where p.id <> p_uid and p.age_tier <> 'kid'
  )
  select id into king from cand
  where case p_level
    when 'gym'       then ugym is not null and gym_id = ugym
    when 'city'      then ucity is not null and city is not null and lower(city) = lower(ucity)
    when 'state'     then ustate is not null and state is not null and lower(state) = lower(ustate)
    when 'country'   then ucountry is not null and country is not null and lower(country) = lower(ucountry)
    when 'continent' then ucont is not null and continent is not null and lower(continent) = lower(ucont)
    when 'world'     then true
    else false end
  order by rating desc, id
  limit 1;

  if king is null then return 0; end if;
  if exists (
    select 1 from public.matches
    where status = 'completed' and winner_id = p_uid
      and ((challenger_id = p_uid and opponent_id = king) or (opponent_id = p_uid and challenger_id = king))
  ) then return 1; end if;
  return 0;
end; $$;
grant execute on function public.king_slayer_progress(uuid, text) to authenticated;

-- Distinct inhabited continents among the caller's completed-match opponents.
create or replace function public.globetrotter_progress(p_uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct cont)::integer from (
    select coalesce(public.continent_for_country(coalesce(nullif(btrim(op.country), ''), g.country)), g.continent) as cont
    from public.matches m
    join public.profiles op on op.id = case when m.challenger_id = p_uid then m.opponent_id else m.challenger_id end
    left join public.gyms g on g.id = op.gym_id
    where m.status = 'completed' and (m.challenger_id = p_uid or m.opponent_id = p_uid)
  ) q
  where cont is not null;
$$;
grant execute on function public.globetrotter_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- quest_status v3 — appends King Slayer (6) + Globe Trotter to the existing set
-- ---------------------------------------------------------------------------
create or replace function public.quest_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk timestamptz := date_trunc('week', now());
  wkp text := to_char(date_trunc('week', now()), 'IYYY-IW');
  strk integer; legc integer; chokec integer; tric integer; legtot integer; choketot integer;
  gt integer;
begin
  strk := public.weekly_roll_streak(uid);
  legc := public.hunter_progress(uid,'leg',30);
  chokec := public.hunter_progress(uid,'choke',30);
  tric := public.triangle_progress(uid,7);
  select count(*) into legtot from public.submission_values where category='leg';
  select count(*) into choketot from public.submission_values where category='choke';
  gt := public.globetrotter_progress(uid);

  return jsonb_build_array(
    jsonb_build_object('key','shapeShifter','period','once','title','Shape Shifter — all triangles in 7 days','progress',tric,'target',4,'reward',15,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='shapeShifter' and period_key='once')),
    jsonb_build_object('key','legHunter','period','once','title','Leg Hunter — all leg locks in 30 days','progress',legc,'target',legtot,'reward',18,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='legHunter' and period_key='once')),
    jsonb_build_object('key','headHunter','period','once','title','Head Hunter — all chokes in 30 days','progress',chokec,'target',choketot,'reward',20,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='headHunter' and period_key='once')),
    jsonb_build_object('key','ksGym','period','once','title','Bully Beatdown — beat the #1 in your gym','progress',public.king_slayer_progress(uid,'gym'),'target',1,'reward',10,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksGym' and period_key='once')),
    jsonb_build_object('key','ksTown','period','once','title','Mayor Melee — beat the #1 in your town','progress',public.king_slayer_progress(uid,'city'),'target',1,'reward',12,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksTown' and period_key='once')),
    jsonb_build_object('key','ksState','period','once','title','Duke Destroyer — beat the #1 in your state','progress',public.king_slayer_progress(uid,'state'),'target',1,'reward',14,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksState' and period_key='once')),
    jsonb_build_object('key','ksCountry','period','once','title','King Slayer — beat the #1 in your country','progress',public.king_slayer_progress(uid,'country'),'target',1,'reward',16,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksCountry' and period_key='once')),
    jsonb_build_object('key','ksContinent','period','once','title','Emperor Eliminator — beat the #1 on your continent','progress',public.king_slayer_progress(uid,'continent'),'target',1,'reward',18,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksContinent' and period_key='once')),
    jsonb_build_object('key','ksWorld','period','once','title','Divine Assassin — beat the world #1','progress',public.king_slayer_progress(uid,'world'),'target',1,'reward',20,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='ksWorld' and period_key='once')),
    jsonb_build_object('key','globeTrotter','period','once','title','Globe Trotter — roll opponents from all 6 continents','progress',gt,'target',6,'reward',20,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='globeTrotter' and period_key='once')),
    jsonb_build_object('key','streak10','period','once','title','Rolled 10 weeks in a row','progress',least(strk,10),'target',10,'reward',10,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak10' and period_key='once')),
    jsonb_build_object('key','streak20','period','once','title','Rolled 20 weeks in a row','progress',least(strk,20),'target',20,'reward',15,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak20' and period_key='once')),
    jsonb_build_object('key','streak30','period','once','title','Rolled 30 weeks in a row','progress',least(strk,30),'target',30,'reward',15,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak30' and period_key='once')),
    jsonb_build_object('key','streak40','period','once','title','Rolled 40 weeks in a row','progress',least(strk,40),'target',40,'reward',20,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak40' and period_key='once')),
    jsonb_build_object('key','streak52','period','once','title','All Year — rolled 52 weeks in a row','progress',least(strk,52),'target',52,'reward',100,'claimed', exists(select 1 from public.quest_claims where user_id=uid and quest_key='streak52' and period_key='once'))
  );
end; $$;

-- ---------------------------------------------------------------------------
-- claim_quest v3 — add King Slayer tiers + Globe Trotter
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  period text := 'once'; progress integer; target integer; reward integer;
begin
  if exists (select 1 from public.quest_claims where user_id=uid and quest_key=p_key and period_key=period) then
    return jsonb_build_object('ok', false, 'reason', 'Already claimed'); end if;

  if p_key='shapeShifter' then target:=4; reward:=15; progress:=public.triangle_progress(uid,7);
  elsif p_key='legHunter' then reward:=18; select count(*) into target from public.submission_values where category='leg'; progress:=public.hunter_progress(uid,'leg',30);
  elsif p_key='headHunter' then reward:=20; select count(*) into target from public.submission_values where category='choke'; progress:=public.hunter_progress(uid,'choke',30);
  elsif p_key='ksGym' then target:=1; reward:=10; progress:=public.king_slayer_progress(uid,'gym');
  elsif p_key='ksTown' then target:=1; reward:=12; progress:=public.king_slayer_progress(uid,'city');
  elsif p_key='ksState' then target:=1; reward:=14; progress:=public.king_slayer_progress(uid,'state');
  elsif p_key='ksCountry' then target:=1; reward:=16; progress:=public.king_slayer_progress(uid,'country');
  elsif p_key='ksContinent' then target:=1; reward:=18; progress:=public.king_slayer_progress(uid,'continent');
  elsif p_key='ksWorld' then target:=1; reward:=20; progress:=public.king_slayer_progress(uid,'world');
  elsif p_key='globeTrotter' then target:=6; reward:=20; progress:=public.globetrotter_progress(uid);
  elsif p_key='streak10' then target:=10; reward:=10; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak20' then target:=20; reward:=15; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak30' then target:=30; reward:=15; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak40' then target:=40; reward:=20; progress:=public.weekly_roll_streak(uid);
  elsif p_key='streak52' then target:=52; reward:=100; progress:=public.weekly_roll_streak(uid);
  else raise exception 'Unknown quest'; end if;

  if progress < target then return jsonb_build_object('ok', false, 'reason', 'Not complete yet'); end if;
  insert into public.quest_claims(user_id, quest_key, period_key) values (uid, p_key, period);
  update public.profiles set rating = rating + reward where id = uid;
  return jsonb_build_object('ok', true, 'reward', reward, 'new_rating', (select rating from public.profiles where id = uid));
end; $$;

select 'quests-kingslayer-installed' as ok;
