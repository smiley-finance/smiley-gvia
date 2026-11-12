// CMS · one-way SMS through an Israeli provider (sender name "Smiley", customers can't reply).
// Secrets: SMS_PROVIDER ("inforu"), SMS_USER, SMS_TOKEN, SMS_SENDER (default "Smiley"), WEBHOOK_SECRET (delivery reports).
// Written for InforU's REST API. CHECK the request/response fields against the provider's docs when the account
// is opened (they are marked VERIFY below). Another provider = one more branch in sendSms(), nothing else changes.

const env = (k: string) => Deno.env.get(k) ?? "";
export const smsReady = () => env("SMS_PROVIDER") === "inforu" && !!env("SMS_USER") && !!env("SMS_TOKEN");
const local = (p: string) => "0" + String(p).slice(3);            // 9725XXXXXXXX -> 05XXXXXXXX

// rowId = our cms_messages id. It is put in the delivery-report address, so the report finds its row
// without depending on the provider's own message id.
export async function sendSms(phone972: string, text: string, rowId: number): Promise<void> {
  const report = `${env("SUPABASE_URL")}/functions/v1/cms-report?key=${encodeURIComponent(env("WEBHOOK_SECRET"))}&id=${rowId}`;
  if (env("SMS_PROVIDER") === "inforu") {
    // VERIFY: endpoint, auth and field names (InforU API v2)
    const r = await fetch("https://capi.inforu.co.il/api/v2/SMS/SendSms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${env("SMS_USER")}:${env("SMS_TOKEN")}`) },
      body: JSON.stringify({
        Data: {
          Message: text,
          Recipients: [{ Phone: local(phone972) }],
          Settings: { Sender: env("SMS_SENDER") || "Smiley", DeliveryNotificationUrl: report },
        },
      }),
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || (j.StatusId !== undefined && Number(j.StatusId) !== 1)) throw new Error("SMS נדחה אצל הספק: " + (j.StatusDescription || r.status));
    return;
  }
  throw new Error("ספק SMS לא מוגדר");
}
