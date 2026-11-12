// CMS · cms-send
// 1. Agent clicks "שלח" in the dashboard:  SB.functions.invoke("cms-send", { body: { phone, stage } })  (logged-in agent)
// 2. The scheduler (pg_cron, every 15 min):  POST {"auto": true} with header x-cms-cron = CRON_SECRET
//    -> sends every stage 2-4 that is due now, inside the window (Sun-Thu 08:00-20:00 Israel time, no holidays).
// Every send runs the same rules as the dashboard (send.js plan()), so the server can't be talked into skipping one.
import { admin, agent, json, loadCase, loadLog, loadOpenCases, R, sendStage, env, testMode, sendingOn, isTestRecipient } from "../_shared/cms.ts";

const MAX_PER_RUN = 40;                                       // stays well inside the function time limit; the rest go next run

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);
  const sb = admin(), now = new Date();
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));

  // ---------- TEST ONLY: run one stage (or the timer) for a test customer, any day/hour ----------
  // Allowed only with the server's own key (x-cms-cron), only in test mode, and only when BOTH the customer's
  // email and phone are in CMS_TEST_TO. Real customers can never pass this check.
  if (body.test) {
    if (!env("CRON_SECRET") || req.headers.get("x-cms-cron") !== env("CRON_SECRET")) return json(req, { ok: false, error: "forbidden" }, 403);
    if (!testMode) return json(req, { ok: false, error: "test mode is off (CMS_TEST_TO)" }, 403);
    const c = await loadCase(sb, String(body.phone || ""));
    if (!c) return json(req, { ok: false, error: "no such case" }, 404);
    if (!isTestRecipient(c.email) || !isTestRecipient(c.phone)) return json(req, { ok: false, error: "not a test customer" }, 403);
    const log = await loadLog(sb, c.phone);
    // deno-lint-ignore no-explicit-any
    const pick = body.stage ? { stage: Number(body.stage), auto: false } : (R.autoPick([c], log, now, { ignoreQuiet: true })[0] as any);
    if (!pick) return json(req, { ok: true, note: "timer: nothing due for this customer", track: R.track(c, log, now) });
    const r = await sendStage(sb, c, pick.stage, { log, now, auto: !body.stage, by: "test", ignoreQuiet: true });
    return json(req, { ...r, timer: !body.stage });
  }

  // ---------- the scheduler ----------
  if (body.auto) {
    if (!env("CRON_SECRET") || req.headers.get("x-cms-cron") !== env("CRON_SECRET")) return json(req, { ok: false, error: "forbidden" }, 403);
    if (!sendingOn) {                                         // main switch off: the scheduler does nothing at all
      await sb.from("cms_runs").insert({ kind: "auto", sent: 0, note: "השליחה כבויה (CMS_SENDING)" });
      return json(req, { ok: true, sent: 0, note: "sending off" });
    }
    const closed = R.quiet(now);
    if (closed) {
      await sb.from("cms_runs").insert({ kind: "auto", sent: 0, note: closed });
      return json(req, { ok: true, sent: 0, note: closed });
    }
    try {
      const [cases, log] = await Promise.all([loadOpenCases(sb), loadLog(sb)]);
      // deno-lint-ignore no-explicit-any
      const picks = R.autoPick(cases, log, now).slice(0, MAX_PER_RUN) as any[];
      const done = [];
      for (const p of picks) {
        const r = await sendStage(sb, p.c, p.stage, { log: await loadLog(sb, p.c.phone), now: new Date(), auto: true, by: null });
        done.push({ phone: p.c.phone, stage: p.stage, ok: r.ok, sent: r.sent, failed: r.failed, errors: r.errors });
      }
      await sb.from("cms_runs").insert({ kind: "auto", sent: done.filter(d => d.ok).length,
        note: `${picks.length} הגיע זמנם${done.some(d => !d.ok) ? ` · ${done.filter(d => !d.ok).length} נכשלו` : ""}${testMode ? " · מצב בדיקה" : ""}` });
      return json(req, { ok: true, sent: done.filter(d => d.ok).length, done });
    } catch (e) {
      await sb.from("cms_runs").insert({ kind: "auto", sent: 0, note: "⚠ שגיאה: " + String((e as Error).message || e).slice(0, 200) });
      return json(req, { ok: false, error: String(e) }, 500);
    }
  }

  // ---------- an agent's click ----------
  const by = await agent(sb, req);
  if (!by) return json(req, { ok: false, error: "צריך להתחבר מחדש" }, 401);
  const phone = String(body.phone || ""), stage = Number(body.stage);
  if (!/^9725\d{8}$/.test(phone) && !/^\d{9,15}$/.test(phone)) return json(req, { ok: false, error: "טלפון לא תקין" }, 400);
  if (![1, 2, 3, 4].includes(stage)) return json(req, { ok: false, error: "שלב לא תקין" }, 400);
  const c = await loadCase(sb, phone);
  if (!c) return json(req, { ok: false, error: "התיק לא נמצא" }, 404);
  // ignore_quiet works ONLY in test mode (CMS_TEST_TO set). Live, the window can't be skipped from the page.
  const r = await sendStage(sb, c, stage, { log: await loadLog(sb, phone), now, auto: false, by, ignoreQuiet: !!body.ignore_quiet });
  return json(req, { ...r, error: r.ok ? null : r.errors.join(" · ") });
});
