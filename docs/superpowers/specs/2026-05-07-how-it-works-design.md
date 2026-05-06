# Design: "How It's Built" — Portfolio-Wide Code Breakdown Pages

**Date:** 2026-05-07
**Status:** Approved

---

## Goal

Add a `📖 How It's Built` link to every project card on Eddie's portfolio hub. Each link opens a dedicated `how-it-works.html` page that explains the app's tech stack, how each file works, and how to replicate the app from scratch — in plain English with annotated code snippets.

**Audience:** Eddie (personal learning reference) and portfolio visitors (employers, other learners). The page must be useful cold — readable without context, detailed enough to rebuild the app without AI assistance.

---

## Hub Card Change

Every `<article class="card">` in `index.html` gets a 3rd link in its `.card-actions` div:

```html
<a href="<app-dir>/how-it-works.html" class="action-btn" target="_blank" rel="noopener"
   aria-label="How this app is built" title="How It's Built">
  📖 <span>How It's Built</span>
</a>
```

- Positioned after the existing Source and VS Code buttons
- Same `.action-btn` class but rendered in cyan (`color: var(--cyan)`, `border-color: var(--cyan)`) to visually distinguish it
- For apps in separate repos (Digital Resume), the hub card links to `https://worldtraveler247.github.io/resume/how-it-works.html`. That file must be added to the `worldtraveler247/resume` repo separately as part of this feature.

The section hint line at the top of the grid is updated to include the 📖 symbol in the legend.

---

## `how-it-works.html` Page Structure

Each app gets its own `how-it-works.html` at the root of its directory (e.g. `code-typist/how-it-works.html`). Pages are static HTML — no build step, no framework.

### Sections (top to bottom)

**1. Header**
- App icon + name + one-line tagline
- `← App Hub` back link (same fixed-position cyan pill used everywhere)
- Thin divider

**2. Overview**
- 2–3 sentences: what the app does, who it's for, and what problem it solves
- No jargon — written so a non-technical employer or a beginner can understand it

**3. Tech Stack**
- Cyan badge chips for every technology used (e.g. `HTML` `CSS` `JavaScript` `Firebase`)
- Below the badge row, a one-line caption per technology explaining its role (e.g. "Firebase — stores game state so two players can play asynchronously"). Plain text, no JS tooltip needed.

**4. How Each Part Works**
- One block per key file or feature
- Each block has:
  - **File name** (bold, monospace)
  - **Plain-English description** — what the file does and why it exists
  - **One annotated code snippet** — the shortest piece of code that shows the core logic, with inline comments explaining each line
- Snippets use a `<pre><code>` block styled with the portfolio's dark theme

**5. File Map**
- Directory tree rendered as a `<pre>` block
- One-line comment next to each file explaining its purpose
- Example:
  ```
  code-typist/
  ├── index.html      ← page structure, keyboard grid, input box
  ├── style.css       ← dark theme, neon highlights, layout
  ├── app.js          ← game engine: keypress listener, scoring, cursor
  └── snippets.js     ← Go/Python/Bash code strings the game cycles through
  ```

**6. Replicate It Yourself**
- Numbered steps to build the app from scratch, no AI
- Written at the level of: "here's what to create, here's what to put in it, here's why"
- Links to official docs for each technology used (MDN for HTML/CSS/JS, official framework docs for Python libs, Firebase docs, etc.)
- Ends with a deploy step (GitHub Pages for static apps, Streamlit Cloud for Python apps)

---

## Tech Stacks Per App

| App | Directory | Tech Stack |
|---|---|---|
| Digital Resume | separate repo (`worldtraveler247/resume`) | HTML, CSS |
| Origin Trace | `origin-trace/` | HTML, CSS, JavaScript, JSON |
| DevSecOps Job Hub | `devsecops-job-hub/` | Python, FastAPI, SQLModel, SQLite, Podman |
| AWS in Practice | `aws-series/` | HTML, CSS, JavaScript |
| Code Typist | `code-typist/` | HTML, CSS, JavaScript |
| Cloud Security Languages | `cloud-security-languages/` | HTML, CSS, JavaScript |
| Galactic Guardian | `space-shooter/` | HTML, CSS, JavaScript, Canvas API |
| Galactic Runner | `mario-style/` | HTML, CSS, JavaScript, Canvas API |
| Dashboard | `my-dashboard/` | HTML, CSS, JavaScript, Open-Meteo API |
| Tetris | `my-tetris/` | HTML, CSS, JavaScript, Canvas API |
| Stock Monitor | `stock-monitor/` | Python, Streamlit, yfinance |
| Real Estate Crash Indicator | `real-estate-risk/` | HTML, CSS, JavaScript, FRED API |
| Async 3D Chess | `3d-chess/` | HTML, CSS, JavaScript, Firebase Realtime Database |

---

## Shared Styles

All `how-it-works.html` pages share a consistent visual style:
- Same dark background and color tokens as the rest of the portfolio (`--bg`, `--cyan: #4af7ff`, `--text`, etc.)
- Each page imports a shared `how-it-works.css` stored at the repo root (linked as `../how-it-works.css` or `../../how-it-works.css` for nested apps)
- Code blocks use a dark code theme consistent with the portfolio aesthetic
- Mobile-responsive: single column on small screens

---

## Template for Future Apps

A `_template/how-it-works.html` is saved at the repo root. It contains all six sections with placeholder content clearly marked (`<!-- TODO: fill in app name -->`, etc.). Every new app Eddie builds starts by copying this template into its directory and filling in the placeholders.

---

## Out of Scope

- No syntax highlighting library (e.g. Prism.js) — keep it zero-dependency; manual `<span>` coloring for the few snippets shown is sufficient
- No interactive code editor or runnable sandbox
- No dark/light mode toggle
- No search or filtering across breakdown pages

---

## Success Criteria

1. Every hub card has a visible `📖 How It's Built` action button
2. Every linked `how-it-works.html` page loads and is readable
3. Each page covers all 6 sections
4. A reader with no prior knowledge of the app can follow "Replicate It Yourself" to build their own version
5. The `_template/how-it-works.html` file exists and is complete enough to use immediately for a new app
