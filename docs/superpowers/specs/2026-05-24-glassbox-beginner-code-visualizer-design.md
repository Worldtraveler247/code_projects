# Glassbox — Beginner Code Visualizer (Design Spec)

**Date:** 2026-05-24
**Status:** Approved design — ready for implementation plan
**Author:** Eddie Camacho (with senior pair-programmer review)

> *Name "Glassbox" is a working title; the app makes the invisible machine visible.*

---

## 1. Problem & Insight

Beginners stall on the same root concept across languages: **what a variable actually is** — that names hold *references* to values, what gets copied, what gets shared, and who owns the data. Compiled research into Python/Go beginner pain confirmed the diagnosis: the cross-cutting unlock is **memory, identity, and ownership of data**, not syntax.

Two corrections drove this design:

1. **Audience is true zero-experience** (never written code). The compiled research describes *advanced-beginner* footguns (mutable default args, slice aliasing, closure capture) — those are an advanced track, not an entry point. A zero-experience learner cannot parse "argument" or "slice" yet.
2. **The bottleneck is the teaching *mechanism*, not the concept list.** The reason `b = a; b.append(4)` surprises people is that **program state is invisible**. Text explanations of invisible state don't stick. The mechanism that works is **visualizing state as it changes** — animated box-and-arrow memory diagrams stepped across execution.

**Design bet:** Make *one invisible thing* — names → references → heap — viscerally visible, brilliantly, rather than touring many concepts shallowly.

---

## 2. Scope

**v1 = a short concept arc of 4 guided lessons, Python only, read-only stepping.**

### Non-goals (YAGNI guardrails so it ships)
- ❌ No live interpreter / Pyodide / arbitrary user code execution
- ❌ No code editing (authored traces only)
- ❌ No Go (documented sequel, not v1)
- ❌ No accounts, no backend, no analytics
- ❌ No multi-language side-by-side (advanced-track feature)

---

## 3. Architecture

Deliberately minimal — the value is in authored content, not the engine.

- **Pure static site.** Vanilla JS + HTML + CSS. **No build step, no framework, no backend.** Ships as an App Hub card to GitHub Pages, matching the existing 18-card convention.
- **SVG for the memory diagram** (boxes + arrows need real geometry). Code panel and narration are plain HTML for screen-reader/copy-paste friendliness.
- **The engine is one pure function:** `render(trace, stepIndex) → DOM`. No interpreter; no runtime state beyond `{lessonId, stepIndex}`. Everything visible at step *N* is fully described by `trace.steps[N]`. This makes the app trivial to test and impossible to desync.

### Data flow
```
lesson JSON  ──load──►  state {lessonId, stepIndex}
                            │
        controls ──mutate──►│
        (next/prev/play)    ▼
                     render(trace, step)  ──►  code panel + SVG memory + narration
```

### Prior art note
Python Tutor (pythontutor.com) implements the live-tracer version of this. We deliberately **do not** rebuild its hardest part (a real execution tracer). Authoring traces by hand keeps the engine trivial and gives full pedagogical control over narration and highlighting.

---

## 4. Data Model (the heart)

Each lesson is one JSON file. The model mirrors how Python actually works: **names live in frames, values live in a heap, names hold references (heap IDs) to objects.** Sharing is not special-cased — it falls out when two names hold the same ID.

```json
{
  "id": "copy-vs-share",
  "title": "Two names, one list",
  "code": ["a = [1, 2, 3]", "b = a", "b.append(4)", "print(a)"],
  "steps": [
    {
      "line": 0,
      "narration": "We build a list and pin the name `a` to it.",
      "frames": [{ "name": "globals", "vars": { "a": "#1" } }],
      "heap":   { "#1": { "type": "list", "value": [1, 2, 3] } },
      "highlight": { "vars": ["a"], "objects": ["#1"] },
      "output": ""
    },
    {
      "line": 1,
      "narration": "`b = a` copies the ARROW, not the list. Both names point to the same box.",
      "frames": [{ "name": "globals", "vars": { "a": "#1", "b": "#1" } }],
      "heap":   { "#1": { "type": "list", "value": [1, 2, 3] } },
      "highlight": { "vars": ["b"], "objects": ["#1"] }
    }
  ]
}
```

### Field semantics
- **`code`** — array of source lines (1 entry per displayed line).
- **`steps[]`** — ordered execution steps; the only thing that drives the view.
  - **`line`** — zero-based index into `code`; the "current line."
  - **`narration`** — one plain-language sentence; **this is where the teaching lives.**
  - **`frames[]`** — call frames (v1 lessons use a single `globals` frame; structure supports a later function-call frame). Each frame's `vars` map names → heap IDs.
  - **`heap`** — map of heap ID → object `{ type, value }`.
  - **`highlight`** — `{ vars: [...], objects: [...] }` — what pulses/glows this step (the attention lever).
  - **`output`** — accumulated `print()` text shown so far.

