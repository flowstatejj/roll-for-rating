-- ============================================================================
-- Roll for Rating — Tournaments PRO (builder + live multi-mat runner)
-- Run in the Supabase SQL editor AFTER schema.sql, teams-tournaments.sql,
-- match-waive-and-wager.sql, ror-mismatch-scaling.sql, leagues.sql.
-- Safe to re-run.
--
-- Adds to the existing `tournaments` table the ability to BUILD and RUN events:
--   • formats: round_robin, single_elim, double_elim, rr_playoff
--   • team formats: individual (1) / 3 / 5, with team rules: positional 'duel'
--     or 'quintet' (winner-stays survivor)
--   • configurable scoring (win/draw/loss points + kill/break submission bonus)
--   • ranked (bouts move ROR) or casual (event only)
--   • multiple mats, each with a referee, running concurrent bouts
--   • team building: host-assigned, captain-invite, or auto-balanced
--
-- NOTE: round_robin + single_elim generation/advancement are fully implemented.
-- double_elim currently generates the winners bracket (single-elim) — a full
-- losers bracket is a follow-up. rr_playoff generates the round-robin; the host
-- starts a single-elim playoff from the standings with generate_tournament_playoff().
-- ============================================================================

-- ---- Extend the tournaments table ------------------------------------------
alter table public.tournaments add column if not exists description     text;
alter table public.tournaments add column if not exists format          text not null default 'single_elim'
  check (format in ('round_robin','single_elim','double_elim','rr_playoff'));
alter table public.tournaments add column if not exists team_size       int  not null default 1 check (team_size in (1,3,5));
alter table public.tournaments add column if not exists team_rule       text not null default 'none'  check (team_rule in ('none','duel','quintet'));
alter table public.tournaments add column if not exists team_build      text not null default 'host'  check (team_build in ('host','captain','auto'));
alter table public.tournaments add column if not exists ranked          boolean not null default false;
alter table public.tournaments add column if not exists win_points      int not null default 3;
alter table public.tournaments add column if not exists draw_points     int not null default 1;
alter table public.tournaments add column if not exists loss_points     int not null default 0;
alter table public.tournaments add column if not exists sub_kill_bonus  int not null default 0;
alter table public.tournaments add column if not exists sub_break_bonus int not null default 0;
alter table public.tournaments add column if not exists mats            int not null default 1 check (mats between 1 and 20);
alter table public.tournaments add column if not exists status          text not null default 'setup' check (status in ('setup','running','complete'));
alter table public.tournaments add column if not exists visibility      text not null default 'open' check (visibility in ('open','private'));
alter table public.tournaments add column if not exists join_code       text;

-- backfill + default a join code
update public.tournaments set join_code = public.gen_league_code() where join_code is null;
alter table public.tournaments alter column join_code set default public.gen_league_code();

-- ---- New tables ------------------------------------------------------------
create table if not exists public.tournament_teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null,
  captain_id    uuid references public.profiles(id) on delete set null,
  seed          int,
  created_at    timestamptz not null default now()
);

create table if not exists public.tournament_team_members (
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot    int,
  primary key (team_id, user_id)
);

create table if not exists public.tournament_mats (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  mat_no        int not null,
  referee_id    uuid references public.profiles(id) on delete set null,
  unique (tournament_id, mat_no)
);

