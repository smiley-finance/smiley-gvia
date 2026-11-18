// CMS · cms-inbox: customers' replies to our emails (18.11.2026).
// Reads the collections@ inbox READ ONLY (IMAP EXAMINE: nothing is marked read, moved or deleted, nothing is sent).
// Each new reply: matched to the customer (our Message-ID in In-Reply-To/References, else the sender = an address we emailed),
// sorted into one of Yair's ready-reply types by keywords (_shared/inbox.js), saved in cms_replies with a short snippet.
// NO PAUSE (the user's decision 18.11.2026): a reply never changes the customer's status or the stage timer.
// Stages 2-4 keep going out on their days. This function only reads and lists; it writes cms_replies (+ a cms_runs line) only.
//
// Called by pg_cron every 15 min (header x-cms-cron = CRON_SECRET). Body:
//   {"dry": true}       report what it would do, change nothing
import "../_shared/inbox.js";
import { ImapFlow } from "npm:imapflow@2.9.1";
import { admin, json, env } from "../_shared/cms.ts";
import { emailReady, imapAuth } from "../_shared/email.ts";

// deno-lint-ignore no-explicit-any
const IN = (globalThis as any).CMS_INBOX;
const DAYS = 10, MAX_NEW = 25, SNIP = 500;

// same guards as cms-bounce: Gmail may drop the IMAP socket without a clean goodbye; never let that kill the worker
globalThis.addEventListener("unhandledrejection", (e) => { e.preventDefault(); console.warn("cms-inbox: ignored", String(e.reason).slice(0, 160)); });
globalThis.addEventListener("error", (e) => { e.preventDefault(); console.warn("cms-inbox: ignored", String(e.message || e.error).slice(0, 160)); });
// deno-lint-ignore no-explicit-any
const bye = (c: any) => { try { c.logout().catch(() => { try { c.close(); } catch { /* gone */ } }); } catch { /* gone */ } };

