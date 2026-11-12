-- CMS scheduler: every 15 minutes the database calls the Edge Function cms-send with {"auto": true}.
-- It runs on the server, with nobody logged in. The function itself checks the window
-- (Sun-Thu 08:00-20:00 Israel time, no holidays), so off-hours runs just log "closed" and send nothing.
--
-- BEFORE running this file, once, in the SQL editor (values are NOT kept in any file):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'cms_project_url');
--   select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'cms_cron_secret');
-- Stop the scheduler any time:  select cron.unschedule('cms-auto');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('cms-auto') where exists (select 1 from cron.job where jobname = 'cms-auto');

select cron.schedule(
  'cms-auto',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cms_project_url') || '/functions/v1/cms-send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cms-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'cms_cron_secret')),
    body    := '{"auto": true}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
