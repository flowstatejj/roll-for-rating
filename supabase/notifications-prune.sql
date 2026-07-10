-- ============================================================================
-- Roll for Rating — auto-prune old notifications
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Notifications older than 30 days are deleted daily. Nobody revisits a
-- month-old "challenge declined", the app's history UI shows two weeks by
-- default, and unbounded growth of this table was flagged in the 100k audit.
-- ============================================================================

-- Clean up now.
delete from public.notifications where created_at < now() - interval '30 days';

-- Schedule the daily prune (pg_cron ships with Supabase; runs as postgres).
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('prune-old-notifications');
exception when others then
  null; -- job didn't exist yet
end $$;

select cron.schedule(
  'prune-old-notifications',
  '13 9 * * *', -- daily 09:13 UTC (~3 AM Mountain)
  $$delete from public.notifications where created_at < now() - interval '30 days'$$
);
