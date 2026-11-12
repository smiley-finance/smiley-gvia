// CMS · cms-health: "are we connected?" for the dot in the dashboard header.
// Same answer shape as the mock (fake-sb.js health()). state: ok · off (not set up yet) · err (problem). mode: live | test.
// Sends nothing. Logged-in agents only (the gateway checks the login, see config.toml).
import { admin, json, testMode, sendingOn, R } from "../_shared/cms.ts";
import { emailReady, emailCheck } from "../_shared/email.ts";
import { smsReady } from "../_shared/sms.ts";

const t = (iso?: string | null) => iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  const sb = admin(), systems = [];

  // database
  let t0 = performance.now();
  const db = await sb.from("cms_cases").select("phone", { count: "exact", head: true });
  systems.push({ key: "db", name: "מסד הנתונים (Supabase)", state: db.error ? "err" : "ok", ms: Math.round(performance.now() - t0),
    detail: db.error ? db.error.message : `מחובר · ${db.count ?? 0} לקוחות בזרימת המייל/SMS` });
  systems.push({ key: "fn", name: "פונקציית השליחה (cms-send)", state: sendingOn ? "ok" : "off",
    detail: !sendingOn ? "מחוברת · השליחה כבויה (CMS_SENDING): שום הודעה לא יוצאת" : testMode ? "פועלת · מצב בדיקה: שולחים רק לרשימת הבדיקה" : "פועלת" });

  // email: logs in to Gmail, sends nothing
  if (!emailReady()) systems.push({ key: "email", name: "מייל · Google Workspace", state: "off", detail: "לא מוגדר", need: "GMAIL_USER + GMAIL_APP_PASSWORD" });
  else {
    t0 = performance.now();
    try { await emailCheck(); systems.push({ key: "email", name: "מייל · Google Workspace", state: "ok", ms: Math.round(performance.now() - t0), detail: "מחובר ל-Gmail" }); }
    catch (e) { systems.push({ key: "email", name: "מייל · Google Workspace", state: "err", detail: "ההתחברות ל-Gmail נכשלה: " + String((e as Error).message || e).slice(0, 120) }); }
  }
  systems.push({ key: "sms", name: "SMS · ספק ישראלי", state: smsReady() ? "ok" : "off", detail: smsReady() ? "מוגדר" : "לא מוגדר", need: smsReady() ? undefined : "SMS_PROVIDER + SMS_USER + SMS_TOKEN" });

  // delivery reports: the last SMS report we got
  const { data: rep } = await sb.from("cms_messages").select("updated_at").eq("channel", "sms").in("status", ["delivered", "failed"]).order("updated_at", { ascending: false }).limit(1);
  systems.push({ key: "hook", name: "דיווחי מסירה (webhook)", state: rep && rep.length ? "ok" : smsReady() ? "ok" : "off",
    detail: rep && rep.length ? `דיווח אחרון: ${t(rep[0].updated_at)}` : "עוד לא התקבלו דיווחים" });

  // scheduler: should have run in the last 20 minutes
  const { data: run } = await sb.from("cms_runs").select("at,sent,note").eq("kind", "auto").order("at", { ascending: false }).limit(1);
  const last = run && run[0], fresh = last && Date.now() - new Date(last.at).getTime() < 20 * 60e3;
  systems.push({ key: "cron", name: "מתזמן אוטומטי (שלבים 2–4)", state: !last ? "off" : fresh ? "ok" : "err",
    detail: !last ? "עוד לא רץ" : `ריצה אחרונה: ${t(last.at)} · נשלחו ${last.sent}${last.note ? " · " + last.note : ""}${fresh ? "" : " · ⚠ לא רץ יותר מ-20 דקות"}`,
    window: R.quiet(new Date()) || "חלון שליחה פתוח" });

  // letters (the private engine's storage)
  const lt = await sb.storage.from("coll-letters").list("", { limit: 1 });
  systems.push({ key: "letters", name: "מכתבי התראה (Storage)", state: lt.error ? "err" : "ok", detail: lt.error ? lt.error.message : "נגיש · המכתב מצורף אוטומטית לשלב 3" });

  // activity, last 24 hours
  const day = new Date(Date.now() - 864e5).toISOString();
  const { data: recent } = await sb.from("cms_messages").select("channel,status,at").gte("at", day);
  const lastOf = async (ch: string) => (await sb.from("cms_messages").select("at").eq("channel", ch).order("at", { ascending: false }).limit(1)).data?.[0]?.at || null;
  return json(req, {
    mode: testMode ? "test" : "live", checked_at: new Date().toISOString(), systems,
    activity: {
      last_email: await lastOf("email"), last_sms: await lastOf("sms"),
      sent_24h: (recent || []).length, failed_24h: (recent || []).filter(m => m.status === "failed").length,
      pending: (recent || []).filter(m => m.status === "queued" || m.status === "sent").length,
    },
  });
});