const ids = (s: string) => [...String(s || "").matchAll(/<[^>\s]+>/g)].map(m => m[0]);
const html2text = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// the first text part of the message (plain text preferred), without downloading attachments
// deno-lint-ignore no-explicit-any
function textPart(node: any): { part: string; html: boolean } | null {
  if (!node) return null;
  let html: { part: string; html: boolean } | null = null;
  // deno-lint-ignore no-explicit-any
  const walk = (n: any): { part: string; html: boolean } | null => {
    if (n.childNodes) { for (const k of n.childNodes) { const r = walk(k); if (r) return r; } return null; }
    if (n.disposition === "attachment") return null;
    if (n.type === "text/plain") return { part: n.part || "1", html: false };
    if (n.type === "text/html" && !html) html = { part: n.part || "1", html: true };
    return null;
  };
  return walk(node) || html;
}
async function readText(client: ImapFlow, uid: number, p: { part: string; html: boolean }) {
  const { content } = await client.download(String(uid), p.part, { uid: true, maxBytes: 40000 });
  if (!content) return "";
  const chunks: Uint8Array[] = []; let n = 0;
  for await (const ch of content) { chunks.push(ch); n += ch.length; if (n > 40000) break; }
  const buf = new Uint8Array(n); let o = 0; for (const ch of chunks) { buf.set(ch.subarray(0, Math.min(ch.length, n - o)), o); o += ch.length; if (o >= n) break; }
  const txt = new TextDecoder().decode(buf);
  return p.html ? html2text(txt) : txt;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);
  if (!env("CRON_SECRET") || req.headers.get("x-cms-cron") !== env("CRON_SECRET")) return json(req, { ok: false, error: "forbidden" }, 403);
  if (!emailReady()) return json(req, { ok: true, note: "email not set up" });
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  const dry = !!body.dry, sb = admin();
  const me = env("GMAIL_USER").toLowerCase();

  const make = () => {
    const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: imapAuth(), logger: false });
    c.on("error", (e: Error) => console.warn("cms-inbox: imap", String(e?.message || e).slice(0, 160)));
    return c;
  };
  let client = make(), step = "connect";
  // deno-lint-ignore no-explicit-any
  const fresh: any[] = [];
  let seen = 0, waiting = 0;
  try {
    try { await client.connect(); }
    catch (e) {
      // deno-lint-ignore no-explicit-any
      if ((e as any).authenticationFailed) throw e;
      bye(client); await new Promise(r => setTimeout(r, 2000));
      client = make(); await client.connect();
    }
    step = "open";
    await client.mailboxOpen("INBOX", { readOnly: true });
    step = "search";
    const since = new Date(Date.now() - DAYS * 864e5);
    const uids = (await client.search({ since }, { uid: true })) || [];
    step = "envelopes";
    // deno-lint-ignore no-explicit-any
    const env1: any[] = [];
    if (uids.length) for await (const m of client.fetch(uids, { envelope: true, bodyStructure: true, headers: ["references"] }, { uid: true })) {
      const from = (m.envelope?.from?.[0]?.address || "").toLowerCase();
      if (!from || from === me || /mailer-daemon|postmaster|no-?reply|accounts\.google\.com/i.test(from)) continue;
      const refs = ids(m.envelope?.inReplyTo || "").concat(ids(m.headers?.toString("utf8") || ""));
      env1.push({ uid: m.uid, msg_id: m.envelope?.messageId || `uid-${m.uid}`, from, at: m.envelope?.date ? new Date(m.envelope.date).toISOString() : new Date().toISOString(),
        subject: (m.envelope?.subject || "").slice(0, 200), refs, part: textPart(m.bodyStructure) });
    }
    seen = env1.length;
    // only replies we have not saved yet
    const known = new Set<string>();
    for (let i = 0; i < env1.length; i += 200) {
      const { data } = await sb.from("cms_replies").select("msg_id").in("msg_id", env1.slice(i, i + 200).map(x => x.msg_id));
      (data || []).forEach((r: { msg_id: string }) => known.add(r.msg_id));
    }
    const todo = env1.filter(x => !known.has(x.msg_id)).sort((a, b) => a.at.localeCompare(b.at));
    const cap = MAX_NEW;                                      // at most 25 per run (each text is one IMAP round trip); the rest next run
    waiting = Math.max(0, todo.length - cap);
    step = "text";
    for (const x of todo.slice(0, cap)) {
      let t = "";
      try { t = x.part ? await readText(client, x.uid, x.part) : ""; } catch (_) { t = ""; }
      const mine = IN.fresh(t) || t.trim();
      fresh.push({ ...x, snippet: mine.slice(0, SNIP), kind: IN.classify(mine + " " + x.subject.replace(/^(re|fw|fwd|השב|הע)\s*:\s*/i, "")) });
    }
  } catch (e) {
    bye(client);
    // deno-lint-ignore no-explicit-any
    const x = e as any;
    return json(req, { ok: false, error: `IMAP (${step}): ` + String(x.message || e).slice(0, 200) + (x.authenticationFailed ? " · login refused" : "") }, 500);
  }
  bye(client);

  // match each reply to a customer: our Message-ID first, then the sender's address (only if it points to ONE customer)
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (const r of fresh) {
    let phone: string | null = null, how = "";
    if (r.refs.length) {
      const { data } = await sb.from("cms_messages").select("phone").eq("channel", "email").in("provider_id", r.refs).limit(5);
      const ph = [...new Set((data || []).map((d: { phone: string }) => d.phone))];
      if (ph.length === 1) { phone = ph[0] as string; how = "thread"; }
    }
    if (!phone) {
      const { data } = await sb.from("cms_messages").select("phone").eq("channel", "email").ilike("to", r.from.replace(/[%_\\]/g, "\\$&")).limit(20);
      const ph = [...new Set((data || []).map((d: { phone: string }) => d.phone))];
      if (ph.length === 1) { phone = ph[0] as string; how = "address"; }
    }
    out.push({ phone, how, kind: r.kind, at: r.at });
    if (dry) continue;
    const { error } = await sb.from("cms_replies").insert({ msg_id: r.msg_id, phone, from_email: r.from, subject: r.subject, snippet: r.snippet,
      kind: r.kind, at: r.at });
    if (error) continue;                                         // already saved by a run at the same moment: do nothing twice
  }
  const nNew = out.length;
  if (nNew && !dry) await sb.from("cms_runs").insert({ kind: "inbox", sent: 0, note: `📥 ${nNew} תשובות חדשות מלקוחות` });
  // counts only: no customer details in the response (it lands in net._http_response)
  const by = (k: string) => out.reduce((a: Record<string, number>, o) => { const v = String((o as Record<string, unknown>)[k]); a[v] = (a[v] || 0) + 1; return a; }, {});
  return json(req, { ok: true, dry, seen, new: nNew, waiting_next_run: waiting, matched: out.filter(o => o.phone).length,
    kinds: by("kind"), matched_by: by("how") });
});
