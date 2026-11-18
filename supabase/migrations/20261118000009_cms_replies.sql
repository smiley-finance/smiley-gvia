-- CMS: customers' email replies (18.11.2026).
-- 1. cms_replies: one row per customer reply in the collections@ inbox (written by the Edge Function cms-inbox only).
--    Keeps a short snippet (the customer's new text, max 500 chars), never attachments.
-- 2. cms_reply_set: the page's only write: change the reply type by hand / mark it handled.
-- 3. pg_cron every 15 min -> cms-inbox (reads the inbox READ ONLY, sends nothing).
-- Undo: select cron.unschedule('cms-inbox'); drop function public.cms_reply_set(bigint, text, boolean); drop table public.cms_replies;

create table if not exists public.cms_replies (
  id          bigint generated always as identity primary key,
  msg_id      text not null unique,                        -- the reply's Message-ID: each reply is saved once
  phone       text,                                        -- the customer (null = could not be matched safely)
  from_email  text,
  subject     text,
  snippet     text,
  kind        text not null default 'other' check (kind in ('paid','legal','sub','notrecv','pay','who','call','other')),
  kind_by     text,                                        -- null = sorted by the keyword rules, else the agent who changed it
  at          timestamptz not null,                        -- when the customer wrote
  handled_at  timestamptz,
  handled_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists cms_replies_phone on public.cms_replies (phone, at desc);
create index if not exists cms_replies_open on public.cms_replies (at desc) where handled_at is null;

alter table public.cms_replies enable row level security;
drop policy if exists cms_replies_read on public.cms_replies;
create policy cms_replies_read on public.cms_replies for select to authenticated using (coll_can_read());
revoke all on public.cms_replies from anon;
grant select on public.cms_replies to authenticated;

create or replace function public.cms_reply_set(p_id bigint, p_kind text default null, p_handled boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not coll_can_read() then
    raise exception 'not allowed';
  end if;
  if p_kind is not null and p_kind not in ('paid','legal','sub','notrecv','pay','who','call','other') then
    raise exception 'invalid kind';
  end if;
  update cms_replies set
    kind       = coalesce(p_kind, kind),
    kind_by    = case when p_kind is not null then auth.jwt() ->> 'email' else kind_by end,
    handled_at = case when p_handled is null then handled_at when p_handled then now() else null end,
    handled_by = case when p_handled is null then handled_by when p_handled then auth.jwt() ->> 'email' else null end
  where id = p_id;
end;
$$;
revoke all on function public.cms_reply_set(bigint, text, boolean) from public, anon;
grant execute on function public.cms_reply_set(bigint, text, boolean) to authenticated;

-- the dashboard updates live when a reply arrives
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cms_replies') then
    alter publication supabase_realtime add table public.cms_replies;
  end if;
end $$;

select cron.unschedule('cms-inbox') where exists (select 1 from cron.job where jobname = 'cms-inbox');
select cron.schedule(
  'cms-inbox',
  '3,18,33,48 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'cms_project_url') || '/functions/v1/cms-inbox',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cms-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'cms_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