create table if not exists public.tournament_bouts (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  bracket         text not null default 'main',   -- 'main' | 'losers' | 'playoff'
  round_no        int  not null default 1,
  position        int  not null default 0,
  a_entrant       uuid references public.profiles(id) on delete set null,
  b_entrant       uuid references public.profiles(id) on delete set null,
  a_team          uuid references public.tournament_teams(id) on delete set null,
  b_team          uuid references public.tournament_teams(id) on delete set null,
  mat_id          uuid references public.tournament_mats(id) on delete set null,
  referee_id      uuid references public.profiles(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','live','done','bye')),
  winner          text check (winner in ('a','b','draw')),
  result          result_type,
  sub_category    text check (sub_category in ('kill','break')),
  a_score         int not null default 0,
  b_score         int not null default 0,
  a_idx           int not null default 1,   -- quintet survivor pointers
  b_idx           int not null default 1,
  match_id        uuid references public.matches(id) on delete set null,
  next_bout_id    uuid references public.tournament_bouts(id) on delete set null,
  next_slot       text check (next_slot in ('a','b')),
  created_at      timestamptz not null default now()
);

create table if not exists public.tournament_subbouts (
  id           uuid primary key default gen_random_uuid(),
  bout_id      uuid not null references public.tournament_bouts(id) on delete cascade,
  order_no     int not null,
  a_user       uuid references public.profiles(id) on delete set null,
  b_user       uuid references public.profiles(id) on delete set null,
  winner       text check (winner in ('a','b','draw')),
  result       result_type,
  sub_category text check (sub_category in ('kill','break')),
  created_at   timestamptz not null default now()
);

-- matches: tag a bout's individual match to its tournament (for ROR + standings)
alter table public.matches add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;

create index if not exists idx_tbouts_tid on public.tournament_bouts (tournament_id, bracket, round_no, position);
create index if not exists idx_tmatches_tid on public.matches (tournament_id) where tournament_id is not null;

-- ---- RLS -------------------------------------------------------------------
alter table public.tournament_teams        enable row level security;
alter table public.tournament_team_members enable row level security;
alter table public.tournament_mats         enable row level security;
alter table public.tournament_bouts        enable row level security;
alter table public.tournament_subbouts     enable row level security;

-- helper: is the caller the host of this tournament?
create or replace function public.is_tournament_host(p_tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = p_tid and t.host_id = auth.uid());
$$;

do $$ begin
  -- readable by all signed-in users
  perform 1;
end $$;

drop policy if exists "ttiteams_read" on public.tournament_teams;
create policy "ttiteams_read" on public.tournament_teams for select to authenticated using (true);
drop policy if exists "ttiteams_write" on public.tournament_teams;
create policy "ttiteams_write" on public.tournament_teams for all to authenticated
  using (public.is_tournament_host(tournament_id) or captain_id = auth.uid())
  with check (public.is_tournament_host(tournament_id) or captain_id = auth.uid());

drop policy if exists "ttmembers_read" on public.tournament_team_members;
create policy "ttmembers_read" on public.tournament_team_members for select to authenticated using (true);
drop policy if exists "ttmembers_write" on public.tournament_team_members;
create policy "ttmembers_write" on public.tournament_team_members for all to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tournament_teams tt where tt.id = team_id
               and (tt.captain_id = auth.uid() or public.is_tournament_host(tt.tournament_id)))
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.tournament_teams tt where tt.id = team_id
               and (tt.captain_id = auth.uid() or public.is_tournament_host(tt.tournament_id)))
  );

drop policy if exists "tmats_read" on public.tournament_mats;
create policy "tmats_read" on public.tournament_mats for select to authenticated using (true);
drop policy if exists "tmats_write" on public.tournament_mats;
create policy "tmats_write" on public.tournament_mats for all to authenticated
  using (public.is_tournament_host(tournament_id)) with check (public.is_tournament_host(tournament_id));

drop policy if exists "tbouts_read" on public.tournament_bouts;
create policy "tbouts_read" on public.tournament_bouts for select to authenticated using (true);
-- bouts are written by SECURITY DEFINER functions only (no direct writes)

drop policy if exists "tsubbouts_read" on public.tournament_subbouts;
create policy "tsubbouts_read" on public.tournament_subbouts for select to authenticated using (true);

-- ---- Settlement hooks: tournament casual fork + keep season race clean -----
-- Recreate _settle_match (same 6-arg signature) to also treat a CASUAL
-- tournament bout as non-rating-affecting (mirrors the league casual fork).
create or replace function public._settle_match(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text, p_notes text, p_sub_category text default null
)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches; k constant integer := 32;
  c_rating integer; o_rating integer;
  c_score double precision; o_score double precision;
  c_expected double precision; o_expected double precision;
  c_new integer; o_new integer; c_delta integer; o_delta integer;
  mismatch double precision; is_casual boolean;
