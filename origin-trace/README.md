# Origin Trace — Content Authoring Guide

Browse-and-explore catalog of entry-level IT career trees for people transitioning into IT.

**Live URL:** `worldtraveler247.github.io/code_projects/origin-trace/`
**Stack:** Vanilla JS + JSON. No npm, no build step, no backend.

---

## Running Locally

```
open /Users/eddiecamacho/mac-ansible/code_projects/origin-trace/index.html
```

Or serve it over HTTP to avoid fetch() CORS issues with `data/roles.json`:

```bash
cd /Users/eddiecamacho/mac-ansible/code_projects/origin-trace
python3 -m http.server 8080
# then open http://localhost:8080
```

---

## File Structure

```
origin-trace/
├── index.html          6-card role selection grid
├── role.html           Per-role detail page (SVG tree + mobile accordion)
├── map.html            Career Atlas — 7-family IT landscape overview
├── style.css           All styles; mirrors App Hub design tokens
├── js/
│   ├── main.js         Landing page: fetches roles.json, renders cards, particles
│   ├── tree.js         role.html: SVG tree renderer + mobile accordion
│   ├── atlas.js        map.html: Career Atlas grid builder
│   └── tooltip.js      Singleton citation tooltip (desktop hover / mobile tap)
├── data/
│   └── roles.json      Single source of truth for all role data
├── tools/
│   └── validate-roles.mjs  Schema validator (Node, no deps)
└── README.md
```

---

## Editing Role Data (`data/roles.json`)

### Schema per role

```jsonc
{
  "id":       "help-desk",          // URL-safe identifier
  "slug":     "help-desk",          // matches ?role= query param
  "title":    "Help Desk / IT Support",
  "icon":     "🖥️",
  "accent":   "#4af7ff",            // unused visually yet; reserved
  "tagline":  "...",                // 1-sentence pitch shown on landing card
  "entry_note": "...",              // honest caveat shown on role detail page
  "tiers": [
    {
      "tier":   "entry",            // "entry" | "mid" | "senior"
      "label":  "ENTRY",
      "typical_titles": ["..."],
      "required_certs": [
        {
          "name":       "CompTIA A+",
          "source_label": "CompTIA",
          "source_url": "https://...",
          "cost_usd":   253,        // null if unknown
          "cost_note":  "...",
          "verify_before_publish": false
        }
      ],
      "education_bar": "...",
      "salary_range": {
        "low":    38000,
        "high":   55000,
        "currency": "USD",
        "geo":    "US national median",
        "source_label": "BLS OOH — ...",
        "source_url":   "https://...",
        "verify_before_publish": false
      },
      "typical_time_in_tier": "1–3 years",
      "branches_into": ["noc-technician"],   // slugs of other roles
      "branch_rationale": {
        "noc-technician": "One sentence justifying this edge."
      }
    }
  ],
  "node_positions": {
    "entry":  { "x": 300, "y": 120 },
    "mid":    { "x": 300, "y": 310 },
    "senior": { "x": 300, "y": 500 }
  }
}
```

### Citation policy (4C)

Accepted sources in order of preference:
1. BLS Occupational Outlook Handbook — `bls.gov/ooh`
2. Vendor certification pages — CompTIA, Cisco, AWS, Microsoft, ISACA, GIAC
3. Levels.fyi
4. Glassdoor / Robert Half / Dice

**Hard reject:** Reddit, blogs, recruiter LinkedIn posts, AI-generated content.

If you cannot verify a datum with a real URL from this list, set `"verify_before_publish": true`.

### verify_before_publish

Any field with `"verify_before_publish": true` blocks the launch gate (the validator exits with code 2). **Do not push to GitHub Pages until all flags are cleared.** The validator lists every open flag on each run.

### Adding a new role

1. Add an entry to `data/roles.json` following the schema above.
2. Run the validator: `node tools/validate-roles.mjs`
3. Add the role to the `RESEARCHED` map in `js/atlas.js` so the Career Atlas links to it.
4. The landing card and role detail page generate automatically from the JSON.

---

## Running the Validator

```bash
node tools/validate-roles.mjs
```

Exit codes:
- `0` — all checks passed, no verify_before_publish flags
- `1` — schema errors (fix before committing)
- `2` — schema valid but launch is blocked (verify_before_publish flags remain)

---

## SVG Tree Layout

Node positions are hand-authored in `node_positions` (x/y, top-left corner of the node rectangle). Node size is `220 × 78` px. The SVG viewBox is `660 × 620`.

To adjust layout for a role with many branches, change the x/y values in `node_positions`. The orthogonal elbow connectors re-draw automatically from the positions.

Tier band dividers are at Y=215 (entry/mid) and Y=415 (mid/senior). Keep entry nodes above 215, mid between 215–415, senior below 415.

---

## Mobile Behavior

At viewport widths below 600px, the SVG tree is hidden and an HTML accordion replaces it. The accordion is built from the same `roles.json` data by `tree.js`. No separate data authoring needed.

---

## Design Tokens

Inherited from the App Hub (`../style.css` tokens):

| Token      | Value     |
|------------|-----------|
| `--bg`     | `#07010f` |
| `--cyan`   | `#4af7ff` |
| `--purple` | `#7b2fff` |
| `--magenta`| `#ff4af7` |
| `--text`   | `#dde0f0` |
| `--muted`  | `#5a607a` |
| `--border` | `rgba(74,247,255,0.13)` |

---

## v2 Candidates (out of scope for v1)

- DoD 8570/8140 role mappings
- Cross-role comparison view
- Search / filter
- Bookmarks
- Resume guidance
- Employer data
- Degree program data
- Clearance content
- Unified DAG across all 6 roots
