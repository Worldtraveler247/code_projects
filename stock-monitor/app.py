"""
Stock Monitor — Streamlit dashboard
Watchlist : VOO · SPY · QQQ · MSFT · LLY · NVDA · AAPL · BTC-USD
Buy alert : price >5 % below 20-day SMA  OR  RSI(14) < 30

Features added:
  - Watchlist persistence: sidebar editor writes to watchlist.json (survives reload)
  - Alert history log: timestamped entries stored in session_state, shown in expander
  - VIX regime badge: calm <15 / elevated 15-25 / fear >25
  - Webhook: POST to Slack/ntfy when a buy signal fires
    Secret name: ALERT_WEBHOOK_URL
    Set in Streamlit Cloud: App Settings → Secrets → ALERT_WEBHOOK_URL = "https://..."
    Set locally: export ALERT_WEBHOOK_URL="https://..." or add to .streamlit/secrets.toml
"""

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

import altair as alt
import pandas as pd
import requests
import streamlit as st
import yfinance as yf
from streamlit.errors import StreamlitSecretNotFoundError

# ── Logging ─────────────────────────────────────────────────────────────────────
# basicConfig is a no-op if logging has already been configured (e.g. by Streamlit),
# so we set the level explicitly on the root logger instead.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Stock Monitor",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Hub back-link injected via st.markdown so it survives Streamlit's DOM ──────
# The link is fixed-positioned so it never obscures the sidebar or content.
# SECURITY NOTE: no user input is interpolated here — this is a static string.
st.markdown(
    """
    <a href="https://worldtraveler247.github.io/code_projects/stock-monitor/"
       style="position:fixed;top:12px;right:12px;z-index:9999;
              background:rgba(10,10,20,0.85);backdrop-filter:blur(6px);
              color:#4af7ff;border:1px solid #4af7ff;border-radius:20px;
              padding:6px 14px;font-family:sans-serif;font-size:13px;
              text-decoration:none;font-weight:600;">
      ← App Hub
    </a>
    """,
    unsafe_allow_html=True,
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
DEFAULT_TICKERS: tuple[str, ...] = (
    "^VIX", "VOO", "SPY", "QQQ", "MSFT", "LLY", "NVDA", "AAPL", "BTC-USD"
)
TICKERS_HEALTHCARE = ("UNH", "LLY", "JNJ", "ABBV")
TICKERS_ENERGY     = ("XOM", "CVX", "COP", "EOG")

COMPANY: dict[str, str] = {
    "^VIX":    "CBOE Volatility Index",
    "VOO":     "Vanguard S&P 500 ETF",
    "SPY":     "SPDR S&P 500 ETF",
    "QQQ":     "Invesco Nasdaq-100 ETF",
    "MSFT":    "Microsoft Corp",
    "LLY":     "Eli Lilly & Co",
    "NVDA":    "NVIDIA Corp",
    "AAPL":    "Apple Inc",
    "BTC-USD": "Bitcoin / USD",
    "UNH":     "UnitedHealth Group",
    "JNJ":     "Johnson & Johnson",
    "ABBV":    "AbbVie Inc",
    "CVX":     "Chevron Corp",
    "COP":     "ConocoPhillips",
    "EOG":     "EOG Resources",
}

REVENUE_DATA = [
    {"ticker": "NVDA",  "name": "NVIDIA Corp",          "fy2026": 215.9, "fy2027": 367.7, "yoy": 70.0, "notes": "FY ends Jan; FY26 already reported. Blackwell/Rubin demand visibility through 2027."},
    {"ticker": "MSFT",  "name": "Microsoft Corp",        "fy2026": 330.0, "fy2027": 385.0, "yoy": 17.0, "notes": "FY ends Jun. Management guided double-digit growth for FY2027."},
    {"ticker": "AAPL",  "name": "Apple Inc",             "fy2026": 465.0, "fy2027": 497.5, "yoy":  7.0, "notes": "FY ends Sep. iPhone 17 cycle reaccelerated growth."},
    {"ticker": "GOOGL", "name": "Alphabet Inc",          "fy2026": 465.0, "fy2027": 540.0, "yoy": 16.0, "notes": "Cloud margin guided to 27.9% in 2027."},
    {"ticker": "AMZN",  "name": "Amazon.com Inc",        "fy2026": 807.0, "fy2027": 901.0, "yoy": 12.0, "notes": "AWS growth accelerating; Q1 2026 +17% YoY."},
    {"ticker": "META",  "name": "Meta Platforms",        "fy2026": 250.0, "fy2027": 290.0, "yoy": 16.0, "notes": "Capex ramp $125–145B for 2026."},
    {"ticker": "BRK.B", "name": "Berkshire Hathaway",   "fy2026": 392.5, "fy2027": 417.5, "yoy":  5.0, "notes": "Insurance + railway + energy mix; tracks GDP growth."},
    {"ticker": "TSLA",  "name": "Tesla Inc",             "fy2026": 105.0, "fy2027": 130.0, "yoy": 20.0, "notes": "Wide estimate range; Robotaxi monetization key for 2027."},
    {"ticker": "AVGO",  "name": "Broadcom Inc",          "fy2026":  80.0, "fy2027": 115.0, "yoy": 44.0, "notes": "FY ends Oct/Nov. CEO: AI chip revenue target $100B+ in 2027."},
    {"ticker": "LLY",   "name": "Eli Lilly & Co",        "fy2026":  85.3, "fy2027":  94.9, "yoy": 11.0, "notes": "GLP-1 / oral obesity pill ramp drives 2027."},
    {"ticker": "JPM",   "name": "JPMorgan Chase",        "fy2026": 194.0, "fy2027": 202.5, "yoy":  4.0, "notes": "Fees + NII; growth depends on rate path."},
    {"ticker": "WMT",   "name": "Walmart Inc",           "fy2026": 725.0, "fy2027": 756.0, "yoy":  4.0, "notes": "FY ends Jan. Company guides 3.5–4.5% sales growth."},
    {"ticker": "V",     "name": "Visa Inc",              "fy2026":  42.0, "fy2027":  46.0, "yoy": 10.0, "notes": "Network volume + cross-border recovery."},
    {"ticker": "XOM",   "name": "ExxonMobil Corp",       "fy2026": 352.5, "fy2027": 365.0, "yoy":  3.0, "notes": "Highly oil-price sensitive; 2026 guidance cautious."},
    {"ticker": "UNH",   "name": "UnitedHealth Group",    "fy2026": 439.0, "fy2027": 470.0, "yoy":  7.0, "notes": "2027 reaccelerates after V28 Medicare coding transition."},
]

SMA_WIN = 20
RSI_WIN = 14

# Watchlist persistence: JSON sidecar file next to app.py.
# On Streamlit Cloud this resets on each cold-start cold container (ephemeral fs),
# so the custom watchlist is a local-dev feature; cloud users get DEFAULT_TICKERS.
WATCHLIST_FILE = Path(__file__).parent / "watchlist.json"


# ── Watchlist helpers ──────────────────────────────────────────────────────────
def load_watchlist() -> list[str]:
    """Read persisted watchlist from disk; fall back to defaults if missing or corrupt."""
    if WATCHLIST_FILE.exists():
        try:
            with WATCHLIST_FILE.open() as fh:
                data = json.load(fh)
            if isinstance(data, list) and all(isinstance(t, str) for t in data):
                return data
            logger.warning("watchlist.json had unexpected shape — using defaults")
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("could not load watchlist.json: %s — using defaults", exc)
    return list(DEFAULT_TICKERS)


def save_watchlist(tickers: list[str]) -> None:
    """Persist the current watchlist to disk."""
    try:
        with WATCHLIST_FILE.open("w") as fh:
            json.dump(tickers, fh)
    except OSError as exc:
        logger.error("could not save watchlist.json: %s", exc)


# ── Session state initialisation ──────────────────────────────────────────────
# Guard with `not in` so this only runs on the first script execution per session.
if "watchlist" not in st.session_state:
    st.session_state["watchlist"] = load_watchlist()

if "alert_history" not in st.session_state:
    st.session_state["alert_history"] = []  # list[dict] — see record_alerts()

if "failed_tickers" not in st.session_state:
    st.session_state["failed_tickers"] = []


# ── Webhook helper ─────────────────────────────────────────────────────────────
def fire_webhook(buy_rows: list[dict]) -> None:
    """POST buy-signal payload to the configured webhook URL.

    Secret name: ALERT_WEBHOOK_URL
    Streamlit Cloud: App Settings → Secrets → ALERT_WEBHOOK_URL = "https://..."
    Locally: export ALERT_WEBHOOK_URL="https://..."  OR  add to .streamlit/secrets.toml

    Compatible with Slack incoming webhooks and ntfy.sh topics:
      Slack: https://hooks.slack.com/services/T.../B.../xxx
      ntfy:  https://ntfy.sh/<your-topic>
    """
    # Resolve the webhook URL from env first, then Streamlit secrets.
    # IMPORTANT: when NO secrets.toml exists at all, st.secrets.get() does NOT
    # return None — accessing st.secrets triggers a parse that raises
    # StreamlitSecretNotFoundError. That is the common "webhook not configured"
    # state, so the lookup must be guarded or the app crashes on the very path
    # this function is meant to degrade through.
    url: str | None = os.environ.get("ALERT_WEBHOOK_URL")
    if not url:
        try:
            url = st.secrets.get("ALERT_WEBHOOK_URL")
        except StreamlitSecretNotFoundError:
            url = None
    if not url:
        logger.debug("ALERT_WEBHOOK_URL not configured — skipping webhook POST")
        return

    tickers_str = ", ".join(r["ticker"] for r in buy_rows)
    payload = {
        # Slack-compatible "text" field; ntfy ignores it
        "text": f"Stock Monitor — Buy Alert: {tickers_str}",
        "alerts": [
            {
                "ticker":  r["ticker"],
                "price":   r["price"],
                "trigger": r["trigger"],
                "time":    datetime.now().isoformat(),
            }
            for r in buy_rows
        ],
    }
    try:
        resp = requests.post(url, json=payload, timeout=5)
        resp.raise_for_status()
        logger.info("webhook POST succeeded (%d) for tickers: %s", resp.status_code, tickers_str)
    except requests.exceptions.Timeout:
        logger.error("webhook POST timed out after 5 s")
    except requests.exceptions.HTTPError as exc:
        logger.error("webhook POST HTTP error: %s", exc)
    except requests.exceptions.RequestException as exc:
        logger.error("webhook POST failed: %s", exc)


# ── Alert history recorder ─────────────────────────────────────────────────────
def record_alerts(buy_rows: list[dict]) -> None:
    """Append timestamped entries to the in-session alert history list."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for r in buy_rows:
        st.session_state["alert_history"].append({
            "time":    ts,
            "ticker":  r["ticker"],
            "price":   r["price"],
            "trigger": r["trigger"],
        })


# ── VIX regime helper ──────────────────────────────────────────────────────────
def vix_regime(vix_value: float) -> tuple[str, str]:
    """Return (label, hex_colour) for a VIX regime badge."""
    if vix_value < 15:
        return "CALM", "#00e676"
    if vix_value <= 25:
        return "ELEVATED", "#fbbf24"
    return "FEAR", "#ff5252"


# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## Settings")

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

    # Watchlist editor — changes are persisted to watchlist.json immediately.
    st.markdown("### Watchlist")
    raw_input = st.text_area(
        "One ticker per line",
        value="\n".join(st.session_state["watchlist"]),
        height=160,
        help="Edit your watchlist. Changes persist across page reloads (local dev only).",
        key="watchlist_input",
    )
    if st.button("Save watchlist", use_container_width=True):
        new_tickers = [t.strip().upper() for t in raw_input.splitlines() if t.strip()]
        if new_tickers:
            st.session_state["watchlist"] = new_tickers
            save_watchlist(new_tickers)
            st.cache_data.clear()
            st.success("Watchlist saved — refreshing data.")
            st.rerun()
        else:
            st.warning("Enter at least one ticker.")

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

    if st.button("Clear cache & refresh", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    st.caption("Data: Yahoo Finance via yfinance · Cache TTL: 5 min")

    # Live countdown placeholder (filled later if auto-refresh is on)
    countdown_slot = st.empty()

    # Surface stale-ticker warnings if any appeared during the last fetch
    if st.session_state["failed_tickers"]:
        st.warning(
            "Failed to fetch: " + ", ".join(st.session_state["failed_tickers"]),
            icon="⚠️",
        )


# ── Helpers ─────────────────────────────────────────────────────────────────────
def calc_rsi(close: pd.Series, period: int = 14) -> float:
    """Wilder's smoothed RSI — returns the most-recent value."""
    d  = close.diff()
    ag = d.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    al = (-d.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = ag / al
    return float((100 - 100 / (1 + rs)).iloc[-1])


@st.cache_data(ttl=300, show_spinner=False)
def load_market_data(tickers: tuple[str, ...]) -> tuple[list[dict], list[str]]:
    """Fetch OHLCV history for each ticker and compute SMA / RSI metrics.

    Returns:
        rows:   list of per-ticker dicts with price, SMA, RSI, etc.
        failed: list of tickers that could not be fetched or had insufficient data.

    Each ticker is caught individually so one bad ticker does not silence the rest.
    Errors are logged at WARNING/ERROR level and surfaced in the sidebar.
    """
    rows:   list[dict] = []
    failed: list[str]  = []

    for t in tickers:
        try:
            hist = yf.Ticker(t).history(period="3mo")

            if hist.empty:
                logger.warning("ticker %s: yfinance returned empty DataFrame", t)
                failed.append(t)
                continue

            if len(hist) < SMA_WIN + RSI_WIN + 2:
                logger.warning(
                    "ticker %s: only %d rows — need at least %d for SMA+RSI",
                    t, len(hist), SMA_WIN + RSI_WIN + 2,
                )
                failed.append(t)
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
                "_hist":   hist,  # kept for chart expander only
            })

        except Exception as exc:
            # Broad catch is intentional: yfinance can raise many undocumented
            # exceptions (network errors, malformed responses, etc.).
            logger.error("ticker %s: unexpected error during fetch: %s", t, exc)
            failed.append(t)

    return rows, failed


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
            "Signal":    "BUY" if r["buy"] else "—",
            "_buy":      r["buy"],
        }
        for r in rows
    ])

    buy_map = dict(zip(df.index, df["_buy"]))
    display = df.drop(columns=["_buy"])

    def row_bg(row: pd.Series) -> list[str]:
        if buy_map.get(row.name, False):
            return ["background-color: rgba(0,230,118,0.10); color: #d4ffe5"] * len(row)
        return [""] * len(row)

    def signal_style(v: str) -> str:
        return "color: #00e676; font-weight: 700; letter-spacing: 1px" if v == "BUY" else "color: #374151"

    def chg_style(v: float) -> str:
        if v > 0: return "color: #00e676"
        if v < 0: return "color: #ff5252"
        return ""

    def sma_style(v: float) -> str:
        if v < -sma_drop: return "color: #00e676; font-weight: 600"
        if v < 0:         return "color: #fb923c"
        return "color: #6b7280"

    def rsi_style(v: float) -> str:
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