begin
  select * into m from public.matches where id = p_match_id for update;

  is_casual :=
    (m.league_id is not null and coalesce((select not ranked from public.leagues where id = m.league_id), false))
    or (m.tournament_id is not null and coalesce((select not ranked from public.tournaments where id = m.tournament_id), false));

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id  for update;

  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);
  mismatch := greatest(0.0, 1 - abs(c_rating - o_rating) / 1000.0);
  c_delta := round(k * (c_score - c_expected) * mismatch);
  o_delta := round(k * (o_score - o_expected) * mismatch);

  if p_result <> 'draw' then
    if p_winner_id = m.challenger_id then
      c_delta := greatest(1, c_delta); o_delta := least(-1, o_delta);
    else
      o_delta := greatest(1, o_delta); c_delta := least(-1, c_delta);
    end if;
  end if;

  c_new := c_rating + c_delta;
  o_new := o_rating + o_delta;

  if p_result <> 'draw' and coalesce(m.wager, 0) > 0 then
    if p_winner_id = m.challenger_id then
      c_new := c_new + m.wager; o_new := o_new - m.wager;
    else
      o_new := o_new + m.wager; c_new := c_new - m.wager;
    end if;
  end if;

  c_new := greatest(100, c_new);
  o_new := greatest(100, o_new);

  if is_casual then
    c_new := c_rating; o_new := o_rating;
  else
    update public.profiles
       set rating = c_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.challenger_id;
    update public.profiles
       set rating = o_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.opponent_id;
  end if;

  update public.matches
     set status = 'completed', winner_id = p_winner_id, result = p_result,
         method = p_method, notes = coalesce(p_notes, notes), result_proposed_by = null,
         sub_category = p_sub_category,
         challenger_rating_before = c_rating, opponent_rating_before = o_rating,
         challenger_rating_after = c_new, opponent_rating_after = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;
  return m;
end; $$;

create or replace function public.accrue_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status = 'completed' and (old.status is distinct from new.status)
     and new.result <> 'draw' and new.winner_id is not null
     and new.league_id is null and new.tournament_id is null then
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

-- ---- Registration ----------------------------------------------------------
create or replace function public.register_for_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tournament_entrants (tournament_id, user_id)
  values (p_tid, auth.uid()) on conflict do nothing;
end; $$;

