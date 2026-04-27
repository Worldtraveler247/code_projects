#!/usr/bin/env python3
"""Fetch housing-market crash indicators from FRED and write real-estate-risk/data.json.

Each indicator is z-scored against the rolling 20-year window. Risk score is mapped
0-100 where 50 = historical average. The composite is the unweighted mean across
indicators that fetched successfully.
"""

import json
import os
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("FRED_API_KEY")
if not API_KEY:
    sys.exit("FRED_API_KEY env var not set")

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
START_DATE = "1980-01-01"
ROLLING_WINDOW = 240  # 20 years of monthly observations

INDICATORS = [
    {"id": "case_shiller", "name": "Case-Shiller Home Price Index", "fredId": "CSUSHPISA",
     "category": "valuation", "higher_is_riskier": True, "unit": "index",
     "description": "S&P/Case-Shiller national home price index. Bubble territory when far above its 20yr trend."},
    {"id": "median_price", "name": "Median Sales Price", "fredId": "MSPUS",
     "category": "valuation", "higher_is_riskier": True, "unit": "USD",
     "description": "Median sale price of houses sold in the US."},
    {"id": "homeownership", "name": "Homeownership Rate", "fredId": "RHORUSQ156N",
     "category": "valuation", "higher_is_riskier": False, "unit": "%",
     "description": "Falling homeownership preceded the 2008 crash for years before it became visible."},
    {"id": "mortgage_delinquency", "name": "Mortgage Delinquency Rate", "fredId": "DRSFRMACBS",
     "category": "credit", "higher_is_riskier": True, "unit": "%",
     "description": "Single-family mortgages 90+ days late. Lagging signal but the most direct measure of credit stress."},
    {"id": "debt_service_ratio", "name": "Household Debt Service Ratio", "fredId": "TDSP",
     "category": "leverage", "higher_is_riskier": True, "unit": "%",
     "description": "Share of disposable income that goes to debt payments. Peaked in 2007."},
    {"id": "real_income", "name": "Real Median Household Income", "fredId": "MEHOINUSA672N",
     "category": "leverage", "higher_is_riskier": False, "unit": "USD",
     "description": "Inflation-adjusted median income. Affordability collapses when prices outrun wages."},
    {"id": "housing_starts", "name": "Housing Starts", "fredId": "HOUST",
     "category": "supply", "higher_is_riskier": False, "unit": "thousands",
     "description": "New housing units started. Collapsed 79% from 2006 peak to 2009 trough."},
    {"id": "months_inventory", "name": "Months of Inventory", "fredId": "MSACSR",
     "category": "supply", "higher_is_riskier": True, "unit": "months",
     "description": "How long current inventory would last at current sales pace. >7 months = oversupply."},
    {"id": "new_home_sales", "name": "New Home Sales", "fredId": "HSN1F",
     "category": "supply", "higher_is_riskier": False, "unit": "thousands",
     "description": "New single-family homes sold (annualized rate)."},
    {"id": "unemployment", "name": "Unemployment Rate", "fredId": "UNRATE",
     "category": "macro", "higher_is_riskier": True, "unit": "%",
     "description": "Job loss is the single biggest driver of mortgage default."},
    {"id": "mortgage_rate", "name": "30-Year Mortgage Rate", "fredId": "MORTGAGE30US",
     "category": "macro", "higher_is_riskier": True, "unit": "%",
     "description": "Cost of a fixed mortgage. Rising rates kill affordability and sales."},
    {"id": "yield_curve", "name": "Yield Curve (10y - 2y)", "fredId": "T10Y2Y",
     "category": "macro", "higher_is_riskier": False, "unit": "%",
     "description": "Negative = inverted = recession often follows within 6-18 months."},
    {"id": "fed_funds", "name": "Fed Funds Rate", "fredId": "FEDFUNDS",
     "category": "macro", "higher_is_riskier": True, "unit": "%",
     "description": "Tightening cycles preceded both the 1989 and 2008 housing peaks."},
    {"id": "consumer_sentiment", "name": "Consumer Sentiment", "fredId": "UMCSENT",
     "category": "sentiment", "higher_is_riskier": False, "unit": "index",
     "description": "Univ. of Michigan index. Sustained weakness coincides with housing pullbacks."},
]

