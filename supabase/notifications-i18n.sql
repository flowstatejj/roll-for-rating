-- ============================================================================
-- Rollr — Notification i18n upgrade
-- Adds a structured `data` jsonb payload to every notification so the app can
-- render the title/body in the member's CURRENT language (English title/body
-- are kept as a fallback for older clients + push payloads).
--
-- Run in the Supabase SQL Editor AFTER notifications.sql. Safe to re-run.
-- ============================================================================

alter table public.notifications add column if not exists data jsonb;

-- ---------------------------------------------------------------------------
-- New challenge -> notify opponent + referee
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select display_name into cname from public.profiles where id = new.challenger_id;
  insert into public.notifications (user_id, type, title, body, data, match_id) values
    (new.opponent_id, 'challenge', 'New challenge', cname || ' challenged you',
      jsonb_build_object('k', 'challenge.new', 'name', cname), new.id),
    (new.referee_id, 'referee', 'You are refereeing', cname || ' set up a match — you''re the ref',
      jsonb_build_object('k', 'referee.new', 'name', cname), new.id);
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Status changes -> accepted / declined / cancelled / completed
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text; oname text; rkind text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select display_name into cname from public.profiles where id = new.challenger_id;
  select display_name into oname from public.profiles where id = new.opponent_id;

  if new.status = 'pending_referee' then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.challenger_id, 'accepted', 'Challenge accepted', oname || ' accepted your challenge',
        jsonb_build_object('k', 'challenge.accepted', 'name', oname), new.id),
      (new.referee_id, 'referee', 'Ready to record', cname || ' vs ' || oname || ' is ready to score',
        jsonb_build_object('k', 'referee.ready', 'c', cname, 'o', oname), new.id);
  elsif new.status = 'declined' then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.challenger_id, 'declined', 'Challenge declined', oname || ' declined your challenge',
        jsonb_build_object('k', 'challenge.declined', 'name', oname), new.id);
  elsif new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.challenger_id, 'cancelled', 'Match cancelled', 'Your match vs ' || oname || ' was cancelled',
        jsonb_build_object('k', 'match.cancelled', 'name', oname), new.id),
      (new.opponent_id, 'cancelled', 'Match cancelled', 'Your match vs ' || cname || ' was cancelled',
        jsonb_build_object('k', 'match.cancelled', 'name', cname), new.id);
  elsif new.status = 'completed' then
    -- challenger row
    rkind := case when new.result = 'draw' then 'result.draw'
                  when new.winner_id = new.challenger_id then 'result.win'
                  else 'result.loss' end;
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.challenger_id, 'result', 'Result recorded',
        case when new.result = 'draw' then 'Draw vs ' || oname
             when new.winner_id = new.challenger_id then 'You beat ' || oname else 'You lost to ' || oname end
        || ' — rating ' || new.challenger_rating_before || ' → ' || new.challenger_rating_after,
        jsonb_build_object('k', rkind, 'name', oname,
          'rb', new.challenger_rating_before, 'ra', new.challenger_rating_after), new.id);
    -- opponent row
    rkind := case when new.result = 'draw' then 'result.draw'
                  when new.winner_id = new.opponent_id then 'result.win'
                  else 'result.loss' end;
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.opponent_id, 'result', 'Result recorded',
        case when new.result = 'draw' then 'Draw vs ' || cname
             when new.winner_id = new.opponent_id then 'You beat ' || cname else 'You lost to ' || cname end
        || ' — rating ' || new.opponent_rating_before || ' → ' || new.opponent_rating_after,
        jsonb_build_object('k', rkind, 'name', cname,
          'rb', new.opponent_rating_before, 'ra', new.opponent_rating_after), new.id);
  end if;
  return new;
end; $$;

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
    insert into public.notifications (user_id, type, title, body, data)
    values (target_owner, 'gym_request', 'Gym friend request', coalesce(rname, 'A gym') || ' wants to connect',
      jsonb_build_object('k', 'gym.request', 'gym', coalesce(rname, 'A gym')));
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Reaction on a public match -> notify the competitors
-- ---------------------------------------------------------------------------
create or replace function public.notify_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; rname text;
begin
  select challenger_id, opponent_id into cid, oid from public.matches where id = new.match_id;
  select display_name into rname from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, type, title, body, data, match_id)
  select uid, 'reaction', 'New reaction', coalesce(rname, 'Someone') || ' reacted ' || new.reaction || ' to your match',
    jsonb_build_object('k', 'reaction.new', 'name', coalesce(rname, 'Someone'), 'emoji', new.reaction), new.match_id
  from (values (cid), (oid)) as t(uid)
  where uid is not null and uid <> new.user_id;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- New match message -> notify the other participants
-- ---------------------------------------------------------------------------
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; rid uuid; sname text;
begin
  select challenger_id, opponent_id, referee_id into cid, oid, rid from public.matches where id = new.match_id;
  select display_name into sname from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, type, title, body, data, match_id)
  select uid, 'message', 'New message', coalesce(sname, 'Member') || ': ' || left(new.body, 60),
    jsonb_build_object('k', 'message.new', 'name', coalesce(sname, 'Member'), 'snippet', left(new.body, 60)), new.match_id
  from (values (cid), (oid), (rid)) as t(uid)
  where uid is not null and uid <> new.sender_id;
  return new;
end; $$;

-- (Triggers themselves are unchanged — they already point at these functions.)
