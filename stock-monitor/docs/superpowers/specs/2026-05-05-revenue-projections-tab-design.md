# Design: 2026–2027 Revenue Projections Tab

**Date:** 2026-05-05
**App:** Stock Monitor (`app.py`)

## What we're adding

A third tab — "📊 2026–2027 Revenue Projections" — added to the existing `st.tabs(...)` call alongside "Market Overview" and "IPO Watch List."

## Components

### 1. Static data
Hardcoded list of 15 dicts (no API call, no cache needed):

| Ticker | Company | FY2026 ($B) | FY2027 ($B) | YoY% | Notes |
|--------|---------|-------------|-------------|------|-------|
| NVDA | NVIDIA | 215.9 | 367.7 | 70 | FY ends Jan; FY26 already reported |
| MSFT | Microsoft | 330.0 | 385.0 | 17 | FY ends Jun |
| AAPL | Apple | 465.0 | 497.5 | 7 | FY ends Sep |
| GOOGL | Alphabet | 465.0 | 540.0 | 16 | Cloud margin guided to 27.9% in 2027 |
| AMZN | Amazon | 807.0 | 901.0 | 12 | AWS growth accelerating |
| META | Meta | 250.0 | 290.0 | 16 | Capex ramp $125–145B for 2026 |
| BRK.B | Berkshire | 392.5 | 417.5 | 5 | Tracks GDP growth |
| TSLA | Tesla | 105.0 | 130.0 | 20 | Wide range; Robotaxi monetization key for 2027 |
| AVGO | Broadcom | 80.0 | 115.0 | 40 | FY ends Oct/Nov; AI chip revenue target $100B+ in 2027 |
| LLY | Eli Lilly | 85.3 | 94.9 | 11 | GLP-1/oral obesity ramp |
| JPM | JPMorgan | 194.0 | 202.5 | 4 | Rate-path dependent |
| WMT | Walmart | 725.0 | 756.0 | 4 | FY ends Jan |
| V | Visa | 42.0 | 46.0 | 10 | Cross-border recovery |
| XOM | ExxonMobil | 352.5 | 365.0 | 3 | Oil-price sensitive |
| UNH | UnitedHealth | 439.0 | 470.0 | 7 | 2027 reaccelerates after V28 transition |

### 2. Grouped horizontal bar chart (Altair)
- No new dependency — Altair ships with Streamlit
- Y-axis: tickers, sorted by FY2027 revenue descending
- X-axis: revenue in billions
- Two bars per ticker: FY2026 (muted blue) / FY2027 (cyan accent, matching app's `#4af7ff` palette)
- Legend at top

### 3. Detail table
- Styled pandas DataFrame (same approach as existing overview table)
- Columns: Ticker, Company, FY2026 ($B), FY2027 ($B), YoY Growth %, Notes
- YoY Growth % colored: ≥30% cyan, ≥15% green, ≥10% orange, <10% muted
- Hidden index

### 4. Disclaimer caption
Small `st.caption()` below the table: "Estimates blend analyst consensus with company guidance as of early May 2026. Fiscal years vary by company."

## Data flow

```
REVENUE_DATA (list[dict], hardcoded)
  → pd.DataFrame
    → Altair chart (grouped bars)
    → styled Styler table
```

## What changes in `app.py`

1. Add `REVENUE_DATA` constant near the top (after `COMPANY` dict)
2. Add `"📊 2026–2027 Revenue Projections"` to the `st.tabs(...)` call
3. Add a new `with tab_rev:` block containing the chart + table + caption
4. No new imports needed (Altair already available via Streamlit)
