"""Turn raw budget exports into data/budget_fy27.json.

Usage:
    python scripts/clean_budget.py data/raw/expenditures.csv

TODO:
  - Download expenditures/budget CSV from https://data.raleighnc.gov into data/raw/
  - Map messy line items -> department categories (optionally with Gemini, see categorize())
  - Write the aggregated totals back into data/budget_fy27.json
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "budget_fy27.json"

# TODO: adjust once we see the real column names
DEPT_COL = "Department"
AMOUNT_COL = "Amount"


def categorize(line_item: str) -> str:
    """Map a raw line item to a plain-English category. Stub: passthrough."""
    # TODO: optionally batch these to Gemini for messy names
    return line_item.strip()


def main(csv_path: str) -> None:
    totals = defaultdict(float)
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                amount = float(str(row[AMOUNT_COL]).replace(",", "").replace("$", ""))
            except (KeyError, ValueError):
                continue
            totals[categorize(row.get(DEPT_COL, "Unknown"))] += amount

    budget = json.loads(OUT.read_text())
    budget["departments"] = [
        {"name": k, "amount": round(v)} for k, v in sorted(totals.items(), key=lambda kv: -kv[1])
    ]
    OUT.write_text(json.dumps(budget, indent=2))
    print(f"Wrote {len(totals)} departments to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
