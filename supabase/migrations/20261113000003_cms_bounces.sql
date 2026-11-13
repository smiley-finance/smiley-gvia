-- CMS: email bounces.
-- 1. a new message status "bounced" (Gmail accepted the email, then the customer's server sent it back)
-- 2. pg_cron every 15 min -> Edge Function cms-bounce (reads the collections@ inbox READ ONLY, sends nothing)
-- A bounced email still counts as "stage sent" (the SMS of that stage usually went out), so the timer goes on as before;
-- the agent sees the bounce in the log and in the customer's history and fixes the address.
-- Undo: select cron.unschedule('cms-bounce');  (the extra status value is harmless)

alter table public.cms_messages drop constraint if exists cms_messages_status_check;
alter table public.cms_messages add constraint cms_messages_status_check
  check (status in ('queued','sent','delivered','failed','bounced'));

select cron.unschedule('cms-bounce') where exists (select 1 from cron.job where jobname = 'cms-bounce');
select cron.schedule(
  'cms-bounce',
  '7,22,37,52 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cms_project_url') || '/functions/v1/cms-bounce',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cms-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'cms_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
