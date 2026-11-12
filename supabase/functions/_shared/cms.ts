// CMS · shared server code for the Edge Functions.
// The rules and the texts are send.js + templates.js next to this file (the same code is copied into index.html by supabase/sync_index.py).
import "./templates.js";
import "./send.js";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { emailReady, sendEmail } from "./email.ts";
import { smsReady, sendSms } from "./sms.ts";

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
export const R = G.CMS_SEND, T = G.CMS_T;
export const env = (k: string) => Deno.env.get(k) ?? "";

// service role: only inside the functions, never in the page
export const admin = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// the dashboard runs on GitHub Pages (+ local preview); only those origins may call the functions from a browser
const ORIGINS = (env("CMS_ORIGINS") || "https://yairecom.github.io,http://localhost:8000,https://raw.githack.com").split(",").map(s => s.trim());
export function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// TEST MODE: while CMS_TEST_TO is set, ONLY these emails / phones (972...) can get anything. Everyone else is refused.
// Go live = delete the CMS_TEST_TO secret.
const TEST_TO = env("CMS_TEST_TO").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export const testMode = TEST_TO.length > 0;
// MAIN SWITCH: nothing is ever sent unless the secret CMS_SENDING is exactly "on". Not set = connected, but silent.
export const sendingOn = env("CMS_SENDING") === "on";
const allowed = (to: string) => !testMode || TEST_TO.includes(String(to).toLowerCase());
export const isTestRecipient = (to: string) => testMode && TEST_TO.includes(String(to || "").toLowerCase());

// the logged-in agent behind a request (null = not logged in)
export async function agent(sb: SupabaseClient, req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  return error || !data.user ? null : (data.user.email || data.user.id);
}

