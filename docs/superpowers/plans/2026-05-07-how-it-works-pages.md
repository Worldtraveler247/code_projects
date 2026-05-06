# "How It's Built" Pages — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 📖 How It's Built third action button to every hub card and create a matching how-it-works.html breakdown page for all 13 apps plus the Digital Resume.

**Architecture:** Shared how-it-works.css at repo root imported by every page. Each app gets its own static how-it-works.html with 6 sections: Header, Overview, Tech Stack, How Each Part Works, File Map, Replicate It Yourself. _template/how-it-works.html scaffolds future apps.

**Tech Stack:** Vanilla HTML, CSS (no framework, no build step)

**Spec:** docs/superpowers/specs/2026-05-07-how-it-works-design.md

---

## Task Order

1. Shared CSS + style.css update
2. Update index.html (all 13 cards + hint line)
3. _template/how-it-works.html
4. code-typist/how-it-works.html
5. my-tetris/how-it-works.html
6. space-shooter/how-it-works.html
7. mario-style/how-it-works.html
8. my-dashboard/how-it-works.html
9. real-estate-risk/how-it-works.html
10. 3d-chess/how-it-works.html
11. origin-trace/how-it-works.html
12. cloud-security-languages/how-it-works.html
13. aws-series/how-it-works.html
14. stock-monitor/how-it-works.html
15. devsecops-job-hub/how-it-works.html
16. Digital Resume (separate repo: worldtraveler247/resume)
17. Push all + verify live URLs

---

## Page Structure (all 13 apps follow this template)

Each how-it-works.html has exactly 6 sections in this order:

1. Header — app emoji + name + one-line tagline + fixed App Hub back link
2. Overview — 2-3 sentences: what it does, who it's for, what problem it solves (no jargon)
3. Tech Stack — cyan badge chips + one-line caption per technology explaining its role
4. How Each Part Works — one hiw-file-block per key file: plain-English description + one annotated code snippet
5. File Map — directory tree in a pre block with one-line comments per file
6. Replicate It Yourself — numbered steps to build from scratch, links to official docs, ends with deploy step

---

## Shared CSS (how-it-works.css)

Create at /Users/eddiecamacho/mac-ansible/code_projects/how-it-works.css:

