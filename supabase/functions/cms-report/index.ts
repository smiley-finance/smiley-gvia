// CMS · cms-report: the SMS provider tells us "delivered" / "failed" for each SMS.
// Address (built by sms.ts per message): /functions/v1/cms-report?key=WEBHOOK_SECRET&id=<cms_messages id>
// VERIFY the provider's report fields when the account is opened; this accepts JSON or form posts and looks
// for the usual status words, so it works with most providers as is.
import { admin, env } from "../_shared/cms.ts";

const DELIVERED = /^(delivered|deliver|2|success|ok|נמסר)$/i;
const FAILED = /^(failed|fail|undeliverable|undelivered|rejected|expired|blocked|-?\d{2,}|נכשל)$/i;

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (!env("WEBHOOK_SECRET") || u.searchParams.get("key") !== env("WEBHOOK_SECRET")) return new Response("forbidden", { status: 403 });
  const id = Number(u.searchParams.get("id"));
  if (!id) return new Response("no id", { status: 400 });

  // deno-lint-ignore no-explicit-any
  let b: any = {};
  const raw = await req.text();
  try { b = JSON.parse(raw); } catch { b = Object.fromEntries(new URLSearchParams(raw)); }
  const pick = (o: Record<string, unknown>) => String(o.Status ?? o.status ?? o.StatusId ?? o.DeliveryStatus ?? o.state ?? "").trim();
  const s = pick(b) || pick(Array.isArray(b.Data) ? b.Data[0] || {} : b.Data || {}) || pick(Object.fromEntries(u.searchParams));
  const status = DELIVERED.test(s) ? "delivered" : FAILED.test(s) ? "failed" : null;
  if (!status) return new Response("ignored", { status: 200 });          // an in-between report ("sent to carrier"): nothing to change

  const sb = admin();
  const { data: row } = await sb.from("cms_messages").select("id,phone,stage,channel,status").eq("id", id).eq("channel", "sms").maybeSingle();
  if (!row) return new Response("unknown", { status: 200 });
  if (row.status === "delivered" && status === "failed") return new Response("ok", { status: 200 });   // never undo a delivery
  await sb.from("cms_messages").update({ status, error: status === "failed" ? `ה-SMS לא נמסר (${s})` : null, updated_at: new Date().toISOString() }).eq("id", id);
  if (status === "failed") {
    const { data: cur } = await sb.from("cms_cases").select("email_status").eq("phone", row.phone).maybeSingle();
    await sb.from("cms_events").insert({ phone: row.phone, status: cur?.email_status || null, note: `⚠ ה-SMS של שלב ${row.stage} לא נמסר: לבדוק את המספר` });
  }
  return new Response("ok", { status: 200 });
});
