-- CMS: backup send. A bounced email (like a failed one) no longer blocks sending that channel of the stage again,
-- e.g. after the agent fixed the customer's address. Everything else the index protects stays the same:
-- one live (not failed/bounced) copy per customer + stage + channel.
drop index if exists public.cms_messages_once;
create unique index cms_messages_once on public.cms_messages (phone, stage, channel) where status not in ('failed','bounced');
