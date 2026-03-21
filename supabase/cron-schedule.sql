-- Newsletter Cron Schedule — Run in Supabase SQL Editor
-- IMPORTANT: First enable pg_cron and pg_net extensions in
-- Dashboard > Database > Extensions (search and enable both)
--
-- Schedule: Every day at 3:40 AM ICT = 20:40 UTC (previous day)
-- Replace YOUR_PROJECT_REF with your Supabase project ref (Settings > General)

-- Remove old schedule if exists
select cron.unschedule('generate-daily-newsletter');

-- Schedule daily at 20:40 UTC = 3:40 AM ICT, every day (* * * = every day of month, every month, every day of week)
select cron.schedule(
  'generate-daily-newsletter',
  '40 20 * * *',
  $$
  select net.http_post(
    url := 'https://bjzekjyhiylhdekmwofd.supabase.co/functions/v1/generate-newsletter',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Verify it's scheduled
select jobid, jobname, schedule, command from cron.job;
