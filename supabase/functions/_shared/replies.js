// Smiley CMS · replies.js: THE source of the ready EMAIL replies to a customer's answer (Yair's wording, locked).
// Used by the dashboard (emailReplies), the demo, and the server (cms-reply-send builds the text here so the
// browser can never choose the words). After editing, run:  python supabase/sync_index.py
// Keep the KINDS in step with _shared/inbox.js (the classifier) and RK in index.html (the labels).
(function (root) {
  const CONSENT_IMG = "https://cdn.shopify.com/s/files/1/0638/7816/8733/files/WhatsApp_Image_2026-10-27_at_01.43.26.jpg?v=1793091924";
  const local = p => p && String(p).startsWith("972") ? "0" + String(p).slice(3) : String(p || "");
  const greet = (c, b) => `שלום ${c.first_name || ""},\n\n${b}\n\nבברכה,\nמחלקת הכספים · Smiley`;
  const shipLines = c => (c.orders || []).flatMap(o => (o.shipments || []).map(s =>
    `הזמנה ${o.order}: ${s.carrier} ${s.tracking} · ${s.status}${s.date ? " · " + s.date : ""}\n${s.tracking_url}`)).join("\n");

  // one entry per reply-kind. body(c) = the exact text; img = an attachment URL or null; subjectOnly types (call/other) have no entry.
  // The wording is Yair's, unchanged from the WhatsApp replies, adapted to email.
  const BY_KIND = {
    pay: { title: "הסכים לשלם / שאל איך", img: null, body: c =>
      `מלוא החוב (${c.total}) ניתן לתשלום בקישור האישי שלהלן, דף תשלום מאובטח של Stripe (כרטיס אשראי, ולרוב גם Apple Pay ו-Google Pay). עם התשלום יישלח אישור למייל, והתיק ייסגר.\n${c.payment_link}` },
    who: { title: '"מי אתם? זה עוקץ?"', img: null, body: c =>
      `זו מחלקת הכספים של Smiley, האתר try-smiley.com. ההזמנה (${(c.orders_label || "").includes(",") ? "הזמנות " : "הזמנה "}${c.orders_label}) בוצעה עם מספר הטלפון ${local(c.phone)} ונשלחה לכתובת ${c.address || ""}. התשלום עליה בוטל דרך חברת האשראי. הקישור הוא דף תשלום מאובטח של Stripe בסכום החוב, ${c.total}.\n${c.payment_link}` },
    notrecv: { title: '"לא קיבלתי"', img: null, body: c =>
      `לפי התיעוד שלנו:\n${shipLines(c)}\nביטול החיוב דרך חברת האשראי אינו הדרך לבירור משלוח. החוב בסך ${c.total} פתוח.\n${c.payment_link}` },
    sub: { title: '"לא ידעתי שזה מנוי"', img: CONSENT_IMG, subOnly: true, body: c =>
      `ההצטרפות למנוי הוצגה באתר בארבעה מקומות: בדף המוצר, בעגלה, בסיכום ההזמנה ומעל כפתור התשלום, עם נוסח הסכמה מפורש לחיוב אוטומטי. ניתן היה לבחור במקום זה רכישה חד־פעמית.\nהמשלוחים יצאו אליך, והחוב הוא רק עליהם. ביטול מנוי מונע חיובים עתידיים בלבד, ואינו מבטל תשלום על משלוחים שכבר סופקו. המנוי כבר הופסק ולא יהיו חיובים נוספים.\n${c.payment_link}` },
    paid: { title: '"כבר שילמתי"', img: null, body: c =>
      `לא התקבל תשלום בקישור האישי. אם שולם בדרך אחרת, יש להשיב למייל זה ולצרף צילום של אישור התשלום. עד אז התיק פתוח.\n${c.payment_link}` },
    legal: { title: '"תתבעו אותי" / סירוב', img: null, body: c =>
      `הודעתך נרשמה. החוב בסך ${c.total} פתוח, ויישלח אלייך מכתב התראה רשמי לפני נקיטת הליכים. עד אז עדיין ניתן להסדיר את החוב בקישור:\n${c.payment_link}` },
    // 22.11.2026 (Yair): word for word from the WhatsApp reply (index.html clientMsgs). A return goes through customer
    // service and never offsets the disputed debt; a subscription is cancelled by the customer in the portal (and in a
    // subscription case we note it is already stopped here). [סכום]=c.total, [קישור]=c.payment_link.
    retsub: { title: "רוצה להחזיר מוצר / לבטל מנוי", img: null, body: c =>
      `החזרת מוצר מתבצעת מול שירות הלקוחות של Smiley בוואטסאפ 053-396-5246, ואינה קשורה לחוב הזה. החוב הוא על משלוחים שכבר סופקו ושהתשלום עליהם בוטל דרך חברת האשראי, ולכן החזרת מוצר אינה מקזזת אותו.\nביטול מנוי אפשרי באופן מלא ועצמאי בפורטל המנויים: try-smiley.com/account${c.kind === "sub" ? " (בתיק הזה המנוי כבר הופסק אצלנו, ולא יהיו חיובים נוספים)" : ""}. ביטול מנוי מונע חיובים עתידיים בלבד, ואינו מבטל את החוב על מה שכבר נשלח.\nהחוב בסך ${c.total} פתוח, וניתן להסדיר אותו בקישור האישי:\n${c.payment_link}` },
  };

  // build the one ready reply for a kind -> { title, body, image } | null (null = no ready reply for this kind/case)
  function build(c, kind) {
    const e = BY_KIND[kind];
    if (!e) return null;                              // call / other / unknown: no ready reply
    if (e.subOnly && c.kind !== "sub") return null;   // the "לא ידעתי שזה מנוי" reply only fits a subscription case
    return { title: e.title, body: greet(c, e.body(c)), image: e.img || null };
  }
  const hasReply = (c, kind) => !!build(c, kind);

  // the full list the dashboard shows (same order as before: pay, who, notrecv, [sub], paid, legal)
  function list(c) {
    const order = ["pay", "who", "notrecv", "paid", "legal", "retsub"];
    const out = order.map(k => build(c, k)).filter(Boolean).map(r => [r.title, r.body, r.image]);
    const sub = build(c, "sub");
    if (sub) out.splice(2, 0, [sub.title + " (לצרף את התמונה למייל)", sub.body, sub.image]);
    return out;
  }

  root.CMS_REPLIES = { build, hasReply, list, CONSENT_IMG };
})(typeof globalThis !== "undefined" ? globalThis : this);