:root { --bg:#06060f; --cyan:#4af7ff; --text:#e2e8f0; --muted:#6b7a99; --surface:rgba(255,255,255,0.04); --border:rgba(255,255,255,0.08); }
*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--text); font-family:'Inter',sans-serif; font-size:16px; line-height:1.7; padding:80px 20px 60px; }
.hiw-page { max-width:820px; margin:0 auto; }
.hiw-header { text-align:center; margin-bottom:52px; }
.hiw-icon { font-size:3rem; margin-bottom:12px; }
.hiw-header h1 { font-family:'Orbitron',sans-serif; font-size:clamp(1.5rem,4vw,2.2rem); font-weight:800; background:linear-gradient(135deg,var(--cyan),#a78bfa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:10px; }
.hiw-tagline { color:var(--muted); font-size:.95rem; }
.hiw-section { margin-bottom:52px; padding-bottom:52px; border-bottom:1px solid var(--border); }
.hiw-section:last-child { border-bottom:none; }
.hiw-section h2 { font-family:'Orbitron',sans-serif; font-size:.85rem; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--cyan); margin-bottom:20px; }
.hiw-badges { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
.hiw-badge { background:rgba(74,247,255,0.08); border:1px solid var(--cyan); color:var(--cyan); border-radius:6px; padding:4px 12px; font-size:.8rem; font-weight:600; letter-spacing:.04em; }
.hiw-caption-list { list-style:none; display:flex; flex-direction:column; gap:6px; }
.hiw-caption-list li { color:var(--muted); font-size:.9rem; }
.hiw-caption-list li strong { color:var(--text); }
.hiw-file-block { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:20px; }
.hiw-file-block h3 { font-size:1rem; font-weight:600; margin-bottom:10px; color:var(--text); }
.hiw-file-block h3 code { font-family:'Fira Code',monospace; color:var(--cyan); font-size:.95rem; }
.hiw-file-block p { color:var(--muted); font-size:.9rem; margin-bottom:16px; }
.hiw-code { background:#0a0a18; border:1px solid rgba(74,247,255,0.15); border-radius:8px; padding:16px; overflow-x:auto; font-family:'Fira Code',monospace; font-size:.82rem; line-height:1.65; color:#c9d1e0; white-space:pre; }
.hiw-file-map { background:#0a0a18; border:1px solid var(--border); border-radius:8px; padding:20px; font-family:'Fira Code',monospace; font-size:.82rem; line-height:1.8; color:#c9d1e0; overflow-x:auto; white-space:pre; }
.hiw-steps { padding-left:0; list-style:none; counter-reset:steps; display:flex; flex-direction:column; gap:18px; }
.hiw-steps li { counter-increment:steps; display:flex; gap:16px; align-items:flex-start; }
.hiw-steps li::before { content:counter(steps); min-width:28px; height:28px; background:rgba(74,247,255,0.1); border:1px solid var(--cyan); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:.75rem; font-weight:700; color:var(--cyan); flex-shrink:0; margin-top:2px; }
.hiw-steps li a { color:var(--cyan); }
.hiw-steps li code { font-family:'Fira Code',monospace; background:rgba(74,247,255,0.08); border-radius:4px; padding:1px 6px; font-size:.85em; color:var(--cyan); }
@media (max-width:600px) { body { padding:70px 16px 40px; } .hiw-file-block { padding:16px; } }

---

## style.css addition

After the .action-btn:focus-visible block (~line 220), add:

.action-btn--build { color: var(--cyan); }

---

## index.html changes

Hint line: add  · 📖 how it's built  after the VS Code hint entry.

For each of the 13 cards, add inside .card-actions after the VS Code button:

<a href="HREF" class="action-btn action-btn--build" target="_blank" rel="noopener" aria-label="How this app is built" title="How It's Built">
  📖 <span>How It's Built</span>
</a>

HREFs per card:
- Digital Resume: https://worldtraveler247.github.io/resume/how-it-works.html
- Origin Trace: origin-trace/how-it-works.html
- DevSecOps Job Hub: devsecops-job-hub/how-it-works.html
- AWS in Practice: aws-series/how-it-works.html
- Code Typist: code-typist/how-it-works.html
- Cloud Security Languages: cloud-security-languages/how-it-works.html
- Galactic Guardian: space-shooter/how-it-works.html
- Galactic Runner: mario-style/how-it-works.html
- Dashboard: my-dashboard/how-it-works.html
- Tetris: my-tetris/how-it-works.html
- Stock Monitor: stock-monitor/how-it-works.html
- Real Estate Crash Indicator: real-estate-risk/how-it-works.html
- Async 3D Chess: 3d-chess/how-it-works.html

---

## Per-App Content Guide

For each app, READ the actual source files first, then write the how-it-works.html using the template structure. Use real code from the source as the annotated snippet — do not invent code.

### code-typist
Stack: HTML, CSS, JavaScript
Key files: index.html (keyboard grid + input), app.js (keydown handler comparing e.key to snippet[cursor]), snippets.js (array of code strings)
Core snippet: the keydown event listener in app.js
Replicate steps: 1) pre+input overlay structure, 2) snippets as plain array, 3) keydown compare loop, 4) keyboard grid as CSS grid with .active highlight, 5) GitHub Pages deploy

### my-tetris
Stack: HTML, CSS, JavaScript, Canvas API
Key files: index.html (two canvas elements), tetris.js (SHAPES object, draw loop, collision, row clear)
Core snippet: the SHAPES object or the collision check
Replicate steps: 1) canvas setup, 2) SHAPES as 2D arrays, 3) draw() with ctx.fillRect, 4) drop() with setInterval, 5) row clear logic, 6) GitHub Pages deploy

### space-shooter (Galactic Guardian)
Stack: HTML, CSS, JavaScript, Canvas API
Key files: index.html (canvas + mobile buttons), game.js (game loop, collision, particles)
Core snippet: requestAnimationFrame game loop or circle collision check
Replicate steps: 1) full-screen canvas, 2) entity objects {x,y,vx,vy,r}, 3) rAF game loop, 4) circle collision with Math.hypot, 5) particle array, 6) touch controls, 7) GitHub Pages deploy

### mario-style (Galactic Runner)
Stack: HTML, CSS, JavaScript, Canvas API
Key files: index.html (canvas), game.js (gravity+jump physics, parallax, platform collision)
Core snippet: gravity accumulation (vy += gravity each frame)
Replicate steps: 1) canvas setup, 2) player {x,y,vy,onGround}, 3) gravity per frame, 4) parallax: 3 layers at different scroll speeds, 5) draw back-to-front, 6) platform collision check, 7) GitHub Pages deploy

### my-dashboard
Stack: HTML, CSS, JavaScript, Open-Meteo API
Key files: index.html (clock + weather layout), script.js (fetchWeather async function, updateClock interval)
Core snippet: the fetch() call to api.open-meteo.com
Replicate steps: 1) geolocation or hardcoded coords, 2) Open-Meteo URL construction, 3) fetch().then().then() pattern, 4) setInterval clock, 5) GitHub Pages deploy

### real-estate-risk
Stack: HTML, CSS, JavaScript, FRED API, JSON
Key files: index.html (gauge + indicator grid), app.js (z-score math, gauge rotation), data.json (pre-fetched FRED data), indicators-content.js (descriptions)
Core snippet: z-score calculation (currentValue - mean) / stdDev
Replicate steps: 1) download FRED CSVs, 2) compute mean+stdDev, store in data.json, 3) z-score in JS, 4) average z-scores to composite, 5) rotate SVG needle, 6) GitHub Pages deploy