# ── Module-level history loader ────────────────────────────────────────────────
@st.cache_data(ttl=300, show_spinner=False)
def load_history(t: str) -> pd.DataFrame:
    hist = yf.Ticker(t).history(period="1mo")[["Close"]]
    hist.index = hist.index.tz_localize(None)
    hist.columns = ["Price"]
    hist[f"SMA {SMA_WIN}"] = hist["Price"].rolling(SMA_WIN).mean()
    return hist.dropna()


# ── Reusable sector tab renderer ───────────────────────────────────────────────
def render_sector_tab(tickers: tuple[str, ...], key: str) -> None:
    with st.spinner("Fetching market data…"):
        raw, failed = load_market_data(tickers)

    if failed:
        st.warning(f"Could not fetch data for: {', '.join(failed)}", icon="⚠️")

    if not raw:
        st.error("No data returned. Check your internet connection and try again.")
        return

    raw = annotate_signals(raw, sma_drop, rsi_level)

    sorted_raw = sorted(raw, key=lambda x: x["ticker"] != "^VIX")
    cols = st.columns(len(sorted_raw))
    for col, r in zip(cols, sorted_raw):
        with col:
            st.metric(
                label=r["ticker"],
                value=f"${r['price']:,.2f}" if r["ticker"] != "^VIX" else f"{r['price']:.2f}",
                delta=f"{r['day_chg']:+.2f}%",
            )

    st.markdown("")

    buy_rows = [r for r in raw if r["buy"]]
    if buy_rows:
        # Record to history and fire webhook for any new signals.
        # Both operations are side-effect-free on failure (logged, not raised).
        record_alerts(buy_rows)
        fire_webhook(buy_rows)

        n     = len(buy_rows)
        lines = "".join(
            f"<b>{r['ticker']}</b> (${r['price']:,.2f}) &mdash; {r['trigger']}<br>"
            for r in buy_rows
        )
        st.markdown(
            f'<div class="alert-banner">'
            f'<h4>BUY ALERT — {n} ticker{"s" if n > 1 else ""} triggered</h4>'
            f"<p>{lines}</p>"
            f"</div>",
            unsafe_allow_html=True,
        )
    else:
        st.success("No buy alerts — all tickers are within thresholds.", icon="✅")

    st.markdown("### Overview")
    st.dataframe(
        make_styled_table(raw),
        use_container_width=True,
        height=len(raw) * 52 + 46,
    )

    st.markdown("")

    st.markdown("### Daily Summary")
    c_gain, c_loss, c_buy = st.columns(3)

    by_chg  = sorted(raw, key=lambda r: r["day_chg"], reverse=True)
    gainers = [r for r in by_chg if r["day_chg"] > 0]
    losers  = [r for r in by_chg if r["day_chg"] < 0]

    with c_gain:
        st.markdown("**Gainers today**")
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
        st.markdown("**Losers today**")
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
        st.markdown("**Buy signals**")
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

    st.markdown("")
    with st.expander("30-Day Price History + SMA", expanded=False):
        ticker_sel = st.selectbox(
            "Select ticker",
            options=[r["ticker"] for r in raw],
            key=f"chart_sel_{key}",
        )
        chart_data = load_history(ticker_sel)
        st.line_chart(chart_data, use_container_width=True, height=280)
        st.caption(
            f"Green line = {ticker_sel} close · Orange line = {SMA_WIN}-day SMA. "
            f"Buy alert triggers when price drops >{sma_drop:.0f}% below SMA."
        )


