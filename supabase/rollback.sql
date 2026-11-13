-- CMS: remove everything the CMS added. coll_* tables and the WhatsApp flow are not touched.
-- (Also delete the Edge Functions cms-send, cms-health, cms-report in the dashboard, and the cms_* vault secrets.)
select cron.unschedule('cms-bounce') where exists (select 1 from cron.job where jobname = 'cms-bounce');
select cron.unschedule('cms-auto') where exists (select 1 from cron.job where jobname = 'cms-auto');
drop function if exists public.cms_set_status(text, text, text);
drop table if exists public.cms_runs;
drop table if exists public.cms_events;
drop table if exists public.cms_messages;
drop table if exists public.cms_cases;