-- ---- Teams -----------------------------------------------------------------
create or replace function public.create_tournament_team(p_tid uuid, p_name text, p_captain uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; cap uuid;
begin
  if not (public.is_tournament_host(p_tid) or exists (select 1 from public.tournaments where id = p_tid and team_build = 'captain')) then
    raise exception 'Not allowed to create a team here';
  end if;
  cap := coalesce(p_captain, auth.uid());
  insert into public.tournament_teams (tournament_id, name, captain_id)
  values (p_tid, p_name, cap) returning id into tid;
  return tid;
end; $$;

create or replace function public.add_team_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; sz int; tid uuid;
begin
  select tournament_id into tid from public.tournament_teams where id = p_team;
  select team_size into sz from public.tournaments where id = tid;
  select count(*) into n from public.tournament_team_members where team_id = p_team;
  if n >= sz then raise exception 'Team is full (% members)', sz; end if;
  insert into public.tournament_team_members (team_id, user_id, slot)
  values (p_team, p_user, n + 1) on conflict do nothing;
end; $$;

-- Auto-balance solo entrants into teams of team_size, snake-seeded by rating.
create or replace function public.auto_balance_teams(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sz int; ids uuid[]; nteams int; i int; ti int; team_ids uuid[]; tname text;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can auto-balance'; end if;
  select team_size into sz from public.tournaments where id = p_tid;
  if sz < 2 then raise exception 'Not a team tournament'; end if;
  -- wipe existing teams
  delete from public.tournament_teams where tournament_id = p_tid;
  select array_agg(e.user_id order by p.rating desc) into ids
    from public.tournament_entrants e join public.profiles p on p.id = e.user_id
    where e.tournament_id = p_tid;
  if ids is null then return; end if;
  nteams := floor(array_length(ids,1) / sz);
  if nteams < 2 then return; end if;
  for ti in 1..nteams loop
    insert into public.tournament_teams (tournament_id, name) values (p_tid, 'Team ' || ti) returning id into tname;
    team_ids := array_append(team_ids, tname::uuid);
  end loop;
  -- snake distribution
  for i in 1..(nteams*sz) loop
    ti := ((i-1) % nteams);
    if ((i-1)/nteams) % 2 = 1 then ti := nteams-1-ti; end if;  -- snake
    insert into public.tournament_team_members (team_id, user_id, slot)
    values (team_ids[ti+1], ids[i], ((i-1)/nteams)+1) on conflict do nothing;
  end loop;
end; $$;

-- ---- Mats ------------------------------------------------------------------
create or replace function public.set_mat_referee(p_mat uuid, p_ref uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tournament_id into tid from public.tournament_mats where id = p_mat;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can assign referees'; end if;
  update public.tournament_mats set referee_id = p_ref where id = p_mat;
end; $$;

create or replace function public.assign_bout_mat(p_bout uuid, p_mat uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; ref uuid;
begin
  select tournament_id into tid from public.tournament_bouts where id = p_bout;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can assign mats'; end if;
  select referee_id into ref from public.tournament_mats where id = p_mat;
  update public.tournament_bouts set mat_id = p_mat, referee_id = ref, status = 'live' where id = p_bout;
end; $$;

-- ============================================================================
-- Generation
-- ============================================================================
-- Create the mats rows for the tournament (idempotent).
create or replace function public._ensure_mats(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nm int; i int;
begin
  select mats into nm from public.tournaments where id = p_tid;
  for i in 1..coalesce(nm,1) loop
    insert into public.tournament_mats (tournament_id, mat_no) values (p_tid, i)
    on conflict (tournament_id, mat_no) do nothing;
  end loop;
end; $$;

-- Participants as an ordered array of "ref" rows. For individuals: profile ids
-- (seeded by rating). For teams: team ids (seeded by seed/created order).
create or replace function public._tournament_seeds(p_tid uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when (select team_rule from public.tournaments where id = p_tid) = 'none' then
      (select array_agg(e.user_id order by p.rating desc)
         from public.tournament_entrants e join public.profiles p on p.id = e.user_id
         where e.tournament_id = p_tid)
    else
      (select array_agg(tt.id order by coalesce(tt.seed, 999999), tt.created_at)
         from public.tournament_teams tt where tt.tournament_id = p_tid)
  end;
$$;

-- Round-robin (circle method): every participant meets every other once.
create or replace function public._gen_round_robin(p_tid uuid, ids uuid[], is_team boolean)
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
        insert into public.tournament_bouts (tournament_id, bracket, round_no, position, a_team, b_team)
        values (p_tid, 'main', r, i, a, b);
      else
        insert into public.tournament_bouts (tournament_id, bracket, round_no, position, a_entrant, b_entrant)
        values (p_tid, 'main', r, i, a, b);
      end if;
    end loop;
  end loop;
end; $$;

-- Single elimination with standard seeding + byes; links winners forward.
create or replace function public._gen_single_elim(p_tid uuid, ids uuid[], is_team boolean, p_bracket text default 'main')
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

  -- standard seed slot order for a bracket of `size` (1-indexed seeds)
  slotorder := array[1];
  cnt := 1;
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

  -- place seeds into slots; seed>n => bye (null)
  slots := '{}';
  for i in 1..size loop
    if slotorder[i] <= n then slots := slots || ids[slotorder[i]]; else slots := slots || null::uuid; end if;
  end loop;

  -- build final round upward so we have parent ids to link to. Easiest: create
  -- bouts round by round from the LAST round to first, tracking child slots.
  -- Round R (final) has 1 bout; round 1 has size/2 bouts.
  -- We create from round=rounds down to 1, storing the array of bout ids per round.
  declare
    per_round int;
    round_ids uuid[][];  -- not used; we use cur/nxt arrays of ids
  begin
    -- create final..first; nxt holds the ids of the round just created (children's parents)
    nxt := '{}';
    for r in reverse rounds..1 loop
      per_round := size / (2 ^ r)::int;  -- bouts in this round
      cur := '{}';
      for i in 1..per_round loop
        if r = rounds then parent := null; else parent := nxt[((i-1)/2)+1]; end if;
        insert into public.tournament_bouts (tournament_id, bracket, round_no, position, next_bout_id, next_slot)
        values (p_tid, p_bracket, r, i, parent, case when (i % 2)=1 then 'a' else 'b' end)
        returning id into bout_id;
        cur := cur || bout_id;
      end loop;
      nxt := cur;
    end loop;
  end;

  -- fill round 1 competitors from slots, set byes, and pre-advance byes
  declare b1 uuid[]; j int; idx int;
  begin
    select array_agg(id order by position) into b1 from public.tournament_bouts
      where tournament_id = p_tid and bracket=p_bracket and round_no=1;
    j := 1;
    foreach bout_id in array b1 loop
      a := slots[j]; b := slots[j+1]; j := j + 2;
      if is_team then
        update public.tournament_bouts set a_team=a, b_team=b where id=bout_id;
      else
        update public.tournament_bouts set a_entrant=a, b_entrant=b where id=bout_id;
      end if;
      -- byes: one side null -> auto-advance the present side
      if a is null or b is null then
        perform public._advance_bye(bout_id, coalesce(a,b), is_team);
      end if;
    end loop;
  end;
end; $$;

-- Advance a bye winner into its parent bout immediately.
create or replace function public._advance_bye(p_bout uuid, p_winner uuid, is_team boolean)
returns void language plpgsql security definer set search_path = public as $$
declare nb uuid; ns text;
begin
  update public.tournament_bouts set status='bye',
    winner = case when p_winner is not null then 'a' else null end
   where id = p_bout;
  select next_bout_id, next_slot into nb, ns from public.tournament_bouts where id = p_bout;
  if nb is not null and p_winner is not null then
    if is_team then
      if ns='a' then update public.tournament_bouts set a_team=p_winner where id=nb;
      else update public.tournament_bouts set b_team=p_winner where id=nb; end if;
    else
      if ns='a' then update public.tournament_bouts set a_entrant=p_winner where id=nb;
      else update public.tournament_bouts set b_entrant=p_winner where id=nb; end if;
    end if;
  end if;
end; $$;

-- Main entry: generate the bracket/schedule for a tournament.
create or replace function public.generate_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare fmt text; is_team boolean; ids uuid[]; tr text;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can start the tournament'; end if;
  if exists (select 1 from public.tournament_bouts where tournament_id = p_tid) then return; end if;
  select format, (team_rule <> 'none') into fmt, is_team from public.tournaments where id = p_tid;
  ids := public._tournament_seeds(p_tid);
  if ids is null or array_length(ids,1) < 2 then raise exception 'Need at least 2 participants'; end if;

  perform public._ensure_mats(p_tid);
  if fmt = 'round_robin' or fmt = 'rr_playoff' then
    perform public._gen_round_robin(p_tid, ids, is_team);
  else
    -- single_elim and (for now) double_elim use the single-elim winners bracket
    perform public._gen_single_elim(p_tid, ids, is_team, 'main');
  end if;
  update public.tournaments set status='running' where id = p_tid;
end; $$;

-- Build a single-elim playoff from the top N of an rr_playoff's standings.
create or replace function public.generate_tournament_playoff(p_tid uuid, p_top int default 4)
returns void language plpgsql security definer set search_path = public as $$
declare is_team boolean; ids uuid[];
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can start the playoff'; end if;
  if exists (select 1 from public.tournament_bouts where tournament_id=p_tid and bracket='playoff') then return; end if;
  select (team_rule <> 'none') into is_team from public.tournaments where id=p_tid;
  select array_agg(s.id) into ids from (
    select user_id as id from public.tournament_standings_pro(p_tid) limit greatest(2,p_top)
  ) s;
  if ids is null or array_length(ids,1) < 2 then return; end if;
  perform public._gen_single_elim(p_tid, ids, is_team, 'playoff');
end; $$;

-- ============================================================================
-- Running: record results
-- ============================================================================
-- Caller may record if they are the bout's referee, the mat's referee, or host.
create or replace function public._may_record(p_bout public.tournament_bouts)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_bout.referee_id = auth.uid(), false)
    or public.is_tournament_host(p_bout.tournament_id)
    or exists (select 1 from public.tournament_mats mm where mm.id = p_bout.mat_id and mm.referee_id = auth.uid());
$$;

-- Advance the winner of a finished bout into its next bout.
create or replace function public._advance_winner(p_bout public.tournament_bouts, is_team boolean)
returns void language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  if p_bout.next_bout_id is null or p_bout.winner is null or p_bout.winner = 'draw' then return; end if;
  if is_team then w := case when p_bout.winner='a' then p_bout.a_team else p_bout.b_team end;
  else w := case when p_bout.winner='a' then p_bout.a_entrant else p_bout.b_entrant end; end if;
  if is_team then
    if p_bout.next_slot='a' then update public.tournament_bouts set a_team=w where id=p_bout.next_bout_id;
    else update public.tournament_bouts set b_team=w where id=p_bout.next_bout_id; end if;
  else
    if p_bout.next_slot='a' then update public.tournament_bouts set a_entrant=w where id=p_bout.next_bout_id;
    else update public.tournament_bouts set b_entrant=w where id=p_bout.next_bout_id; end if;
  end if;
end; $$;

-- Record an INDIVIDUAL bout: creates+settles a real match (so ROR moves when
-- the tournament is ranked) and advances the bracket.
create or replace function public.record_bout_result(
  p_bout uuid, p_winner text, p_result result_type,
  p_sub_category text default null, p_method text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare b public.tournament_bouts; mid uuid; wid uuid; ref uuid; is_team boolean;
begin
  select * into b from public.tournament_bouts where id = p_bout for update;
  if not found then raise exception 'Bout not found'; end if;
  -- Guard against a double-record (same as record_subbout): without it, a second
  -- call creates a second match and settles Elo again. The `for update` lock
  -- above serialises concurrent calls so the second sees status='done' here.
  if b.status = 'done' then raise exception 'Bout already finished'; end if;
  if not public._may_record(b) then raise exception 'Only the assigned referee or host can record this bout'; end if;
  if b.a_team is not null or b.b_team is not null then raise exception 'Use record_subbout for team bouts'; end if;
  if b.a_entrant is null or b.b_entrant is null then raise exception 'Both competitors are required'; end if;

  ref := coalesce(b.referee_id, auth.uid());
  wid := case when p_winner='a' then b.a_entrant when p_winner='b' then b.b_entrant else null end;

  -- create the match (tournament-tagged) and settle it through the normal engine
  insert into public.matches (challenger_id, opponent_id, referee_id, referee_waived, status, wager, is_public, tournament_id)
  values (b.a_entrant, b.b_entrant, ref, false, 'pending_referee', 0, false, b.tournament_id)
  returning id into mid;
  perform public._settle_match(mid, wid, p_result, p_method, null, p_sub_category);

  update public.tournament_bouts
     set status='done', winner=p_winner, result=p_result, sub_category=p_sub_category, match_id=mid,
         a_score = case when p_winner='a' then 1 else 0 end,
         b_score = case when p_winner='b' then 1 else 0 end
   where id = p_bout;
  select * into b from public.tournament_bouts where id = p_bout;
  perform public._advance_winner(b, false);
  if b.mat_id is not null then update public.tournament_bouts set mat_id=null where id=p_bout; end if;
end; $$;

-- Record one sub-bout of a TEAM bout (duel or quintet). Computes the team
-- winner when the bout is decided, then advances the bracket.
create or replace function public.record_subbout(
  p_bout uuid, p_winner text, p_result result_type,
  p_sub_category text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.tournament_bouts; tr text; sz int; au uuid; bu uuid; ord int;
  a_roster uuid[]; b_roster uuid[]; decided boolean := false; team_win text;
begin
  select * into b from public.tournament_bouts where id = p_bout for update;
  if not found then raise exception 'Bout not found'; end if;
  if not public._may_record(b) then raise exception 'Only the assigned referee or host can record this bout'; end if;
  if b.a_team is null or b.b_team is null then raise exception 'Not a team bout'; end if;
  if b.status = 'done' then raise exception 'Bout already finished'; end if;

  select team_rule, team_size into tr, sz from public.tournaments where id = b.tournament_id;
  select array_agg(user_id order by coalesce(slot, 999), user_id) into a_roster from public.tournament_team_members where team_id = b.a_team;
  select array_agg(user_id order by coalesce(slot, 999), user_id) into b_roster from public.tournament_team_members where team_id = b.b_team;

  au := a_roster[b.a_idx]; bu := b_roster[b.b_idx];
  select coalesce(max(order_no),0)+1 into ord from public.tournament_subbouts where bout_id = p_bout;
  insert into public.tournament_subbouts (bout_id, order_no, a_user, b_user, winner, result, sub_category)
  values (p_bout, ord, au, bu, p_winner, p_result, p_sub_category);

  if tr = 'quintet' then
    -- winner stays; loser advances to next fighter; draw eliminates both
    if p_winner = 'a' then b.b_idx := b.b_idx + 1; b.b_score := b.b_score; b.a_score := b.a_score + 1;
    elsif p_winner = 'b' then b.a_idx := b.a_idx + 1; b.b_score := b.b_score + 1;
    else b.a_idx := b.a_idx + 1; b.b_idx := b.b_idx + 1; end if;
    update public.tournament_bouts set a_idx=b.a_idx, b_idx=b.b_idx, a_score=b.a_score, b_score=b.b_score where id=p_bout;
    if b.a_idx > sz and b.b_idx > sz then decided := true; team_win := 'draw';
    elsif b.b_idx > sz then decided := true; team_win := 'a';
    elsif b.a_idx > sz then decided := true; team_win := 'b';
    end if;
  else
    -- duel: fixed positions; advance both pointers each sub-bout
    if p_winner='a' then b.a_score := b.a_score + 1; elsif p_winner='b' then b.b_score := b.b_score + 1; end if;
    b.a_idx := b.a_idx + 1; b.b_idx := b.b_idx + 1;
    update public.tournament_bouts set a_idx=b.a_idx, b_idx=b.b_idx, a_score=b.a_score, b_score=b.b_score where id=p_bout;
    if (b.a_idx > sz) or (b.b_idx > sz) then
      decided := true;
      team_win := case when b.a_score > b.b_score then 'a' when b.b_score > b.a_score then 'b' else 'draw' end;
    end if;
  end if;

  if decided then
    update public.tournament_bouts set status='done', winner=team_win, mat_id=null where id=p_bout;
    select * into b from public.tournament_bouts where id=p_bout;
    perform public._advance_winner(b, true);
  end if;
end; $$;

-- ============================================================================
-- Standings (round-robin / pools)
-- ============================================================================
create or replace function public.tournament_standings_pro(p_tid uuid)
returns table (user_id uuid, played int, wins int, losses int, draws int, points int)
language sql stable security definer set search_path = public as $$
  with t as (select * from public.tournaments where id = p_tid),
  -- INDIVIDUAL: aggregate from tournament-tagged completed matches
  ind as (
    with mt as (select * from public.matches where tournament_id = p_tid and status='completed'),
    per as (
      select mt.challenger_id uid,
        case when mt.result<>'draw' and mt.winner_id=mt.challenger_id then 1 else 0 end win,
        case when mt.result<>'draw' and mt.winner_id=mt.opponent_id then 1 else 0 end loss,
        case when mt.result='draw' then 1 else 0 end draw,
        case when mt.winner_id=mt.challenger_id and mt.result='submission' then mt.sub_category end won_sub from mt
      union all
      select mt.opponent_id uid,
        case when mt.result<>'draw' and mt.winner_id=mt.opponent_id then 1 else 0 end win,
        case when mt.result<>'draw' and mt.winner_id=mt.challenger_id then 1 else 0 end loss,
        case when mt.result='draw' then 1 else 0 end draw,
        case when mt.winner_id=mt.opponent_id and mt.result='submission' then mt.sub_category end won_sub from mt
    )
    select e.user_id,
      coalesce(sum(coalesce(per.win,0)+coalesce(per.loss,0)+coalesce(per.draw,0)),0)::int played,
      coalesce(sum(per.win),0)::int wins, coalesce(sum(per.loss),0)::int losses, coalesce(sum(per.draw),0)::int draws,
      coalesce(sum(coalesce(per.win,0)*t.win_points + coalesce(per.draw,0)*t.draw_points + coalesce(per.loss,0)*t.loss_points
        + case when per.won_sub='kill' then t.sub_kill_bonus when per.won_sub='break' then t.sub_break_bonus else 0 end),0)::int points
    from public.tournament_entrants e cross join t
    left join per on per.uid = e.user_id
    where e.tournament_id = p_tid
    group by e.user_id
  ),
  -- TEAM: aggregate from finished team bouts (team id used as the "user_id")
  team as (
    with bt as (select * from public.tournament_bouts where tournament_id=p_tid and status='done' and a_team is not null),
    per as (
      select bt.a_team uid, case when bt.winner='a' then 1 else 0 end win, case when bt.winner='b' then 1 else 0 end loss, case when bt.winner='draw' then 1 else 0 end draw from bt
      union all
      select bt.b_team uid, case when bt.winner='b' then 1 else 0 end win, case when bt.winner='a' then 1 else 0 end loss, case when bt.winner='draw' then 1 else 0 end draw from bt
    )
    select tt.id user_id,
      coalesce(sum(coalesce(per.win,0)+coalesce(per.loss,0)+coalesce(per.draw,0)),0)::int played,
      coalesce(sum(per.win),0)::int wins, coalesce(sum(per.loss),0)::int losses, coalesce(sum(per.draw),0)::int draws,
      coalesce(sum(coalesce(per.win,0)*t.win_points + coalesce(per.draw,0)*t.draw_points + coalesce(per.loss,0)*t.loss_points),0)::int points
    from public.tournament_teams tt cross join t
    left join per on per.uid = tt.id
    where tt.tournament_id = p_tid
    group by tt.id
  )
  select * from ind where (select team_rule from t)='none'
  union all
  select * from team where (select team_rule from t)<>'none'
  order by points desc, wins desc;
$$;