# ── Page header + VIX banner ───────────────────────────────────────────────────
st.markdown("# Stock Monitor")

# VIX: fetched directly (not from the cached watchlist loader) so it's always fresh.
try:
    vix_data = yf.Ticker("^VIX").history(period="2d")
    if vix_data.empty or len(vix_data) < 2:
        raise ValueError("VIX returned insufficient data")

    current_vix = float(vix_data["Close"].iloc[-1])
    prev_vix    = float(vix_data["Close"].iloc[-2])
    vix_delta   = (current_vix - prev_vix) / prev_vix * 100

    regime_label, regime_colour = vix_regime(current_vix)

    st.markdown(
        f"""
        <div style="background:rgba(255,75,75,0.2);border-left:5px solid #ff4b4b;
                    padding:20px;border-radius:10px;margin-bottom:25px;">
            <h1 style="margin:0;color:#d32f2f;font-size:3rem;">
                VIX: {current_vix:.2f}
                <span style="font-size:1.5rem;">({vix_delta:+.2f}%)</span>
                &nbsp;
                <span style="font-size:1rem;background:rgba(0,0,0,0.3);
                             color:{regime_colour};border:1px solid {regime_colour};
                             border-radius:6px;padding:4px 12px;
                             font-family:monospace;letter-spacing:1px;">
                    {regime_label}
                </span>
            </h1>
            <p style="font-size:1.1rem;margin-top:10px;line-height:1.6;
                      color:#1a1a1a;font-weight:500;">
                The <b>CBOE Volatility Index (VIX)</b>, known as the "Fear Gauge," measures
                the market's expectation of 30-day forward-looking volatility.
                A rising VIX typically signals increased market fear and potential downward
                pressure on stocks, while a falling VIX suggests stability and confidence.
                <br><br>
                <b>Regime:</b>
                <span style="color:#00e676;">Calm</span> (&lt;15) ·
                <span style="color:#fbbf24;">Elevated</span> (15–25) ·
                <span style="color:#ff5252;">Fear</span> (&gt;25)
            </p>
            <a href="https://www.investopedia.com/terms/v/vix.asp"
               target="_blank"
               style="color:#0056b3;text-decoration:underline;font-weight:bold;">
                Learn more about the VIX on Investopedia →
            </a>
        </div>
        """,
        unsafe_allow_html=True,
    )

