"""
review_server.py  -  a small local web page to confirm or correct the dates
that scan.py flagged.

For each flagged photo/video you see the picture, who's in it, the current
date, why it was flagged, and a year/month picker. Choosing a date writes it
back to Immich (so the timeline fixes itself) and records it in
corrections.json (which the organizer and the date-guesser learn from).

Runs only on your own laptop: http://localhost:5000
"""

from __future__ import annotations
import json
from pathlib import Path

from flask import Flask, request, redirect, Response, render_template_string

from immich_client import ImmichClient


PAGE = """
<!doctype html><html><head><meta charset="utf-8"><title>Timeline Doctor</title>
<style>
 body{font-family:system-ui,Arial;margin:0;background:#0f1115;color:#e8e8e8}
 header{padding:14px 20px;background:#171a21;font-size:18px;font-weight:600}
 .card{max-width:760px;margin:24px auto;background:#171a21;border-radius:12px;
       padding:18px;box-shadow:0 2px 12px #0006}
 img{max-width:100%;border-radius:8px;display:block;margin:0 auto 14px}
 .meta{font-size:14px;line-height:1.6;color:#c7c7c7}
 .reason{margin:10px 0;padding:10px;background:#241c14;border-radius:8px;color:#ffd9a8}
 .people span{display:inline-block;background:#222732;border-radius:14px;
              padding:3px 10px;margin:2px;font-size:13px}
 form{margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 select,button{font-size:15px;padding:8px 12px;border-radius:8px;border:1px solid #333}
 button{cursor:pointer;background:#2d6cdf;color:#fff;border:none;font-weight:600}
 button.sec{background:#2a2f3a;color:#ddd}
 .done{max-width:760px;margin:60px auto;text-align:center;color:#9ad}
 .count{float:right;font-weight:400;color:#9aa;font-size:14px}
</style></head><body>
<header>Timeline Doctor <span class="count">{{remaining}} left to review</span></header>
{% if item %}
<div class="card">
  <img src="/thumb/{{item.asset_id}}" alt="preview">
  <div class="meta">
    <b>{{item.filename}}</b><br>
    Current date: {{item.current_date or "— none —"}}<br>
    <div class="people">Who's in it:
      {% for p in item.people %}
        <span>{{p.name}} — looks ~{{p.apparent_age}}{% if p.expected_age is not none %} (date implies {{p.expected_age}}){% endif %}</span>
      {% endfor %}
    </div>
  </div>
  <div class="reason">⚠ {{item.reason}} &nbsp; Suggested year: <b>{{item.suggested_year}}</b>
       {% if item.confidence=='certain' %}(high confidence){% endif %}</div>

  <form method="post" action="/save">
    <input type="hidden" name="asset_id" value="{{item.asset_id}}">
    Year:
    <select name="year">
      {% for y in years %}<option value="{{y}}" {% if y==item.suggested_year %}selected{% endif %}>{{y}}</option>{% endfor %}
    </select>
    Month:
    <select name="month">
      <option value="">unknown</option>
      {% for m in range(1,13) %}<option value="{{m}}">{{m}}</option>{% endfor %}
    </select>
    <button type="submit">Save date</button>
    <button class="sec" formaction="/correct" formmethod="post" name="asset_id" value="{{item.asset_id}}">Date is already right</button>
    <button class="sec" formaction="/skip" formmethod="post" name="asset_id" value="{{item.asset_id}}">Skip for now</button>
  </form>
</div>
{% else %}
<div class="done"><h2>All caught up 🎉</h2><p>No items left in the review queue.</p></div>
{% endif %}
</body></html>
"""


def create_app(cfg: dict):
    app = Flask(__name__)
    queue_file = Path(cfg.get("queue_file", "review_queue.json"))
    corr_file = Path(cfg.get("corrections_file", "corrections.json"))
    client = ImmichClient(cfg["immich"]["base_url"], cfg["immich"]["api_key"])

    def load_queue():
        return json.loads(queue_file.read_text()) if queue_file.exists() else []

    def save_queue(q):
        queue_file.write_text(json.dumps(q, indent=2))

    def record_correction(asset_id, iso, year, month):
        data = json.loads(corr_file.read_text()) if corr_file.exists() else []
        data.append({"asset_id": asset_id, "date": iso, "year": year, "month": month})
        corr_file.write_text(json.dumps(data, indent=2))

    def next_pending():
        for it in load_queue():
            if it.get("status") == "pending":
                return it
        return None

    def set_status(asset_id, status):
        q = load_queue()
        for it in q:
            if it["asset_id"] == asset_id:
                it["status"] = status
        save_queue(q)

    @app.route("/")
    def index():
        q = load_queue()
        remaining = sum(1 for it in q if it.get("status") == "pending")
        item = next_pending()
        years = list(range(1960, 2031))
        return render_template_string(PAGE, item=item, remaining=remaining, years=years)

    @app.route("/thumb/<asset_id>")
    def thumb(asset_id):
        return Response(client.preview_bytes(asset_id), mimetype="image/jpeg")

    @app.route("/save", methods=["POST"])
    def save():
        aid = request.form["asset_id"]
        year = int(request.form["year"])
        month = request.form.get("month") or ""
        m = int(month) if month else 1   # default to January when month unknown
        iso = f"{year:04d}-{m:02d}-01T12:00:00.000Z"
        client.set_date(aid, iso)
        record_correction(aid, iso, year, int(month) if month else None)
        set_status(aid, "fixed")
        return redirect("/")

    @app.route("/correct", methods=["POST"])
    def correct():
        set_status(request.form["asset_id"], "kept")
        return redirect("/")

    @app.route("/skip", methods=["POST"])
    def skip():
        set_status(request.form["asset_id"], "skipped")
        return redirect("/")

    return app
