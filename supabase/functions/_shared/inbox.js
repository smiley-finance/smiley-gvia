// Smiley CMS · inbox.js: sorts a customer's email reply into one of Yair's ready-reply types (18.11.2026).
// Plain keyword rules, no AI: the same text always gets the same type, and nothing leaves Supabase.
// The agent can always change the type by hand on the dashboard. Used by the Edge Function cms-inbox (and the demo).
// The keyword lists are general Hebrew phrases, not taken from any customer's message.
(function (root) {
  // order matters: the first type whose words appear wins
  const RULES = [
    ["paid",    ["שילמתי", "שולם", "ששילמתי", "כבר שילמ", "אישור תשלום", "אישור על תשלום", "העברתי את", "שילמנו"]],
    ["legal",   ["תביעה", "תבעו", "אתבע", "לתבוע", "בית משפט", "בית המשפט", "עורך דין", "עורכת דין", "עו\"ד", "עו״ד", "הליכים משפטיים", "משטרה", "תלונה"]],
    // return / cancel intent — must sit ABOVE sub (whose bare "מנוי" would swallow it). Phrases are anchored on
    // מוצר / מנוי so a bare "להחזיר" or "ביטול" (e.g. refund the money, cancel the transaction) does not match.
    ["retsub",  ["להחזיר מוצר", "להחזיר את המוצר", "להחזיר את המוצרים", "להחזיר מוצרים", "להחזיר את הפריט", "החזרת מוצר", "החזרת המוצר", "להחזיר את ההזמנה", "לבטל מנוי", "לבטל את המנוי", "ביטול מנוי", "ביטול המנוי", "להפסיק מנוי", "להפסיק את המנוי", "לבטל מינוי", "לבטל את המינוי", "ביטול מינוי"]],
    ["sub",     ["מנוי", "הוראת קבע", "הוראת הקבע", "חד פעמי", "חד-פעמי", "חד־פעמי", "פעם אחת", "חיוב נוסף", "חיוב חוזר", "חייבתם שוב", "לא הזמנתי עוד"]],
    ["notrecv", ["לא קיבלתי", "לא קבלתי", "לא הגיע", "לא הגיעה", "לא אספתי", "לא משכתי", "לא נמסר", "לא קיבלנו", "לא התקבל"]],
    ["pay",     ["אשלם", "רוצה לשלם", "מוכן לשלם", "מוכנה לשלם", "איך משלמים", "איך לשלם", "לשלם את החוב", "אסדיר"]],
    ["who",     ["מי אתם", "עוקץ", "הונאה", "על מה החוב", "איזה חוב", "על מה מדובר", "לא מכיר", "לא מכירה"]],
    ["call",    ["תתקשרו", "תחזרו אלי", "לחזור אלי", "שיחזרו", "טלפונית", "צרו קשר", "ליצור קשר", "להתקשר"]],
  ];
  // the dashboard label of each type; reply = the title of Yair's ready reply (null = no ready reply: a person decides)
  const KINDS = {
    paid:    { label: "כבר שילמתי",              reply: "\"כבר שילמתי\"" },
    legal:   { label: "סירוב / איום בתביעה",       reply: "\"תתבעו אותי\" / סירוב" },
    sub:     { label: "לא ידעתי שזה מנוי",          reply: "\"לא ידעתי שזה מנוי\"" },
    retsub:  { label: "רוצה להחזיר מוצר / לבטל מנוי", reply: "רוצה להחזיר מוצר / לבטל מנוי" },
    notrecv: { label: "לא קיבלתי",                reply: "\"לא קיבלתי\"" },
    pay:     { label: "רוצה לשלם / איך",           reply: "הסכים לשלם / שאל איך" },
    who:     { label: "מי אתם? זה עוקץ?",           reply: "\"מי אתם? זה עוקץ?\"" },
    call:    { label: "ביקש שיחזרו אליו",          reply: null },
    other:   { label: "לבדיקה ידנית",             reply: null },
  };
  const norm = s => String(s || "").replace(/[֑-ׇ]/g, "").replace(/\s+/g, " ");
  function classify(text) {
    const t = norm(text);
    for (const [kind, words] of RULES) if (words.some(w => t.includes(w))) return kind;
    return "other";
  }
  // keep only what the customer wrote now: cut the quoted earlier mail and phone signatures
  const CUT = [/^\s*>/, /^\s*(בתאריך|ב-\d|On .+(wrote|כתב)|From:|-----Original|Le .+ a écrit|في .+ كتب|נשלח מה-?iPhone|Sent from|השג את Outlook|קבל Outlook|Get Outlook)/i];
  function fresh(text) {
    const out = [];
    for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
      if (CUT.some(r => r.test(line))) break;
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  root.CMS_INBOX = { RULES, KINDS, classify, fresh };
})(typeof window !== "undefined" ? window : globalThis);
