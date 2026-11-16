-- CMS main switches: an agent can turn ALL email or ALL SMS sending off (and back on) from the dashboard.
-- Off = that channel is skipped on every send (agent clicks and the automatic stages 2-4). Nothing else changes.
create table if not exists public.cms_switches (
  channel    text primary key check (channel in ('email','sms')),
  is_on      boolean not null default true,
  by_email   text,
  updated_at timestamptz not null default now()
);
insert into public.cms_switches (channel) values ('email'), ('sms') on conflict do nothing;
alter table public.cms_switches enable row level security;
drop policy if exists cms_switches_read on public.cms_switches;
create policy cms_switches_read on public.cms_switches for select to authenticated using (true);

-- the only way to change a switch: a logged-in agent, through this function (it also writes who and when)
create or replace function public.cms_set_switch(p_channel text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel'; end if;
  update cms_switches set is_on = p_on, by_email = auth.jwt() ->> 'email', updated_at = now() where channel = p_channel;
  insert into cms_runs (kind, sent, note)
  values ('switch', 0, (case p_channel when 'email' then '📧 מייל' else '💬 SMS' end) || (case when p_on then ' הופעל' else ' כובה' end)
          || ' במתג הראשי · ' || coalesce(auth.jwt() ->> 'email', ''));
end; $$;
revoke all on function public.cms_set_switch(text, boolean) from public, anon;
grant execute on function public.cms_set_switch(text, boolean) to authenticated;
