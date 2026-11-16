-- Commission backfill (16.11.2026, owner's decision): email/SMS sends a clicker made count as agent work, like WhatsApp.
-- Cases that got a manual email/SMS send (by an agent, or a manager who earns) but have no agent mark get the mark at the
-- time of their FIRST such send that went out. Only coll_cases.agent_touched_at (+ updated_at) changes, only where it was empty.
-- Every changed row is saved first in cms_backfill_commission, so it can be put back exactly (see rollback.sql).
create table if not exists public.cms_backfill_commission (
  phone text primary key, old_agent_touched_at timestamptz, new_agent_touched_at timestamptz not null,
  old_updated_at timestamptz, done_at timestamptz not null default now());
alter table public.cms_backfill_commission enable row level security;   -- no policies: server only

with snd as (
  select m.phone, min(m.at) first_manual
  from public.cms_messages m left join public.coll_admins a on a.email = m.by_email
  where m.by_email is not null and m.by_email <> 'test' and (a.email is null or a.earns) and m.status not in ('failed','bounced')
  group by m.phone)
insert into public.cms_backfill_commission (phone, old_agent_touched_at, new_agent_touched_at, old_updated_at)
select c.phone, c.agent_touched_at, s.first_manual, c.updated_at
from snd s join public.coll_cases c on c.phone = s.phone
where c.agent_touched_at is null
on conflict (phone) do nothing;

update public.coll_cases c set agent_touched_at = b.new_agent_touched_at, updated_at = now()
from public.cms_backfill_commission b
where b.phone = c.phone and c.agent_touched_at is null;
