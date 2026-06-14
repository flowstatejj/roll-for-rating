-- ============================================================================
-- BUGFIX — waived/filmed matches (no referee) could not be created.
--
-- notify_match_created() inserted a "you're the referee" notification with
-- new.referee_id. On a waived match referee_id is NULL, which violated
-- notifications.user_id NOT NULL and aborted the whole match insert — so the
-- entire "film it, no referee" flow was broken at creation.
--
-- Fix: always notify the opponent; notify the referee only when one exists.
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.notify_match_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select display_name into cname from public.profiles where id = new.challenger_id;

  insert into public.notifications (user_id, type, title, body, data, match_id) values
    (new.opponent_id, 'challenge', 'New challenge', cname || ' challenged you',
      jsonb_build_object('k', 'challenge.new', 'name', cname), new.id);

  -- Only when there's actually a referee (waived/filmed matches have none).
  if new.referee_id is not null then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.referee_id, 'referee', 'You are refereeing', cname || ' set up a match — you''re the ref',
        jsonb_build_object('k', 'referee.new', 'name', cname), new.id);
  end if;

  return new;
end; $$;

-- Same NULL-referee bug when a waived match is ACCEPTED (status -> pending_referee):
-- the "Ready to record" notification targeted new.referee_id. Guard it.
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
        jsonb_build_object('k', 'challenge.accepted', 'name', oname), new.id);
    -- Filmed/waived matches have no referee.
    if new.referee_id is not null then
      insert into public.notifications (user_id, type, title, body, data, match_id) values
        (new.referee_id, 'referee', 'Ready to record', cname || ' vs ' || oname || ' is ready to score',
          jsonb_build_object('k', 'referee.ready', 'c', cname, 'o', oname), new.id);
    end if;
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
