// CMS · one-way SMS through Sendy (sendy.co.il, Israeli provider). Docs: https://sendy.co.il/docs
// Secrets: SMS_PROVIDER = "sendy", SMS_TOKEN = the workspace API token (sk_live_…, from Sendy → Developers),
//          SMS_SENDER = an approved sender exactly as Sendy lists it (GET /senders), e.g. "05XXXXXXXX" or "Smiley".
// Delivery reports come to cms-report (one webhook URL set in Sendy → Developers → Webhooks, signed with WEBHOOK_SECRET).
// Sendy charges 1 credit per message of up to 201 characters (Hebrew included); our SMS are well under that.

const env = (k: string) => Deno.env.get(k) ?? "";
const API = "https://sendy.co.il/api/v1";
export const smsReady = () => env("SMS_PROVIDER") === "sendy" && !!env("SMS_TOKEN") && !!env("SMS_SENDER");
const auth = () => ({ Authorization: `Bearer ${env("SMS_TOKEN")}`, "Content-Type": "application/json" });

// Sendy's error codes, in words the agent understands
const ERR: Record<string, string> = {
  INVALID_RECIPIENT: "מספר הטלפון לא תקין (לא נייד ישראלי)",
  INSUFFICIENT_CREDITS: "אין מספיק קרדיט בחשבון ה-SMS",
  SENDER_NOT_APPROVED: "השולח לא מאושר ב-Sendy (SMS_SENDER)",
  ACCOUNT_UNDER_REVIEW: "חשבון ה-SMS עדיין בבדיקה אצל Sendy: אפשר לשלוח רק למספר המאומת שלכם",
  WORKSPACE_SUSPENDED: "חשבון ה-SMS מושעה",
  CONTENT_FLAGGED: "Sendy חסמו את תוכן ההודעה",
  INVALID_API_KEY: "מפתח ה-API של Sendy שגוי (SMS_TOKEN)",
  MESSAGE_TOO_LONG: "ההודעה ארוכה מדי",
  RATE_LIMITED: "יותר מדי הודעות בדקה, יישלח בריצה הבאה",
};

// Returns Sendy's message id (kept in cms_messages.provider_id; the delivery report finds the row by it).
// rowId = our cms_messages id, sent as Idempotency-Key: a retry can never send or charge twice.
export async function sendSms(phone972: string, text: string, rowId: number): Promise<string> {
  if (env("SMS_PROVIDER") !== "sendy") throw new Error("ספק SMS לא מוגדר");
  const r = await fetch(`${API}/messages`, {
    method: "POST",
    headers: { ...auth(), "Idempotency-Key": `cms-${rowId}` },
    body: JSON.stringify({ to: "+" + String(phone972).replace(/\D/g, ""), from: env("SMS_SENDER"), body: text, mode: "transactional" }),
  });
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    const code = j?.error?.code || String(r.status);
    throw new Error("SMS: " + (ERR[code] || j?.error?.message || code));
  }
  return String(j.id);
}

// for the connections check: is the token valid and the sender approved? Sends nothing.
export async function smsCheck(): Promise<string> {
  const r = await fetch(`${API}/senders`, { headers: auth() });
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ERR[j?.error?.code] || j?.error?.message || String(r.status));
  const list = (j.senders || []).map((s: { value: string }) => s.value);
  if (!list.includes(env("SMS_SENDER"))) throw new Error(`השולח "${env("SMS_SENDER")}" לא מאושר. מאושרים: ${list.join(", ") || "אין"}`);
  return `מחובר ל-Sendy · שולח: ${env("SMS_SENDER")}`;
}
