-- ============================================================================
-- Roll for Rating — Content moderation hardening (App Store Guideline 1.2)
-- Run in the Supabase SQL editor (after safety.sql). Safe to re-run.
--
-- Builds on safety.sql (block + report + EULA) with the precautions still
-- missing for an app with user-generated content:
--   1. an automated objectionable-content filter on display names + chat
--   2. blocking also FILES A REPORT (notifies moderators) + see Watch filter
--   3. banned / eject — a banned user can't post anything
--   4. admin moderation RPCs — review reports, hide content, ban users (24h)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Objectionable-content filter
-- Masks a base list of slurs + strong profanity with asterisks. Not exhaustive;
-- it's the automated first line, backed by user reporting/blocking + admin
-- takedown within 24h.
-- ---------------------------------------------------------------------------
create or replace function public.mask_objectionable(p_text text)
returns text language plpgsql immutable as $$
declare
  w text;
  out_text text := p_text;
  words text[] := array[
    'fuck','shit','bitch','asshole','bastard','cunt','dick','piss',
    'nigger','nigga','faggot','fag','retard','spic','chink','kike','tranny','whore','slut'
  ];
begin
  if out_text is null then return null; end if;
  foreach w in array words loop
    -- case-insensitive; the word plus any trailing word chars (fucking, etc.)
    out_text := regexp_replace(out_text, '\m' || w || '\w*', repeat('*', length(w)), 'gi');
  end loop;
  return out_text;
end; $$;

-- Display name (public, shown on leaderboards/Watch/profiles).
create or replace function public.tg_mask_display_name()
returns trigger language plpgsql as $$
begin
  new.display_name := public.mask_objectionable(new.display_name);
  return new;
end; $$;
drop trigger if exists trg_mask_display_name on public.profiles;
create trigger trg_mask_display_name before insert or update of display_name on public.profiles
  for each row execute function public.tg_mask_display_name();

-- Match chat.
create or replace function public.tg_mask_message()
returns trigger language plpgsql as $$
begin
  new.body := public.mask_objectionable(new.body);
  return new;
end; $$;
drop trigger if exists trg_mask_message on public.match_messages;
create trigger trg_mask_message before insert on public.match_messages
  for each row execute function public.tg_mask_message();

-- ---------------------------------------------------------------------------
-- 2. Blocking also notifies the developer (App Store 1.2)
-- A new block auto-files an open report so it lands in the moderation queue.
-- ---------------------------------------------------------------------------
create or replace function public.tg_block_files_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_reports (reporter_id, reported_user_id, reason, details, status)
  values (new.blocker_id, new.blocked_id, 'blocked',
          'Auto-filed when a user blocked this member — review for objectionable behavior.', 'open');
  return new;
end; $$;
drop trigger if exists trg_block_files_report on public.blocked_users;
create trigger trg_block_files_report after insert on public.blocked_users
  for each row execute function public.tg_block_files_report();

-- ---------------------------------------------------------------------------
-- 3. Banned / eject
-- A banned member can't create matches, post chat, or upload videos; the app
-- also signs them out on load (see the client).
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists banned boolean not null default false;

create or replace function public.is_banned(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select banned from public.profiles where id = p_uid), false);
$$;

create or replace function public.enforce_not_banned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned(auth.uid()) then
    raise exception 'Your account has been suspended for violating our community guidelines.';
  end if;
  return new;
end; $$;
drop trigger if exists trg_not_banned_matches on public.matches;
create trigger trg_not_banned_matches before insert on public.matches
  for each row execute function public.enforce_not_banned();
drop trigger if exists trg_not_banned_messages on public.match_messages;
create trigger trg_not_banned_messages before insert on public.match_messages
  for each row execute function public.enforce_not_banned();
drop trigger if exists trg_not_banned_videos on public.match_videos;
create trigger trg_not_banned_videos before insert on public.match_videos
  for each row execute function public.enforce_not_banned();

-- ---------------------------------------------------------------------------
-- 4. Admin moderation queue (act within 24h)
-- ---------------------------------------------------------------------------
-- Open reports for the in-app moderation screen (admins only).
create or replace function public.admin_user_reports()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', ur.id,
      'created_at', ur.created_at,
      'reason', ur.reason,
      'details', ur.details,
      'reporter_name', rp.display_name,
      'reported_id', ur.reported_user_id,
      'reported_name', tp.display_name,
      'reported_banned', tp.banned,
      'match_id', ur.match_id,
      'video_count', (select count(*) from public.match_videos v where v.match_id = ur.match_id)
    ) as r
    from public.user_reports ur
    left join public.profiles rp on rp.id = ur.reporter_id
    left join public.profiles tp on tp.id = ur.reported_user_id
    where ur.status = 'open' and public.is_admin()
    order by ur.created_at desc
  ) q;
$$;
grant execute on function public.admin_user_reports() to authenticated;

-- Admin acts on a report. p_action:
--   'dismiss' — close it, no action.
--   'remove'  — hide the reported match from Watch (is_public = false).
--   'ban'     — ban the reported user, hide all their public matches, and close
--               every open report against them.
create or replace function public.admin_resolve_user_report(p_report_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.user_reports;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_action not in ('dismiss','remove','ban') then raise exception 'Invalid action'; end if;
  select * into r from public.user_reports where id = p_report_id;
  if not found then raise exception 'Report not found'; end if;

  -- Remove the reported content from public view.
  if p_action in ('remove','ban') and r.match_id is not null then
    update public.matches set is_public = false where id = r.match_id;
  end if;

  -- Eject the reported user.
  if p_action = 'ban' and r.reported_user_id is not null then
    update public.profiles set banned = true where id = r.reported_user_id;
    -- Ban the AUTH user too: GoTrue then refuses token refresh and re-login, so
    -- the ban actually revokes API access (the current access token still
    -- expires within ~1h). Without this, banned=true only blocks the three
    -- insert triggers below and the client-side sign-out — a banned user could
    -- keep using a valid JWT, or just sign back in, and retain full API access.
    update auth.users set banned_until = now() + interval '100 years'
      where id = r.reported_user_id;
    update public.matches set is_public = false
      where is_public and (challenger_id = r.reported_user_id or opponent_id = r.reported_user_id);
    update public.user_reports set status = 'actioned'
      where reported_user_id = r.reported_user_id and status = 'open' and id <> p_report_id;
  end if;

  update public.user_reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end
   where id = p_report_id;
end; $$;
grant execute on function public.admin_resolve_user_report(uuid, text) to authenticated;

-- Refresh PostgREST so the new RPCs are callable immediately.
notify pgrst, 'reload schema';

select 'content-moderation installed' as ok;
