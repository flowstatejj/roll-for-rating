-- ============================================================================
-- Roll for Rating — Push notifications + per-category preferences + new events
-- Run in the Supabase SQL editor. Additive + safe to re-run.
--
-- Delivery model: every user-facing notification is already a row in
-- public.notifications (inserted server-side by triggers/RPCs). A Supabase
-- Database Webhook on INSERT of that table calls the `send-push` edge function,
-- which checks the recipient's per-category toggle (profiles.notif_prefs),
-- looks up their Expo push tokens, and sends via Expo's push service.
--
-- This file adds: the push-token store, the prefs column + category mapping,
-- three new notification sources the user asked for (video posted, weekly
-- league matchup, league announcements), and the league_messages feature.
-- It does NOT create the webhook (dashboard step) or the edge function (deploy).
-- ============================================================================

-- --- 1. Expo push token store ----------------------------------------------
create table if not exists public.expo_push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text,
  updated_at  timestamptz not null default now()
);
create index if not exists expo_push_tokens_user_idx on public.expo_push_tokens (user_id);
alter table public.expo_push_tokens enable row level security;

-- A device token belongs to whoever last registered it (re-login moves it).
drop policy if exists "ept_select_own" on public.expo_push_tokens;
create policy "ept_select_own" on public.expo_push_tokens
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "ept_delete_own" on public.expo_push_tokens;
create policy "ept_delete_own" on public.expo_push_tokens
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.expo_push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end; $$;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.expo_push_tokens where token = p_token and user_id = auth.uid();
$$;
grant execute on function public.unregister_push_token(text) to authenticated;

-- --- 2. Per-category preferences -------------------------------------------
-- Toggles affect PUSH delivery only; the in-app notification row is always
-- written (the bell stays a complete history). Missing key = enabled (opt-out).
alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

-- Map a notification `type` to one of the 8 user-facing toggle categories.
create or replace function public.notif_category(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'challenge'        then 'challenges'
    when 'accepted'         then 'challenges'
    when 'declined'         then 'challenges'
    when 'cancelled'        then 'challenges'
    when 'referee'          then 'challenges'
    when 'result'           then 'results'
    when 'message'          then 'messages'
    when 'video'            then 'videos'
    when 'reaction'         then 'reactions'
    when 'friend_request'   then 'friends'
    when 'friend_accepted'  then 'friends'
    when 'league_invite'    then 'leagues'
    when 'tournament_invite' then 'leagues'
    when 'league_matchup'   then 'leagues'
    when 'league_message'   then 'leagues'
    when 'gym_request'      then 'gym'
    else 'other'  -- e.g. match_disputed (admins) — always delivered
  end;
$$;

-- --- 3. NEW: video posted to a match -> notify the other participants ------
create or replace function public.notify_video_posted()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; rid uuid; uname text;
begin
  select challenger_id, opponent_id, referee_id into cid, oid, rid
    from public.matches where id = new.match_id;
  select display_name into uname from public.profiles where id = new.uploader_id;
  insert into public.notifications (user_id, type, title, body, data, match_id)
  select uid, 'video', 'New match video',
    coalesce(uname,'Someone') || ' posted a video of your match',
    jsonb_build_object('k','video.new','name',coalesce(uname,'Someone')), new.match_id
  from (values (cid),(oid),(rid)) as t(uid)
  where uid is not null and uid <> new.uploader_id;
  return new;
end; $$;
drop trigger if exists trg_video_posted on public.match_videos;
create trigger trg_video_posted after insert on public.match_videos
  for each row execute function public.notify_video_posted();

-- --- 4. NEW: weekly league matchup posted -> notify both players -----------
create or replace function public.notify_league_matchup()
returns trigger language plpgsql security definer set search_path = public as $$
declare lname text; na text; nb text;
begin
  select name into lname from public.leagues where id = new.league_id;
  select display_name into na from public.profiles where id = new.player_a;
  select display_name into nb from public.profiles where id = new.player_b;
  if new.player_a is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (new.player_a, 'league_matchup', 'Weekly matchup',
      coalesce(lname,'Your league') || ': you face ' || coalesce(nb,'a bye') || ' this week',
      jsonb_build_object('k','league.matchup','name',coalesce(lname,'Your league'),
        'o',coalesce(nb,''),'lid',new.league_id::text));
  end if;
  if new.player_b is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (new.player_b, 'league_matchup', 'Weekly matchup',
      coalesce(lname,'Your league') || ': you face ' || coalesce(na,'someone') || ' this week',
      jsonb_build_object('k','league.matchup','name',coalesce(lname,'Your league'),
        'o',coalesce(na,''),'lid',new.league_id::text));
  end if;
  return new;
end; $$;
drop trigger if exists trg_league_matchup on public.league_fixtures;
create trigger trg_league_matchup after insert on public.league_fixtures
  for each row execute function public.notify_league_matchup();

-- --- 5. NEW: league announcements (organizer posts -> members notified) ----
create table if not exists public.league_messages (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists league_messages_league_idx
  on public.league_messages (league_id, created_at desc);
alter table public.league_messages enable row level security;

-- Members + the organizer can read; inserts only via the RPC below.
drop policy if exists "lm_read_members" on public.league_messages;
create policy "lm_read_members" on public.league_messages
  for select to authenticated using (
    exists (select 1 from public.league_members m
            where m.league_id = league_messages.league_id and m.user_id = auth.uid())
    or exists (select 1 from public.leagues l
               where l.id = league_messages.league_id and l.created_by = auth.uid())
  );

-- Organizer-only post; writes the message AND notifies every other member.
create or replace function public.post_league_message(p_lid uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare lname text; aname text; v_body text := trim(coalesce(p_body, ''));
begin
  if not exists (select 1 from public.leagues where id = p_lid and created_by = auth.uid()) then
    raise exception 'Only the organizer can post announcements';
  end if;
  if length(v_body) = 0 then raise exception 'Message is empty'; end if;

  insert into public.league_messages (league_id, author_id, body) values (p_lid, auth.uid(), v_body);

  select name into lname from public.leagues where id = p_lid;
  select display_name into aname from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, type, title, body, data)
  select m.user_id, 'league_message',
    coalesce(lname,'League') || ' announcement',
    coalesce(aname,'Organizer') || ': ' || left(v_body, 80),
    jsonb_build_object('k','league.message','name',coalesce(lname,'League'),
      'snippet',left(v_body,80),'lid',p_lid::text)
  from public.league_members m
  where m.league_id = p_lid and m.user_id <> auth.uid();
end; $$;
grant execute on function public.post_league_message(uuid, text) to authenticated;

-- Live updates for the announcements list (best-effort; ignore if already added).
do $$ begin
  alter publication supabase_realtime add table public.league_messages;
exception when duplicate_object then null; when others then null; end $$;
