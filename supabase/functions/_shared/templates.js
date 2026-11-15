// Smiley CMS · templates.js: THE source of the email/SMS texts. Used by the Edge Functions and the demo (cms-demo/).
// After editing, run:  python supabase/sync_index.py   (copies it into index.html, which must stay one file).
// CMS · Collection Messaging Service · message templates
// ONE source for the email (HTML + plain text) and the SMS of every stage.
// Pure functions, no page / DOM: the same file moves into the Supabase Edge Function later.
//
// render(c, stage, ctx) -> { subject, pre, html, text, sms, attach }
//   c     = a case row as in coll_cases (first_name, name, phone, email, total, orders, orders_label,
//           address, payment_link, short_link, variant: sent|delivered|fraud, kind: "sub"|...)
//   stage = 1 first notice · 2 reminder · 3 warning letter (PDF attached) · 4 final reminder
//   ctx   = { due: "DD.MM.YYYY" deadline shown to the customer, hasEmail: bool }
(function (root) {
  const CONSENT_IMG = "https://cdn.shopify.com/s/files/1/0638/7816/8733/files/WhatsApp_Image_2026-10-27_at_01.43.26.jpg?v=1793091924";
  const SITE = "try-smiley.com";
  const BRAND = "#4f46e5";                                                            // one color for every email (all stages)
  const STATUS_AFTER = { 1: "נשלחה הודעה", 2: "נשלחה הודעה", 3: "נשלח מכתב התראה", 4: "סגור" };   // same as the WhatsApp steps
  const NAMES = { 1: "פנייה ראשונה", 2: "תזכורת", 3: "מכתב התראה", 4: "תזכורת אחרונה" };

  // ---------- text helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const plain = s => String(s).replace(/\*\*/g, "");                                   // **bold** -> bold
  const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");                     // escaped, then **bold** -> <b>
  const local = p => p && String(p).startsWith("972") ? "0" + String(p).slice(3) : String(p || "");
  const ordWord = c => (String(c.orders_label || "").includes(",") ? "הזמנות " : "הזמנה ") + c.orders_label;

  // "what happened" line, same wording as the WhatsApp template (msgs() in the dashboard)
  function mid(c) {
    const ord = ordWord(c);
    return c.variant === "fraud"
      ? `המוצרים בהזמנה (${ord}) נשלחו לכתובת שנמסרה בהזמנה. התשלום עליהם, בסך ${c.total}, בוטל דרך חברת האשראי של בעל הכרטיס, והסכום עדיין לא שולם.`
      : `המוצרים שהזמנת (${ord}) נשלחו${c.variant === "delivered" ? " ונמסרו" : ""} לכתובתך. התשלום עליהם, בסך ${c.total}, בוטל דרך חברת האשראי, והסכום עדיין לא שולם.`;
  }

  // ---------- content of each stage, as blocks (drawn as HTML and as plain text) ----------
  // block types: p, h, small, summary, pay, orders, faq, letter
  // days from today until a "DD.MM.YYYY" deadline (stage 4 says how many days are really left)
  function daysTo(due, now) {
    const m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(due || ""); if (!m) return null;
    const d = Date.UTC(+m[3], +m[2] - 1, +m[1]), t = new Date(now || Date.now());
    return Math.max(0, Math.round((d - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5));
  }
  const daysWord = n => n === 1 ? "יום אחד" : `${n} ימים`;
  function blocks(c, stage, ctx) {
    const n = c.first_name || c.name || "", due = ctx.due, ord = ordWord(c), left = daysWord(daysTo(due, ctx.now) ?? 3);
    const hi = { t: "p", v: `שלום ${n},` };
    if (stage === 1) return {
      subject: `חוב פתוח בסך ${c.total} · ${ord}`,
      pre: `פרטי החוב, ההזמנה והמשלוח, וקישור לתשלום מאובטח עד ${due}`,
      b: [hi, { t: "p", v: "זו פנייה רשמית של מחלקת הכספים של Smiley בנוגע לחוב פתוח על שמך." },
        { t: "summary", title: "חוב פתוח" },
        { t: "h", v: "מה קרה?" }, { t: "p", v: mid(c) },
        { t: "pay", v: `לתשלום מאובטח · ${c.total}` }, { t: "small", v: "עם התשלום יישלח אישור למייל, והתיק ייסגר." },
        { t: "h", v: "פרטי ההזמנה והמשלוח" }, { t: "orders", full: true },
        { t: "h", v: "מה קורה אם החוב לא יוסדר?" },
        { t: "p", v: `יש להסדיר את מלוא הסכום עד **${due}**. אם החוב לא יוסדר עד המועד הזה, הטיפול בו יעבור לשלב הבא, ויישלח אליך מכתב התראה רשמי.` },
        { t: "h", v: "שאלות נפוצות" }, { t: "faq" },
        { t: "pay", v: `לתשלום · ${c.total}` }] };
    if (stage === 2) return {
      subject: `תזכורת: החוב בסך ${c.total} עדיין לא הוסדר`,
      pre: `המועד האחרון לתשלום: ${due}. לאחר מכן יישלח מכתב התראה רשמי.`,
      b: [hi, { t: "p", v: `תזכורת: החוב בסך ${c.total} בגין ${ord} עדיין לא הוסדר.` },
        { t: "summary", title: "תזכורת" },
        { t: "p", v: "לאחר המועד שנקבע יישלח אליך מכתב התראה רשמי. ניתן להסדיר את החוב בקישור האישי:" },
        { t: "pay", v: `לתשלום מאובטח · ${c.total}` },
        { t: "h", v: "תזכורת: מה קרה?" }, { t: "p", v: mid(c) }, { t: "orders", full: true },
        { t: "h", v: "שאלות נפוצות" }, { t: "faq" }] };
    if (stage === 3) return {
      subject: `מכתב התראה רשמי · חוב בסך ${c.total}`,
      pre: `מצורף מכתב התראה. ניתן להסדיר את החוב עד ${due}.`, attach: `מכתב התראה - ${c.name || n}.pdf`,
      b: [hi, { t: "p", v: `החוב בסך ${c.total} טרם הוסדר.` },
        { t: "letter" },
        { t: "summary", title: "מכתב התראה" },
        { t: "p", v: `ניתן להסדיר את מלוא החוב עד **${due}** בקישור האישי. לאחר מועד זה נפעל כמפורט במכתב.` },
        { t: "pay", v: `לתשלום מאובטח · ${c.total}` },
        { t: "h", v: "פרטי ההזמנה והמשלוח" }, { t: "p", v: mid(c) }, { t: "orders", full: true },
        { t: "h", v: "שאלות נפוצות" }, { t: "faq" }] };
    return {
      subject: `תזכורת אחרונה: נותרו ${left} · חוב בסך ${c.total}`,
      pre: `לאחר ${due} לא תישלח פנייה נוספת.`,
      b: [hi, { t: "p", v: `נותרו ${left} למועד האחרון שנקבע במכתב ההתראה.` },
        { t: "summary", title: "תזכורת אחרונה" },
        { t: "p", v: `החוב בסך ${c.total} עדיין פתוח. לאחר מועד זה לא תישלח פנייה נוספת.` },
        { t: "pay", v: `לתשלום מאובטח · ${c.total}` },
        { t: "h", v: "פרטי ההזמנה" }, { t: "orders", full: false },
        { t: "small", v: "מכתב ההתראה נשלח אליך במייל קודם. לכל שאלה אפשר להשיב למייל הזה." }] };
  }

  // FAQ = the WhatsApp ready replies, answered up front so the customer does not need to ask
  function faqItems(c) {
    const ord = ordWord(c), list = [
      ["מי אתם? זה לא עוקץ?", `זו מחלקת הכספים של Smiley, האתר ${SITE}. ה${ord} בוצעה עם מספר הטלפון ${local(c.phone)} ונשלחה לכתובת ${c.address || "שנמסרה בהזמנה"}. הקישור לתשלום מוביל לדף מאובטח של Stripe, בסכום החוב בלבד.`],
      ["לא קיבלתי את ההזמנה", "פרטי המשלוח ומספר המעקב מופיעים למעלה. ביטול החיוב דרך חברת האשראי אינו הדרך לבירור משלוח. אם יש בעיה במשלוח, אפשר להשיב למייל הזה."],
      ["כבר שילמתי", "לא התקבל תשלום בקישור האישי. אם שולם בדרך אחרת, יש להשיב למייל הזה עם צילום של אישור התשלום. עד אז התיק פתוח."],
      ["אפשר הנחה או תשלומים?", `לא ניתן להסדיר את החוב בהנחה או בתשלומים. הסכום לתשלום הוא ${c.total}.`],
      ["יש לי טענה לגבי החיוב", "אפשר להשיב למייל הזה ולפרט, ונחזור אליך."],
    ];
    if (c.kind === "sub") list.splice(2, 0, ["לא ידעתי שזה מנוי",
      "ההצטרפות למנוי הוצגה באתר בארבעה מקומות: בדף המוצר, בעגלה, בסיכום ההזמנה ומעל כפתור התשלום, עם נוסח הסכמה מפורש לחיוב אוטומטי. ניתן היה לבחור במקום זה רכישה חד־פעמית. המשלוחים יצאו אליך, והחוב הוא רק עליהם. ביטול מנוי מונע חיובים עתידיים בלבד, ואינו מבטל תשלום על משלוחים שכבר סופקו. המנוי כבר הופסק ולא יהיו חיובים נוספים.",
      CONSENT_IMG]);
    return list;
  }

  // ---------- HTML (table layout + inline styles: works in Gmail / Outlook / phones) ----------
  const F = "font-family:Arial,Helvetica,sans-serif;direction:rtl;";
  const box = (inner, bg) => `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:12px;margin:0 0 10px"><tr><td style="padding:16px 18px;${F}">${inner}</td></tr></table>`;
  const row = (k, v) => `<tr><td style="${F}padding:5px 0;font-size:14px;color:#6b7085;width:105px;vertical-align:top">${k}</td><td style="${F}padding:5px 0;font-size:14px;color:#1b1d2a">${v}</td></tr>`;

  function htmlBlock(x, c, stage, ctx) {
    const color = BRAND, link = esc(c.payment_link);
    switch (x.t) {
      case "p": return `<p style="${F}font-size:15px;line-height:1.7;margin:0 0 10px;color:#1b1d2a">${rich(x.v)}</p>`;
      case "h": return `<h2 style="${F}font-size:17px;margin:24px 0 8px;color:#1b1d2a">${esc(x.v)}</h2>`;
      case "small": return `<p style="${F}font-size:13px;line-height:1.6;margin:6px 0 0;color:#6b7085;text-align:center">${esc(x.v)}</p>`;
      case "summary": {
        const cell = (k, v) => `<td style="${F}padding:8px 6px;text-align:center;width:33%"><div style="font-size:12px;color:#6b7085">${k}</div><div style="font-size:17px;font-weight:bold;color:#1b1d2a">${esc(v)}</div></td>`;
        return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${color};border-radius:12px;margin:14px 0">
          <tr><td colspan="3" style="${F}background:${color};color:#fff;padding:8px 14px;font-weight:bold;font-size:14px">${esc(x.title)}</td></tr>
          <tr>${cell("סכום לתשלום", c.total)}${cell("מועד אחרון", ctx.due)}${cell(String(c.orders_label).includes(",") ? "הזמנות" : "הזמנה", c.orders_label)}</tr></table>`;
      }
      case "pay": return `<table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" style="margin:18px auto 6px"><tr><td style="background:#16a34a;border-radius:10px">
          <a href="${link}" style="${F}display:inline-block;padding:14px 34px;color:#fff;font-size:17px;font-weight:bold;text-decoration:none">${esc(x.v)}</a></td></tr></table>
          <p style="${F}text-align:center;font-size:12px;color:#6b7085;margin:0">דף תשלום מאובטח של Stripe · כרטיס אשראי, ולרוב גם Apple Pay ו-Google Pay</p>`;
      case "letter": return box(`<div style="font-size:15px;font-weight:bold;color:#b91c1c">📎 מצורף מכתב התראה רשמי בנוגע לחוב</div><div style="font-size:14px;margin-top:4px;color:#33364a">יש לעיין בו. הקובץ מצורף למייל הזה.</div>`, "#fee2e2");
      case "orders": return (c.orders || []).map(o => box(`<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0">
          ${row("מספר הזמנה", `<b>${esc(o.order)}</b>`)}${row("תאריך", esc(o.order_date))}${row("מוצרים", esc(o.products))}${row("סכום", esc(o.amount))}
          ${(o.shipments || []).map(s => row("משלוח", `${esc(s.carrier)} · <span dir="ltr">${esc(s.tracking)}</span><br><b>${esc(s.status)}</b>${s.date ? " · " + esc(s.date) : ""}${x.full && s.tracking_url ? ` · <a href="${esc(s.tracking_url)}" style="color:#4f46e5">מעקב אחרי המשלוח</a>` : ""}`)).join("")}
          ${x.full && c.address ? row("כתובת", esc(c.address)) : ""}</table>`, "#f7f8fc")).join("");
      case "faq": return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0">` + faqItems(c).map(([q, a, img]) =>
          `<tr><td style="${F}padding:12px 0;border-bottom:1px solid #e4e6f0"><div style="font-weight:bold;font-size:15px;margin-bottom:4px;color:#1b1d2a">${esc(q)}</div><div style="font-size:14px;line-height:1.7;color:#33364a">${esc(a)}</div>${img ? `<img src="${img}" alt="כך הוצגה ההסכמה למנוי באתר" width="260" style="display:block;margin-top:10px;border:1px solid #e4e6f0;border-radius:8px;max-width:100%">` : ""}</td></tr>`).join("") + `</table>`;
    }
    return "";
  }
  function shell(stage, subject, pre, inner) {
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="rtl" style="margin:0;padding:24px 12px;background:#f4f5f8;direction:rtl">
<div dir="rtl" style="direction:rtl;text-align:right">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" dir="rtl" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e4e6f0">
  <tr><td style="background:${BRAND};padding:18px 24px;${F}color:#fff;text-align:right">
    <div style="font-size:20px;font-weight:bold">Smiley</div><div style="font-size:13px;opacity:.9">מחלקת הכספים · ${esc(NAMES[stage])}</div></td></tr>
  <tr><td style="padding:24px;${F}text-align:right">${inner}</td></tr>
  <tr><td style="background:#f7f8fc;padding:16px 24px;${F}font-size:12px;color:#6b7085;line-height:1.6;text-align:right">
    לכל שאלה אפשר להשיב למייל הזה.<br>Smiley · מחלקת הכספים · ${SITE}<br>הודעה זו נשלחה אליך בנוגע לחוב פתוח על שמך.</td></tr>
</table></td></tr></table></div></body></html>`;
  }

  // ---------- plain text (sent next to the HTML: better delivery, and readable anywhere) ----------
  function textBlock(x, c, stage, ctx) {
    switch (x.t) {
      case "p": return plain(x.v);
      case "h": return "\n" + x.v + "\n" + "-".repeat(Math.min(30, x.v.length + 2));
      case "small": return x.v;
      case "summary": return `${x.title}: ${c.total} · מועד אחרון ${ctx.due} · ${ordWord(c)}`;
      case "pay": return `${x.v}:\n${c.payment_link}`;
      case "letter": return "מצורף מכתב התראה רשמי בנוגע לחוב. יש לעיין בו.";
      case "orders": return (c.orders || []).map(o => [`הזמנה ${o.order} · ${o.order_date} · ${o.amount}`, o.products,
        ...(o.shipments || []).map(s => `משלוח: ${s.carrier} ${s.tracking} · ${s.status}${s.date ? " · " + s.date : ""}${x.full && s.tracking_url ? "\n" + s.tracking_url : ""}`),
        x.full && c.address ? `כתובת: ${c.address}` : ""].filter(Boolean).join("\n")).join("\n\n");
      case "faq": return faqItems(c).map(([q, a]) => `* ${q}\n${a}`).join("\n\n");
    }
    return "";
  }

  // ---------- SMS: a short one-way notification; the email has the details ----------
  // Hebrew SMS = UCS-2: 70 characters for one message, 67 per part when longer. Aim: 2 parts at most.
  function sms(c, stage, ctx) {
    const n = c.first_name || "", L = c.short_link || c.payment_link, d = shortDate(ctx.due), left = daysWord(daysTo(ctx.due, ctx.now) ?? 3);
    const mail = ctx.hasEmail !== false;
    const RLM = String.fromCharCode(0x200F);                  // invisible right-to-left mark (U+200F)
    return RLM + {
      1: mail ? `Smiley: שלום ${n}, חוב פתוח על שמך בסך ${c.total}. כל הפרטים נשלחו אליך למייל. לתשלום עד ${d}:\n${L}`
              : `Smiley: שלום ${n}, חוב פתוח על שמך בסך ${c.total} (הזמנה ${c.orders_label}). לתשלום מאובטח עד ${d}:\n${L}`,
      2: mail ? `Smiley: תזכורת, החוב בסך ${c.total} לא הוסדר. הפרטים במייל. לתשלום עד ${d}:\n${L}`
              : `Smiley: תזכורת, החוב בסך ${c.total} לא הוסדר. לתשלום עד ${d}:\n${L}`,
      3: mail ? `Smiley: נשלח אליך למייל מכתב התראה רשמי, חוב ${c.total}. להסדרה עד ${d}:\n${L}`
              : `Smiley: נשלח אליך מכתב התראה רשמי בנוגע לחוב בסך ${c.total}. להסדרה עד ${d}:\n${L}`,
      4: `Smiley: נותרו ${left} להסדרת החוב בסך ${c.total}. אחרי ${d} לא תישלח פנייה נוספת:\n${L}`,
    }[stage];
  }
  const shortDate = due => String(due || "").replace(/^(\d\d)[./](\d\d)[./]\d{4}$/, "$1.$2");
  function segs(t) {
    const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(t);
    const len = [...t].length, one = gsm ? 160 : 70, part = gsm ? 153 : 67;
    return { len, parts: len <= one ? 1 : Math.ceil(len / part), enc: gsm ? "GSM" : "UCS-2", one };
  }

  function render(c, stage, ctx) {
    ctx = Object.assign({ hasEmail: !!c.email }, ctx);
    const s = blocks(c, stage, ctx);
    const html = shell(stage, s.subject, s.pre, s.b.map(x => htmlBlock(x, c, stage, ctx)).join(""));
    const text = s.b.map(x => textBlock(x, c, stage, ctx)).filter(Boolean).join("\n\n")
      + `\n\n--\nלכל שאלה אפשר להשיב למייל הזה.\nSmiley · מחלקת הכספים · ${SITE}`;
    const sm = sms(c, stage, ctx);
    return { stage, name: NAMES[stage], subject: s.subject, pre: s.pre, html, text, attach: s.attach || null,
             sms: sm, smsInfo: segs(sm), statusAfter: STATUS_AFTER[stage] };
  }

  root.CMS_T = { render, segs, NAMES, STATUS_AFTER, local };
})(typeof window !== "undefined" ? window : globalThis);