except Exception as exc:
    logger.warning("VIX banner fetch failed: %s", exc)
    st.warning("VIX data unavailable — check connection.", icon="⚠️")

# ── Watchlist caption + data fetch ─────────────────────────────────────────────
active_tickers: tuple[str, ...] = tuple(st.session_state["watchlist"])

ticker_display = " · ".join(
    t if t != "BTC-USD" else "BTC" for t in active_tickers if t != "^VIX"
)
st.caption(
    f"Watchlist: **{ticker_display}**  "
    f"|  Buy alert: price **>{sma_drop:.0f}%** below SMA-{SMA_WIN}  "
    f"or  RSI(14) < **{rsi_level}**"
)

with st.spinner("Fetching market data…"):
    raw, failed = load_market_data(active_tickers)

# Store failed tickers in session_state so the sidebar warning updates.
st.session_state["failed_tickers"] = failed

if not raw:
    st.error("No data returned. Check your internet connection and try again.")
    st.stop()

st.caption(f"Last updated: {datetime.now().strftime('%B %d, %Y  %I:%M:%S %p')}")
st.markdown("---")

# ── Alert History expander ─────────────────────────────────────────────────────
if st.session_state["alert_history"]:
    with st.expander(
        f"Alert History — {len(st.session_state['alert_history'])} entries this session",
        expanded=False,
    ):
        history_df = pd.DataFrame(st.session_state["alert_history"])
        st.dataframe(
            history_df[["time", "ticker", "price", "trigger"]].rename(columns={
                "time":    "Time",
                "ticker":  "Ticker",
                "price":   "Price",
                "trigger": "Trigger",
            }),
            use_container_width=True,
            hide_index=True,
        )
        if st.button("Clear history", key="clear_history"):
            st.session_state["alert_history"] = []
            st.rerun()

