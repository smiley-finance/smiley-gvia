// CMS · cms-reply-send (22.11.2026)
// A clicker picked a ready reply in the dashboard and hit send. We send it BACK to the customer, threaded into the
// SAME Gmail conversation (In-Reply-To the customer's Message-ID), with the locked wording Yair wrote.
//   dashboard click:  SB.functions.invoke("cms-reply-send", { body: { reply_id } })   (logged-in clicker)
// SAFETY:
//  - the text is built HERE from the database (replies.js), never taken from the browser;
//  - only the ready reply for the reply's kind can go out (call/other have none -> refused);
//  - it NEVER changes a status, a stage or the timer. It only marks the reply handled/replied.
//  - a self-test path ({selftest:true,to}) sends two threaded emails to a chosen non-customer address, to prove
//    threading works, guarded by the server key. It touches no customer and no CMS_TEST_TO.
import { admin, agent, json, loadCase, env, sendingOn, testMode, isTestRecipient, switchesOff, REPLIES } from "../_shared/cms.ts";
import { sendEmail, sendEmailReply, emailReady } from "../_shared/email.ts";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
// plain-text reply -> clean RTL HTML: escape, turn URLs into links, keep line breaks. An image (if any) rides inline via cid.
function toHtml(text: string, hasImg: boolean): string {
  const body = esc(text).replace(/https?:\/\/[^\s]+/g, u => `<a href="${u}" style="color:#4f46e5;font-weight:bold">${u}</a>`).replace(/\n/g, "<br>");
  const img = hasImg ? `<div style="margin-top:14px"><img src="cid:consent" alt="כך הוצגה ההסכמה למנוי באתר" width="260" style="display:block;border:1px solid #e4e6f0;border-radius:8px;max-width:100%"></div>` : "";
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body dir="rtl" style="margin:0;padding:20px 12px;background:#f4f5f8;direction:rtl">
<div dir="rtl" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e4e6f0;border-radius:12px;padding:20px 22px;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;font-size:15px;line-height:1.75;color:#20222e">${body}${img}</div>
</body></html>`;
}

async function imageAttachment(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("image fetch " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return { filename: "הסכמה-למנוי.jpg", content: buf, contentType: ct, cid: "consent" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);
  const sb = admin();
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));

  // ---------- SELF-TEST: prove threading to a chosen non-customer address (server key only) ----------
  if (body.selftest) {
    if (!env("CRON_SECRET") || req.headers.get("x-cms-cron") !== env("CRON_SECRET")) return json(req, { ok: false, error: "forbidden" }, 403);
    const to = String(body.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(req, { ok: false, error: "bad test address" }, 400);
    if (!emailReady()) return json(req, { ok: false, error: "email not configured" }, 500);
    const subject = "בדיקת שרשור — Smiley (" + new Date().toISOString().slice(11, 19) + ")";
    const first = await sendEmail({ to, subject, text: "הודעה 1 מתוך 2 (בדיקה). התשובה אמורה להופיע מתחת להודעה הזו, באותה שיחה.", html: toHtml("הודעה 1 מתוך 2 (בדיקה). התשובה אמורה להופיע מתחת להודעה הזו, באותה שיחה.", false) });
    const second = await sendEmailReply({ to, subject, inReplyTo: first, text: "הודעה 2 מתוך 2 (בדיקה) — זו תשובה. אם היא יושבת מתחת להודעה 1 באותה שיחה, השרשור עובד.", html: toHtml("הודעה 2 מתוך 2 (בדיקה) — זו תשובה. אם היא יושבת מתחת להודעה 1 באותה שיחה, השרשור עובד.", false) });
    return json(req, { ok: true, first, second, note: "two threaded test mails sent to " + to });
  }

  // ---------- a clicker's send ----------
  const by = await agent(sb, req);
  if (!by) return json(req, { ok: false, error: "צריך להתחבר מחדש" });
  const id = Number(body.reply_id);
  if (!Number.isInteger(id) || id <= 0) return json(req, { ok: false, error: "reply_id לא תקין" });

  const { data: reply } = await sb.from("cms_replies").select("*").eq("id", id).maybeSingle();
  if (!reply) return json(req, { ok: false, error: "התשובה לא נמצאה" });
  if (reply.replied_at) return json(req, { ok: false, error: "כבר נשלחה תשובה לפנייה הזו" });
  if (!reply.from_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply.from_email)) return json(req, { ok: false, error: "אין כתובת מייל תקינה לפנייה" });
  if (!reply.msg_id) return json(req, { ok: false, error: "חסר מזהה הודעה לשרשור" });
  if (!reply.phone) return json(req, { ok: false, error: "הפנייה לא שויכה ללקוח — יש לענות ב-Gmail" });

  const c = await loadCase(sb, reply.phone);
  if (!c) return json(req, { ok: false, error: "התיק לא נמצא" });

  // the text is built here, from the DB — the browser cannot choose the words
  const built = REPLIES.build(c, reply.kind);
  if (!built) return json(req, { ok: false, error: "אין תשובה מוכנה לסוג הזה — יש לענות ב-Gmail" });

  // same guards as every send: the email switch and the main kill-switch, and the test allowlist if on
  if (!sendingOn) return json(req, { ok: false, error: "השליחה כבויה (CMS_SENDING)" });
  const off = await switchesOff(sb);
  if (off.email) return json(req, { ok: false, error: "המייל כבוי במתג הראשי" });
  if (testMode && !isTestRecipient(reply.from_email)) return json(req, { ok: false, error: "מצב בדיקה: הכתובת אינה ברשימת הבדיקה" });
  if (!emailReady()) return json(req, { ok: false, error: "המייל לא מוגדר בשרת" });

  try {
    const attachments = built.image ? [await imageAttachment(built.image)] : [];
    const refs = Array.isArray(reply.refs) ? reply.refs : undefined;
    const msgId = await sendEmailReply({
      to: reply.from_email, subject: reply.subject || "חוב פתוח", inReplyTo: reply.msg_id, refs,
      text: built.body, html: toHtml(built.body, !!built.image), attachments,
    });
    const now = new Date().toISOString();
    await sb.from("cms_replies").update({ replied_at: now, replied_by: by, reply_msg_id: msgId, handled_at: reply.handled_at || now, handled_by: reply.handled_by || by }).eq("id", id);
    await sb.from("cms_runs").insert({ kind: "reply", sent: 1, note: `✉️ תשובה (${reply.kind}) נשלחה ללקוח · ${by}` });
    return json(req, { ok: true, reply_msg_id: msgId });
  } catch (e) {
    return json(req, { ok: false, error: "שליחה נכשלה: " + String((e as Error).message || e).slice(0, 200) });
  }
});
