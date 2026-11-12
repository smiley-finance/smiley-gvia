-- CMS (Collection Messaging Service): the email + SMS flow.
-- Adds NEW objects only, all named cms_*. Does not change any coll_* table, function, policy or the private engine.
-- Same model as the dashboard today: logged-in agents can READ; the only write from the page is an RPC.
-- Sending (and the messages log) is done by the Edge Function cms-send with the service role.
-- Undo everything: rollback.sql

-- 1. the email/SMS flow's own status per customer (separate from the WhatsApp status in coll_cases.status)
create table if not exists public.cms_cases (
  phone            text primary key,                       -- same key as coll_cases.phone (no FK: the engine may rewrite coll_cases freely)
  email_status     text not null default 'חדש'
                   check (email_status in ('חדש','נשלחה הודעה','בתהליך','בבדיקה/המתנה','בוצע – ממתין לאימות','נשלח מכתב התראה','סגור')),
  email_touched_at timestamptz,                            -- first time the flow moved (stage 1 sent / agent changed it)
  email_last_at    timestamptz,                            -- last change
  updated_at       timestamptz not null default now()
);

-- 2. every email and SMS we sent (one row per channel per stage)
create table if not exists public.cms_messages (
  id          bigint generated always as identity primary key,
  phone       text not null,
  stage       smallint not null check (stage between 1 and 4),
  channel     text not null check (channel in ('email','sms')),
  "to"        text not null,
  subject     text,
  body        text,
  attach      text,
  parts       smallint,                                    -- SMS parts (Hebrew: 70 chars = 1, 67 per part after)
  due         text,                                        -- the deadline the customer was given, DD.MM.YYYY
  status      text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  error       text,
  provider_id text,                                        -- SMS provider message id / email Message-ID, for delivery reports
  auto        boolean not null default false,              -- true = sent by the scheduler (stages 2-4)
  by_email    text,                                        -- the agent who clicked (null for the scheduler)
  at          timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cms_messages_phone on public.cms_messages (phone, at desc);
create index if not exists cms_messages_provider on public.cms_messages (provider_id);
-- the database itself refuses a double send of the same stage on the same channel (agent click + scheduler at the same second)
create unique index if not exists cms_messages_once on public.cms_messages (phone, stage, channel) where status <> 'failed';

-- 3. history of the email/SMS flow (like coll_events for WhatsApp)
create table if not exists public.cms_events (
  id       bigint generated always as identity primary key,
  phone    text not null,
  status   text,
  note     text,
  by_email text,
  at       timestamptz not null default now()
);
create index if not exists cms_events_phone on public.cms_events (phone, at desc);

-- 4. scheduler runs (the connections check shows the last one)
create table if not exists public.cms_runs (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  kind   text not null,                                    -- 'auto'
  sent   int not null default 0,
  note   text
);

-- read: logged-in users only (same as coll_*). No insert/update/delete policies: writes go through the RPC or the Edge Function.
alter table public.cms_cases    enable row level security;
alter table public.cms_messages enable row level security;
alter table public.cms_events   enable row level security;
alter table public.cms_runs     enable row level security;
drop policy if exists cms_cases_read    on public.cms_cases;
drop policy if exists cms_messages_read on public.cms_messages;
drop policy if exists cms_events_read   on public.cms_events;
drop policy if exists cms_runs_read     on public.cms_runs;
create policy cms_cases_read    on public.cms_cases    for select to authenticated using (true);
create policy cms_messages_read on public.cms_messages for select to authenticated using (true);
create policy cms_events_read   on public.cms_events   for select to authenticated using (true);
create policy cms_runs_read     on public.cms_runs     for select to authenticated using (true);
revoke all on public.cms_cases, public.cms_messages, public.cms_events, public.cms_runs from anon;
grant select on public.cms_cases, public.cms_messages, public.cms_events, public.cms_runs to authenticated;

-- the page's only write for this flow: change the email/SMS status by hand (like coll_set_status for WhatsApp)
create or replace function public.cms_set_status(p_phone text, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not logged in';
  end if;
  if p_status not in ('חדש','נשלחה הודעה','בתהליך','בבדיקה/המתנה','בוצע – ממתין לאימות','נשלח מכתב התראה','סגור') then
    raise exception 'invalid status';
  end if;
  if not exists (select 1 from coll_cases where phone = p_phone) then
    raise exception 'case not found';
  end if;
  insert into cms_cases (phone, email_status, email_touched_at, email_last_at, updated_at)
  values (p_phone, p_status, case when p_status <> 'חדש' then v_now end, v_now, v_now)
  on conflict (phone) do update
    set email_status     = excluded.email_status,
        email_touched_at = coalesce(cms_cases.email_touched_at, excluded.email_touched_at),
        email_last_at    = v_now,
        updated_at       = v_now;
  insert into cms_events (phone, status, note, by_email)
  values (p_phone, p_status, left(p_note, 500), auth.jwt() ->> 'email');
end;
$$;
revoke all on function public.cms_set_status(text, text, text) from public, anon;
grant execute on function public.cms_set_status(text, text, text) to authenticated;
