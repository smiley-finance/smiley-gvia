# Copies the email/SMS texts + send rules into index.html (the page must stay one file, no build step).
# THE source is supabase/functions/_shared/templates.js + send.js (the Edge Functions and cms-demo/ use them directly).
# Run from the repo folder after editing either file:   python supabase/sync_index.py
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
shared = root / "supabase" / "functions" / "_shared"
tpl = (shared / "templates.js").read_text(encoding="utf8").strip()
rules = (shared / "send.js").read_text(encoding="utf8").strip()
page = root / "index.html"
s = page.read_text(encoding="utf8")
marker = "<!-- CMS: email/SMS texts + send rules, copied from supabase/functions/_shared/ by supabase/sync_index.py. Do not edit here. -->"
pat = re.compile(re.escape(marker) + r"\n<script>\n.*?\n</script>\n<script>\n.*?\n</script>", re.S)
if len(pat.findall(s)) != 1:
    sys.exit("stopped: the CMS block in index.html was not found exactly once")
s = pat.sub(lambda m: f"{marker}\n<script>\n{tpl}\n</script>\n<script>\n{rules}\n</script>", s)
page.write_text(s, encoding="utf8", newline="\n")
print("index.html updated from supabase/functions/_shared/")
