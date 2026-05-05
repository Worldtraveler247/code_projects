# Revenue Projections Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "📊 2026–2027 Revenue Projections" tab to the Stock Monitor Streamlit app displaying a grouped horizontal bar chart and styled detail table for 15 top US stocks.

**Architecture:** Static data hardcoded as a list of dicts is converted to a DataFrame, melted for Altair, and rendered as a grouped horizontal bar chart (FY2026 vs FY2027) plus a styled Pandas table — all inside a new third tab. No API calls, no caching needed.

**Tech Stack:** Streamlit, Altair (transitive Streamlit dep), Pandas

---

### Task 1: Add `import altair` and `REVENUE_DATA` constant

**Files:**
- Modify: `stock-monitor/app.py:7-10` (imports block) and `app.py:56-68` (after COMPANY dict)

- [ ] **Step 1: Add `import altair as alt` to the imports block**

In `app.py`, the imports block currently reads:

```python
import time
from datetime import datetime

import pandas as pd
import streamlit as st
import yfinance as yf
```

Change it to:

```python
import time
from datetime import datetime

import altair as alt
import pandas as pd
import streamlit as st
import yfinance as yf
```

- [ ] **Step 2: Add `REVENUE_DATA` constant after the `COMPANY` dict (after line 68)**

After the closing `}` of the `COMPANY` dict, add:

```python
REVENUE_DATA = [
    {"ticker": "NVDA",  "name": "NVIDIA Corp",          "fy2026": 215.9, "fy2027": 367.7, "yoy": 70, "notes": "FY ends Jan; FY26 already reported. Blackwell/Rubin demand visibility through 2027."},
    {"ticker": "MSFT",  "name": "Microsoft Corp",        "fy2026": 330.0, "fy2027": 385.0, "yoy": 17, "notes": "FY ends Jun. Management guided double-digit growth for FY2027."},
    {"ticker": "AAPL",  "name": "Apple Inc",             "fy2026": 465.0, "fy2027": 497.5, "yoy":  7, "notes": "FY ends Sep. iPhone 17 cycle reaccelerated growth."},
    {"ticker": "GOOGL", "name": "Alphabet Inc",          "fy2026": 465.0, "fy2027": 540.0, "yoy": 16, "notes": "Cloud margin guided to 27.9% in 2027."},
    {"ticker": "AMZN",  "name": "Amazon.com Inc",        "fy2026": 807.0, "fy2027": 901.0, "yoy": 12, "notes": "AWS growth accelerating; Q1 2026 +17% YoY."},
    {"ticker": "META",  "name": "Meta Platforms",        "fy2026": 250.0, "fy2027": 290.0, "yoy": 16, "notes": "Capex ramp $125–145B for 2026."},
    {"ticker": "BRK.B", "name": "Berkshire Hathaway",   "fy2026": 392.5, "fy2027": 417.5, "yoy":  5, "notes": "Insurance + railway + energy mix; tracks GDP growth."},
    {"ticker": "TSLA",  "name": "Tesla Inc",             "fy2026": 105.0, "fy2027": 130.0, "yoy": 20, "notes": "Wide estimate range; Robotaxi monetization key for 2027."},
    {"ticker": "AVGO",  "name": "Broadcom Inc",          "fy2026":  80.0, "fy2027": 115.0, "yoy": 40, "notes": "FY ends Oct/Nov. CEO: AI chip revenue target $100B+ in 2027."},
    {"ticker": "LLY",   "name": "Eli Lilly & Co",        "fy2026":  85.3, "fy2027":  94.9, "yoy": 11, "notes": "GLP-1 / oral obesity pill ramp drives 2027."},
    {"ticker": "JPM",   "name": "JPMorgan Chase",        "fy2026": 194.0, "fy2027": 202.5, "yoy":  4, "notes": "Fees + NII; growth depends on rate path."},
    {"ticker": "WMT",   "name": "Walmart Inc",           "fy2026": 725.0, "fy2027": 756.0, "yoy":  4, "notes": "FY ends Jan. Company guides 3.5–4.5% sales growth."},
    {"ticker": "V",     "name": "Visa Inc",              "fy2026":  42.0, "fy2027":  46.0, "yoy": 10, "notes": "Network volume + cross-border recovery."},
    {"ticker": "XOM",   "name": "ExxonMobil Corp",       "fy2026": 352.5, "fy2027": 365.0, "yoy":  3, "notes": "Highly oil-price sensitive; 2026 guidance cautious."},
    {"ticker": "UNH",   "name": "UnitedHealth Group",    "fy2026": 439.0, "fy2027": 470.0, "yoy":  7, "notes": "2027 reaccelerates after V28 Medicare coding transition."},
]
```

