-- New reply type (23.11.2026, Yair): "רוצה להחזיר מוצר / לבטל מנוי" (return a product / cancel a subscription).
-- The ready text lives in _shared/replies.js; the classifier rule in _shared/inbox.js. This migration only
-- widens the allowed kind set so cms-inbox can save, and clickers can tag, replies of the new type.
-- Schema only. No customer rows are read or changed.

alter table public.cms_replies drop constraint if exists cms_replies_kind_check;
alter table public.cms_replies add constraint cms_replies_kind_check
  check (kind = any (array['paid','legal','sub','notrecv','pay','who','call','other','retsub']));

-- the manual type-change RPC keeps its own whitelist in step with the constraint
create or replace function public.cms_reply_set(p_id bigint, p_kind text default null, p_handled boolean default null)
  returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not coll_can_read() then
    raise exception 'not allowed';
  end if;
  if p_kind is not null and p_kind not in ('paid','legal','sub','notrecv','pay','who','call','other','retsub') then
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
