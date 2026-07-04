-- ============================================================================
-- Roll for Rating - match-video retention (14 days).
-- Run in the Supabase SQL editor. Schedules a daily job that calls the
-- purge-old-videos edge function, which deletes storage files + match_videos
-- rows older than 14 days. Safe to re-run (re-schedules the one job).
--
-- BEFORE running:
--   1. Deploy the function:  supabase functions deploy purge-old-videos --no-verify-jwt
--   2. (recommended) set its secret:  supabase secrets set PURGE_SECRET=<random-string>
--   3. Fill the two placeholders below with your project ref + the SAME secret.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule so re-running this file doesn't stack duplicates.
select cron.unschedule('purge-old-match-videos')
where exists (select 1 from cron.job where jobname = 'purge-old-match-videos');

-- Daily at 09:00 UTC. Fires the purge edge function (which enforces the window).
select cron.schedule(
  'purge-old-match-videos',
  '0 9 * * *',
  $CRON$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-old-videos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-secret', '<PURGE_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $CRON$
);

-- To run it once immediately (optional, to clear any existing backlog), call the
-- function directly with the same header, or:
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-old-videos',
--     headers := jsonb_build_object('Content-Type','application/json','x-purge-secret','<PURGE_SECRET>'),
--     body := '{}'::jsonb);
