"""
Stock Monitor — Streamlit dashboard
Watchlist : VOO · SPY · QQQ · MSFT · LLY · NVDA · AAPL · BTC-USD
Buy alert : price >5 % below 20-day SMA  OR  RSI(14) < 30
"""

import time
from datetime import datetime

import pandas as pd
import streamlit as st
import yfinance as yf

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Stock Monitor",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Global CSS ─────────────────────────────────────────────────────────────────
st.markdown("""
<style>
    .block-container { padding-top: 1.2rem; max-width: 1400px; }

    /* Metric price cards */
    [data-testid="metric-container"] {
        background  : rgba(255,255,255,0.03);
        border      : 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding     : .75rem 1rem;
        transition  : border-color .2s;
    }
    [data-testid="metric-container"]:hover {
        border-color: rgba(74,247,255,0.35);
    }

    /* Buy alert banner */
    .alert-banner {
        background  : linear-gradient(90deg, rgba(0,230,118,0.11), rgba(0,230,118,0.04));
        border-left : 3px solid #00e676;
        border-radius: 8px;
        padding     : 12px 18px;
        margin      : 4px 0 16px;
    }
    .alert-banner h4 { color:#00e676; margin:0 0 6px; font-size:.85rem; letter-spacing:.5px; }
    .alert-banner p  { color:#b2ffd6; margin:0; font-size:.83rem; line-height:1.7; }

    /* Section dividers */
    hr { border-color: rgba(255,255,255,0.06) !important; }
</style>
""", unsafe_allow_html=True)

# ── Constants ──────────────────────────────────────────────────────────────────
TICKERS = ("VOO", "SPY", "QQQ", "MSFT", "LLY", "NVDA", "AAPL", "BTC-USD")

COMPANY = {
    "VOO":     "Vanguard S&P 500 ETF",
    "SPY":     "SPDR S&P 500 ETF",
    "QQQ":     "Invesco Nasdaq-100 ETF",
    "MSFT":    "Microsoft Corp",
    "LLY":     "Eli Lilly & Co",
    "NVDA":    "NVIDIA Corp",
    "AAPL":    "Apple Inc",
    "BTC-USD": "Bitcoin / USD",
}

SMA_WIN = 20
RSI_WIN = 14

# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## ⚙️ Settings")

    sma_drop = st.slider(
        "SMA drop threshold (%)",
        min_value=1.0, max_value=15.0, value=5.0, step=0.5,
        help=f"Trigger alert when price falls more than this % below the {SMA_WIN}-day SMA.",
    )
    rsi_level = st.slider(
        "RSI oversold level",
        min_value=10, max_value=45, value=30, step=1,
        help="Trigger alert when RSI(14) drops below this value.",
    )

    st.divider()

    auto_refresh = st.toggle("Auto-refresh", value=False)
    interval_sec = st.select_slider(
        "Refresh interval",
        options=[60, 120, 300, 600],
        value=300,
        format_func=lambda s: f"{s // 60} min{'s' if s > 60 else ''}",
        disabled=not auto_refresh,
    )

    st.divider()

    if st.button("🗑️ Clear cache & refresh", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    st.caption("Data: Yahoo Finance via yfinance · Cache TTL: 5 min")

    # Live countdown placeholder (filled later if auto-refresh is on)
    countdown_slot = st.empty()

# ── Helpers ────────────────────────────────────────────────────────────────────
def calc_rsi(close: pd.Series, period: int = 14) -> float:
    """Wilder's smoothed RSI — returns the most-recent value."""
    d  = close.diff()
    ag = d.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    al = (-d.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = ag / al
    return float((100 - 100 / (1 + rs)).iloc[-1])


@st.cache_data(ttl=300, show_spinner=False)
def load_market_data(tickers: tuple) -> list[dict]:
    """Fetch OHLCV history for each ticker and compute SMA / RSI metrics."""
    rows = []
    for t in tickers:
        try:
            hist = yf.Ticker(t).history(period="3mo")
            if hist.empty or len(hist) < SMA_WIN + RSI_WIN + 2:
                continue
            c     = hist["Close"]
            price = float(c.iloc[-1])
            prev  = float(c.iloc[-2])
            sma   = float(c.rolling(SMA_WIN).mean().iloc[-1])
            rsi   = calc_rsi(c, RSI_WIN)

            rows.append({
                "ticker":  t,
                "name":    COMPANY.get(t, t),
                "price":   price,
                "day_chg": (price - prev) / prev * 100,
                "sma20":   sma,
                "vs_sma":  (price - sma) / sma * 100,
                "rsi":     rsi,
                "_hist":   hist,           # kept for chart expander only
            })
        except Exception:
            pass
    return rows


def annotate_signals(rows: list[dict], sma_drop_pct: float, rsi_threshold: int) -> list[dict]:
    """Attach buy-alert flags to each row using the current slider values."""
    for r in rows:
        r["sma_alert"] = r["vs_sma"] < -sma_drop_pct
        r["rsi_alert"] = r["rsi"]    < rsi_threshold
        r["buy"]       = r["sma_alert"] or r["rsi_alert"]

        parts = []
        if r["sma_alert"]:
            parts.append(f">{sma_drop_pct:.0f}% below SMA-{SMA_WIN} ({r['vs_sma']:+.1f}%)")
        if r["rsi_alert"]:
            parts.append(f"RSI {r['rsi']:.1f} < {rsi_threshold}")
        r["trigger"] = " · ".join(parts)
    return rows

# ── Styled-table builder ───────────────────────────────────────────────────────
def make_styled_table(rows: list[dict]) -> "pd.io.formats.style.Styler":
    df = pd.DataFrame([
        {
            "Ticker":    r["ticker"],
            "Company":   r["name"],
            "Price":     r["price"],
            "Day Chg %": r["day_chg"],
            "SMA 20":    r["sma20"],
            "% vs SMA":  r["vs_sma"],
            "RSI (14)":  r["rsi"],
            "Signal":    "🟢  BUY" if r["buy"] else "—",
            "_buy":      r["buy"],
        }
        for r in rows
    ])

    buy_map = dict(zip(df.index, df["_buy"]))
    display = df.drop(columns=["_buy"])

    def row_bg(row):
        if buy_map.get(row.name, False):
            return ["background-color: rgba(0,230,118,0.10); color: #d4ffe5"] * len(row)
        return [""] * len(row)

    def signal_style(v):
        return "color: #00e676; font-weight: 700; letter-spacing: 1px" if "BUY" in str(v) else "color: #374151"

    def chg_style(v):
        if v > 0: return "color: #00e676"
        if v < 0: return "color: #ff5252"
        return ""

    def sma_style(v):
        if v < -sma_drop: return "color: #00e676; font-weight: 600"
        if v < 0:         return "color: #fb923c"
        return "color: #6b7280"

    def rsi_style(v):
        if v < rsi_level: return "color: #00e676; font-weight: 600"
        if v > 70:        return "color: #ff5252"
        return ""

    return (
        display.style
        .apply(row_bg, axis=1)
        .map(signal_style, subset=["Signal"])
        .map(chg_style,    subset=["Day Chg %"])
        .map(sma_style,    subset=["% vs SMA"])
        .map(rsi_style,    subset=["RSI (14)"])
        .format({
            "Price":     "${:,.2f}",
            "Day Chg %": "{:+.2f}%",
            "SMA 20":    "${:,.2f}",
            "% vs SMA":  "{:+.2f}%",
            "RSI (14)":  "{:.1f}",
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

# ── Fetch & annotate ───────────────────────────────────────────────────────────
st.markdown("# 📈 Stock Monitor")
ticker_display = ' · '.join(t if t != "BTC-USD" else "₿ BTC" for t in TICKERS)
st.caption(
    f"Watchlist: **{ticker_display}**  "
    f"|  Buy alert: price **>{sma_drop:.0f}%** below SMA-{SMA_WIN}  "
    f"or  RSI(14) < **{rsi_level}**"
)

with st.spinner("Fetching market data…"):
    raw = load_market_data(TICKERS)

if not raw:
    st.error("No data returned. Check your internet connection and try again.")
    st.stop()

raw = annotate_signals(raw, sma_drop, rsi_level)

st.caption(f"Last updated: {datetime.now().strftime('%B %d, %Y  %I:%M:%S %p')}")
st.markdown("---")

# ── Price metric cards ─────────────────────────────────────────────────────────
cols = st.columns(len(raw))
for col, r in zip(cols, raw):
    with col:
        st.metric(
            label=r["ticker"],
            value=f"${r['price']:,.2f}",
            delta=f"{r['day_chg']:+.2f}%",
        )

st.markdown("")

# ── Buy alert banner ───────────────────────────────────────────────────────────
buy_rows = [r for r in raw if r["buy"]]

if buy_rows:
    n     = len(buy_rows)
    lines = "".join(
        f"<b>{r['ticker']}</b> (${r['price']:,.2f}) &mdash; {r['trigger']}<br>"
        for r in buy_rows
    )
    st.markdown(
        f'<div class="alert-banner">'
        f'<h4>🟢 BUY ALERT — {n} ticker{"s" if n > 1 else ""} triggered</h4>'
        f"<p>{lines}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )
else:
    st.success("No buy alerts — all tickers are within thresholds.", icon="✅")

# ── Main overview table ────────────────────────────────────────────────────────
st.markdown("### 📊 Market Overview")
st.dataframe(
    make_styled_table(raw),
    use_container_width=True,
    height=len(raw) * 52 + 46,
)

st.markdown("")

# ── Daily summary cards ────────────────────────────────────────────────────────
st.markdown("### 📋 Daily Summary")
c_gain, c_loss, c_buy = st.columns(3)

by_chg  = sorted(raw, key=lambda r: r["day_chg"], reverse=True)
gainers = [r for r in by_chg if r["day_chg"] > 0]
losers  = [r for r in by_chg if r["day_chg"] < 0]

with c_gain:
    st.markdown("**🟢 Gainers today**")
    if gainers:
        for r in gainers:
            st.markdown(
                f"**{r['ticker']}** &nbsp; "
                f"<span style='color:#00e676'>+{r['day_chg']:.2f}%</span> &nbsp; "
                f"${r['price']:,.2f}",
                unsafe_allow_html=True,
            )
    else:
        st.caption("None today")

with c_loss:
    st.markdown("**🔴 Losers today**")
    if losers:
        for r in reversed(losers):
            st.markdown(
                f"**{r['ticker']}** &nbsp; "
                f"<span style='color:#ff5252'>{r['day_chg']:.2f}%</span> &nbsp; "
                f"${r['price']:,.2f}",
                unsafe_allow_html=True,
            )
    else:
        st.caption("None today")

with c_buy:
    st.markdown("**🟢 Buy signals**")
    if buy_rows:
        for r in buy_rows:
            st.markdown(
                f"**{r['ticker']}** &nbsp; "
                f"RSI <span style='color:#00e676'>{r['rsi']:.1f}</span> &nbsp;·&nbsp; "
                f"SMA <span style='color:#00e676'>{r['vs_sma']:+.1f}%</span>",
                unsafe_allow_html=True,
            )
    else:
        st.caption("No alerts triggered")

# ── Price history chart ────────────────────────────────────────────────────────
st.markdown("")
with st.expander("📉 30-Day Price History + SMA", expanded=False):
    ticker_sel = st.selectbox(
        "Select ticker",
        options=[r["ticker"] for r in raw],
        key="chart_sel",
    )

    @st.cache_data(ttl=300, show_spinner=False)
    def load_history(t: str) -> pd.DataFrame:
        hist = yf.Ticker(t).history(period="1mo")[["Close"]]
        hist.index = hist.index.tz_localize(None)
        hist.columns = ["Price"]
        hist[f"SMA {SMA_WIN}"] = hist["Price"].rolling(SMA_WIN).mean()
        return hist.dropna()

    chart_data = load_history(ticker_sel)
    st.line_chart(chart_data, use_container_width=True, height=280)
    st.caption(
        f"Green line = {ticker_sel} close · Orange line = {SMA_WIN}-day SMA. "
        f"Buy alert triggers when price drops >{sma_drop:.0f}% below SMA."
    )

# ── Auto-refresh countdown ─────────────────────────────────────────────────────
if auto_refresh:
    for remaining in range(interval_sec, 0, -1):
        mins, secs = divmod(remaining, 60)
        countdown_slot.caption(f"↻ Refreshing in {mins:02d}:{secs:02d}")
        time.sleep(1)
    countdown_slot.empty()
    st.cache_data.clear()
    st.rerun()
