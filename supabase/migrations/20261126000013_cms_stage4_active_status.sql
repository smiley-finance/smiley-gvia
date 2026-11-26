-- Stage-4 "final reminder" cases can stay ACTIVE instead of auto-closing (26.11.2026).
-- New email_status "תזכורת אחרונה נשלחה" so a case that got the stage-4 letter shows in the
-- stage-4 column of the 📧 מייל board (which only lists non-closed cases) instead of vanishing into "סגור".
-- Schema only: widens the email_status CHECK + both status-set RPC whitelists. No customer rows changed here.
-- (The one-time reopen of already-closed stage-4 cases was applied separately, non-paid only, backed up to
--  table cms_stage4_reopen_backup for a clean revert. The stage-4 SEND still closes the case unless that is
--  also changed in templates.js STATUS_AFTER[4] — kept as-is on purpose.)

alter table public.cms_cases drop constraint if exists cms_cases_email_status_check;
alter table public.cms_cases add constraint cms_cases_email_status_check
  check (email_status = any (array['חדש','נשלחה הודעה','בתהליך','בבדיקה/המתנה','בוצע – ממתין לאימות','נשלח מכתב התראה','תזכורת אחרונה נשלחה','סגור']));

create or replace function public.cms_set_status(p_phone text, p_status text, p_note text default null)
  returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_now timestamptz := now();
begin
  if not public.coll_can_read() then raise exception 'אין הרשאה'; end if;
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if p_status not in ('חדש','נשלחה הודעה','בתהליך','בבדיקה/המתנה','בוצע – ממתין לאימות','נשלח מכתב התראה','תזכורת אחרונה נשלחה','סגור') then
    raise exception 'invalid status';
  end if;
  if not exists (select 1 from coll_cases where phone = p_phone) then raise exception 'case not found'; end if;
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
$function$;

create or replace function public.cms_set_sms_status(p_phone text, p_status text, p_note text default null)
  returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_now timestamptz := now();
begin
  if not public.coll_can_read() then raise exception 'אין הרשאה'; end if;
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if p_status not in ('חדש','נשלחה הודעה','בתהליך','בבדיקה/המתנה','בוצע – ממתין לאימות','נשלח מכתב התראה','תזכורת אחרונה נשלחה','סגור') then
    raise exception 'invalid status';
  end if;
  if not exists (select 1 from coll_cases where phone = p_phone) then raise exception 'case not found'; end if;
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
$function$;