### Why this shape
- `"a": "#1"` and `"b": "#1"` pointing at one ID *is* the shared-reference concept, rendered as two arrows into one box. No special case.
- **Immutable vs mutable falls out for free:** reassigning an int points the name at a *new* heap ID; mutating a list changes the *same* object's value. The learner sees the difference instead of being told it.

### Authoring guardrail
A **trace validator** (pure function, Node-testable) runs over every lesson file and asserts:
- every `vars` reference resolves to an existing `heap` ID,
- every `line` is within `code` range,
- `steps` is non-empty and each step has required fields.
A broken trace fails a test, never the learner's screen.

---

## 5. UI & Interaction

Single screen, three regions + a lesson rail. A zero-experience learner should never wonder where to look.

```
┌────────────────────────────────────────────────────────────┐
│  Glassbox    Lesson 3 of 4: Two names, one list             │
├──────────────────────────┬─────────────────────────────────┤
│  CODE                     │  MEMORY                         │
│    a = [1, 2, 3]          │   globals                       │
│  ▸ b = a          ◄ now   │   ┌───┐                         │
│    b.append(4)            │   │ a ├──┐                      │
│    print(a)               │   │ b ├──┼──► [ 1, 2, 3 ]       │
│                           │   └───┘     (one list, shared)  │
├──────────────────────────┴─────────────────────────────────┤
│  💬  b = a copies the ARROW, not the list. Both names       │
│      point to the same box.                                 │
├────────────────────────────────────────────────────────────┤
│   ◀ Prev   ▶ Play   Next ▶    Step 2 / 4    ↺ Reset         │
└────────────────────────────────────────────────────────────┘
```

### Interaction model
- **Stepping is the entire interaction:** Prev / Next / Play (autoplay ~1.5s/step) / Reset. Arrow keys mirror the buttons.
- **Current line and highlighted boxes move together** every step, linking *"this line ran"* ↔ *"this changed in memory."* This linkage is the teaching mechanism.
- **Arrows animate** when a reference is created or repointed — the visceral "the arrow moved, the box didn't" moment.
- **Lesson rail** moves between the 4 lessons. Progress persisted in `localStorage` (no backend); a returning learner resumes where they left off.

### Accessibility (decided up front, not deferred)
- Color alone must not carry "shared vs separate" — pair highlight color with **motion + a text label on the arrow** (colorblind safety).
- Narration is real DOM text, not baked into SVG (screen-reader + copy-paste friendly).
- Full keyboard navigation for stepping.

---

## 6. The 4-Lesson Arc

Each lesson reuses the same names→arrows→heap picture; difficulty climbs by exactly one new idea per lesson.

1. **A name points to a value** — `x = 5`, then `x = 6`. The arrow leaves the old value, points at a new one. Teaches: a variable is a *name pinned to a value*; assignment re-pins it. (Kills the "box you put things in" misconception immediately.)
2. **A list is one object with a name** — build `nums = [10, 20]`, index, append. Teaches: a list is a single heap object; the name points *at* it. Makes "the box" concrete.
3. **Two names, one list (the aha)** — `a = [1,2,3]; b = a; b.append(4); print(a)`. Teaches: `=` copies the arrow, not the list; mutation through one name is visible through the other.
4. **Numbers vs lists — why one "shares" and one doesn't** — side-by-side: reassigning an int repoints to a new box; mutating a list changes the shared box. Teaches immutable-vs-mutable *visually* — the true root the research identified — without naming it until the learner has seen it.

Lesson 4 is the bridge to the advanced concepts (the original research) and the natural sequel hook.

---

## 7. Testing

Aligned to the constraint that browser logic is verified in Node; DOM-interaction smoke tests are manual.

- **Trace validator** — pure function, full unit tests (`node --test`): dangling heap IDs, out-of-range `line`, empty/malformed steps.
- **Layout model** — the function mapping a step → box/arrow position data is pure; snapshot-test its *output data*, not pixels.
- **Manual smoke-test checklist** (for Eddie): step each lesson; confirm current-line ↔ highlight sync, arrow animation, keyboard nav, `localStorage` resume, mobile/responsive layout.

---

## 8. Open Items / Future (post-v1)
- Advanced track: closures, mutable default args, slice aliasing (from the original research).
- Go track with the same engine (pointers/values, slice backing arrays).
- Optional "predict the output" micro-quiz before revealing a step.
- Authored "change one value" variants to approximate light editing without an interpreter.
