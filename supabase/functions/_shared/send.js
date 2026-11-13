// Smiley CMS · send.js: THE source of the email/SMS send rules. Used by the Edge Functions and the demo (cms-demo/).
// After editing, run:  python supabase/sync_index.py   (copies it into index.html, which must stay one file).
// CMS · the send rules. This is the logic the Supabase Edge Function will run (here it runs in the mock).
// plan(c, stage, ctx) decides IF a stage may go out, to which channels, with which deadline and texts.
// Nothing is sent from here: the caller (fake server now, Edge Function later) does the sending.
//
// Flow: the agent sends stage 1 by hand. Stages 2-4 then go out AUTOMATICALLY on the day timer
// (a scheduler runs every 15 minutes on the server: autoPick() says what is due now).
// Sending window for every stage: Sunday-Thursday, 08:00-20:00 Israel time. Never Friday or Saturday.
//
// ctx = { log: [messages of this case], now: Date, ignoreQuiet: bool (test only) }
// log rows look like the planned table cms_messages:
//   { id, phone, stage, channel: "email"|"sms", to, subject, body, due, status: "queued"|"sent"|"delivered"|"failed", error, at }
(function (root) {
  const T = root.CMS_T;
  const DONE = "בוצע – ממתין לאימות", HOLD = "בבדיקה/המתנה";
  const DAY = 864e5;

  // Israel time parts (the server runs in UTC, the rules are Israeli)
  function il(now) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map(x => [x.type, x.value]));
    return { wd: p.weekday, h: Number(p.hour), day: `${p.year}-${p.month}-${p.day}` };
  }
  const ilDay = d => il(new Date(d)).day;
  const fmt = d => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric" }).format(d).replace(/\//g, ".");

  // Israeli holidays (no sending all day), from the Hebrew calendar built into every browser and Deno: no list to update.
  // Yom tov days + Yom HaZikaron/Yom HaAtzmaut. The eve of Rosh Hashana, Yom Kippur, Sukkot, Pesach and Shavuot: nothing from 13:00.
  const HEB = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "Asia/Jerusalem", month: "long", day: "numeric" });
  const hebDay = d => { const p = Object.fromEntries(HEB.formatToParts(d).map(x => [x.type, x.value])); return p.month + " " + p.day; };
  const HOLIDAYS = { "Tishri 1": "ראש השנה", "Tishri 2": "ראש השנה", "Tishri 10": "יום כיפור", "Tishri 15": "סוכות",
    "Tishri 22": "שמחת תורה", "Nisan 15": "פסח", "Nisan 21": "שביעי של פסח", "Sivan 6": "שבועות" };
  const EVES = { "Elul 29": "ערב ראש השנה", "Tishri 9": "ערב יום כיפור", "Tishri 14": "ערב סוכות", "Tishri 21": "ערב שמחת תורה",
    "Nisan 14": "ערב פסח", "Nisan 20": "ערב שביעי של פסח", "Sivan 5": "ערב שבועות" };
  // Yom HaAtzmaut is 5 Iyar, moved so it never touches Shabbat (Fri/Sat -> Thursday before, Monday -> Tuesday); Yom HaZikaron is the day before.
  function atzmaut(now) {
    const { wd } = il(now), hd = hebDay(now), back = n => hebDay(new Date(+now - n * DAY)), fwd = n => hebDay(new Date(+now + n * DAY));
    const isAtz = (wd === "Thu" && (hd === "Iyar 4" || hd === "Iyar 3")) ? (fwd(1) === "Iyar 5" || fwd(2) === "Iyar 5")
      : wd === "Tue" && hd === "Iyar 6" ? back(1) === "Iyar 5"
      : hd === "Iyar 5" && !["Fri", "Sat", "Mon"].includes(wd);
    if (isAtz) return "יום העצמאות";
    if (atzmautTomorrow(now)) return "יום הזיכרון";
    return null;
  }
  const atzmautTomorrow = now => { const t = new Date(+now + DAY), { wd } = il(t), hd = hebDay(t);
    return (wd === "Thu" && (hd === "Iyar 4" || hd === "Iyar 3") && (hebDay(new Date(+t + DAY)) === "Iyar 5" || hebDay(new Date(+t + 2 * DAY)) === "Iyar 5"))
      || (wd === "Tue" && hd === "Iyar 6" && hebDay(new Date(+t - DAY)) === "Iyar 5") || (hd === "Iyar 5" && !["Fri", "Sat", "Mon"].includes(wd)); };
  function holiday(now) {
    const hd = hebDay(now), { h } = il(now);
    if (HOLIDAYS[hd]) return `חג (${HOLIDAYS[hd]}): לא שולחים היום`;
    const n = atzmaut(now); if (n) return `${n}: לא שולחים היום`;
    if (EVES[hd] && h >= 13) return `${EVES[hd]}: לא שולחים אחרי 13:00`;
    return null;
  }

  // sending window: Sunday-Thursday 08:00-20:00. Friday + Saturday + Israeli holidays: nothing goes out.
  function quiet(now) {
    const { wd, h } = il(now);
    if (wd === "Fri" || wd === "Sat") return "סוף שבוע: שולחים רק בימים א׳–ה׳";
    const hol = holiday(now); if (hol) return hol;
    if (h < 8 || h >= 20) return "מחוץ לשעות: שולחים רק בין 08:00 ל-20:00";
    return null;
  }
  // the first moment from d (or now) that is inside the window, on a 15-minute step (the scheduler's rhythm)
  function nextWindow(d) {
    let t = new Date(Math.ceil(+new Date(d) / 9e5) * 9e5);
    for (let i = 0; i < 4 * 24 * 8 && quiet(t); i++) t = new Date(+t + 9e5);
    return t;
  }
  const WD = { Sun: "א׳", Mon: "ב׳", Tue: "ג׳", Wed: "ד׳", Thu: "ה׳", Fri: "ו׳", Sat: "ש׳" };
  const when = d => `יום ${WD[il(d).wd]} ${fmt(d).slice(0, 5)} ${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }).format(d)}`;
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ""));
  const validPhone = p => /^9725\d{8}$/.test(String(p || ""));                                // Israeli mobile, international format
  const isPaid = c => Number(c.paid_amount || 0) * 100 >= c.amount - 1;

  // the deadline the customer sees. Stage 2 repeats stage 1's date, stage 4 repeats stage 3's (kept in the log).
  function dueFor(c, stage, log, now) {
    const first = s => log.find(m => m.stage === s && m.due);
    if (stage === 2 && first(1)) return first(1).due;
    if (stage === 4 && first(3)) return first(3).due;
    // stage 1 / 3 set a new deadline; a reminder with no earlier send (agent moved the status by hand) gets a fresh one too
    return fmt(new Date(+now + (stage <= 2 ? 7 : 14) * DAY));
  }

  function plan(c, stage, ctx) {
    ctx = ctx || {};
    const now = ctx.now || new Date(), log = (ctx.log || []).filter(m => m.phone === c.phone);
    const errors = [], warnings = [];
    const sent = s => log.some(m => m.stage === s && m.status !== "failed");

    // 1. the case. The email/SMS flow has its OWN status (email_status), separate from the WhatsApp status.
    //    Shared between the flows: the customer details, and a payment verified in Stripe (it ends both).
    const st = c.email_status || "חדש";
    if (st === "סגור") errors.push("התיק סגור בזרימת המייל/SMS");
    if (isPaid(c) || String(c.status).startsWith("שולם")) errors.push("התיק שולם (אומת ב-Stripe)");
    if (st === DONE) errors.push("הלקוח אמר ששילם: ממתינים לאימות התשלום");
    if (st === HOLD) errors.push("התיק בבדיקה/המתנה");
    if (c.status && c.status !== "חדש") warnings.push(`לידיעה: בוואטסאפ הלקוח בסטטוס "${c.status}" (זרימה נפרדת)`);
    // 2. the stage
    if (sent(stage)) errors.push(`שלב ${stage} כבר נשלח ללקוח הזה`);
    if (log.some(m => m.status !== "failed" && ilDay(m.at) === il(now).day)) errors.push("כבר נשלחה ללקוח הודעה היום. שלב אחד ביום לכל היותר");
    if (stage === 2 && st === "חדש" && !sent(1)) errors.push("קודם לשלוח את הפנייה הראשונה (שלב 1)");
    if (stage === 3 && !c.letter_path) errors.push("מכתב ההתראה עוד לא מוכן (אין PDF)");
    if (stage === 4 && st !== "נשלח מכתב התראה" && !sent(3)) errors.push("קודם לשלוח את מכתב ההתראה (שלב 3)");
    // 3. when
    const q = quiet(now);
    if (q) (ctx.ignoreQuiet ? warnings : errors).push(q + (ctx.ignoreQuiet ? " (מצב בדיקה: מתעלמים)" : ""));
    // 4. the channels
    const email = validEmail(c.email), sms = validPhone(c.phone);
    if (!email) warnings.push(c.email ? `כתובת המייל לא תקינה (${c.email}): יישלח SMS בלבד` : "אין מייל ללקוח: יישלח SMS בלבד. כדאי להמשיך בוואטסאפ");
    if (!sms) warnings.push("מספר הטלפון אינו נייד ישראלי: יישלח מייל בלבד");
    if (!email && !sms) errors.push("אין מייל ואין נייד תקין: אי אפשר לשלוח");
    if (log.some(m => m.channel === "email" && m.status === "failed")) warnings.push("מייל קודם ללקוח הזה חזר (נכשל). לבדוק את הכתובת");

    const due = dueFor(c, stage, log, now);
    const msg = T.render(c, stage, { due, hasEmail: email, now });
    if (msg.smsInfo.parts > 2) warnings.push(`ה-SMS ארוך: ${msg.smsInfo.parts} חלקים`);
    return { ok: errors.length === 0, errors, warnings, stage, due, channels: { email, sms },
             to: { email: email ? c.email : null, sms: sms ? c.phone : null }, msg, statusAfter: T.STATUS_AFTER[stage] };
  }

  // where a customer stands in the 4 stages, and when the next one is due (same days as the WhatsApp flow):
  // Email/SMS timer (the user's decision 12.11.2026): stage 1 (agent) day 0 -> stage 2 day 3 -> stage 3 letter day 8 -> stage 4 day 11.
  // All counted from the day stage 1 was sent. (The WhatsApp flow keeps its own timing.)
  // Uses ONLY the email/SMS flow: its log and its own status (email_status). The WhatsApp status is not used here.
  function track(c, allLog, now) {
    now = now || new Date();
    const log = allLog.filter(m => m.phone === c.phone).sort((a, b) => a.at.localeCompare(b.at));
    const ok = log.filter(m => m.status !== "failed");
    const at = s => { const m = ok.find(x => x.stage === s); return m ? new Date(m.at) : null; };
    const st = c.email_status || "חדש";
    let stage = Math.max(0, ...ok.map(m => m.stage));
    if (!stage && st === "נשלח מכתב התראה") stage = 3;              // the agent moved the email status by hand
    else if (!stage && st === "נשלחה הודעה") stage = 1;
    const s1 = at(1) || (c.email_touched_at && new Date(c.email_touched_at)), s3 = at(3) || (st === "נשלח מכתב התראה" && c.email_last_at && new Date(c.email_last_at));
    const closed = st === "סגור" || isPaid(c) || String(c.status).startsWith("שולם");
    const waiting = st === DONE || st === HOLD;
    const talking = st === "בתהליך";                            // in a conversation with the customer: no automatic next stage
    const plus = (d, n) => d ? new Date(+d + n * DAY) : now;
    let next = null, due = null;
    if (!closed && !waiting && !talking && stage < 4) {
      next = stage + 1;
      due = next === 1 ? now : next === 2 ? plus(s1, 3) : next === 3 ? plus(s1, 8) : plus(s1, 11);
    }
    const last = log[log.length - 1] || null, lastStage = last ? log.filter(m => m.stage === last.stage) : [];
    const auto = !!next && next >= 2;                               // stages 2-4 go out by themselves
    const sendAt = auto ? nextWindow(due > now ? due : now) : null;   // when the scheduler will actually send it
    return {
      stage, next, due, dueNow: !!due && due <= now, auto, sendAt, sendAtText: sendAt ? when(sendAt) : null,
      manualDue: next === 1,                                         // only stage 1 waits for an agent's click
      blocked: next === 3 && !c.letter_path ? "מכתב בהכנה" : null,
      lastAt: last ? new Date(last.at) : null,
      email: (lastStage.find(m => m.channel === "email") || {}).status || null,     // delivery of the last stage, per channel
      sms: (lastStage.find(m => m.channel === "sms") || {}).status || null,
      failed: log.some(m => m.status === "failed"),
      closed, waiting, talking, status: st, count: log.length,
    };
  }

  // the scheduler: which automatic stages (2-4) go out right now. Same rules as a manual send (plan), plus the window.
  function autoPick(cases, allLog, now, opt) {
    now = now || new Date(); opt = opt || {};
    if (quiet(now) && !opt.ignoreQuiet) return [];
    return cases.map(c => ({ c, t: track(c, allLog, now) }))
      .filter(({ t }) => t.auto && t.dueNow && !t.blocked)
      .map(({ c, t }) => ({ c, stage: t.next, plan: plan(c, t.next, { log: allLog, now, ignoreQuiet: opt.ignoreQuiet }) }))
      .filter(x => x.plan.ok);
  }

  root.CMS_SEND = { plan, track, autoPick, quiet, holiday, nextWindow, when, validEmail, validPhone, fmt };
})(typeof window !== "undefined" ? window : globalThis);
