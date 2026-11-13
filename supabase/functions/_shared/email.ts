// CMS · email through Google Workspace SMTP (the collections@ mailbox). No outside email company.
// Port 465 (SSL): Supabase Edge Functions block outgoing 25 and 587.
// Secrets: GMAIL_USER (collections@...), GMAIL_APP_PASSWORD (16-letter app password, 2-step verification must be on),
//          MAIL_FROM_NAME (optional, default "Smiley · מחלקת הכספים").
import nodemailer from "npm:nodemailer@6.9.16";

const env = (k: string) => Deno.env.get(k) ?? "";
export const emailReady = () => !!(env("GMAIL_USER") && env("GMAIL_APP_PASSWORD"));

// deno-lint-ignore no-explicit-any
let tx: any = null;
function mailer() {
  tx ??= nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") },
  });
  return tx;
}

// id = the cms_messages row. It rides in the X-CMS-Id header, so a bounce (which quotes our headers) points back to the row.
export async function sendEmail(o: { to: string; subject: string; html: string; text: string; attachments?: unknown[]; id?: number }): Promise<string> {
  const from = { name: env("MAIL_FROM_NAME") || "Smiley · מחלקת הכספים", address: env("GMAIL_USER") };
  const info = await mailer().sendMail({ from, replyTo: from, to: o.to, subject: o.subject, html: o.html, text: o.text, attachments: o.attachments || [],
    headers: o.id ? { "X-CMS-Id": String(o.id) } : {} });
  if (info.rejected && info.rejected.length) throw new Error("Gmail דחה את הכתובת: " + info.rejected.join(", "));
  return info.messageId as string;
}

// bounces: read the collections@ mailbox over IMAP with the same app password (cms-bounce)
export const imapAuth = () => ({ user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") });

// for the connections check: logs in to Gmail without sending anything
export async function emailCheck(): Promise<void> { await mailer().verify(); }
