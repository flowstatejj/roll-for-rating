-- ============================================================================
-- Roll for Rating — In-app notifications (table + triggers + realtime)
-- Run in the Supabase SQL Editor (after schema.sql, social.sql, public-matches,
-- messages). Safe to re-run.
-- ============================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  match_id   uuid references public.matches (id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications for select to authenticated using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- (No insert policy — the SECURITY DEFINER triggers below create rows.)

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- New challenge -> notify opponent + referee
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select display_name into cname from public.profiles where id = new.challenger_id;
  insert into public.notifications (user_id, type, title, body, match_id) values
    (new.opponent_id, 'challenge', 'New challenge', cname || ' challenged you', new.id),
    (new.referee_id, 'referee', 'You are refereeing', cname || ' set up a match — you''re the ref', new.id);
  return new;
end; $$;

drop trigger if exists trg_match_created on public.matches;
create trigger trg_match_created after insert on public.matches
  for each row execute function public.notify_match_created();

-- ---------------------------------------------------------------------------
-- Status changes -> accepted / declined / cancelled / completed
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text; oname text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select display_name into cname from public.profiles where id = new.challenger_id;
  select display_name into oname from public.profiles where id = new.opponent_id;

  if new.status = 'pending_referee' then
    insert into public.notifications (user_id, type, title, body, match_id) values
      (new.challenger_id, 'accepted', 'Challenge accepted', oname || ' accepted your challenge', new.id),
      (new.referee_id, 'referee', 'Ready to record', cname || ' vs ' || oname || ' is ready to score', new.id);
  elsif new.status = 'declined' then
    insert into public.notifications (user_id, type, title, body, match_id) values
      (new.challenger_id, 'declined', 'Challenge declined', oname || ' declined your challenge', new.id);
  elsif new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, body, match_id) values
      (new.challenger_id, 'cancelled', 'Match cancelled', 'Your match vs ' || oname || ' was cancelled', new.id),
      (new.opponent_id, 'cancelled', 'Match cancelled', 'Your match vs ' || cname || ' was cancelled', new.id);
  elsif new.status = 'completed' then
    insert into public.notifications (user_id, type, title, body, match_id) values
      (new.challenger_id, 'result', 'Result recorded',
        case when new.result = 'draw' then 'Draw vs ' || oname
             when new.winner_id = new.challenger_id then 'You beat ' || oname else 'You lost to ' || oname end
        || ' — rating ' || new.challenger_rating_before || ' → ' || new.challenger_rating_after, new.id),
      (new.opponent_id, 'result', 'Result recorded',
        case when new.result = 'draw' then 'Draw vs ' || cname
             when new.winner_id = new.opponent_id then 'You beat ' || cname else 'You lost to ' || cname end
        || ' — rating ' || new.opponent_rating_before || ' → ' || new.opponent_rating_after, new.id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_match_status on public.matches;
create trigger trg_match_status after update on public.matches
  for each row execute function public.notify_match_status();

-- ---------------------------------------------------------------------------
-- Gym friend request -> notify the target gym's owner
-- ---------------------------------------------------------------------------
create or replace function public.notify_gym_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_owner uuid; rname text;
begin
  select owner_id into target_owner from public.gyms
   where id = (case when new.gym_low = new.requested_by_gym then new.gym_high else new.gym_low end);
  select name into rname from public.gyms where id = new.requested_by_gym;
  if target_owner is not null then
    insert into public.notifications (user_id, type, title, body)
    values (target_owner, 'gym_request', 'Gym friend request', coalesce(rname, 'A gym') || ' wants to connect');
  end if;
  return new;
end; $$;

drop trigger if exists trg_gym_request on public.gym_friendships;
create trigger trg_gym_request after insert on public.gym_friendships
  for each row execute function public.notify_gym_request();

-- ---------------------------------------------------------------------------
-- Reaction on a public match -> notify the competitors
-- ---------------------------------------------------------------------------
create or replace function public.notify_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; rname text;
begin
  select challenger_id, opponent_id into cid, oid from public.matches where id = new.match_id;
  select display_name into rname from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, type, title, body, match_id)
  select uid, 'reaction', 'New reaction', coalesce(rname, 'Someone') || ' reacted ' || new.reaction || ' to your match', new.match_id
  from (values (cid), (oid)) as t(uid)
  where uid is not null and uid <> new.user_id;
  return new;
end; $$;

drop trigger if exists trg_reaction on public.match_reactions;
create trigger trg_reaction after insert on public.match_reactions
  for each row execute function public.notify_reaction();

-- ---------------------------------------------------------------------------
-- New match message -> notify the other participants
-- ---------------------------------------------------------------------------
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; rid uuid; sname text;
begin
  select challenger_id, opponent_id, referee_id into cid, oid, rid from public.matches where id = new.match_id;
  select display_name into sname from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, type, title, body, match_id)
  select uid, 'message', 'New message', coalesce(sname, 'Member') || ': ' || left(new.body, 60), new.match_id
  from (values (cid), (oid), (rid)) as t(uid)
  where uid is not null and uid <> new.sender_id;
  return new;
end; $$;

drop trigger if exists trg_message on public.match_messages;
create trigger trg_message after insert on public.match_messages
  for each row execute function public.notify_message();
