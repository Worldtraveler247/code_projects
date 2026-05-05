# Sector Tabs + AI Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Health Care, Energy, and AI Race tabs to the Stock Monitor; refactor Market Overview rendering into a reusable `render_sector_tab()` function used by all three live-data tabs.

**Architecture:** Extract all Market Overview rendering into `render_sector_tab(tickers, company, key)`. Move `load_history` to module level. Health Care and Energy tabs each call `render_sector_tab()` with sector-specific tickers. AI Race tab is static markdown content — no API calls.

**Tech Stack:** Streamlit, yfinance, pandas

---

### Task 1: Add ticker constants and COMPANY dict additions

**Files:**
- Modify: `stock-monitor/app.py` — Constants block (lines 56–69)

- [ ] **Step 1: Add sector ticker tuples after `TICKERS` (line 57)**

After the existing `TICKERS = (...)` line, add:

```python
TICKERS_HEALTHCARE = ("UNH", "LLY", "JNJ", "ABBV")
TICKERS_ENERGY     = ("XOM", "CVX", "COP", "EOG")
```

- [ ] **Step 2: Add five new entries to the `COMPANY` dict**

The current `COMPANY` dict ends with `"BTC-USD": "Bitcoin / USD",`. Add these entries before the closing `}`:

```python
    "UNH":  "UnitedHealth Group",
    "JNJ":  "Johnson & Johnson",
    "ABBV": "AbbVie Inc",
    "CVX":  "Chevron Corp",
    "COP":  "ConocoPhillips",
    "EOG":  "EOG Resources",
```

Note: `LLY` and `XOM` are already in `COMPANY` — do not duplicate them.

- [ ] **Step 3: Verify syntax**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app; print(app.TICKERS_HEALTHCARE, app.TICKERS_ENERGY)" 2>&1 | grep -v UserWarning | grep -v streamlit
```

Expected output:
```
('UNH', 'LLY', 'JNJ', 'ABBV') ('XOM', 'CVX', 'COP', 'EOG')
```

---

### Task 2: Move `load_history` to module level and define `render_sector_tab()`

**Files:**
- Modify: `stock-monitor/app.py`
  - Add `load_history` + `render_sector_tab` after `make_styled_table` (around line 244)
  - Remove module-level `raw = annotate_signals(...)` line (currently line 305)
  - Replace body of `with tab_market:` (lines 313–426) with single function call
  - Remove the nested `load_history` definition from inside the expander (lines 413–419)

- [ ] **Step 1: Insert `load_history` and `render_sector_tab` after `make_styled_table`**

Find the `# ── Fetch & annotate` comment (currently around line 245) and insert the following block immediately before it:

```python
# ── Module-level history loader ────────────────────────────────────────────────
@st.cache_data(ttl=300, show_spinner=False)
def load_history(t: str) -> pd.DataFrame:
    hist = yf.Ticker(t).history(period="1mo")[["Close"]]
    hist.index = hist.index.tz_localize(None)
    hist.columns = ["Price"]
    hist[f"SMA {SMA_WIN}"] = hist["Price"].rolling(SMA_WIN).mean()
    return hist.dropna()


# ── Reusable sector tab renderer ───────────────────────────────────────────────
def render_sector_tab(tickers: tuple, company: dict, key: str) -> None:
    with st.spinner("Fetching market data…"):
        raw = load_market_data(tickers)

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

    st.markdown("### Overview")
    st.dataframe(
        make_styled_table(raw),
        use_container_width=True,
        height=len(raw) * 52 + 46,
    )

    st.markdown("")

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

    st.markdown("")
    with st.expander("📉 30-Day Price History + SMA", expanded=False):
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
```

- [ ] **Step 2: Remove the module-level `raw = annotate_signals(...)` line**

Find and delete this exact line (currently around line 305):

```python
raw = annotate_signals(raw, sma_drop, rsi_level)
```

Leave the lines before and after it intact:
- Keep: `if not raw:` block + `st.stop()`
- Keep: `st.caption(f"Last updated: ...")` and `st.markdown("---")`

- [ ] **Step 3: Replace the body of `with tab_market:` with a single function call**

The entire `with tab_market:` block currently spans from the `sorted_raw = sorted(...)` line down to and including the `st.caption(f"Green line = ...")` line inside the expander. Replace the entire body (everything indented under `with tab_market:`) with:

```python
with tab_market:
    render_sector_tab(TICKERS, COMPANY, key="market")
```