# ── Main Tabs ──────────────────────────────────────────────────────────────────
tab_market, tab_ipo, tab_ai, tab_health, tab_energy, tab_rev = st.tabs([
    "Market Overview",
    "IPO Watch List",
    "AI Race",
    "Health Care",
    "Energy",
    "2026–2027 Revenue Projections",
])

with tab_market:
    render_sector_tab(active_tickers, key="market")

with tab_ai:
    st.markdown("# The AI Race — 2026")

    st.markdown("""
## What is Agentic AI?

**Agentic AI** refers to AI systems that don't just respond to questions — they *take action*.
Instead of a chatbot that answers "How do I send an email?", an agentic AI *writes* the email,
sends it, follows up, and updates your calendar — without you touching a keyboard at each step.

The agent plans multi-step tasks, executes them across different tools and apps, and adapts when
things go wrong. This shift from *conversation* to *action* is the defining milestone of 2026 AI.
""")

    st.markdown("""
---
## The 2026 AI Race: What Companies Are Building

The "AI Race" has evolved significantly. In 2023 and 2024, the race was about who could build the
smartest "chatbot." By 2026, the focus has shifted from mere conversation to **agency and infrastructure**.

The goal is no longer just to answer questions, but to **do work**. Here is a breakdown of what
companies are currently racing to achieve:

### 1. The Shift to "Agentic" AI

The biggest milestone in 2026 is the move from chatbots to **AI Agents**.

- **The Goal:** Instead of you asking an AI to "write an email," you tell the AI to "plan a 3-day
  marketing campaign, coordinate with the design team, and set up the launch meeting."
- **The Race:** Companies like Microsoft, Google, and OpenAI are racing to build systems that can
  execute multi-step tasks across different apps (e.g., browsing the web, editing a spreadsheet,
  and sending a Slack message) without human intervention at every step.

### 2. Physical and Multimodal Integration

The race is moving beyond the screen.

- **The Goal:** AI that can see, hear, and interact with the physical world in real time. This
  includes "Medical Imaging Copilots" that help doctors diagnose in real-time and "Robotic
  Navigation Platforms" for more autonomous factories.
- **The Race:** Major tech firms are competing to make multimodality (the ability to process text,
  image, video, and audio simultaneously) the standard for every device, from your phone to
  industrial robots.

### 3. Sovereign AI and "Patriotic Tech"

As AI becomes critical to national security and economic power, the race has a heavy geopolitical layer.

- **The Goal:** Countries (and the companies within them) are racing to build "Sovereign AI" — AI
  models trained on local data, hosted on local servers, and aligned with local laws and culture.
- **The Race:** There is a massive "compute" arms race. The U.S. and China are competing for
  dominance in high-end chips and data center capacity. In 2026 alone, U.S. cloud providers are
  projected to spend over **$600 billion** on AI infrastructure.

### 4. Reaching the "Jagged Frontier"

Researchers refer to the current state of AI as a **"Jagged Frontier."**

- **The Gap:** AI models can now pass PhD-level science exams and win gold medals at the
  International Mathematical Olympiad, yet they still struggle with simple physical logic, like
  reliably telling time on an analog clock.
- **The Race:** Companies are racing to bridge these gaps so AI can be trusted with high-stakes
  tasks, like autonomous scientific discovery in chemistry and biology.

### 5. From "Experiment" to "ROI"

The "hype" phase is ending. Investors are no longer impressed by a company just "using AI."

- **The Goal:** **Monetization.** Companies are racing to prove that AI actually increases profit
  margins or reduces costs.
- **The Race:** There is a push toward "Intelligent Ops," where AI is used to self-heal code
  repositories, automate complex supply chains, and handle customer service so efficiently that it
  moves from a cost center to a value driver.

---

### Summary of the "Leaderboard" (2026 Context)

- **The Infrastructure Kings:** NVIDIA and TSMC (providing the "shovels" for the gold mine).
- **The Software Titans:** Microsoft, Google, and Anthropic (racing for the most capable "Agents").
- **The New Entrants:** Companies like **CoreWeave** and specialized AI-cloud providers that are
  building the physical "superfactories" of intelligence.
""")

    st.divider()

    st.markdown("## The GPU Race: Why Chips Are the Foundation of AI")

    st.markdown("""
GPUs (Graphics Processing Units) were originally designed for rendering video games — but their
architecture turned out to be perfect for AI. Unlike CPUs (which have a few very fast cores), GPUs
have **thousands of smaller cores** that run calculations in parallel.

Training a neural network is essentially billions of matrix multiplications happening simultaneously —
exactly what GPUs do best. A single frontier model training run can require **tens of thousands of
GPUs running for months**. Inference (running the model to answer your questions) also requires
massive GPU clusters at scale.

In 2026, U.S. cloud providers alone are projected to spend over **$600 billion** on AI
infrastructure — the majority going to GPUs and the data centers that house them.
Whoever controls the chips controls the race.
""")

    gpu_data = [
        {
            "Company":        "NVIDIA",
            "Ticker":         "NVDA",
            "Role":           "GPU Designer",
            "Why It Matters": "Dominant H100/B200 AI GPUs; ~80% datacenter AI market share. CUDA ecosystem creates deep developer lock-in.",
        },
        {
            "Company":        "AMD",
            "Ticker":         "AMD",
            "Role":           "GPU Designer",
            "Why It Matters": "MI300X/MI325X challenger to NVIDIA. Only credible alternative at scale for AI training workloads.",
        },
        {
            "Company":        "Broadcom",
            "Ticker":         "AVGO",
            "Role":           "AI ASIC Designer",
            "Why It Matters": "Designs custom AI accelerator chips for Google, Meta, and ByteDance. CEO targets $100B+ AI revenue by 2027.",
        },
        {
            "Company":        "TSMC",
            "Ticker":         "TSM",
            "Role":           "Chip Manufacturer",
            "Why It Matters": "Manufactures GPUs for NVIDIA and AMD. Controls the world's most advanced chip fabrication. No TSMC = no frontier AI.",
        },
    ]

    st.table(pd.DataFrame(gpu_data))

