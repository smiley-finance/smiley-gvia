-- "Forwarded to customer service" marker (23.11.2026): a per-customer flag a clicker sets when a return / CS
-- matter is handed to customer service. It is a tag ONLY — it does NOT change any status or pause the timer,
-- because a return does not cancel the debt (Yair), so the automated collection flow keeps running.
-- Additive: two nullable columns + one toggle RPC. No customer rows are read or changed by this migration.

alter table public.cms_cases
  add column if not exists cs_forwarded_at timestamptz,
  add column if not exists cs_forwarded_by text;

comment on column public.cms_cases.cs_forwarded_at is 'when a clicker marked the customer as forwarded to customer service (null = not forwarded)';
comment on column public.cms_cases.cs_forwarded_by is 'which clicker set the mark (auth email)';

create or replace function public.cms_set_cs_forward(p_phone text, p_on boolean)
  returns void language plpgsql security definer set search_path to 'public' as $$
declare v_now timestamptz := now();
begin
  if not public.coll_can_read() then raise exception 'אין הרשאה'; end if;
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if not exists (select 1 from coll_cases where phone = p_phone) then raise exception 'case not found'; end if;
  insert into cms_cases (phone, cs_forwarded_at, cs_forwarded_by, updated_at)
  values (p_phone, case when p_on then v_now end, case when p_on then auth.jwt() ->> 'email' end, v_now)
  on conflict (phone) do update
    set cs_forwarded_at = case when p_on then v_now else null end,
        cs_forwarded_by = case when p_on then auth.jwt() ->> 'email' else null end,
        updated_at      = v_now;
end;
$$;
