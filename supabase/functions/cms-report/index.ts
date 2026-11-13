// CMS · cms-report: Sendy's delivery reports (webhook), https://sendy.co.il/docs/webhooks
// Set ONE webhook in Sendy → Developers → Webhooks:
//   URL:    https://<project-ref>.supabase.co/functions/v1/cms-report
//   Events: message.sent, message.delivered, message.undelivered, message.failed
//   Then copy Sendy's signing secret (whsec_…) into the Supabase secret WEBHOOK_SECRET.
// Every report is checked with Sendy's signature (HMAC-SHA256 of "<t>.<raw body>"), so nobody can fake one.
import { admin, env } from "../_shared/cms.ts";

const enc = new TextEncoder();
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map(b => b.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string): boolean {                 // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verified(req: Request, raw: string): Promise<boolean> {
  const secret = env("WEBHOOK_SECRET"), h = req.headers.get("sendy-signature") || "";
  if (!secret || !h) return false;
  const parts = h.split(",").map(s => s.trim());
  const t = (parts.find(p => p.startsWith("t=")) || "").slice(2);
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;        // older than 5 minutes: refuse
  const want = await hmacHex(secret, `${t}.${raw}`);
  return parts.filter(p => p.startsWith("v1=")).some(p => same(p.slice(3), want));  // 2 values right after a secret rotation
}

// Sendy status -> our status
const MAP: Record<string, string> = { sent: "sent", delivered: "delivered", undelivered: "failed", failed: "failed" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const raw = await req.text();                                 // the signature is over the raw bytes
  if (!(await verified(req, raw))) return new Response("bad signature", { status: 401 });
  // deno-lint-ignore no-explicit-any
  let ev: any; try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (!String(ev.type || "").startsWith("message.")) return new Response("ok", { status: 200 });   // ping and other events

  const d = ev.data || {}, status = MAP[d.status];
  if (!d.id || !status) return new Response("ok", { status: 200 });
  const sb = admin();
  const { data: row } = await sb.from("cms_messages").select("id,phone,stage,status").eq("provider_id", String(d.id)).eq("channel", "sms").maybeSingle();
  if (!row) return new Response("ok", { status: 200 });         // not one of ours (e.g. a test from Sendy's dashboard)
  // reports can arrive twice and out of order: never move back from a final state
  if (row.status === "delivered" || (row.status === "failed" && status !== "delivered")) return new Response("ok", { status: 200 });
  if (row.status === status) return new Response("ok", { status: 200 });
  await sb.from("cms_messages").update({ status, error: status === "failed" ? `ה-SMS לא נמסר (${d.status}${d.error_code ? ", " + d.error_code : ""})` : null,
    updated_at: new Date().toISOString() }).eq("id", row.id);
  if (status === "failed") {
    const { data: cur } = await sb.from("cms_cases").select("email_status").eq("phone", row.phone).maybeSingle();
    await sb.from("cms_events").insert({ phone: row.phone, status: cur?.email_status || null, note: `⚠ ה-SMS של שלב ${row.stage} לא נמסר: לבדוק את המספר` });
  }
  return new Response("ok", { status: 200 });
});