### 3d-chess
Stack: HTML, CSS, JavaScript, Three.js, Firebase Realtime Database, chess.js
Key files: index.html (canvas + CDN script tags), app.js (Three.js scene setup, Firebase onValue listener, move handler)
Core snippet: Three.js scene/camera/renderer initialization OR the Firebase onValue listener
Replicate steps: 1) Firebase project setup, 2) Three.js scene via CDN, 3) chess.js for move validation, 4) Firebase write on move, 5) onValue listener for real-time sync, 6) GitHub Pages + Firebase Spark plan

### origin-trace
Stack: HTML, CSS, JavaScript, JSON
Key files: index.html (role grid), role.html (?role= param), map.html (atlas), dag.html (SVG DAG), js/main.js (fetch+render), data/roles.json (all data)
Core snippet: the fetch('data/roles.json') + card render loop in main.js
Replicate steps: 1) design roles.json schema, 2) fetch+render loop, 3) data-track filter chips, 4) role.html with URLSearchParams, 5) SVG DAG with next_moves edges, 6) GitHub Pages deploy

### cloud-security-languages
Stack: HTML, CSS, JavaScript
Key files: index.html (hub with 3 language cards), go/index.html (content structure: concept+code pattern), shared CSS, shared JS
Core snippet: copy-to-clipboard pattern or the nav breadcrumb structure
Replicate steps: 1) hub index with sub-page links, 2) per-language content structure, 3) pre+code blocks with copy button, 4) shared CSS via relative path, 5) GitHub Pages deploy

### aws-series
Stack: HTML, CSS, JavaScript, AWS, Terraform
Key files: aws-series/index.html (10-service hub), ec2/index.html (service overview), iam/tutorial.html (3-tab Console/CLI/Terraform layout)
Core snippet: the tab switcher JS (click tab → hide other sections with display:none)
Replicate steps: 1) hub index with service cards, 2) per-service overview page, 3) tutorial.html with 3 section tabs, 4) write CLI commands in pre code blocks, 5) Terraform from registry.terraform.io docs, 6) GitHub Pages deploy

### stock-monitor
Stack: Python, Streamlit, yfinance, Pandas, Altair
Key files: app.py (entire app), requirements.txt
Core snippet: yf.Ticker().history() call + one st.metric() call
Replicate steps: 1) pip install streamlit yfinance pandas altair, 2) fetch with yf.Ticker, 3) SMA with rolling().mean(), 4) RSI formula, 5) buy signal boolean column, 6) st.metric + st.altair_chart, 7) deploy to streamlit.io/cloud

### devsecops-job-hub
Stack: Python, FastAPI, SQLModel, SQLite, Podman
Key files: pyproject.toml, src/main.py (FastAPI routes), src/models.py (SQLModel classes), Containerfile
Core snippet: a SQLModel model class definition + one FastAPI GET route
Replicate steps: 1) pip install fastapi sqlmodel uvicorn, 2) SQLModel class definition, 3) create_all on startup, 4) GET /jobs route with session query, 5) uvicorn run + /docs explorer, 6) Containerfile FROM+COPY+CMD, 7) podman build+run

### Digital Resume (separate repo: worldtraveler247/resume)
Stack: HTML, CSS
Key files: index.html (semantic resume structure)
Core snippet: the flex row for job title + dates (justify-content: space-between)
NOTE: CSS must be inline in a style block — cannot link ../how-it-works.css from a different repo
Replicate steps: 1) semantic HTML structure (header/section/article), 2) flex row for title+dates, 3) Google Fonts link, 4) print media query, 5) GitHub Pages deploy
Back link href: https://worldtraveler247.github.io/code_projects (absolute URL, different repo)

---

## Commit Strategy

One commit per app:
  feat(code-typist): add How It's Built page
  feat(my-tetris): add How It's Built page
  ... etc

Infrastructure commits:
  feat: add shared how-it-works CSS and action-btn--build style
  feat: add How It's Built action button to all 13 hub cards
  feat: add how-it-works.html template for future apps

Final:
  git push origin main  (main portfolio repo)
  git push origin main  (resume repo)

---

## Verification

After push, confirm these URLs return 200 with hiw-page content:
- https://worldtraveler247.github.io/code_projects/code-typist/how-it-works.html
- https://worldtraveler247.github.io/code_projects/origin-trace/how-it-works.html
- https://worldtraveler247.github.io/code_projects/3d-chess/how-it-works.html
- https://worldtraveler247.github.io/code_projects/stock-monitor/how-it-works.html
- https://worldtraveler247.github.io/resume/how-it-works.html
