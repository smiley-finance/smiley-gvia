# CMS demo (fake data only)

A demo of the email/SMS flow that runs entirely in the browser: fake customers, a fake server, nothing is sent and nothing connects to Supabase.
Use it to show the flow, try changes, or preview the messages.

- `dashboard.html`: the dashboard with fake data. The yellow bar lets you run the timer, skip a day, and reset the demo.
- `preview.html`: every email and SMS (stages 1–4) for each fake customer, plus SMS length.
- `connections.html`: what the connections check looks like.
- `fake-sb.js` / `mock-data.js`: the fake server and the fake customers.

The texts and send rules are NOT copied here. The demo loads the real ones from `supabase/functions/_shared/` (`templates.js`, `send.js`), the same files the server uses.
`dashboard.html` is a snapshot of the dashboard and may fall behind `index.html`.

Open it at `https://yairecom.github.io/smiley-gvia/cms-demo/dashboard.html`, or locally: `python -m http.server 8000` in the repo folder, then `http://localhost:8000/cms-demo/dashboard.html`.
