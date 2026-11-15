// CMS · cms-bounce: finds emails that bounced and marks them in the log.
// Gmail accepts our mail ("נמסר"). If the customer's address is wrong, Gmail's mailer-daemon sends a bounce
// back to the collections@ inbox later. This function reads those bounces and sets the matching email row to "bounced".
//
// Called by pg_cron every 15 min (header x-cms-cron = CRON_SECRET), all days, all hours (it sends nothing).
// The mailbox is opened READ ONLY (IMAP EXAMINE): nothing is marked read, moved or deleted.
// Match: our X-CMS-Id header (every email since this change), or the original Message-ID (= cms_messages.provider_id).
// Body {"dry": true}: only report what it found, change nothing.
import { ImapFlow } from "npm:imapflow@2.9.1";
import { admin, json, env } from "../_shared/cms.ts";
import { emailReady, imapAuth } from "../_shared/email.ts";

const DAYS = 7, MAX = 200;

// Gmail sometimes closes the IMAP connection without a clean TLS goodbye ("peer closed connection").
// That error arrives outside our try/catch and used to kill the whole worker (503). Keep the worker alive;
// the run itself still reports its own result, and the next run (15 min) checks the last 7 days again.
globalThis.addEventListener("unhandledrejection", (e) => { e.preventDefault(); console.warn("cms-bounce: ignored", String(e.reason).slice(0, 160)); });
globalThis.addEventListener("error", (e) => { e.preventDefault(); console.warn("cms-bounce: ignored", String(e.message || e.error).slice(0, 160)); });

// log out in the background: never wait on (or crash from) a connection Gmail may already have dropped
// deno-lint-ignore no-explicit-any
const bye = (c: any) => { try { c.logout().catch(() => { try { c.close(); } catch { /* gone */ } }); } catch { /* gone */ } };

// one bounce email -> what failed and why (null = not a hard failure, e.g. a "delay" notice)
function parse(src: string) {
  const failed = /^X-Failed-Recipients:\s*(.+)$/im.exec(src);
  if (!failed && !/^Action:\s*failed/im.test(src)) return null;
  const ids = [...src.matchAll(/^X-CMS-Id:\s*(\d+)/gim)].map(m => Number(m[1]));
  const mids = [...src.matchAll(/^Message-ID:\s*(<[^>\s]+>)/gim)].map(m => m[1]);
  const to = failed ? failed[1].trim() : (/^Final-Recipient:\s*rfc822;\s*(\S+)/im.exec(src) || [])[1] || "";
  const diag = /^Diagnostic-Code:\s*(?:smtp;\s*)?([\s\S]+?)(?:\r?\n(?!\s)|(?![\s\S]))/im.exec(src);
  const code = (/^Status:\s*([45]\.\d+\.\d+)/im.exec(src) || [])[1] || "";
  // a long reason is folded over several lines, each repeating the code ("550-5.1.1 ..."): join them, drop the repeats
  const why = (diag ? diag[1].replace(/\s+\d{3}[- ]\d\.\d+\.\d+\s+/g, " ").replace(/\s+/g, " ").trim() : "") || code || "הכתובת לא קיבלה את המייל";
  return { to, ids, mids, why: why.slice(0, 250) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);
  if (!env("CRON_SECRET") || req.headers.get("x-cms-cron") !== env("CRON_SECRET")) return json(req, { ok: false, error: "forbidden" }, 403);
  if (!emailReady()) return json(req, { ok: true, note: "email not set up" });
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  const dry = !!body.dry, sb = admin();

  const make = () => {
    const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: imapAuth(), logger: false });
    c.on("error", (e: Error) => console.warn("cms-bounce: imap", String(e?.message || e).slice(0, 160)));   // socket errors: handled, not fatal
    return c;
  };
  let client = make();
  // deno-lint-ignore no-explicit-any
  const found: any[] = [];
  let step = "connect";
  try {
    try { await client.connect(); }
    catch (e) {
      // deno-lint-ignore no-explicit-any
      if ((e as any).authenticationFailed) throw e;            // wrong app password: retrying will not help
      bye(client); await new Promise(r => setTimeout(r, 2000));
      client = make(); await client.connect();
    }
    step = "list";
    // "All Mail" catches a bounce even if someone archived it; its name depends on the mailbox language, so find it by its flag
    const boxes = await client.list();
    const all = boxes.find(b => b.specialUse === "\\All")?.path || "INBOX";
    step = "open";
    await client.mailboxOpen(all, { readOnly: true });
    step = "search";
    const since = new Date(Date.now() - DAYS * 864e5);
    const uids = ((await client.search({ from: "mailer-daemon", since }, { uid: true })) || []).slice(-MAX);
    step = "fetch";
    if (uids.length) {
      for await (const m of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
        const p = parse(m.source?.toString("utf8") || "");
        if (p) found.push({ ...p, at: m.envelope?.date?.toISOString?.() || null, subject: m.envelope?.subject || "" });
      }
    }
  } catch (e) {
    bye(client);
    // deno-lint-ignore no-explicit-any
    const x = e as any;
    return json(req, { ok: false, error: `IMAP (${step}): ` + String(x.message || e).slice(0, 200) + (x.responseText ? " · " + String(x.responseText).slice(0, 200) : "") + (x.authenticationFailed ? " · login refused" : "") }, 500);
  }
  bye(client);

  // match each bounce to our email rows (only rows that still look delivered)
  const marked = [], unmatched = [];
  for (const b of found) {
    const ors = [];
    if (b.ids.length) ors.push(`id.in.(${b.ids.join(",")})`);
    if (b.mids.length) ors.push(`provider_id.in.(${b.mids.map((x: string) => `"${x.replace(/"/g, "")}"`).join(",")})`);
    if (!ors.length) { unmatched.push(dry ? { to: b.to, why: b.why } : { why: b.why }); continue; }
    const { data: rows } = await sb.from("cms_messages").select("id,phone,stage,status").eq("channel", "email").or(ors.join(","));
    const hit = (rows || []).filter(r => r.status === "delivered" || r.status === "sent");
    if (!(rows || []).length) { unmatched.push(dry ? { to: b.to, why: b.why } : { why: b.why }); continue; }
    for (const r of hit) {
      marked.push({ id: r.id, stage: r.stage });
      if (dry) continue;
      await sb.from("cms_messages").update({ status: "bounced", error: ("חזר: " + b.why).slice(0, 300), updated_at: new Date().toISOString() }).eq("id", r.id);
      const { data: cur } = await sb.from("cms_cases").select("email_status").eq("phone", r.phone).maybeSingle();
      await sb.from("cms_events").insert({ phone: r.phone, status: cur?.email_status || null, by_email: null,
        note: `⚠ המייל של שלב ${r.stage} חזר (כתובת שגויה?): ${b.why.slice(0, 160)}. ה-SMS לא מושפע. לבדוק את כתובת המייל של הלקוח` });
    }
  }
  if (marked.length && !dry) await sb.from("cms_runs").insert({ kind: "bounce", sent: 0, note: `${marked.length} מיילים חזרו` });
  return json(req, { ok: true, dry, bounces: found.length, marked, unmatched });
});
