import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

ROOT = Path(__file__).resolve().parent
BUDGET = json.loads((ROOT / "data" / "budget_fy27.json").read_text())

app = Flask(__name__, static_folder="static", static_url_path="")

# Wake County tax parcels (public ArcGIS service, no key needed)
PARCELS_URL = "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query"
PARCEL_FIELDS = [
    "PIN_NUM", "REID", "SITE_ADDRESS", "CITY", "CITY_DECODE", "TOTAL_VALUE_ASSD",
    "LAND_VAL", "BLDG_VAL", "TYPE_USE_DECODE", "EXEMPTSTAT", "EXEMPTDESC", "YEAR_BUILT",
]


def query_parcels(where: str, limit: int = 10) -> list[dict]:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": ",".join(PARCEL_FIELDS),
        "returnGeometry": "false",
        "resultRecordCount": limit,
        "orderByFields": "SITE_ADDRESS",
        "f": "json",
    })
    with urllib.request.urlopen(f"{PARCELS_URL}?{params}", timeout=15) as resp:
        data = json.load(resp)
    if "error" in data:
        raise RuntimeError(data["error"].get("message", "parcel query failed"))
    return [f["attributes"] for f in data.get("features", [])]


def resolve_value() -> float:
    """Assessed value from ?value= or ?class=, defaulting to the median class."""
    if request.args.get("value"):
        return float(request.args["value"])
    cls_id = request.args.get("class", "median")
    cls = next((c for c in BUDGET["classes"] if c["id"] == cls_id), None)
    if cls is None:
        raise ValueError(f"unknown class '{cls_id}'")
    return float(cls["value"])


def compute_breakdown(value: float) -> dict:
    rates = BUDGET["rates_per_100"]
    city_tax = value * rates["city"] / 100
    county_tax = value * rates["county"] / 100

    gf = sum(d["amount"] for d in BUDGET["departments"])
    departments = [
        {**d, "share_pct": d["amount"] / gf * 100, "your_dollars": city_tax * d["amount"] / gf}
        for d in BUDGET["departments"]
    ]

    # Your slice of each capital project = your city tax as a fraction of the general fund.
    # TODO: refine. Capital is funded by bonds/debt service too, so this is a rough proxy.
    your_fraction = city_tax / BUDGET["totals"]["general_fund"]
    projects = [
        {**p, "your_dollars": p["amount"] * your_fraction} for p in BUDGET["capital_projects"]
    ]

    return {
        "assessed_value": value,
        "city_tax": round(city_tax, 2),
        "county_tax": round(county_tax, 2),
        "total_tax": round(city_tax + county_tax, 2),
        "departments": departments,
        "capital_projects": projects,
    }


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/budget")
def budget():
    return jsonify(BUDGET)


@app.get("/api/breakdown")
def breakdown():
    try:
        value = resolve_value()
    except ValueError as e:
        return jsonify(error=str(e)), 400
    return jsonify(compute_breakdown(value))


@app.get("/api/search")
def search():
    """Address autocomplete, limited to parcels inside Raleigh city limits."""
    q = re.sub(r"[^A-Z0-9 ]", "", request.args.get("q", "").upper()).strip()
    q = re.sub(r"\s+", " ", q)
    if len(q) < 3:
        return jsonify(results=[])
    try:
        rows = query_parcels(f"CITY = 'RAL' AND SITE_ADDRESS LIKE '{q}%'")
    except Exception as e:
        return jsonify(error=f"Wake County lookup failed: {e}"), 502
    return jsonify(results=[
        {"pin": r["PIN_NUM"], "address": r["SITE_ADDRESS"], "type": r["TYPE_USE_DECODE"]}
        for r in rows
    ])


@app.get("/api/property")
def property_lookup():
    pin = request.args.get("pin", "")
    if not re.fullmatch(r"\d{10}", pin):
        return jsonify(error="pin must be a 10-digit Wake County PIN"), 400
    try:
        rows = query_parcels(f"PIN_NUM = '{pin}'", limit=1)
    except Exception as e:
        return jsonify(error=f"Wake County lookup failed: {e}"), 502
    if not rows:
        return jsonify(error="property not found"), 404

    p = rows[0]
    result = compute_breakdown(float(p["TOTAL_VALUE_ASSD"] or 0))
    result["property"] = {
        "pin": p["PIN_NUM"],
        "address": p["SITE_ADDRESS"],
        "city": p["CITY_DECODE"],
        "type": p["TYPE_USE_DECODE"],
        "land_value": p["LAND_VAL"],
        "building_value": p["BLDG_VAL"],
        "year_built": p["YEAR_BUILT"],
        "exemption": p["EXEMPTDESC"],
        "wake_url": f"https://services.wake.gov/realestate/Account.asp?id={p['REID']}",
    }
    # TODO: partial exemptions (historic, brownfield, homestead) aren't modeled.
    # Treat any exemption as "bill may be lower or $0" and say so in the UI.
    return jsonify(result)


@app.post("/api/ask")
def ask():
    body = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()
    if not question:
        return jsonify(error="question is required"), 400

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return jsonify(answer="(Gemini not configured. Set GEMINI_API_KEY in .env)")

    from google import genai

    context = compute_breakdown(float(body.get("value") or 391000))
    if body.get("address"):
        context["address"] = body["address"]
    prompt = (
        "You explain Raleigh, NC city property taxes in plain English to residents. "
        "Be concise (under 120 words) and only use the data provided.\n\n"
        f"Budget data: {json.dumps(BUDGET)}\n\n"
        f"This user's breakdown: {json.dumps(context)}\n\n"
        f"Question: {question}"
    )
    client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), contents=prompt
    )
    return jsonify(answer=resp.text)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 8080)), debug=True)
