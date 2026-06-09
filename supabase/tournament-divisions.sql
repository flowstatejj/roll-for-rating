-- ============================================================================
-- Roll for Rating — Tournament DIVISIONS (belt/age/weight/gender brackets)
-- Run in the Supabase SQL editor AFTER tournaments-pro.sql. Safe to re-run.
--
-- Real events split into divisions; each division has its own bracket/round-robin
-- and standings. Bouts now carry a division_id. Generation moves per-division
-- (generate_division); generate_tournament loops every division. Recording /
-- advancement (record_bout_result, record_subbout) are unchanged — bouts just
-- additionally carry division_id. Also enables realtime on the live-run tables.
-- ============================================================================

create table if not exists public.tournament_divisions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null,
  belt_min      public.belt_rank,
  belt_max      public.belt_rank,
  age_min       int,
  age_max       int,
  weight_min_kg numeric,
  weight_max_kg numeric,
  gender        text not null default 'any' check (gender in ('any','male','female')),
  format        text check (format in ('round_robin','single_elim','double_elim','rr_playoff')),
  status        text not null default 'setup' check (status in ('setup','running','complete')),
  created_at    timestamptz not null default now()
);

create table if not exists public.division_entrants (
  division_id uuid not null references public.tournament_divisions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (division_id, user_id)
);

create table if not exists public.division_teams (
  division_id uuid not null references public.tournament_divisions(id) on delete cascade,
  team_id     uuid not null references public.tournament_teams(id) on delete cascade,
  primary key (division_id, team_id)
);

alter table public.tournament_bouts add column if not exists division_id uuid references public.tournament_divisions(id) on delete cascade;
create index if not exists idx_tbouts_division on public.tournament_bouts (division_id) where division_id is not null;

-- ---- RLS -------------------------------------------------------------------
alter table public.tournament_divisions enable row level security;
alter table public.division_entrants    enable row level security;
alter table public.division_teams       enable row level security;

drop policy if exists "tdiv_read" on public.tournament_divisions;
create policy "tdiv_read" on public.tournament_divisions for select to authenticated using (true);
drop policy if exists "tdiv_write" on public.tournament_divisions;
create policy "tdiv_write" on public.tournament_divisions for all to authenticated
  using (public.is_tournament_host(tournament_id)) with check (public.is_tournament_host(tournament_id));

drop policy if exists "tdent_read" on public.division_entrants;
create policy "tdent_read" on public.division_entrants for select to authenticated using (true);
drop policy if exists "tdent_write" on public.division_entrants;
create policy "tdent_write" on public.division_entrants for all to authenticated
  using (exists (select 1 from public.tournament_divisions d where d.id = division_id and public.is_tournament_host(d.tournament_id)))
  with check (exists (select 1 from public.tournament_divisions d where d.id = division_id and public.is_tournament_host(d.tournament_id)));

drop policy if exists "tdteam_read" on public.division_teams;
create policy "tdteam_read" on public.division_teams for select to authenticated using (true);
drop policy if exists "tdteam_write" on public.division_teams;
create policy "tdteam_write" on public.division_teams for all to authenticated
  using (exists (select 1 from public.tournament_divisions d where d.id = division_id and public.is_tournament_host(d.tournament_id)))
  with check (exists (select 1 from public.tournament_divisions d where d.id = division_id and public.is_tournament_host(d.tournament_id)));

