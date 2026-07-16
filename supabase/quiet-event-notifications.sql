-- ============================================================================
-- Roll for Rating - Quiet notifications for in-person events
-- Run in the Supabase SQL editor AFTER notifications.sql, notifications-i18n.sql
-- AND fix-waived-match-notify.sql. Safe to re-run.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS notify_match_created and notify_match_status. They are also
-- defined in notifications.sql, notifications-i18n.sql and
-- fix-waived-match-notify.sql - if ANY of those is ever re-run, re-run THIS
-- file afterwards.
--
-- WHY: tournament bouts and league matches happen IN PERSON - the referee is
-- standing on the mat. Notifying the referee for every bout meant a host
-- recording a 60-bout tournament got 60 "You are refereeing" rows (and pushes).
-- Announcements/messages cover anything that actually needs saying.
--
-- Changes vs the prior version (everything else identical):
--   * referee notifications ('You are refereeing' / 'Ready to record') are
--     SKIPPED when the match belongs to a tournament OR a league
--   * the 'challenge' notification is SKIPPED for tournament bouts - they are
--     created already settled by record_bout_result, so "X challenged you" was
--     factually wrong noise (league challenges keep it: the opponent still has
--     to accept the fixture match in-app)
--   * result notifications are unchanged (members still get "Result recorded")
-- ============================================================================

create or replace function public.notify_match_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select display_name into cname from public.profiles where id = new.challenger_id;

  -- Tournament bouts are inserted already fought + settled: no "challenge".
  if new.tournament_id is null then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.opponent_id, 'challenge', 'New challenge', cname || ' challenged you',
        jsonb_build_object('k', 'challenge.new', 'name', cname), new.id);
  end if;

  -- Referee: only for standalone matches (waived matches have no referee, and
  -- tournament/league referees are there in person - no notification needed).
  if new.referee_id is not null and new.tournament_id is null and new.league_id is null then
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (new.referee_id, 'referee', 'You are refereeing', cname || ' set up a match — you''re the ref',
        jsonb_build_object('k', 'referee.new', 'name', cname), new.id);
  end if;

  return new;
end; $$;

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
    -- Waived matches have no referee; tournament/league refs are there in person.
    if new.referee_id is not null and new.tournament_id is null and new.league_id is null then
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

-- Clean out any referee rows already created by tournament/league bouts.
delete from public.notifications n
using public.matches m
where n.match_id = m.id
  and n.type = 'referee'
  and (m.tournament_id is not null or m.league_id is not null);

notify pgrst, 'reload schema';
select 'quiet event notifications installed' as ok;
