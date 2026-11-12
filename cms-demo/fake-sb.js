// CMS · a FAKE Supabase client. Same calls the dashboard makes, answered from MOCK data in this browser.
// No network, no keys, no real customers. Changes are kept in localStorage ("cms-mock") until "reset".
//
// It also plays the future Edge Function "cms-send": rpc("cms_send", { p_phone, p_stage })
// -> checks the rules (send.js), writes the messages log + history, moves the status, then fakes delivery reports.
(function (root) {
  const KEY = "cms-mock-v5";
  const STATUSES_OK = ["חדש", "נשלחה הודעה", "בתהליך", "בוצע – ממתין לאימות", "נשלח מכתב התראה", "סגור"];   // what coll_set_status accepts today
  const clone = o => JSON.parse(JSON.stringify(o));
  let DB;
  try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!DB || !DB.cases) DB = clone(root.MOCK);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} };
  const TABLES = { coll_cases: "cases", coll_events: "events", coll_payments: "payments", coll_payouts: "payouts", coll_admins: "admins", cms_messages: "messages", cms_events: "cms_events" };
  const wait = (v, ms = 120) => new Promise(r => setTimeout(() => r(v), ms));   // feels like a server

  // from("table").select("*").eq(k, v).order(k, { ascending }) -> await gives { data, error }
  function from(table) {
    const f = [], o = [];
    const q = {
      select: () => q, eq: (k, v) => (f.push(r => r[k] === v), q),
      order: (k, opt) => (o.push([k, opt && opt.ascending === false ? -1 : 1]), q),
      then: (ok, bad) => {
        const src = table === "cms_cases"     // real server: its own table. Here: read from the mock cases
          ? DB.cases.map(c => ({ phone: c.phone, email_status: c.email_status || "חדש", email_touched_at: c.email_touched_at || null, email_last_at: c.email_last_at || null }))
          : DB[TABLES[table]] || [];
        let rows = clone(src).filter(r => f.every(fn => fn(r)));
        o.forEach(([k, d]) => rows.sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")) * d));
        return wait({ data: rows, error: null }).then(ok, bad);
      },
    };
    return q;
  }

  function setStatus(phone, st, note) {
    if (!STATUSES_OK.includes(st)) return { message: "invalid status" };          // same refusal as the real server
    const c = DB.cases.find(x => x.phone === phone); if (!c) return { message: "case not found" };
    const now = new Date().toISOString();
    Object.assign(c, { status: st, last_action_at: now, done_at: st === "בוצע – ממתין לאימות" ? now : c.done_at,
                       agent_touched_at: c.agent_touched_at || (st !== "חדש" ? now : null) });
    DB.events.push({ phone, status: st, at: now, note: note || null });
    return null;
  }

  // ---------- the email/SMS flow has its own status (email_status) and its own history (cms_events) ----------
  // Same status names as WhatsApp, so agents know them; the values are kept apart. בבדיקה/המתנה is allowed here.
  const EMAIL_STATUSES = ["חדש", "נשלחה הודעה", "בתהליך", "בבדיקה/המתנה", "בוצע – ממתין לאימות", "נשלח מכתב התראה", "סגור"];
  function setEmailStatus(phone, st, note) {
    if (!EMAIL_STATUSES.includes(st)) return { message: "invalid status" };
    const c = DB.cases.find(x => x.phone === phone); if (!c) return { message: "case not found" };
    const now = new Date().toISOString();
    Object.assign(c, { email_status: st, email_last_at: now, email_touched_at: c.email_touched_at || (st !== "חדש" ? now : null) });
    DB.cms_events.push({ phone, status: st, at: now, note: note || null });
    return null;
  }

  // ---------- the future Edge Function, played here ----------
  let NEXT_ID = Math.max(0, ...DB.messages.map(m => m.id)) + 1;
  function cmsSend({ p_phone, p_stage, p_ignore_quiet, p_auto }) {
    const c = DB.cases.find(x => x.phone === p_phone);
    if (!c) return { error: { message: "case not found" } };
    const plan = root.CMS_SEND.plan(c, p_stage, { log: DB.messages, ignoreQuiet: !!p_ignore_quiet });
    if (!plan.ok) return { data: plan, error: { message: plan.errors.join(" · ") } };
    const at = new Date().toISOString(), m = plan.msg, rows = [];
    if (plan.channels.email) rows.push({ id: NEXT_ID++, phone: c.phone, stage: p_stage, channel: "email", to: c.email, subject: m.subject,
      body: m.text, attach: m.attach, due: plan.due, status: "sent", error: null, at, auto: !!p_auto });
    if (plan.channels.sms) rows.push({ id: NEXT_ID++, phone: c.phone, stage: p_stage, channel: "sms", to: c.phone, subject: "",
      body: m.sms, parts: m.smsInfo.parts, due: plan.due, status: "sent", error: null, at, auto: !!p_auto });
    DB.messages.push(...rows);
    const how = [plan.channels.email && "מייל", plan.channels.sms && "SMS"].filter(Boolean).join(" + ");
    setEmailStatus(c.phone, plan.statusAfter, `${p_auto ? "⏱ נשלח אוטומטית · " : ""}📧💬 שלב ${p_stage} נשלח (${how}) · מועד אחרון ${plan.due}`);   // the WhatsApp status is NOT touched
    save();
    // delivery reports arrive a few seconds later (the providers' webhooks)
    rows.forEach(r => setTimeout(() => {
      const row = DB.messages.find(x => x.id === r.id); if (!row) return;
      if (row.channel === "email" && /bounce/.test(row.to)) { row.status = "failed"; row.error = "המייל חזר: הכתובת לא קיימת";
        DB.cms_events.push({ phone: row.phone, status: c.email_status, at: new Date().toISOString(), note: "⚠ המייל חזר (bounce): לבדוק את כתובת המייל" }); }
      else row.status = "delivered";
      save(); root.dispatchEvent(new CustomEvent("cms-report", { detail: row }));
    }, 2500 + Math.random() * 2000));
    return { data: Object.assign({}, plan, { sent: rows.map(r => r.channel) }), error: null };
  }

  // ---------- the scheduler (real: a cron job on the server every 15 minutes, runs with nobody logged in) ----------
  // Sends stages 2-4 that are due, inside the window (Sun-Thu 08:00-20:00). Here it runs every 30s while a page is open.
  DB.meta = DB.meta || { runs: 0, last_run: null, last_sent: 0 };
  function engineLetters() {            // MOCK ONLY: plays the private engine that prepares the warning letters (day 8)
    DB.cases.forEach(c => {
      const t = root.CMS_SEND.track(c, DB.messages);
      if (t.next === 3 && !c.letter_path && t.due && t.due - Date.now() < 864e5) { c.letter_path = "mock/" + c.phone + ".pdf"; c.letter_date = new Date().toISOString(); }
    });
  }
  function runAuto() {
    engineLetters();
    const ignoreQuiet = (() => { try { return localStorage.getItem("cms-iq") === "1"; } catch (e) { return false; } })();
    const picks = root.CMS_SEND.autoPick(DB.cases, DB.messages, new Date(), { ignoreQuiet });
    const done = picks.map(x => (cmsSend({ p_phone: x.c.phone, p_stage: x.stage, p_ignore_quiet: ignoreQuiet, p_auto: true }), { name: x.c.name, stage: x.stage }));
    Object.assign(DB.meta, { runs: DB.meta.runs + 1, last_run: new Date().toISOString(), last_sent: done.length, window: root.CMS_SEND.quiet(new Date()) });
    save();
    if (done.length) root.dispatchEvent(new CustomEvent("cms-auto", { detail: done }));
    return done;
  }
  setTimeout(runAuto, 1500); setInterval(runAuto, 30e3);
  // MOCK ONLY: move the demo one day forward (every date in the data goes one day back), then run the scheduler
  function skipDay() {
    const back = iso => iso ? new Date(new Date(iso) - 864e5).toISOString() : iso;
    const backD = s => { const m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(s || ""); if (!m) return s; const d = new Date(+m[3], +m[2] - 1, +m[1] - 1); return [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()].join("."); };
    DB.cases.forEach(c => ["latest", "agent_touched_at", "last_action_at", "done_at", "letter_date", "email_touched_at", "email_last_at", "created_at"].forEach(k => c[k] = back(c[k])));
    DB.messages.forEach(m => { m.at = back(m.at); m.due = backD(m.due); });
    [DB.events, DB.cms_events].forEach(l => l.forEach(e => e.at = back(e.at)));
    DB.payments.forEach(p => p.paid_at = back(p.paid_at));
    DB.meta.days_skipped = (DB.meta.days_skipped || 0) + 1;
    save(); return runAuto();
  }

  // ---------- a fake warning letter (a small real PDF, made here) ----------
  function fakePdf(name) {
    const lines = ["MOCK WARNING LETTER - SAMPLE ONLY", "", "This is not a real letter.", "Case: " + name, "Smiley CMS test data"];
    const text = "BT /F1 18 Tf 60 760 Td 26 TL " + lines.map(l => `(${l.replace(/[()\\]/g, "")}) '`).join(" ") + " ET";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let out = "%PDF-1.4\n"; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")
      + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return new Blob([out], { type: "application/pdf" });
  }

  // ---------- health check: the shape the real Edge Function "cms-health" will return ----------
  // state: ok = connected · mock = demo only · off = not set up yet · err = problem
  function health() {
    const t0 = performance.now(), last = ch => DB.messages.filter(m => m.channel === ch).sort((a, b) => b.at.localeCompare(a.at))[0];
    const day = Date.now() - 864e5, recent = DB.messages.filter(m => new Date(m.at) >= day);
    const reports = DB.messages.filter(m => m.status === "delivered" || m.status === "failed").sort((a, b) => b.at.localeCompare(a.at));
    return {
      mode: "mock", checked_at: new Date().toISOString(),
      systems: [
        { key: "db", name: "מסד הנתונים (Supabase)", state: "mock", ms: Math.round(performance.now() - t0 + 40), detail: `שרת מדומה בדפדפן · ${DB.cases.length} תיקים מדומים`, real: "פרויקט הבדיקה של יאיר (Supabase)" },
        { key: "fn", name: "פונקציית השליחה (cms-send)", state: "mock", ms: 60, detail: "רצה בדפדפן (fake-sb.js) עם אותם כללים של send.js", real: "Edge Function בפרויקט הבדיקה" },
        { key: "email", name: "מייל · Google Workspace", state: "off", detail: "לא מוגדר עדיין. שום מייל לא יוצא.", need: "GMAIL_USER + GMAIL_APP_PASSWORD (סודות ב-Supabase) · DKIM פעיל", real: "שליחה דרך SMTP של Gmail מ-collections@" },
        { key: "sms", name: "SMS · ספק ישראלי", state: "off", detail: "לא מוגדר עדיין. שום SMS לא יוצא.", need: "SMS_API_KEY · שם שולח Smiley מאושר", real: "InforU / 019 / Cellact" },
        { key: "hook", name: "דיווחי מסירה (webhook)", state: "mock", detail: reports[0] ? `דיווח אחרון: ${new Date(reports[0].at).toLocaleString("he-IL")}` : "עוד לא התקבלו דיווחים", real: "הספקים מדווחים נמסר / נכשל לפונקציה" },
        { key: "cron", name: "מתזמן אוטומטי (שלבים 2–4)", state: "mock", detail: DB.meta && DB.meta.last_run ? `ריצה אחרונה: ${new Date(DB.meta.last_run).toLocaleTimeString("he-IL")} · נשלחו ${DB.meta.last_sent}${DB.meta.window ? " · " + DB.meta.window : " · חלון שליחה פתוח"}` : "עוד לא רץ", real: "cron בשרת כל 15 דקות, רץ גם כשאף אחד לא מחובר · א׳–ה׳ 08:00–20:00" },
        { key: "letters", name: "מכתבי התראה (Storage)", state: "mock", detail: "PDF מדומה נוצר בדפדפן", real: "coll-letters, מצורף אוטומטית לשלב 3" },
      ],
      activity: {
        last_email: (last("email") || {}).at || null, last_sms: (last("sms") || {}).at || null,
        sent_24h: recent.length, failed_24h: recent.filter(m => m.status === "failed").length,
        pending: DB.messages.filter(m => m.status === "sent" || m.status === "queued").length,
      },
    };
  }

  root.FAKE_SB = {
    auth: {
      getSession: () => wait({ data: { session: { user: { email: "agent@mock.test" } } } }),
      signInWithPassword: () => wait({ error: null }), signOut: () => wait({}),
    },
    from,
    rpc: (name, args) => {
      if (name === "coll_set_status") { const e = setStatus(args.p_phone, args.p_status, args.p_note); save(); return wait({ error: e }); }
      if (name === "coll_mark_payout") { DB.payouts.push({ month: args.p_month, ref: args.p_ref, paid_at: new Date().toISOString() }); save(); return wait({ error: null }); }
      if (name === "cms_set_status") { const e = setEmailStatus(args.p_phone, args.p_status, args.p_note); save(); return wait({ error: e }); }
      if (name === "cms_send") return wait(cmsSend(args), 600);
      if (name === "cms_auto_run") return wait({ data: runAuto(), error: null }, 300);
      if (name === "mock_skip_day") return wait({ data: skipDay(), error: null }, 300);
      if (name === "cms_health") return wait({ data: health(), error: null }, 300 + Math.random() * 300);
      return wait({ error: { message: "unknown rpc " + name } });
    },
    // the real Edge Functions cms-send / cms-health, played here. Same answer shape as the real ones.
    functions: { invoke: (name, opt) => {
      const b = (opt && opt.body) || {};
      if (name === "cms-send") {
        const r = cmsSend({ p_phone: b.phone, p_stage: b.stage, p_ignore_quiet: b.ignore_quiet });
        return wait({ data: Object.assign({ ok: !r.error, sent: [], failed: [] }, r.data || {}, r.error ? { ok: false, error: r.error.message } : {}), error: null }, 600);
      }
      if (name === "cms-health") return wait({ data: health(), error: null }, 300 + Math.random() * 300);
      return wait({ data: null, error: { message: "unknown function " + name } });
    } },
    storage: { from: () => ({ createSignedUrl: path => {
      const c = DB.cases.find(x => x.letter_path === path);
      return wait({ data: { signedUrl: URL.createObjectURL(fakePdf(c ? c.name.replace(/[^\x20-\x7E]/g, "") || c.phone : path)) } });
    } }) },
  };
  root.MOCK_RESET = () => { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  root.MOCK_DB = () => DB;
})(window);