-- ---- Host helpers (create/manage divisions) --------------------------------
create or replace function public.create_division(
  p_tid uuid, p_name text,
  p_belt_min public.belt_rank default null, p_belt_max public.belt_rank default null,
  p_age_min int default null, p_age_max int default null,
  p_wmin numeric default null, p_wmax numeric default null,
  p_gender text default 'any', p_format text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can add divisions'; end if;
  insert into public.tournament_divisions (tournament_id, name, belt_min, belt_max, age_min, age_max, weight_min_kg, weight_max_kg, gender, format)
  values (p_tid, p_name, p_belt_min, p_belt_max, p_age_min, p_age_max, p_wmin, p_wmax, coalesce(p_gender,'any'), p_format)
  returning id into did;
  return did;
end; $$;

create or replace function public.add_division_entrant(p_division uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can assign entrants'; end if;
  insert into public.division_entrants (division_id, user_id) values (p_division, p_user) on conflict do nothing;
  insert into public.tournament_entrants (tournament_id, user_id) values (tid, p_user) on conflict do nothing;
end; $$;

create or replace function public.add_division_team(p_division uuid, p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can assign teams'; end if;
  insert into public.division_teams (division_id, team_id) values (p_division, p_team) on conflict do nothing;
end; $$;

-- ============================================================================
-- Generation — recreate the generators to carry division_id, then per-division.
-- ============================================================================
drop function if exists public._gen_round_robin(uuid, uuid[], boolean);
drop function if exists public._gen_single_elim(uuid, uuid[], boolean, text);

create or replace function public._gen_round_robin(p_tid uuid, ids uuid[], is_team boolean, p_division uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare n int; rounds int; r int; i int; half int; rot uuid[]; a uuid; b uuid;
begin
  n := array_length(ids,1);
  if n is null or n < 2 then return; end if;
  if n % 2 = 1 then ids := ids || array[null::uuid]; n := n + 1; end if;
  rounds := n - 1; half := n / 2;
  for r in 1..rounds loop
    rot := array[ids[1]];
    for i in 1..(n-1) loop rot := rot || ids[2 + ((i-1 + (r-1)) % (n-1))]; end loop;
    for i in 1..half loop
      a := rot[i]; b := rot[n+1-i];
      if a is null or b is null then continue; end if;
      if is_team then
        insert into public.tournament_bouts (tournament_id, division_id, bracket, round_no, position, a_team, b_team)
        values (p_tid, p_division, 'main', r, i, a, b);
      else
        insert into public.tournament_bouts (tournament_id, division_id, bracket, round_no, position, a_entrant, b_entrant)
        values (p_tid, p_division, 'main', r, i, a, b);
      end if;
    end loop;
  end loop;
end; $$;

create or replace function public._gen_single_elim(p_tid uuid, ids uuid[], is_team boolean, p_bracket text default 'main', p_division uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n int; size int; rounds int; r int; i int; cnt int;
  slotorder int[]; slots uuid[]; cur uuid[]; nxt uuid[];
  bout_id uuid; parent uuid; a uuid; b uuid;
begin
  n := array_length(ids,1);
  if n is null or n < 2 then return; end if;
  size := 1; while size < n loop size := size * 2; end loop;
  rounds := 0; cnt := size; while cnt > 1 loop rounds := rounds + 1; cnt := cnt/2; end loop;

  slotorder := array[1]; cnt := 1;
  while cnt < size loop
    declare tmp int[] := '{}'; s int;
    begin
      foreach s in array slotorder loop
        tmp := tmp || s;
        tmp := tmp || (cnt*2 + 1 - s);
      end loop;
      slotorder := tmp; cnt := cnt * 2;
    end;
  end loop;

  slots := '{}';
  for i in 1..size loop
    if slotorder[i] <= n then slots := slots || ids[slotorder[i]]; else slots := slots || null::uuid; end if;
  end loop;

  declare per_round int;
  begin
    nxt := '{}';
    for r in reverse rounds..1 loop
      per_round := size / (2 ^ r)::int;
      cur := '{}';
      for i in 1..per_round loop
        if r = rounds then parent := null; else parent := nxt[((i-1)/2)+1]; end if;
        insert into public.tournament_bouts (tournament_id, division_id, bracket, round_no, position, next_bout_id, next_slot)
        values (p_tid, p_division, p_bracket, r, i, parent, case when (i % 2)=1 then 'a' else 'b' end)
        returning id into bout_id;
        cur := cur || bout_id;
      end loop;
      nxt := cur;
    end loop;
  end;

  declare b1 uuid[]; j int;
  begin
    select array_agg(id order by position) into b1 from public.tournament_bouts
      where tournament_id = p_tid and bracket=p_bracket and round_no=1
        and (division_id = p_division or (division_id is null and p_division is null));
    j := 1;
    foreach bout_id in array b1 loop
      a := slots[j]; b := slots[j+1]; j := j + 2;
      if is_team then update public.tournament_bouts set a_team=a, b_team=b where id=bout_id;
      else update public.tournament_bouts set a_entrant=a, b_entrant=b where id=bout_id; end if;
      if a is null or b is null then
        perform public._advance_bye(bout_id, coalesce(a,b), is_team);
      end if;
    end loop;
  end;
end; $$;

-- Ordered seeds for a single division (individuals by rating; teams by created order).
create or replace function public._division_seeds(p_division uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when (select t.team_rule from public.tournament_divisions d join public.tournaments t on t.id=d.tournament_id where d.id=p_division) = 'none' then
      (select array_agg(de.user_id order by p.rating desc)
         from public.division_entrants de join public.profiles p on p.id=de.user_id
         where de.division_id = p_division)
    else
      (select array_agg(dt.team_id order by tt.created_at)
         from public.division_teams dt join public.tournament_teams tt on tt.id=dt.team_id
         where dt.division_id = p_division)
  end;
$$;

-- Generate one division's bracket/schedule.
create or replace function public.generate_division(p_division uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; fmt text; is_team boolean; ids uuid[];
begin
  select d.tournament_id, coalesce(d.format, t.format), (t.team_rule <> 'none')
    into tid, fmt, is_team
    from public.tournament_divisions d join public.tournaments t on t.id = d.tournament_id
    where d.id = p_division;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can generate a division'; end if;
  if exists (select 1 from public.tournament_bouts where division_id = p_division) then return; end if;
  ids := public._division_seeds(p_division);
  if ids is null or array_length(ids,1) < 2 then raise exception 'Division needs at least 2 participants'; end if;
  perform public._ensure_mats(tid);
  if fmt = 'round_robin' or fmt = 'rr_playoff' then
    perform public._gen_round_robin(tid, ids, is_team, p_division);
  else
    perform public._gen_single_elim(tid, ids, is_team, 'main', p_division);
  end if;
  update public.tournament_divisions set status='running' where id = p_division;
  update public.tournaments set status='running' where id = tid;
end; $$;

-- Recreate generate_tournament: if the event has divisions, generate each;
-- otherwise fall back to the legacy whole-tournament bracket.
create or replace function public.generate_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare fmt text; is_team boolean; ids uuid[]; d record;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can start the tournament'; end if;
  perform public._ensure_mats(p_tid);

  if exists (select 1 from public.tournament_divisions where tournament_id = p_tid) then
    for d in select id from public.tournament_divisions where tournament_id = p_tid loop
      begin
        perform public.generate_division(d.id);
      exception when others then null;  -- skip divisions with <2 entrants
      end;
    end loop;
    update public.tournaments set status='running' where id = p_tid;
    return;
  end if;

  -- legacy: no divisions
  if exists (select 1 from public.tournament_bouts where tournament_id = p_tid) then return; end if;
  select format, (team_rule <> 'none') into fmt, is_team from public.tournaments where id = p_tid;
  ids := public._tournament_seeds(p_tid);
  if ids is null or array_length(ids,1) < 2 then raise exception 'Need at least 2 participants'; end if;
  if fmt = 'round_robin' or fmt = 'rr_playoff' then
    perform public._gen_round_robin(p_tid, ids, is_team, null);
  else
    perform public._gen_single_elim(p_tid, ids, is_team, 'main', null);
  end if;
  update public.tournaments set status='running' where id = p_tid;
end; $$;

-- ============================================================================
-- Standings for one division (from finished bouts; configurable scoring).
-- ============================================================================
create or replace function public.division_standings(p_division uuid)
returns table (participant uuid, played int, wins int, losses int, draws int, points int)
language sql stable security definer set search_path = public as $$
  with d as (select * from public.tournament_divisions where id = p_division),
  t as (select tt.* from public.tournaments tt join d on d.tournament_id = tt.id),
  is_team as (select (team_rule <> 'none') as v from t),
  parts as (
    select user_id as pid from public.division_entrants where division_id = p_division and (select not v from is_team)
    union all
    select team_id as pid from public.division_teams where division_id = p_division and (select v from is_team)
  ),
  bt as (select * from public.tournament_bouts where division_id = p_division and status = 'done'),
  per as (
    -- individual side
    select b.a_entrant pid,
      case when b.winner='a' then 1 else 0 end win, case when b.winner='b' then 1 else 0 end loss,
      case when b.winner='draw' then 1 else 0 end draw,
      case when b.winner='a' and b.result='submission' then b.sub_category end won_sub
    from bt b where b.a_entrant is not null
    union all
    select b.b_entrant pid,
      case when b.winner='b' then 1 else 0 end win, case when b.winner='a' then 1 else 0 end loss,
      case when b.winner='draw' then 1 else 0 end draw,
      case when b.winner='b' and b.result='submission' then b.sub_category end won_sub
    from bt b where b.b_entrant is not null
    union all
    -- team side
    select b.a_team pid, case when b.winner='a' then 1 else 0 end, case when b.winner='b' then 1 else 0 end,
      case when b.winner='draw' then 1 else 0 end, null::text from bt b where b.a_team is not null
    union all
    select b.b_team pid, case when b.winner='b' then 1 else 0 end, case when b.winner='a' then 1 else 0 end,
      case when b.winner='draw' then 1 else 0 end, null::text from bt b where b.b_team is not null
  )
  select
    parts.pid,
    coalesce(sum(coalesce(per.win,0)+coalesce(per.loss,0)+coalesce(per.draw,0)),0)::int played,
    coalesce(sum(per.win),0)::int wins, coalesce(sum(per.loss),0)::int losses, coalesce(sum(per.draw),0)::int draws,
    coalesce(sum(coalesce(per.win,0)*t.win_points + coalesce(per.draw,0)*t.draw_points + coalesce(per.loss,0)*t.loss_points
      + case when per.won_sub='kill' then t.sub_kill_bonus when per.won_sub='break' then t.sub_break_bonus else 0 end),0)::int points
  from parts cross join t
  left join per on per.pid = parts.pid
  group by parts.pid
  order by points desc, wins desc;
$$;

-- ---- Realtime: stream live-run tables to the web console -------------------
do $$ begin alter publication supabase_realtime add table public.tournament_bouts; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tournament_mats; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tournament_divisions; exception when others then null; end $$;
