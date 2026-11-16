-- Dashboard self-updating (16.11.2026): the database announces every change on the desk's tables, and the open
-- dashboard refreshes itself within about a second (sends, delivery reports, statuses, Stripe payments written by the payments engine).
-- SETTINGS ONLY: no row is read or changed. Every table here has RLS with read for logged-in agents only,
-- and Supabase Realtime applies the same RLS, so nobody receives a change they could not already read.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['coll_cases','coll_payments','coll_payouts','coll_events','cms_messages','cms_events','cms_cases','cms_switches'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
