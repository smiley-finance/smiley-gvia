# Smiley collections desk — dashboard

The page the collections agent works in: https://yairecom.github.io/smiley-gvia/

Everything is in one file, `index.html` (HTML + CSS + JS, Hebrew, RTL). There is no build step. GitHub Pages serves `main` as is.

## How changes go live
1. Make a branch, edit `index.html`, push the branch.
2. Preview your branch, logged in with your own (agent) account:
   - locally: `python3 -m http.server 8000` in the repo folder → http://localhost:8000
   - or online: `https://raw.githack.com/yairecom/smiley-gvia/<your-branch>/index.html`
3. Open a Pull Request into `main`. Write in the description what changed and add a screenshot.
4. It goes live only after Yair approves and merges it. Direct pushes to `main` are blocked.

## What the page talks to
- Supabase project `tlxuqxlqzcpelcfdtjax`, with the **anon** key that is already in the file (it is public by design). Never put any other key in this repo.
- Login = Supabase Auth (email + password). Accounts are created by Yair only.

Data you can **read** (logged in):
| table | what |
|---|---|
| `coll_cases` | one row per customer (key = `phone`, international format). Name, email, orders (jsonb), amount (agorot), payment link, letter, status, dates |
| `coll_events` | history per case |
| `coll_payments` | payments verified in Stripe, with the commission per payment |
| `coll_payouts` | which months' commission was paid |
| `coll_admins` | manager emails (decides what the page shows) |
| storage `coll-letters` | warning-letter PDFs (`createSignedUrl`) |

The **only write** the page can do is the RPC `coll_set_status(p_phone, p_status, p_note?, p_promise?, p_letter?)`.
Valid statuses (the server rejects anything else):
`חדש` / `נשלחה הודעה` / `בתהליך` / `בוצע – ממתין לאימות` / `נשלח מכתב התראה` / `סגור`.
`שולם – אומת` is set by the system only, when Stripe confirms a payment.

The status flow, the ready messages and the next-step logic are all in `index.html` (`next()`, `msgs()`).

## What is not here (and can't be changed from the page)
New cases, payment links, letters, payment verification, commission and subscription cancelling all run in a separate private engine on a schedule. Commission is calculated on the server from Stripe. Nothing in this page can change it.
Manager actions (marking a month's commission as paid) are checked on the server: `coll_mark_payout` refuses anyone who is not in `coll_admins`.

## Rules
- Keep everything working as it does now: same statuses, same buttons and the same automatic status change when a message is sent.
- No new external scripts except from `cdn.jsdelivr.net` / `cdnjs.cloudflare.com` with a pinned version.
- Don't send data anywhere except Supabase. No analytics or trackers.
- Test on your branch before opening the PR.
