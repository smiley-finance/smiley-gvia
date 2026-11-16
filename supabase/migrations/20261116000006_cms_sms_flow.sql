-- CMS: SMS becomes its own flow (16.11.2026): its own status, history and timer, like the email flow and WhatsApp.
-- ADDITIVE ONLY: new empty columns. No existing row is changed. An empty sms_status means "from before the split":
-- the code then follows the email status (see send.js smsStatus()).
alter table public.cms_cases  add column if not exists sms_status     text;
alter table public.cms_cases  add column if not exists sms_touched_at timestamptz;
alter table public.cms_cases  add column if not exists sms_last_at    timestamptz;
alter table public.cms_events add column if not exists flow text check (flow in ('email','sms'));   -- null = email (older rows)

-- the SMS status, changed by a logged-in agent on the 📱 SMS tab (separate from cms_set_status, which stays the email one)
create or replace function public.cms_set_sms_status(p_phone text, p_status text, p_note text default null)
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
  insert into cms_cases (phone, sms_status, sms_touched_at, sms_last_at, updated_at)
  values (p_phone, p_status, case when p_status <> 'חדש' then v_now end, v_now, v_now)
  on conflict (phone) do update
    set sms_status     = excluded.sms_status,
        sms_touched_at = coalesce(cms_cases.sms_touched_at, excluded.sms_touched_at),
        sms_last_at    = v_now,
        updated_at     = v_now;
  insert into cms_events (phone, status, note, by_email, flow)
  values (p_phone, p_status, left(p_note, 500), auth.jwt() ->> 'email', 'sms');
end;
$$;
revoke all on function public.cms_set_sms_status(text, text, text) from public, anon;
grant execute on function public.cms_set_sms_status(text, text, text) to authenticated;
