// CMS · FAKE data only. Invented people, phones (05000000xx), emails (@example.com) and orders.
// Dates are relative to "now", so every scenario is due the moment the page opens.
(function (root) {
  const ago = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const dd = d => new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(Date.now() - d * 864e5));
  const ship = (carrier, tracking, status, d) => ({ carrier, tracking, status, date: dd(d), tracking_url: "https://example.com/track/" + tracking });
  const order = (no, d, amount, products, shipments) => ({ order: no, order_date: dd(d), amount, products, shipments });

  // one case per scenario we need to test
  const base = (i, x) => Object.assign({
    phone: "9725000000" + String(i).padStart(2, "0"), removed: false, paid_amount: 0, kind: "one",
    payment_link: "https://pay.example.com/c/mock" + i, short_link: "https://smly.example/m" + i,
    address: "רחוב הדוגמה " + i + ", תל אביב", latest: ago(i), letter_path: null, letter_date: null,
    agent_touched_at: null, last_action_at: null, done_at: null,
    // the email/SMS flow keeps its own status, separate from the WhatsApp status above
    email_status: "חדש", email_touched_at: null, email_last_at: null,
  }, x);
  const one = (no, d, amt, prod, st = "נמסר") => [order(no, d, amt, prod, [ship("דואר ישראל", "RR1000" + no.slice(1) + "IL", st, d - 6)])];

  const cases = [
    base(1, { name: "דנה לוי", first_name: "דנה", email: "dana@example.com", case_type: "ביטול עסקה", variant: "sent",
      status: "חדש", latest: ago(0, 3), amount: 28900, total: "₪289", orders_label: "#10452", orders: one("#10452", 40, "₪289", "ערכת הלבנת שיניים ×1, ג'ל משלים ×2", "נשלח") }),
    base(2, { name: "יוסי כהן", first_name: "יוסי", email: "yossi@example.com", case_type: "מנוי", variant: "delivered", kind: "sub",
      status: "חדש", amount: 41800, total: "₪418", orders_label: "#10388, #10511",
      orders: [order("#10388", 70, "₪209", "מנוי הלבנה · משלוח 1", [ship("דואר ישראל", "RR100388IL", "נמסר", 64)]),
               order("#10511", 40, "₪209", "מנוי הלבנה · משלוח 2", [ship("חברת שליחויות", "HFD10511", "נמסר", 35)])] }),
    base(3, { name: "מיכל אברהם", first_name: "מיכל", email: "", case_type: "בעל כרטיס אחר", variant: "fraud",
      status: "חדש", amount: 19900, total: "₪199", orders_label: "#10533", orders: one("#10533", 30, "₪199", "ערכת הלבנת שיניים ×1") }),
    base(4, { name: "אבי מזרחי", first_name: "אבי", email: "avi@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "חדש", amount: 28900, total: "₪289", orders_label: "#10470", orders: one("#10470", 45, "₪289", "ערכת הלבנת שיניים ×1, ג'ל משלים ×2"),
      email_status: "נשלחה הודעה", email_touched_at: ago(4), email_last_at: ago(4) }),
    base(5, { name: "רונית פרץ", first_name: "רונית", email: "ronit@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "נשלחה הודעה", amount: 35700, total: "₪357", orders_label: "#10301", orders: one("#10301", 60, "₪357", "ערכה זוגית ×1"),
      agent_touched_at: ago(9), last_action_at: ago(9), letter_path: "mock/972500000005.pdf", letter_date: ago(0, 3),
      email_status: "נשלחה הודעה", email_touched_at: ago(9), email_last_at: ago(5) }),
    base(6, { name: "עומר ביטון", first_name: "עומר", email: "omer@example.com", case_type: "ביטול עסקה", variant: "sent",
      status: "נשלחה הודעה", amount: 19900, total: "₪199", orders_label: "#10322", orders: one("#10322", 55, "₪199", "ערכת הלבנת שיניים ×1", "נשלח"),
      agent_touched_at: ago(9), last_action_at: ago(5) }),
    base(7, { name: "שירה דהן", first_name: "שירה", email: "shira@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "נשלחה הודעה", amount: 28900, total: "₪289", orders_label: "#10255", orders: one("#10255", 70, "₪289", "ערכת הלבנת שיניים ×1, ג'ל משלים ×2"),
      agent_touched_at: ago(23), last_action_at: ago(23), letter_path: "mock/972500000007.pdf", letter_date: ago(12),
      email_status: "נשלח מכתב התראה", email_touched_at: ago(20), email_last_at: ago(12) }),
    base(8, { name: "נועם אוחיון", first_name: "נועם", email: "noam@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "בתהליך", amount: 19900, total: "₪199", orders_label: "#10490", orders: one("#10490", 35, "₪199", "ערכת הלבנת שיניים ×1"),
      agent_touched_at: ago(5), last_action_at: ago(3), email_status: "בתהליך", email_touched_at: ago(5), email_last_at: ago(3) }),
    base(9, { name: "תמר גבאי", first_name: "תמר", email: "tamar@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "בוצע – ממתין לאימות", amount: 28900, total: "₪289", orders_label: "#10412", orders: one("#10412", 42, "₪289", "ערכת הלבנת שיניים ×1, ג'ל משלים ×2"),
      agent_touched_at: ago(6), last_action_at: ago(2), done_at: ago(2) }),
    base(10, { name: "אלון חדד", first_name: "אלון", email: "alon@example.com", case_type: "ביטול עסקה", variant: "sent",
      status: "סגור", amount: 19900, total: "₪199", orders_label: "#10101", orders: one("#10101", 90, "₪199", "ערכת הלבנת שיניים ×1"),
      agent_touched_at: ago(40), last_action_at: ago(15) }),
    base(11, { name: "ליאת שמעוני", first_name: "ליאת", email: "liat@bounce.example.com", case_type: "ביטול עסקה", variant: "sent",
      status: "חדש", latest: ago(0, 1), amount: 24900, total: "₪249", orders_label: "#10544", orders: one("#10544", 28, "₪249", "ערכת הלבנה + מברשת ×1", "נשלח") }),
    base(12, { name: "גיא עמר", first_name: "גיא", email: "guy@example.com", case_type: "ביטול עסקה", variant: "delivered",
      status: "חדש", amount: 28900, total: "₪289", orders_label: "#10560", orders: one("#10560", 25, "₪289", "ערכת הלבנת שיניים ×1, ג'ל משלים ×2"),
      email_status: "נשלחה הודעה", email_touched_at: ago(0, 2), email_last_at: ago(0, 2) }),
  ];

  // what was already sent by the CMS (the planned cms_messages table)
  const msg = (id, i, stage, channel, at, due, status = "delivered") => ({ id, phone: cases[i - 1].phone, stage, channel,
    to: channel === "email" ? cases[i - 1].email : cases[i - 1].phone, subject: "", body: "", due, status, error: null, at });
  const messages = [
    msg(1, 4, 1, "email", ago(4), dd(-3)), msg(2, 4, 1, "sms", ago(4), dd(-3)),
    msg(3, 5, 1, "email", ago(9), dd(2)), msg(4, 5, 1, "sms", ago(9), dd(2)),
    msg(5, 5, 2, "email", ago(5), dd(2)), msg(6, 5, 2, "sms", ago(5), dd(2)),
    msg(11, 7, 1, "email", ago(20), dd(13)), msg(12, 7, 1, "sms", ago(20), dd(13)),
    msg(13, 7, 2, "email", ago(17), dd(13)), msg(14, 7, 2, "sms", ago(17), dd(13)),
    msg(7, 7, 3, "email", ago(12), dd(-2)), msg(8, 7, 3, "sms", ago(12), dd(-2)),
    msg(9, 12, 1, "email", ago(0, 2), dd(-7)), msg(10, 12, 1, "sms", ago(0, 2), dd(-7)),
    msg(15, 8, 1, "email", ago(5), dd(-2)), msg(16, 8, 1, "sms", ago(5), dd(-2)),
  ];
  // WhatsApp flow history (coll_events)
  const ev = (i, status, at, note) => ({ phone: cases[i - 1].phone, status, at, note: note || null });
  const events = [
    ev(5, "נשלחה הודעה", ago(9), "נשלח בוואטסאפ"),
    ev(6, "נשלחה הודעה", ago(9), "נשלח בוואטסאפ"),
    ev(7, "נשלחה הודעה", ago(23), "נשלח בוואטסאפ"),
    ev(8, "נשלחה הודעה", ago(5)), ev(8, "בתהליך", ago(3), "הלקוח ביקש את הקישור שוב"),
    ev(9, "בוצע – ממתין לאימות", ago(2), "הלקוח אומר ששילם"),
    ev(10, "סגור", ago(15)),
  ];
  // email/SMS flow history (planned table cms_events): its own statuses
  const cev = (i, status, at, note) => ({ phone: cases[i - 1].phone, status, at, note: note || null });
  const cms_events = [
    cev(4, "נשלחה הודעה", ago(4), "📧💬 שלב 1 נשלח (מייל + SMS)"),
    cev(5, "נשלחה הודעה", ago(9), "📧💬 שלב 1 נשלח (מייל + SMS)"), cev(5, "נשלחה הודעה", ago(5), "📧💬 שלב 2 נשלח (מייל + SMS)"),
    cev(7, "נשלחה הודעה", ago(20), "📧💬 שלב 1 נשלח (מייל + SMS)"), cev(7, "נשלחה הודעה", ago(17), "📧💬 שלב 2 נשלח (מייל + SMS)"),
    cev(7, "נשלח מכתב התראה", ago(12), "📧💬 שלב 3 נשלח (מייל + SMS)"),
    cev(8, "נשלחה הודעה", ago(5), "📧💬 שלב 1 נשלח (מייל + SMS)"), cev(8, "בתהליך", ago(3), "הלקוח השיב למייל"),
    cev(12, "נשלחה הודעה", ago(0, 2), "📧💬 שלב 1 נשלח (מייל + SMS)"),
  ];
  const ym = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"); };
  const payments = [];

  // ---------- a month of FAKE past work, so the day / week / month summary has something to show ----------
  // Customers who already paid (they are off the desk, like in the real dashboard). Fixed pattern, no randomness.
  const FIRST = ["אורי", "הדס", "עידן", "מאיה", "רועי", "נגה", "איתי", "יעל", "בן", "שני", "עמית", "טל", "אסף", "רותם", "דור", "ענבל", "ליאור", "קרן", "יובל", "אביגיל", "ניר", "חן", "אלה", "תום"];
  const LAST = ["כהן", "לוי", "פרידמן", "אזולאי", "שושן", "קליין", "ברק", "נחום"];
  const AMT = [199, 289, 249, 357, 418];
  FIRST.forEach((fn, k) => {
    const i = 20 + k, start = 2 + ((k * 7) % 28), amount = AMT[k % AMT.length], phone = "9725000000" + i;
    const viaEmail = k % 3 !== 0, viaWa = k % 2 === 0, paidDay = Math.max(0, start - 1 - (k % 5));
    cases.push(base(i, { phone, name: fn + " " + LAST[k % LAST.length], first_name: fn, email: "customer" + i + "@example.com", case_type: "ביטול עסקה",
      variant: "delivered", status: viaWa ? "סגור" : "חדש", amount: amount * 100, total: "₪" + amount, paid_amount: amount, latest: ago(start + 1),
      orders_label: "#" + (10600 + i), orders: one("#" + (10600 + i), start + 30, "₪" + amount, "ערכת הלבנת שיניים ×1"),
      agent_touched_at: viaWa ? ago(start) : null, last_action_at: viaWa ? ago(paidDay) : null,
      email_status: viaEmail ? "נשלחה הודעה" : "חדש", email_touched_at: viaEmail ? ago(start) : null, email_last_at: viaEmail ? ago(start) : null }));
    if (viaWa) { events.push({ phone, status: "נשלחה הודעה", at: ago(start, 3), note: "נשלח בוואטסאפ" });
      if (k % 4 === 0) events.push({ phone, status: "בתהליך", at: ago(Math.max(paidDay, start - 1), 2), note: "הלקוח ביקש את הקישור שוב" }); }
    if (viaEmail) {
      const id = 100 + k * 4, due = dd(start - 7);
      messages.push({ id, phone, stage: 1, channel: "email", to: "customer" + i + "@example.com", subject: "", body: "", due, status: k === 5 ? "failed" : "delivered", error: k === 5 ? "המייל חזר: הכתובת לא קיימת" : null, at: ago(start, 5) },
                    { id: id + 1, phone, stage: 1, channel: "sms", to: phone, subject: "", body: "", due, status: "delivered", error: null, at: ago(start, 5) });
      cms_events.push({ phone, status: "נשלחה הודעה", at: ago(start, 5), note: "📧💬 שלב 1 נשלח (מייל + SMS)" });
      if (start - paidDay >= 3) { messages.push({ id: id + 2, phone, stage: 2, channel: "email", to: "customer" + i + "@example.com", subject: "", body: "", due, status: "delivered", error: null, at: ago(start - 3, 5) },
                                               { id: id + 3, phone, stage: 2, channel: "sms", to: phone, subject: "", body: "", due, status: "delivered", error: null, at: ago(start - 3, 5) });
        cms_events.push({ phone, status: "נשלחה הודעה", at: ago(start - 3, 5), note: "📧💬 שלב 2 נשלח (מייל + SMS)" }); }
    }
    if (viaWa) events.push({ phone, status: "שולם – אומת", at: ago(paidDay, 1), note: "Stripe" });
    payments.push({ id: "pi_mock_" + i, phone, amount, refunded: 0, commission: +(amount * 0.2).toFixed(2), commissionable: true, month: ym(ago(paidDay, 1)), paid_at: ago(paidDay, 1) });
  });
  root.MOCK = { cases, messages, events, cms_events, payments, payouts: [], admins: [] };
})(window);
