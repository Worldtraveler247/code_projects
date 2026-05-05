# Design: Sector Tabs (Health Care & Energy) + AI Race Tab

**Date:** 2026-05-05
**App:** Stock Monitor (`app.py`)

## What we're adding

Five changes to `app.py`:

1. Extract Market Overview rendering into `render_sector_tab()` — a reusable function
2. Add missing tickers to the `COMPANY` dict (JNJ, ABBV, CVX, COP, EOG)
3. Add **Health Care** tab (UNH, LLY, JNJ, ABBV) — full Market Overview experience
4. Add **Energy** tab (XOM, CVX, COP, EOG) — full Market Overview experience
5. Add **AI Race** tab — Agentic AI explainer + GPU Race section (static content)

## Tab Order

```
📊 Market Overview | 🚀 IPO Watch List | 🤖 AI Race | 🏥 Health Care | ⚡ Energy | 📈 2026–2027 Revenue Projections
```

## Architecture

### `render_sector_tab(tickers, company, key)`

Extract everything currently inside `with tab_market:` into this function:

```python
def render_sector_tab(tickers: tuple, company: dict, key: str) -> None:
```

- `tickers` — tuple of ticker strings to display
- `company` — dict mapping ticker → display name
- `key` — unique string appended to all Streamlit widget keys (prevents ID collisions)

**What the function contains (in order):**
1. `load_market_data(tickers)` call + `annotate_signals(raw, sma_drop, rsi_level)` call
2. Price metric cards row (`st.columns` + `st.metric`)
3. Buy alert banner or "no alerts" success message
4. Overview table (`make_styled_table`)
5. Daily Summary section (gainers, losers, buy signals — 3 columns)
6. Price history chart expander (`st.selectbox` key = `f"chart_sel_{key}"`)

The existing `with tab_market:` block becomes:
```python
with tab_market:
    render_sector_tab(TICKERS_MARKET, COMPANY, key="market")
```

### New ticker constants

Add after existing `TICKERS` constant:

```python
TICKERS_MARKET = ("^VIX", "VOO", "SPY", "QQQ", "MSFT", "LLY", "NVDA", "AAPL", "BTC-USD")

TICKERS_HEALTHCARE = ("UNH", "LLY", "JNJ", "ABBV")

TICKERS_ENERGY = ("XOM", "CVX", "COP", "EOG")
```

Note: existing `TICKERS` constant remains for backward compatibility (used in the VIX header block above the tabs).

### `COMPANY` dict additions

```python
"JNJ":  "Johnson & Johnson",
"ABBV": "AbbVie Inc",
"CVX":  "Chevron Corp",
"COP":  "ConocoPhillips",
"EOG":  "EOG Resources",
```

## Health Care Tab

```python
with tab_health:
    st.markdown("## 🏥 Health Care — Top 4 US Stocks")
    render_sector_tab(TICKERS_HEALTHCARE, COMPANY, key="health")
```

No VIX banner (VIX block stays in the main page header, above all tabs).

## Energy Tab

```python
with tab_energy:
    st.markdown("## ⚡ Energy — Top 4 US Stocks")
    render_sector_tab(TICKERS_ENERGY, COMPANY, key="energy")
```

## AI Race Tab

Two sections rendered with `st.markdown`. No API calls, no widgets, pure content.

### Section 1 — What is Agentic AI

Intro paragraph + 5 numbered subsections (from user-provided text):
1. The Shift to "Agentic" AI
2. Physical and Multimodal Integration
3. Sovereign AI and "Patriotic Tech"
4. Reaching the "Jagged Frontier"
5. From "Experiment" to "ROI"
+ Leaderboard summary

### Section 2 — The GPU Race

**Why GPUs matter (prose):** GPUs excel at the massively parallel math that powers neural networks — thousands of cores running tensor operations simultaneously, with high-memory bandwidth to feed them. A single training run for a frontier model can require billions of GPU-hours. Without GPUs, modern AI at scale is impossible.

**Top chip players (styled `st.table`):**

| Company | Ticker | Role | Why It Matters |
|---------|--------|------|----------------|
| NVIDIA | NVDA | GPU designer | Dominant H100/B200 AI GPUs; ~80% datacenter AI market share |
| AMD | AMD | GPU designer | MI300X challenger; only credible alternative to NVIDIA at scale |
| Broadcom | AVGO | AI ASIC designer | Custom TPU-style chips for Google, Meta, ByteDance |
| TSMC | TSM | Chip manufacturer | Manufactures NVIDIA and AMD GPUs; no TSMC = no frontier AI |

## Data Flow

```
render_sector_tab(tickers, company, key)
  → load_market_data(tickers)      [cached 5 min]
  → annotate_signals(raw, ...)
  → price cards
  → alert banner
  → overview table
  → daily summary
  → price history chart (key=f"chart_sel_{key}")
```

## What changes in `app.py`

1. Add `TICKERS_MARKET`, `TICKERS_HEALTHCARE`, `TICKERS_ENERGY` constants (keep `TICKERS` as-is)
2. Add 5 entries to `COMPANY` dict
3. Extract `render_sector_tab()` function from Market Overview code
4. Update `st.tabs()` call — 6 tabs, new order
5. Replace `with tab_market:` body with `render_sector_tab(TICKERS_MARKET, COMPANY, key="market")`
6. Add `with tab_health:` block
7. Add `with tab_energy:` block
8. Add `with tab_ai:` block (static content)