CATEGORIES = {
    "valuation": "Affordability & Valuation",
    "credit": "Credit Stress",
    "leverage": "Household Leverage",
    "supply": "Supply & Activity",
    "macro": "Macro Triggers",
    "sentiment": "Sentiment",
}


def fetch_series(series_id):
    params = {
        "series_id": series_id,
        "api_key": API_KEY,
        "file_type": "json",
        "observation_start": START_DATE,
    }
    url = f"{FRED_BASE}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)
    out = []
    for o in data.get("observations", []):
        v = o.get("value")
        if v in (".", None, ""):
            continue
        try:
            out.append({"date": o["date"], "value": float(v)})
        except (ValueError, TypeError):
            continue
    return out


def compute_risk(values, higher_is_riskier):
    if len(values) < 12:
        return None, None, None
    window = values[-ROLLING_WINDOW:] if len(values) > ROLLING_WINDOW else values
    current = values[-1]
    mean = statistics.fmean(window)
    stdev = statistics.pstdev(window) or 1e-9
    z = (current - mean) / stdev
    rank = sum(1 for v in window if v <= current)
    pct = round(rank / len(window) * 100)
    score = 50 + z * 20 if higher_is_riskier else 50 - z * 20
    score = max(0, min(100, round(score)))
    return round(z, 2), pct, score


def risk_level(score):
    if score is None:
        return "unknown"
    if score >= 80:
        return "critical"
    if score >= 65:
        return "high"
    if score >= 45:
        return "moderate"
    if score >= 25:
        return "low"
    return "minimal"


def main():
    out_inds = []
    for ind in INDICATORS:
        try:
            obs = fetch_series(ind["fredId"])
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
            print(f"WARN: {ind['fredId']} fetch failed: {e}", file=sys.stderr)
            continue
        if not obs:
            print(f"WARN: {ind['fredId']} returned no observations", file=sys.stderr)
            continue
        values = [o["value"] for o in obs]
        z, pct, score = compute_risk(values, ind["higher_is_riskier"])
        latest = obs[-1]
        out_inds.append({
            "id": ind["id"],
            "name": ind["name"],
            "fredId": ind["fredId"],
            "category": ind["category"],
            "unit": ind["unit"],
            "description": ind["description"],
            "current": round(latest["value"], 2),
            "currentDate": latest["date"],
            "zScore": z,
            "percentile": pct,
            "riskScore": score,
            "riskLevel": risk_level(score),
            "history": obs,
        })
        print(f"OK {ind['fredId']}: {latest['date']} = {latest['value']} (risk {score})")

    scores = [i["riskScore"] for i in out_inds if i.get("riskScore") is not None]
    composite = round(sum(scores) / len(scores)) if scores else 0

    cat_scores = {}
    for cat, label in CATEGORIES.items():
        cat_inds = [i for i in out_inds if i["category"] == cat and i.get("riskScore") is not None]
        if cat_inds:
            cat_scores[cat] = {
                "name": label,
                "score": round(sum(i["riskScore"] for i in cat_inds) / len(cat_inds)),
                "indicatorIds": [i["id"] for i in cat_inds],
            }

    payload = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "compositeScore": composite,
        "compositeLevel": risk_level(composite),
        "categories": cat_scores,
        "indicators": out_inds,
    }

    out_path = Path(__file__).resolve().parent.parent / "real-estate-risk" / "data.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"\nWrote {out_path} ({out_path.stat().st_size:,} bytes)")
    print(f"Composite risk: {composite}/100 ({risk_level(composite)})")


if __name__ == "__main__":
    main()
