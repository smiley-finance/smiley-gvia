-- CMS: remove everything the CMS added. coll_* tables and the WhatsApp flow are not touched.
-- commission backfill (20261116000008): put the agent mark back where it was, then drop the backup
update public.coll_cases c set agent_touched_at = b.old_agent_touched_at from public.cms_backfill_commission b where b.phone = c.phone and c.agent_touched_at = b.new_agent_touched_at;
drop table if exists public.cms_backfill_commission;
-- live updates (20261116000007): stop announcing changes (settings only)
do $$ declare t text; begin foreach t in array array['coll_cases','coll_payments','coll_payouts','coll_events','cms_messages','cms_events','cms_cases','cms_switches'] loop
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime drop table public.%I', t); end if; end loop; end $$;
-- (Also delete the Edge Functions cms-send, cms-health, cms-report in the dashboard, and the cms_* vault secrets.)
select cron.unschedule('cms-bounce') where exists (select 1 from cron.job where jobname = 'cms-bounce');
select cron.unschedule('cms-auto') where exists (select 1 from cron.job where jobname = 'cms-auto');
drop function if exists public.cms_set_sms_status(text, text, text);
alter table if exists public.cms_events drop column if exists flow;
alter table if exists public.cms_cases drop column if exists sms_status, drop column if exists sms_touched_at, drop column if exists sms_last_at;
drop function if exists public.cms_set_switch(text, boolean);
drop table if exists public.cms_switches;
drop function if exists public.cms_set_status(text, text, text);
drop table if exists public.cms_runs;
drop table if exists public.cms_events;
drop table if exists public.cms_messages;
drop table if exists public.cms_cases;