- [ ] **Step 3: Verify the file still loads without syntax errors**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app" 2>&1 | head -20
```

Expected: no output (clean import).

---

### Task 2: Add the new tab to `st.tabs()`

**Files:**
- Modify: `stock-monitor/app.py:292` (the `st.tabs(...)` call)

- [ ] **Step 1: Expand the tabs tuple**

Find this line (currently line 292):

```python
tab_market, tab_ipo = st.tabs(["📊 Market Overview", "🚀 IPO Watch List"])
```

Replace it with:

```python
tab_market, tab_ipo, tab_rev = st.tabs(["📊 Market Overview", "🚀 IPO Watch List", "📈 2026–2027 Revenue Projections"])
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app" 2>&1 | head -20
```

Expected: no output (clean import).

---

### Task 3: Build the `tab_rev` block

**Files:**
- Modify: `stock-monitor/app.py` — append new block after the closing `with tab_ipo:` block (currently ends around line 466)

- [ ] **Step 1: Add the full `with tab_rev:` block at the end of the tab section (before the auto-refresh block)**

Locate the line `with tab_ipo:` and its closing content. Immediately after the last line of that block (the `st.warning(...)` call), add:

```python
with tab_rev:
    st.markdown("### 2026–2027 Revenue Projections — Top 15 US Stocks")

    rev_df = pd.DataFrame([
        {
            "Ticker":       r["ticker"],
            "Company":      r["name"],
            "FY2026 ($B)":  r["fy2026"],
            "FY2027 ($B)":  r["fy2027"],
            "YoY Growth %": r["yoy"],
            "Notes":        r["notes"],
        }
        for r in REVENUE_DATA
    ])

    # ── Grouped horizontal bar chart ───────────────────────────────────────────
    ticker_order = rev_df.sort_values("FY2027 ($B)", ascending=False)["Ticker"].tolist()

    rev_long = rev_df.melt(
        id_vars=["Ticker", "Company"],
        value_vars=["FY2026 ($B)", "FY2027 ($B)"],
        var_name="Year",
        value_name="Revenue ($B)",
    )

    chart = (
        alt.Chart(rev_long)
        .mark_bar()
        .encode(
            x=alt.X("Revenue ($B):Q", title="Revenue (USD Billions)"),
            y=alt.Y("Ticker:N", sort=ticker_order, title=None),
            yOffset=alt.YOffset("Year:N", sort=["FY2026 ($B)", "FY2027 ($B)"]),
            color=alt.Color(
                "Year:N",
                scale=alt.Scale(
                    domain=["FY2026 ($B)", "FY2027 ($B)"],
                    range=["#4a6fa5", "#4af7ff"],
                ),
                legend=alt.Legend(orient="top", title=None),
            ),
            tooltip=[
                alt.Tooltip("Company:N"),
                alt.Tooltip("Year:N"),
                alt.Tooltip("Revenue ($B):Q", format=",.1f"),
            ],
        )
        .properties(height=520)
    )
    st.altair_chart(chart, use_container_width=True)

    st.markdown("")

    # ── Detail table ───────────────────────────────────────────────────────────
    def yoy_style(v):
        if v >= 30:  return "color: #4af7ff; font-weight: 700"
        if v >= 15:  return "color: #00e676; font-weight: 600"
        if v >= 10:  return "color: #fb923c"
        return "color: #6b7280"

    styled_rev = (
        rev_df.style
        .map(yoy_style, subset=["YoY Growth %"])
        .format({
            "FY2026 ($B)":  "${:,.1f}B",
            "FY2027 ($B)":  "${:,.1f}B",
            "YoY Growth %": "{:+d}%",
        })
        .hide(axis="index")
        .set_table_styles([
            {"selector": "thead th", "props": [
                ("background-color", "#0f0f1e"),
                ("color", "#6b7280"),
                ("font-size", ".70rem"),
                ("letter-spacing", "1.5px"),
                ("text-transform", "uppercase"),
                ("padding", "10px 14px"),
                ("border-bottom", "1px solid rgba(255,255,255,0.07)"),
            ]},
            {"selector": "tbody td", "props": [
                ("padding", "10px 14px"),
                ("border-bottom", "1px solid rgba(255,255,255,0.035)"),
                ("font-size", ".88rem"),
            ]},
            {"selector": "table", "props": [
                ("width", "100%"),
                ("border-collapse", "collapse"),
            ]},
        ])
    )

    st.dataframe(styled_rev, use_container_width=True, height=len(REVENUE_DATA) * 52 + 46)

    st.caption(
        "Estimates blend analyst consensus with company guidance as of early May 2026. "
        "Fiscal years vary by company."
    )
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app" 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 3: Run the app and visually verify the new tab**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
streamlit run app.py
```

Open the browser. Check:
- Three tabs visible: "📊 Market Overview", "🚀 IPO Watch List", "📈 2026–2027 Revenue Projections"
- Clicking the third tab shows the bar chart with 15 tickers sorted by FY2027 revenue descending
- FY2026 bars are muted blue; FY2027 bars are cyan
- Hovering a bar shows Company, Year, Revenue tooltip
- Detail table below shows all 15 rows with formatted revenue columns and colored YoY growth %
- Disclaimer caption appears below the table
- Other two tabs still work normally (no regressions)

- [ ] **Step 4: Commit**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
git add app.py docs/superpowers/specs/2026-05-05-revenue-projections-tab-design.md docs/superpowers/plans/2026-05-05-revenue-projections-tab.md
git commit -m "feat: add 2026–2027 revenue projections tab with grouped bar chart and detail table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
