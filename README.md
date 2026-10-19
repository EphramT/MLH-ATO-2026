# Raleigh Tax Tracker

See where Raleigh's money goes, and how much of **your** tax bill funds each department and capital project.

MLH x ATO Hackathon, Raleigh NC, 2026.

## How it works
1. Pick a taxpayer class (or type a home value).
2. City tax = `assessed_value * city_rate / 100` (FY27 rate: 37.2¢ per $100).
3. Your bill is split across general fund departments by each one's share of the budget.
4. Ask Gemini things like "why did my bill go up?"

Water and sewer are funded by utility fees, not property tax, so they're left out.

## Run locally
```bash
python -m venv .venv
.venv\Scripts\activate          # Windows (source .venv/bin/activate on mac/linux)
pip install -r requirements.txt
copy .env.example .env          # then add your GEMINI_API_KEY
python app.py                   # http://localhost:8080
```

## Layout
| Path | What |
|---|---|
| `app.py` | Flask API, also serves `static/` |
| `data/budget_fy27.json` | Rates, classes, department and capital project budgets (**placeholder numbers, replace them**) |
| `scripts/clean_budget.py` | Turns raw open-data CSV exports into `budget_fy27.json` |
| `static/` | Dashboard (HTML + Chart.js) |
| `.do/app.yaml` | DigitalOcean App Platform spec |

## API
- `GET /api/budget`: full budget JSON
- `GET /api/breakdown?value=391000` or `?class=median`: your share per department and project
- `POST /api/ask` `{ "question": "...", "value": 391000 }`: Gemini explanation

## Data sources
- City of Raleigh open data: https://data.raleighnc.gov (search "budget", "expenditures")
- FY27 adopted budget PDF (department breakdown)
- Wake County tax rate: verify the FY27 rate before you hardcode it

## TODO
- [ ] Replace placeholder department and project numbers with real FY27 data
- [ ] Confirm the Wake County FY27 rate
- [ ] Renter class: estimate the share of property tax passed through in rent
- [ ] Set the GitHub repo in `.do/app.yaml` and deploy

## Sentry
Set `SENTRY_DSN` in `.env` (Sentry > Project Settings > Client Keys). Leave it blank to turn Sentry off.

What it tracks:
- **Wake County outages:** failed parcel lookups are reported with the query that failed (tag `upstream:wake_county`), and users see a friendly message.
- **Gemini failures and blocked answers:** reported with tag `upstream:gemini`.
- **Performance:** every request is traced, with custom spans for `wake.parcels` and `gen_ai.generate`. Browser traces connect to the backend.
- **Data quality:** warns when a taxable parcel has no assessed value, or when department totals don't add up to the general fund. Every event is tagged `budget.placeholder` while we're on placeholder data.
- **Frontend:** JavaScript errors, plus a session replay whenever an error happens.

To test it, visit `/api/debug-sentry` (turned off in production).

## RUNNING THE APP
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app.py