with tab_ipo:
    st.markdown("### IPO Watch List")
    st.info("Information on high-profile private companies and how retail investors can gain exposure.")

    ipo_data = [
        {
            "Company": "OpenAI",
            "Status": "Private",
            "Pre-IPO Platforms": "Forge Global, EquityZen, Hiive, DXYZ",
            "Public Proxies": "Microsoft (MSFT)",
            "Details": "Leader in AGI. Heavily backed by Microsoft. No confirmed IPO date."
        },
        {
            "Company": "Anthropic",
            "Status": "Private",
            "Pre-IPO Platforms": "Hiive, Linqto",
            "Public Proxies": "Amazon (AMZN), Google (GOOGL)",
            "Details": "AI safety research. Backed by billions from Amazon and Google."
        },
        {
            "Company": "SpaceX",
            "Status": "Private",
            "Pre-IPO Platforms": "Forge Global, EquityZen, Hiive",
            "Public Proxies": "Google (GOOGL), Destiny Tech100 (DXYZ)",
            "Details": "Space exploration. Regularly trades on secondary markets."
        },
        {
            "Company": "Starlink",
            "Status": "Private (Part of SpaceX)",
            "Pre-IPO Platforms": "Indirect via SpaceX equity",
            "Public Proxies": "Google (GOOGL - indirect)",
            "Details": "Satellite internet. Hints of a future spinoff IPO once cashflow is predictable."
        }
    ]

    st.table(pd.DataFrame(ipo_data))

    st.markdown("#### How to Invest")
    col1, col2 = st.columns(2)

    with col1:
        st.markdown("**1. Pre-IPO (Secondary Markets)**")
        st.write("""
        Retail investors typically use platforms that aggregate shares from former employees or early investors:
        - **Secondary Platforms:** Forge Global, EquityZen, Hiive, and Linqto.
        - **Funds:** Some platforms offer "feeder funds" with lower minimums ($10k-$25k) compared to direct private equity.
        - **Closed-End Funds:** **Destiny Tech100 (DXYZ)** is a publicly traded fund that holds stakes in SpaceX and OpenAI.
        """)

    with col2:
        st.markdown("**2. Post-IPO (Public Markets)**")
        st.write("""
        Once a company goes public (Initial Public Offering):
        - **Brokerage:** You can buy shares directly through any standard brokerage (Fidelity, Robinhood, Schwab).
        - **IPO Access:** Some brokers (like Robinhood or SoFi) offer "IPO Access" to retail investors to buy at the IPO price before it hits the open market.
        """)

    st.warning("**Risk Warning:** Private equity is highly illiquid and high-risk. Valuations are speculative.")

with tab_health:
    st.markdown("## Health Care — Top 4 US Stocks")
    render_sector_tab(TICKERS_HEALTHCARE, key="health")

with tab_energy:
    st.markdown("## Energy — Top 4 US Stocks")
    render_sector_tab(TICKERS_ENERGY, key="energy")

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
    def yoy_style(v: float) -> str:
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
            "YoY Growth %": "{:+.0f}%",
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

# ── Auto-refresh countdown ─────────────────────────────────────────────────────
if auto_refresh:
    for remaining in range(interval_sec, 0, -1):
        mins, secs = divmod(remaining, 60)
        countdown_slot.caption(f"Refreshing in {mins:02d}:{secs:02d}")
        time.sleep(1)
    countdown_slot.empty()
    st.cache_data.clear()
    st.rerun()