The nested `load_history` definition that was inside the expander is now removed (it lives at module level — Step 1 above).

- [ ] **Step 4: Verify syntax and function accessibility**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app; print('render_sector_tab:', callable(app.render_sector_tab))" 2>&1 | grep render_sector_tab
```

Expected:
```
render_sector_tab: True
```

---

### Task 3: Update `st.tabs()` and add Health Care, Energy, AI Race tab blocks

**Files:**
- Modify: `stock-monitor/app.py` — the `st.tabs()` line and the tab blocks that follow

- [ ] **Step 1: Replace the `st.tabs()` line**

Find:
```python
tab_market, tab_ipo, tab_rev = st.tabs(["📊 Market Overview", "🚀 IPO Watch List", "📈 2026–2027 Revenue Projections"])
```

Replace with:
```python
tab_market, tab_ipo, tab_ai, tab_health, tab_energy, tab_rev = st.tabs([
    "📊 Market Overview",
    "🚀 IPO Watch List",
    "🤖 AI Race",
    "🏥 Health Care",
    "⚡ Energy",
    "📈 2026–2027 Revenue Projections",
])
```

- [ ] **Step 2: Add `with tab_health:` and `with tab_energy:` blocks after `with tab_ipo:`**

After the closing line of `with tab_ipo:` (the `st.warning(...)` line) and before `with tab_rev:`, insert:

```python
with tab_health:
    st.markdown("## 🏥 Health Care — Top 4 US Stocks")
    render_sector_tab(TICKERS_HEALTHCARE, COMPANY, key="health")

with tab_energy:
    st.markdown("## ⚡ Energy — Top 4 US Stocks")
    render_sector_tab(TICKERS_ENERGY, COMPANY, key="energy")
```

- [ ] **Step 3: Add `with tab_ai:` block after `with tab_market:` and before `with tab_ipo:`**

Insert the following block between `with tab_market:` and `with tab_ipo:`:

```python
with tab_ai:
    st.markdown("# 🤖 The AI Race — 2026")

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

    st.markdown("## ⚙️ The GPU Race: Why Chips Are the Foundation of AI")

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
```

- [ ] **Step 4: Verify no syntax errors**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
python -c "import app" 2>&1 | grep -i "error\|traceback\|syntaxerror" | head -10
```

Expected: no output (no errors).

- [ ] **Step 5: Commit**

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/stock-monitor
git add app.py \
    docs/superpowers/specs/2026-05-05-sector-tabs-ai-race-design.md \
    docs/superpowers/plans/2026-05-05-sector-tabs-ai-race.md
git commit -m "$(cat <<'EOF'
feat: add Health Care, Energy, AI Race tabs; extract render_sector_tab()

- Extract Market Overview rendering into reusable render_sector_tab(tickers, company, key)
- Move load_history to module level
- Add Health Care tab (UNH, LLY, JNJ, ABBV) with full live-data experience
- Add Energy tab (XOM, CVX, COP, EOG) with full live-data experience
- Add AI Race tab: Agentic AI explainer + GPU Race section with chip player table
- Update tab order: Market Overview > IPO Watch List > AI Race > Health Care > Energy > Revenue Projections

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ TICKERS_HEALTHCARE + TICKERS_ENERGY constants — Task 1
- ✅ COMPANY additions (UNH, JNJ, ABBV, CVX, COP, EOG) — Task 1
- ✅ load_history moved to module level — Task 2
- ✅ render_sector_tab() defined + Market Overview refactored — Task 2
- ✅ Tab order: Market Overview, IPO Watch List, AI Race, Health Care, Energy, Revenue Projections — Task 3
- ✅ Health Care tab with render_sector_tab(TICKERS_HEALTHCARE, ...) — Task 3
- ✅ Energy tab with render_sector_tab(TICKERS_ENERGY, ...) — Task 3
- ✅ AI Race tab: Agentic AI intro + 5 sections + Leaderboard — Task 3
- ✅ GPU Race: prose explanation + 4-company table (NVDA, AMD, AVGO, TSM) — Task 3

**Type consistency:**
- render_sector_tab(tickers: tuple, company: dict, key: str) defined in Task 2
- Called as render_sector_tab(TICKERS, COMPANY, key="market") — matches
- Called as render_sector_tab(TICKERS_HEALTHCARE, COMPANY, key="health") — matches
- Called as render_sector_tab(TICKERS_ENERGY, COMPANY, key="energy") — matches
- key strings are unique: "market", "health", "energy" — no widget ID collisions