// a case = the coll_cases row (read only) + the email flow's own status from cms_cases
// deno-lint-ignore no-explicit-any
type Case = Record<string, any>;
function merge(c: Case, e?: Case | null): Case {
  return Object.assign(c, { email_status: e?.email_status || "חדש", email_touched_at: e?.email_touched_at || null, email_last_at: e?.email_last_at || null });
}
export async function loadCase(sb: SupabaseClient, phone: string): Promise<Case | null> {
  const [{ data: c }, { data: e }] = await Promise.all([
    sb.from("coll_cases").select("*").eq("phone", phone).maybeSingle(),
    sb.from("cms_cases").select("*").eq("phone", phone).maybeSingle()]);
  return c ? merge(c, e) : null;
}
export async function loadOpenCases(sb: SupabaseClient): Promise<Case[]> {
  const [{ data: cs, error }, { data: es }] = await Promise.all([
    sb.from("coll_cases").select("*").eq("removed", false),
    sb.from("cms_cases").select("*")]);
  if (error) throw error;
  const E = new Map((es || []).map((r: Case) => [r.phone, r]));
  return (cs || []).map((c: Case) => merge(c, E.get(c.phone)));
}
export async function loadLog(sb: SupabaseClient, phone?: string): Promise<Case[]> {
  let q = sb.from("cms_messages").select("id,phone,stage,channel,status,due,at");
  if (phone) q = q.eq("phone", phone);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ---------- send one stage to one customer: the same steps the mock plays (fake-sb.js cmsSend) ----------
export async function sendStage(sb: SupabaseClient, c: Case, stage: number,
  o: { log: Case[]; now: Date; auto: boolean; by: string | null; ignoreQuiet?: boolean }) {
  if (!sendingOn) return { ok: false, errors: ["השליחה כבויה בשרת (CMS_SENDING לא מופעל). שום הודעה לא יוצאת."], warnings: [], stage, sent: [], failed: [] };
  const plan = R.plan(c, stage, { log: o.log, now: o.now, ignoreQuiet: !!o.ignoreQuiet && testMode });
  const useSms = plan.channels.sms && smsReady();
  if (plan.channels.email && !emailReady()) plan.errors.push("המייל עוד לא מחובר (חסרים GMAIL_USER / GMAIL_APP_PASSWORD)");
  if (plan.channels.sms && !smsReady()) plan.warnings.push("ה-SMS עוד לא מחובר: יישלח מייל בלבד");
  if (plan.channels.email && !allowed(plan.to.email)) plan.errors.push("מצב בדיקה: המייל לא ברשימת הבדיקה (CMS_TEST_TO)");
  if (useSms && !allowed(plan.to.sms)) plan.errors.push("מצב בדיקה: הטלפון לא ברשימת הבדיקה (CMS_TEST_TO)");
  if (!plan.channels.email && !useSms) plan.errors.push("אין ערוץ שליחה זמין");
  if (plan.errors.length) return { ok: false, errors: plan.errors, warnings: plan.warnings, stage, sent: [], failed: [] };

  const m = plan.msg, base = { phone: c.phone, stage, due: plan.due, auto: o.auto, by_email: o.by };
  const rows: Case[] = [];
  if (plan.channels.email) rows.push({ ...base, channel: "email", to: c.email, subject: m.subject, body: m.text, attach: m.attach });
  if (useSms) rows.push({ ...base, channel: "sms", to: c.phone, subject: "", body: m.sms, parts: m.smsInfo.parts });

  // 1. claim: the unique index refuses a second copy of this stage (agent click + scheduler at the same moment)
  const { data: ins, error } = await sb.from("cms_messages").insert(rows).select("id,channel");
  if (error) return { ok: false, errors: [error.code === "23505" ? `שלב ${stage} כבר נשלח (או נשלח ממש עכשיו)` : "שגיאת שרת: " + error.message], warnings: [], stage, sent: [], failed: [] };

  // 2. send each channel, then write what happened
  const sent: string[] = [], failed: string[] = [];
  for (const r of ins as Case[]) {
    try {
      if (r.channel === "email") {
        const attachments = [];
        if (stage === 3 && c.letter_path) {                    // the warning letter PDF, from the private engine's storage
          const { data: pdf, error: e } = await sb.storage.from("coll-letters").download(c.letter_path);
          if (e || !pdf) throw new Error("לא הצלחתי לצרף את מכתב ההתראה");
          attachments.push({ filename: m.attach || "מכתב התראה.pdf", content: new Uint8Array(await pdf.arrayBuffer()), contentType: "application/pdf" });
        }
        const id = await sendEmail({ to: c.email, subject: m.subject, html: m.html, text: m.text, attachments });
        // email: "delivered" = accepted by Gmail. A bounce comes back to the collections@ inbox later.
        await sb.from("cms_messages").update({ status: "delivered", provider_id: id, updated_at: new Date().toISOString() }).eq("id", r.id);
      } else {
        const pid = await sendSms(c.phone, m.sms, r.id);       // SMS: "sent" until Sendy's delivery report (cms-report)
        await sb.from("cms_messages").update({ status: "sent", provider_id: pid, updated_at: new Date().toISOString() }).eq("id", r.id);
      }
      sent.push(r.channel);
    } catch (e) {
      failed.push(r.channel);
      await sb.from("cms_messages").update({ status: "failed", error: String((e as Error).message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq("id", r.id);
    }
  }

  // 3. move the email/SMS status (never the WhatsApp one) + history, only if something went out
  const how = sent.map(x => x === "email" ? "מייל" : "SMS").join(" + ");
  if (sent.length) {
    const now = new Date().toISOString();
    const { data: cur } = await sb.from("cms_cases").select("email_touched_at").eq("phone", c.phone).maybeSingle();
    await sb.from("cms_cases").upsert({ phone: c.phone, email_status: plan.statusAfter, email_touched_at: cur?.email_touched_at || now, email_last_at: now, updated_at: now });
    await sb.from("cms_events").insert({ phone: c.phone, status: plan.statusAfter, by_email: o.by,
      note: `${o.auto ? "⏱ נשלח אוטומטית · " : ""}📧💬 שלב ${stage} נשלח (${how}) · מועד אחרון ${plan.due}${failed.length ? " · ⚠ נכשל: " + failed.join(", ") : ""}` });
  } else {
    await sb.from("cms_events").insert({ phone: c.phone, status: c.email_status, by_email: o.by, note: `⚠ שלב ${stage}: השליחה נכשלה (${failed.join(", ")})` });
  }
  return { ok: sent.length > 0, errors: sent.length ? [] : ["השליחה נכשלה, ראו ביומן ההודעות"], warnings: plan.warnings,
           stage, sent, failed, statusAfter: plan.statusAfter, due: plan.due };
}
