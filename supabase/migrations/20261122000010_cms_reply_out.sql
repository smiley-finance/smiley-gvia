-- Reply-send (22.11.2026): record that a clicker sent a ready reply back to a customer from the dashboard.
-- Additive only. No customer rows are changed by this migration; these columns start null.
alter table public.cms_replies
  add column if not exists replied_at   timestamptz,
  add column if not exists replied_by   text,
  add column if not exists reply_msg_id text;

comment on column public.cms_replies.replied_at is 'when a clicker sent the ready reply back from the dashboard (cms-reply-send)';
comment on column public.cms_replies.replied_by is 'which clicker sent it (auth email)';
comment on column public.cms_replies.reply_msg_id is 'Message-ID of the reply we sent (for threading / audit)';
