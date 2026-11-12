# CMS server: email + SMS for the collections desk

Built to fit how the desk works today:
- The page stays **one file** (`index.html`), no build step, no new external scripts, no keys except the public anon key.
- Agents only **read** tables; the only page write is an **RPC** (`cms_set_status`, like `coll_set_status`).
- Sending runs on the **server** (Supabase Edge Functions). The SMTP and SMS keys live only in Supabase secrets.
- **Nothing existing is changed.** Everything new is named `cms_*`. `coll_*` tables, the WhatsApp flow and the private engine are untouched. The email flow keeps its own status in `cms_cases`, not in `coll_cases`.
- One command undoes it all: `rollback.sql`.

## What it adds
| piece | what |
|---|---|
| `migrations/..._cms_tables.sql` | tables `cms_cases` (email/SMS status per customer), `cms_messages` (every email/SMS), `cms_events` (history), `cms_runs` (scheduler log). Logged-in read only. RPC `cms_set_status`. A unique index stops a stage being sent twice. |
| `migrations/..._cms_cron.sql` | pg_cron every 15 min → `cms-send` with `{"auto":true}`. Runs with nobody logged in. |
| `functions/cms-send` | agent click (stage 1, or any stage early) + the scheduler (stages 2–4). Runs the same rules as the page (`send.js`). |
| `functions/cms-report` | SMS delivery reports (delivered / failed). |
| `functions/cms-health` | the connection dot in the header. Sends nothing. |
| `functions/_shared` | `templates.js` + `send.js`: the same texts and rules that are inside `index.html`. Change both together. |

## Timer and window (same as the page)
Stage 1 is the agent's click. Then stage 2 goes out on day 3, stage 3 (the letter, PDF from `coll-letters`) on day 8, and stage 4 eleven days after the letter.
Sending only happens Sunday–Thursday, 08:00–20:00 Israel time. Nothing goes out on Friday, Saturday, chagim or Yom HaZikaron/HaAtzmaut, or after 13:00 on a chag eve.
`בתהליך`, `בבדיקה/המתנה` and `בוצע – ממתין לאימות` pause the timer. A payment verified in Stripe ends it.

## Setup on the TEST project first (step by step)
1. Run `migrations/20261112000001_cms_tables.sql` in the SQL editor.
2. Add these Edge Function secrets in Settings → Edge Functions → Secrets. **Nothing is sent until `CMS_SENDING` = `on`**:
   - `GMAIL_USER` = the collections@ address. `GMAIL_APP_PASSWORD` = its 16-letter app password (2-step verification must be on).
   - `CRON_SECRET` and `WEBHOOK_SECRET` = two long random strings.
   - **`CMS_TEST_TO`** = your own email and phone (`9725XXXXXXXX`), comma separated. **While this is set, nobody else can receive anything.**
   - `CMS_SENDING` = `on` only when ready to send (not set = connected but silent).
   - Later, when the SMS account exists: `SMS_PROVIDER=inforu`, `SMS_USER`, `SMS_TOKEN`, `SMS_SENDER=Smiley`.
3. Deploy: `supabase functions deploy cms-send cms-report cms-health` (`config.toml` sets the login checks).
4. Store the two scheduler values in the vault (see the top of `..._cms_cron.sql`), then run that file.
5. The page (`index.html` in this repo) is already connected: it reads the `cms_*` tables and calls the functions.
6. Test with your own details only. Go through stage 1 → 2 → 3 → 4, the window, a bounce, and a duplicate click.
7. Go live: delete `CMS_TEST_TO`.

Stop all sending at once: delete the `CMS_SENDING` secret. Stop the scheduler: `select cron.unschedule('cms-auto');`. Remove everything: `rollback.sql`.

## Not verified yet (no accounts yet)
- The **SMS provider fields** in `sms.ts` and `cms-report` (marked VERIFY). Check them against the provider's docs once the account opens.
- **Email bounces:** Gmail accepts the mail (shown as "נמסר"). A bounce then comes back as an email to the collections@ inbox; it does not update the log yet.
- The functions are written and their rules are tested locally. They have **not run on Supabase yet**, because there is no project access yet.
