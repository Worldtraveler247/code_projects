# Glassbox Beginner Code Visualizer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure-static Python memory visualizer for zero-experience learners: 4 authored lessons that step through tiny snippets and animate names → arrows → heap, climaxing in the reference-sharing aha.

**Architecture:** No build step, no framework, no backend. ES modules in the browser (`<script type="module">`) and in Node (`"type": "module"`). The engine is a pure transform `computeLayout(step) → layout model`, rendered to SVG/HTML by a thin DOM layer. Lessons are ES modules exporting trace objects (no `fetch`, so it runs from `file://` and imports natively in tests). State changes are a pure reducer. Deploys as an App Hub card to GitHub Pages.

**Tech Stack:** Vanilla JS (ES2022 modules), SVG, HTML, CSS. Tests via Node 25 built-in `node --test` + `node:assert/strict`. Zero npm dependencies.

**Working dir:** All paths are relative to the repo root `/Users/eddiecamacho/mac-ansible/code_projects`. Work happens on branch `feat/glassbox-visualizer` (already created).

---

## File Structure

```
glassbox/
  package.json            # { "type": "module" } + test script — no deps
  index.html              # app shell: code panel, SVG memory, narration, controls, lesson rail
  style.css               # app-local styles (diagram, highlight/animation, responsive)
  how-it-works.html       # App Hub convention (build explainer)
  src/
    validateTrace.js      # PURE: (trace) -> { ok, errors[] }
    formatValue.js        # PURE: (heapObject) -> display string
    layout.js             # PURE: (step) -> { frames[], objects[], arrows[] }
    state.js              # PURE reducer: stepReducer(step, action, total) + clampStep
    storage.js            # localStorage get/set lesson+step (thin, browser-only)
    render.js             # DOM: paint code panel, frames, SVG arrows, narration, output
    controls.js           # DOM: wire buttons + keyboard + autoplay to state -> render
    main.js               # bootstrap: load lessons, build rail, init controls
  lessons/
    index.js              # ordered array of lesson modules (the manifest)
    01-name-points-to-value.js
    02-list-is-one-object.js
    03-two-names-one-list.js
    04-numbers-vs-lists.js
  test/
    validateTrace.test.js
    formatValue.test.js
    layout.test.js
    state.test.js
    lessons.test.js        # runs the real validator over all 4 real lessons
```

**Responsibility boundaries:** `validateTrace`, `formatValue`, `layout`, `state` are pure and fully unit-tested. `render`, `controls`, `main`, `storage` touch the DOM/browser and are verified by the manual smoke checklist (Task 11). Lessons are data, validated by `lessons.test.js`.

---

### Task 1: Scaffold the project

**Files:**
- Create: `glassbox/package.json`
- Create: `glassbox/.gitignore`

- [ ] **Step 1: Create `glassbox/package.json`**

```json
{
  "name": "glassbox",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Beginner Python memory visualizer — names, arrows, and the heap.",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `glassbox/.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: Verify the test runner starts (no tests yet)**

Run: `cd glassbox && node --test`
Expected: exits 0 with "tests 0" (no test files found yet is fine).

- [ ] **Step 4: Commit**

```bash
git add glassbox/package.json glassbox/.gitignore
git commit -m "chore(glassbox): scaffold project with ESM + node --test"
```

---

### Task 2: `formatValue` — render a heap object as display text

**Files:**
- Create: `glassbox/src/formatValue.js`
- Test: `glassbox/test/formatValue.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// glassbox/test/formatValue.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue } from "../src/formatValue.js";

test("formats an int as its number", () => {
  assert.equal(formatValue({ type: "int", value: 5 }), "5");
});

test("formats a list with bracketed, comma-separated items", () => {
  assert.equal(formatValue({ type: "list", value: [1, 2, 3] }), "[1, 2, 3]");
});

test("formats an empty list", () => {
  assert.equal(formatValue({ type: "list", value: [] }), "[]");
});

test("formats a string with quotes", () => {
  assert.equal(formatValue({ type: "str", value: "hi" }), '"hi"');
});

test("falls back to String() for unknown types", () => {
  assert.equal(formatValue({ type: "bool", value: true }), "true");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glassbox && node --test test/formatValue.test.js`
Expected: FAIL — cannot find module `../src/formatValue.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// glassbox/src/formatValue.js

/**
 * Render a heap object as the short text shown inside its box.
 * @param {{type: string, value: unknown}} obj
 * @returns {string}
 */
export function formatValue(obj) {
  switch (obj.type) {
    case "int":
      return String(obj.value);
    case "str":
      return `"${obj.value}"`;
    case "list":
      return `[${obj.value.join(", ")}]`;
    default:
      return String(obj.value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glassbox && node --test test/formatValue.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add glassbox/src/formatValue.js glassbox/test/formatValue.test.js
git commit -m "feat(glassbox): add formatValue heap-object formatter"
```

---

### Task 3: `validateTrace` — author-time guardrail

**Files:**
- Create: `glassbox/src/validateTrace.js`
- Test: `glassbox/test/validateTrace.test.js`

A trace is valid when: it has string `id`/`title`, a non-empty `code` array of strings, and a non-empty `steps` array where every step has an in-range `line`, a non-empty `narration`, a non-empty `frames` array, a `heap` object, and every variable reference (and every `highlight` reference) resolves.

- [ ] **Step 1: Write the failing test**

```javascript
// glassbox/test/validateTrace.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTrace } from "../src/validateTrace.js";

function goodTrace() {
  return {
    id: "demo",
    title: "Demo",
    code: ["a = [1]", "b = a"],
    steps: [
      {
        line: 0,
        narration: "make a list",
        frames: [{ name: "globals", vars: { a: "#1" } }],
        heap: { "#1": { type: "list", value: [1] } },
        highlight: { vars: ["a"], objects: ["#1"] },
        output: "",
      },
      {
        line: 1,
        narration: "share it",
        frames: [{ name: "globals", vars: { a: "#1", b: "#1" } }],
        heap: { "#1": { type: "list", value: [1] } },
      },
    ],
  };
}

test("accepts a well-formed trace", () => {
  assert.deepEqual(validateTrace(goodTrace()), { ok: true, errors: [] });
});

test("rejects a missing title", () => {
  const t = goodTrace();
  delete t.title;
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("title")));
});

test("rejects an empty steps array", () => {
  const t = goodTrace();
  t.steps = [];
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("steps")));
});

test("rejects a line index out of range", () => {
  const t = goodTrace();
  t.steps[0].line = 9;
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("line")));
});

test("rejects a var pointing at a missing heap id", () => {
  const t = goodTrace();
  t.steps[0].frames[0].vars.a = "#999";
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("#999")));
});

test("rejects a highlight object id not in the heap", () => {
  const t = goodTrace();
  t.steps[0].highlight.objects = ["#404"];
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("#404")));
});

test("rejects an empty narration", () => {
  const t = goodTrace();
  t.steps[0].narration = "";
  const result = validateTrace(t);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("narration")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glassbox && node --test test/validateTrace.test.js`
Expected: FAIL — cannot find module `../src/validateTrace.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// glassbox/src/validateTrace.js

/**
 * Validate an authored lesson trace.
 * @param {object} trace
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTrace(trace) {
  const errors = [];

  if (typeof trace?.id !== "string" || trace.id === "") errors.push("id must be a non-empty string");
  if (typeof trace?.title !== "string" || trace.title === "") errors.push("title must be a non-empty string");

  const code = trace?.code;
  if (!Array.isArray(code) || code.length === 0) {
    errors.push("code must be a non-empty array");
  } else if (!code.every((line) => typeof line === "string")) {
    errors.push("code must contain only strings");
  }

  const steps = trace?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push("steps must be a non-empty array");
    return { ok: errors.length === 0, errors };
  }

  const codeLen = Array.isArray(code) ? code.length : 0;

  steps.forEach((step, i) => {
    const where = `step ${i}`;

    if (!Number.isInteger(step?.line) || step.line < 0 || step.line >= codeLen) {
      errors.push(`${where}: line ${step?.line} out of range 0..${codeLen - 1}`);
    }
    if (typeof step?.narration !== "string" || step.narration.trim() === "") {
      errors.push(`${where}: narration must be a non-empty string`);
    }
    if (typeof step?.heap !== "object" || step.heap === null) {
      errors.push(`${where}: heap must be an object`);
    }
    if (!Array.isArray(step?.frames) || step.frames.length === 0) {
      errors.push(`${where}: frames must be a non-empty array`);
    }

    const heap = step?.heap ?? {};

    (step?.frames ?? []).forEach((frame, f) => {
      if (typeof frame?.name !== "string" || frame.name === "") {
        errors.push(`${where} frame ${f}: name must be a non-empty string`);
      }
      const vars = frame?.vars ?? {};
      for (const [varName, id] of Object.entries(vars)) {
        if (!(id in heap)) {
          errors.push(`${where}: var "${varName}" points at missing heap id ${id}`);
        }
      }
    });

    const hl = step?.highlight;
    if (hl) {
      for (const id of hl.objects ?? []) {
        if (!(id in heap)) errors.push(`${where}: highlight object ${id} not in heap`);
      }
      const knownVars = new Set(
        (step?.frames ?? []).flatMap((fr) => Object.keys(fr?.vars ?? {})),
      );
      for (const v of hl.vars ?? []) {
        if (!knownVars.has(v)) errors.push(`${where}: highlight var "${v}" not defined in any frame`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glassbox && node --test test/validateTrace.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add glassbox/src/validateTrace.js glassbox/test/validateTrace.test.js
git commit -m "feat(glassbox): add trace validator with reference-resolution checks"
```

---

### Task 4: `computeLayout` — the pure engine

**Files:**
- Create: `glassbox/src/layout.js`
- Test: `glassbox/test/layout.test.js`

`computeLayout(step)` turns a step into a structural model (no pixels): which frame variables exist, which heap objects exist, and which arrows connect them — each flagged `highlighted` per the step's `highlight`.

- [ ] **Step 1: Write the failing test**

```javascript
// glassbox/test/layout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayout } from "../src/layout.js";

const sharedStep = {
  line: 1,
  narration: "share it",
  frames: [{ name: "globals", vars: { a: "#1", b: "#1" } }],
  heap: { "#1": { type: "list", value: [1, 2, 3] } },
  highlight: { vars: ["b"], objects: ["#1"] },
};

test("emits one object per heap entry with formatted text", () => {
  const layout = computeLayout(sharedStep);
  assert.equal(layout.objects.length, 1);
  assert.deepEqual(layout.objects[0], {
    id: "#1",
    type: "list",
    valueText: "[1, 2, 3]",
    highlighted: true,
  });
});

test("emits frame variables with highlight flags", () => {
  const layout = computeLayout(sharedStep);
  assert.equal(layout.frames.length, 1);
  const vars = layout.frames[0].vars;
  assert.deepEqual(vars, [
    { name: "a", id: "#1", highlighted: false },
    { name: "b", id: "#1", highlighted: true },
  ]);
});

test("emits one arrow per variable, both pointing at the shared object", () => {
  const layout = computeLayout(sharedStep);
  assert.deepEqual(layout.arrows, [
    { from: "globals.a", to: "#1", highlighted: false },
    { from: "globals.b", to: "#1", highlighted: true },
  ]);
});

test("an unhighlighted step marks nothing highlighted", () => {
  const step = { ...sharedStep, highlight: undefined };
  const layout = computeLayout(step);
  assert.ok(layout.objects.every((o) => o.highlighted === false));
  assert.ok(layout.arrows.every((a) => a.highlighted === false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glassbox && node --test test/layout.test.js`
Expected: FAIL — cannot find module `../src/layout.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// glassbox/src/layout.js
import { formatValue } from "./formatValue.js";

/**
 * Turn an execution step into a structural layout model (no pixel coordinates).
 * @param {object} step
 * @returns {{ frames: Array, objects: Array, arrows: Array }}
 */
export function computeLayout(step) {
  const highlightVars = new Set(step.highlight?.vars ?? []);
  const highlightObjs = new Set(step.highlight?.objects ?? []);

  const objects = Object.entries(step.heap).map(([id, obj]) => ({
    id,
    type: obj.type,
    valueText: formatValue(obj),
    highlighted: highlightObjs.has(id),
  }));

  const frames = step.frames.map((frame) => ({
    name: frame.name,
    vars: Object.entries(frame.vars).map(([name, id]) => ({
      name,
      id,
      highlighted: highlightVars.has(name),
    })),
  }));

  const arrows = step.frames.flatMap((frame) =>
    Object.entries(frame.vars).map(([name, id]) => ({
      from: `${frame.name}.${name}`,
      to: id,
      highlighted: highlightVars.has(name) || highlightObjs.has(id),
    })),
  );

  return { frames, objects, arrows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glassbox && node --test test/layout.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add glassbox/src/layout.js glassbox/test/layout.test.js
git commit -m "feat(glassbox): add pure computeLayout engine"
```

---

### Task 5: `stepReducer` + `clampStep` — pure state transitions

**Files:**
- Create: `glassbox/src/state.js`
- Test: `glassbox/test/state.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// glassbox/test/state.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepReducer, clampStep } from "../src/state.js";

test("clampStep keeps index within [0, total-1]", () => {
  assert.equal(clampStep(-3, 4), 0);
  assert.equal(clampStep(0, 4), 0);
  assert.equal(clampStep(2, 4), 2);
  assert.equal(clampStep(9, 4), 3);
});

test("next advances and stops at the last step", () => {
  assert.equal(stepReducer(0, { type: "next" }, 4), 1);
  assert.equal(stepReducer(3, { type: "next" }, 4), 3);
});

test("prev retreats and stops at zero", () => {
  assert.equal(stepReducer(2, { type: "prev" }, 4), 1);
  assert.equal(stepReducer(0, { type: "prev" }, 4), 0);
});

test("reset returns to zero", () => {
  assert.equal(stepReducer(3, { type: "reset" }, 4), 0);
});

test("goto clamps to range", () => {
  assert.equal(stepReducer(0, { type: "goto", index: 2 }, 4), 2);
  assert.equal(stepReducer(0, { type: "goto", index: 99 }, 4), 3);
});

test("unknown action is a no-op", () => {
  assert.equal(stepReducer(1, { type: "wat" }, 4), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glassbox && node --test test/state.test.js`
Expected: FAIL — cannot find module `../src/state.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// glassbox/src/state.js

/**
 * Clamp a step index into the valid range for a trace of `total` steps.
 * @param {number} index
 * @param {number} total
 * @returns {number}
 */
export function clampStep(index, total) {
  return Math.max(0, Math.min(index, total - 1));
}

/**
 * Pure reducer for stepping through a trace.
 * @param {number} step current step index
 * @param {{ type: string, index?: number }} action
 * @param {number} total total number of steps
 * @returns {number} next step index
 */
export function stepReducer(step, action, total) {
  switch (action.type) {
    case "next":
      return clampStep(step + 1, total);
    case "prev":
      return clampStep(step - 1, total);
    case "reset":
      return 0;
    case "goto":
      return clampStep(action.index, total);
    default:
      return step;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glassbox && node --test test/state.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add glassbox/src/state.js glassbox/test/state.test.js
git commit -m "feat(glassbox): add pure stepReducer and clampStep"
```

---

### Task 6: Author the 4 lessons + manifest

**Files:**
- Create: `glassbox/lessons/01-name-points-to-value.js`
- Create: `glassbox/lessons/02-list-is-one-object.js`
- Create: `glassbox/lessons/03-two-names-one-list.js`
- Create: `glassbox/lessons/04-numbers-vs-lists.js`
- Create: `glassbox/lessons/index.js`
- Test: `glassbox/test/lessons.test.js`

- [ ] **Step 1: Write the failing test (validates the real lessons)**

```javascript
// glassbox/test/lessons.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { lessons } from "../lessons/index.js";
import { validateTrace } from "../src/validateTrace.js";

test("there are exactly 4 lessons", () => {
  assert.equal(lessons.length, 4);
});

test("every lesson passes the trace validator", () => {
  for (const lesson of lessons) {
    const result = validateTrace(lesson);
    assert.deepEqual(result.errors, [], `${lesson.id}: ${result.errors.join("; ")}`);
  }
});

test("lesson ids are unique", () => {
  const ids = lessons.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glassbox && node --test test/lessons.test.js`
Expected: FAIL — cannot find module `../lessons/index.js`.

- [ ] **Step 3: Create lesson 1 — `01-name-points-to-value.js`**

```javascript
// glassbox/lessons/01-name-points-to-value.js
export default {
  id: "name-points-to-value",
  title: "A name points to a value",
  code: ["x = 5", "x = 6"],
  steps: [
    {
      line: 0,
      narration: "We create the value 5 and pin the name `x` to it. A variable is a name pointing at a value.",
      frames: [{ name: "globals", vars: { x: "#1" } }],
      heap: { "#1": { type: "int", value: 5 } },
      highlight: { vars: ["x"], objects: ["#1"] },
      output: "",
    },
    {
      line: 1,
      narration: "`x = 6` does NOT change the 5. It makes a new value 6 and re-points `x` at it. The old 5 is forgotten.",
      frames: [{ name: "globals", vars: { x: "#2" } }],
      heap: { "#2": { type: "int", value: 6 } },
      highlight: { vars: ["x"], objects: ["#2"] },
      output: "",
    },
  ],
};
```

- [ ] **Step 4: Create lesson 2 — `02-list-is-one-object.js`**

```javascript
// glassbox/lessons/02-list-is-one-object.js
export default {
  id: "list-is-one-object",
  title: "A list is one object with a name",
  code: ["nums = [10, 20]", "nums.append(30)", "first = nums[0]"],
  steps: [
    {
      line: 0,
      narration: "We build one list `[10, 20]` and pin the name `nums` to it. The list lives in the box; the name points at it.",
      frames: [{ name: "globals", vars: { nums: "#1" } }],
      heap: { "#1": { type: "list", value: [10, 20] } },
      highlight: { vars: ["nums"], objects: ["#1"] },
      output: "",
    },
    {
      line: 1,
      narration: "`nums.append(30)` changes the SAME list. The box grows to `[10, 20, 30]`; the name still points at it.",
      frames: [{ name: "globals", vars: { nums: "#1" } }],
      heap: { "#1": { type: "list", value: [10, 20, 30] } },
      highlight: { objects: ["#1"] },
      output: "",
    },
    {
      line: 2,
      narration: "`nums[0]` reads the first slot (the value 10) and pins a new name `first` to that value.",
      frames: [{ name: "globals", vars: { nums: "#1", first: "#2" } }],
      heap: { "#1": { type: "list", value: [10, 20, 30] }, "#2": { type: "int", value: 10 } },
      highlight: { vars: ["first"], objects: ["#2"] },
      output: "",
    },
  ],
};
```

- [ ] **Step 5: Create lesson 3 — `03-two-names-one-list.js`**

```javascript
// glassbox/lessons/03-two-names-one-list.js
export default {
  id: "two-names-one-list",
  title: "Two names, one list",
  code: ["a = [1, 2, 3]", "b = a", "b.append(4)", "print(a)"],
  steps: [
    {
      line: 0,
      narration: "We build a list and pin the name `a` to it.",
      frames: [{ name: "globals", vars: { a: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2, 3] } },
      highlight: { vars: ["a"], objects: ["#1"] },
      output: "",
    },
    {
      line: 1,
      narration: "`b = a` copies the ARROW, not the list. Both names now point at the same box.",
      frames: [{ name: "globals", vars: { a: "#1", b: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2, 3] } },
      highlight: { vars: ["b"], objects: ["#1"] },
      output: "",
    },
    {
      line: 2,
      narration: "`b.append(4)` changes the shared list. There is only one box, so `a` sees the change too.",
      frames: [{ name: "globals", vars: { a: "#1", b: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2, 3, 4] } },
      highlight: { objects: ["#1"] },
      output: "",
    },
    {
      line: 3,
      narration: "`print(a)` shows `[1, 2, 3, 4]` — even though we never touched `a` directly. That is sharing.",
      frames: [{ name: "globals", vars: { a: "#1", b: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2, 3, 4] } },
      highlight: { vars: ["a"], objects: ["#1"] },
      output: "[1, 2, 3, 4]",
    },
  ],
};
```

- [ ] **Step 6: Create lesson 4 — `04-numbers-vs-lists.js`**

```javascript
// glassbox/lessons/04-numbers-vs-lists.js
export default {
  id: "numbers-vs-lists",
  title: "Numbers vs lists — why one shares and one doesn't",
  code: [
    "p = 1",
    "q = p",
    "q = q + 1",
    "nums = [1]",
    "more = nums",
    "more.append(2)",
  ],
  steps: [
    {
      line: 0,
      narration: "Pin the name `p` to the number 1.",
      frames: [{ name: "globals", vars: { p: "#1" } }],
      heap: { "#1": { type: "int", value: 1 } },
      highlight: { vars: ["p"], objects: ["#1"] },
      output: "",
    },
    {
      line: 1,
      narration: "`q = p` points `q` at the same 1 — just like sharing a list.",
      frames: [{ name: "globals", vars: { p: "#1", q: "#1" } }],
      heap: { "#1": { type: "int", value: 1 } },
      highlight: { vars: ["q"], objects: ["#1"] },
      output: "",
    },
    {
      line: 2,
      narration: "`q = q + 1` makes a NEW number 2 and re-points `q`. `p` still points at 1 — numbers can't be changed in place.",
      frames: [{ name: "globals", vars: { p: "#1", q: "#2" } }],
      heap: { "#1": { type: "int", value: 1 }, "#2": { type: "int", value: 2 } },
      highlight: { vars: ["q"], objects: ["#2"] },
      output: "",
    },
    {
      line: 3,
      narration: "Now a list: pin `nums` to `[1]`.",
      frames: [{ name: "globals", vars: { p: "#1", q: "#2", nums: "#3" } }],
      heap: {
        "#1": { type: "int", value: 1 },
        "#2": { type: "int", value: 2 },
        "#3": { type: "list", value: [1] },
      },
      highlight: { vars: ["nums"], objects: ["#3"] },
      output: "",
    },
    {
      line: 4,
      narration: "`more = nums` points `more` at the same list — exactly like `q = p` did.",
      frames: [{ name: "globals", vars: { p: "#1", q: "#2", nums: "#3", more: "#3" } }],
      heap: {
        "#1": { type: "int", value: 1 },
        "#2": { type: "int", value: 2 },
        "#3": { type: "list", value: [1] },
      },
      highlight: { vars: ["more"], objects: ["#3"] },
      output: "",
    },
    {
      line: 5,
      narration: "`more.append(2)` changes the SHARED list, so `nums` becomes `[1, 2]` too. Lists share changes; numbers didn't. That's the whole difference.",
      frames: [{ name: "globals", vars: { p: "#1", q: "#2", nums: "#3", more: "#3" } }],
      heap: {
        "#1": { type: "int", value: 1 },
        "#2": { type: "int", value: 2 },
        "#3": { type: "list", value: [1, 2] },
      },
      highlight: { objects: ["#3"] },
      output: "",
    },
  ],
};
```

- [ ] **Step 7: Create the manifest — `lessons/index.js`**

```javascript
// glassbox/lessons/index.js
import lesson1 from "./01-name-points-to-value.js";
import lesson2 from "./02-list-is-one-object.js";
import lesson3 from "./03-two-names-one-list.js";
import lesson4 from "./04-numbers-vs-lists.js";

export const lessons = [lesson1, lesson2, lesson3, lesson4];
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd glassbox && node --test test/lessons.test.js`
Expected: PASS — 3 tests (all 4 lessons validate clean).

- [ ] **Step 9: Run the full suite**

Run: `cd glassbox && node --test`
Expected: PASS — all test files green.

- [ ] **Step 10: Commit**

```bash
git add glassbox/lessons glassbox/test/lessons.test.js
git commit -m "feat(glassbox): author 4-lesson arc + validate real lessons"
```

---

### Task 7: `storage.js` — resume the learner where they left off

**Files:**
- Create: `glassbox/src/storage.js`

No unit test: this is a thin `localStorage` wrapper exercised in the manual smoke checklist (Task 11). It must never throw (private-mode browsers can disable `localStorage`).

- [ ] **Step 1: Write the implementation**

```javascript
// glassbox/src/storage.js
const KEY = "glassbox.progress.v1";

/**
 * Read saved progress. Returns null if absent or storage is unavailable.
 * @returns {{ lessonIndex: number, step: number } | null}
 */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lessonIndex !== "number" || typeof parsed?.step !== "number") return null;
    return parsed;
  } catch {
    return null; // storage disabled or corrupt — start fresh
  }
}

/**
 * Persist progress. Silently no-ops if storage is unavailable.
 * @param {{ lessonIndex: number, step: number }} progress
 */
export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* storage disabled — progress simply won't persist */
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add glassbox/src/storage.js
git commit -m "feat(glassbox): add fail-safe localStorage progress wrapper"
```

---

### Task 8: HTML shell + styles

**Files:**
- Create: `glassbox/index.html`
- Create: `glassbox/style.css`

- [ ] **Step 1: Create `glassbox/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Glassbox — see what your code does</title>
  <meta name="description" content="A beginner's visual playground: watch Python names, arrows, and memory change one step at a time." />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="gb-header">
    <h1>Glassbox</h1>
    <p class="gb-subtitle">Watch what your code <em>actually</em> does — one step at a time.</p>
    <nav class="gb-rail" id="lesson-rail" aria-label="Lessons"></nav>
  </header>

  <main class="gb-stage">
    <section class="gb-panel gb-code" aria-label="Code">
      <h2 class="gb-panel-title">Code</h2>
      <ol class="gb-code-lines" id="code-lines"></ol>
    </section>

    <section class="gb-panel gb-memory" aria-label="Memory">
      <h2 class="gb-panel-title">Memory</h2>
      <div class="gb-memory-area" id="memory-area">
        <svg class="gb-arrows" id="arrows-svg" aria-hidden="true">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
        </svg>
        <div class="gb-frames" id="frames"></div>
        <div class="gb-heap" id="heap"></div>
      </div>
    </section>
  </main>

  <p class="gb-narration" id="narration" aria-live="polite"></p>
  <pre class="gb-output" id="output" aria-label="Program output"></pre>

  <div class="gb-controls" role="group" aria-label="Step controls">
    <button id="btn-prev" type="button">◀ Prev</button>
    <button id="btn-play" type="button">▶ Play</button>
    <button id="btn-next" type="button">Next ▶</button>
    <span class="gb-step-count" id="step-count" aria-live="polite"></span>
    <button id="btn-reset" type="button">↺ Reset</button>
  </div>

  <footer class="gb-footer">
    <a href="../index.html">← App Hub</a>
    <a href="how-it-works.html">How it's built →</a>
  </footer>

  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `glassbox/style.css`**

```css
:root {
  --bg: #0a0e14;
  --panel: #121823;
  --ink: #e6edf3;
  --muted: #8b98a9;
  --accent: #4af7ff;
  --hot: #ffcf4a;       /* highlight glow */
  --line-now: #1f3a44;  /* current code line */
  --box: #1c2733;
  --arrow: #5a6b7b;
  --arrow-hot: #ffcf4a;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.5;
  padding: 1rem clamp(1rem, 4vw, 3rem) 3rem;
}

.gb-header h1 { margin: 0; font-size: 1.6rem; color: var(--accent); }
.gb-subtitle { margin: 0.25rem 0 1rem; color: var(--muted); }
.gb-subtitle em { color: var(--ink); font-style: italic; }

.gb-rail { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
.gb-rail button {
  background: var(--panel); color: var(--muted);
  border: 1px solid #243044; border-radius: 999px;
  padding: 0.35rem 0.8rem; cursor: pointer; font-size: 0.85rem;
}
.gb-rail button[aria-current="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); }

.gb-stage { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 720px) { .gb-stage { grid-template-columns: 1fr; } }

.gb-panel { background: var(--panel); border: 1px solid #1d2735; border-radius: 12px; padding: 1rem; }
.gb-panel-title { margin: 0 0 0.6rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }

.gb-code-lines { margin: 0; padding-left: 2.2rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.gb-code-lines li { padding: 0.15rem 0.4rem; border-radius: 6px; white-space: pre; }
.gb-code-lines li.now { background: var(--line-now); box-shadow: inset 3px 0 0 var(--accent); }

.gb-memory-area { position: relative; min-height: 220px; display: flex; gap: 2.5rem; }
.gb-arrows { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.gb-arrows line { stroke: var(--arrow); stroke-width: 2; marker-end: url(#arrowhead); }
.gb-arrows line.hot { stroke: var(--arrow-hot); stroke-width: 3; }
.gb-arrows marker path { fill: var(--arrow); }

.gb-frames, .gb-heap { display: flex; flex-direction: column; gap: 0.6rem; z-index: 1; }
.gb-frame-name { font-size: 0.75rem; color: var(--muted); }

.gb-var, .gb-obj {
  background: var(--box); border: 1px solid #2a3949; border-radius: 8px;
  padding: 0.4rem 0.7rem; font-family: ui-monospace, monospace; font-size: 0.9rem;
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}
.gb-var .gb-var-name { color: var(--accent); }
.gb-obj .gb-obj-type { color: var(--muted); font-size: 0.7rem; display: block; }

.gb-var.hot, .gb-obj.hot {
  border-color: var(--hot);
  box-shadow: 0 0 0 2px rgba(255, 207, 74, 0.5);
  animation: gb-pulse 0.6s ease;
}
@keyframes gb-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.06); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .gb-var.hot, .gb-obj.hot { animation: none; } }

.gb-narration { background: #0e2730; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; padding: 0.8rem 1rem; margin: 1rem 0 0.5rem; font-size: 1.05rem; }
.gb-output { background: #06090d; border: 1px solid #1d2735; border-radius: 8px; padding: 0.6rem 1rem; min-height: 1.5rem; margin: 0 0 1rem; color: #7ee787; font-family: ui-monospace, monospace; }
.gb-output:empty::before { content: "(no output yet)"; color: var(--muted); }

.gb-controls { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.gb-controls button {
  background: var(--accent); color: var(--bg); border: 0; border-radius: 8px;
  padding: 0.5rem 1rem; font-weight: 600; cursor: pointer;
}
.gb-controls button:disabled { opacity: 0.4; cursor: default; }
.gb-step-count { color: var(--muted); margin-left: auto; }

.gb-footer { margin-top: 2rem; display: flex; justify-content: space-between; }
.gb-footer a { color: var(--accent); text-decoration: none; }
```

- [ ] **Step 3: Manual check — page renders**

Run a static server so ESM imports resolve, then open the page:
```bash
cd glassbox && python3 -m http.server 8000
```
Open `http://localhost:8000/`. Expected: header, two empty panels, narration/output bars, and controls render with no console errors. (Memory/code stay empty until Task 9/10 wire rendering — that's fine here.)

- [ ] **Step 4: Commit**

```bash
git add glassbox/index.html glassbox/style.css
git commit -m "feat(glassbox): add HTML shell and styles"
```

---

### Task 9: `render.js` — paint a step

**Files:**
- Create: `glassbox/src/render.js`

Renders code lines, frames, heap objects, narration, output, and SVG arrows from a `computeLayout` model. Arrows are drawn after layout using each box's measured position (`getBoundingClientRect` relative to the memory area). **Build DOM with `textContent`/`createElement` only — never `innerHTML` — even for trusted authored data; it keeps the renderer XSS-proof by construction.**

- [ ] **Step 1: Write the implementation**

```javascript
// glassbox/src/render.js
import { computeLayout } from "./layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Cache of DOM elements the renderer writes into.
 * @typedef {{
 *   codeLines: HTMLElement, frames: HTMLElement, heap: HTMLElement,
 *   arrowsSvg: SVGSVGElement, narration: HTMLElement, output: HTMLElement,
 *   stepCount: HTMLElement, memoryArea: HTMLElement
 * }} RenderEls
 */

/**
 * Paint a single step.
 * @param {RenderEls} els
 * @param {object} trace
 * @param {number} stepIndex
 */
export function renderStep(els, trace, stepIndex) {
  const step = trace.steps[stepIndex];
  const layout = computeLayout(step);

  renderCode(els.codeLines, trace.code, step.line);
  renderFrames(els.frames, layout.frames);
  renderHeap(els.heap, layout.objects);
  els.narration.textContent = step.narration;
  els.output.textContent = step.output ?? "";
  els.stepCount.textContent = `Step ${stepIndex + 1} / ${trace.steps.length}`;

  // Arrows need final box positions, so draw after layout settles.
  requestAnimationFrame(() => renderArrows(els.arrowsSvg, els.memoryArea, layout.arrows));
}

function renderCode(container, code, currentLine) {
  container.replaceChildren(
    ...code.map((line, i) => {
      const li = document.createElement("li");
      li.textContent = line;
      if (i === currentLine) li.classList.add("now");
      return li;
    }),
  );
}

function renderFrames(container, frames) {
  container.replaceChildren(
    ...frames.map((frame) => {
      const wrap = document.createElement("div");
      const name = document.createElement("div");
      name.className = "gb-frame-name";
      name.textContent = frame.name;
      wrap.append(name);
      for (const v of frame.vars) {
        const box = document.createElement("div");
        box.className = "gb-var" + (v.highlighted ? " hot" : "");
        box.dataset.endpoint = `${frame.name}.${v.name}`;
        const nameSpan = document.createElement("span");
        nameSpan.className = "gb-var-name";
        nameSpan.textContent = v.name;
        box.append(nameSpan);
        wrap.append(box);
      }
      return wrap;
    }),
  );
}

function renderHeap(container, objects) {
  container.replaceChildren(
    ...objects.map((obj) => {
      const box = document.createElement("div");
      box.className = "gb-obj" + (obj.highlighted ? " hot" : "");
      box.dataset.endpoint = obj.id;
      const typeSpan = document.createElement("span");
      typeSpan.className = "gb-obj-type";
      typeSpan.textContent = obj.type;
      box.append(typeSpan, document.createTextNode(obj.valueText));
      return box;
    }),
  );
}

function renderArrows(svg, area, arrows) {
  // Clear previous arrows but keep <defs>.
  svg.querySelectorAll("line").forEach((el) => el.remove());
  const areaBox = area.getBoundingClientRect();
  const byEndpoint = new Map(
    [...area.querySelectorAll("[data-endpoint]")].map((el) => [el.dataset.endpoint, el]),
  );

  for (const arrow of arrows) {
    const fromEl = byEndpoint.get(arrow.from);
    const toEl = byEndpoint.get(arrow.to);
    if (!fromEl || !toEl) continue;
    const f = fromEl.getBoundingClientRect();
    const t = toEl.getBoundingClientRect();
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", f.right - areaBox.left);
    line.setAttribute("y1", f.top + f.height / 2 - areaBox.top);
    line.setAttribute("x2", t.left - areaBox.left - 2);
    line.setAttribute("y2", t.top + t.height / 2 - areaBox.top);
    if (arrow.highlighted) line.classList.add("hot");
    svg.append(line);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add glassbox/src/render.js
git commit -m "feat(glassbox): add step renderer with SVG arrow drawing"
```

---

### Task 10: `controls.js` + `main.js` — wire it together

**Files:**
- Create: `glassbox/src/controls.js`
- Create: `glassbox/src/main.js`

- [ ] **Step 1: Create `glassbox/src/controls.js`**

```javascript
// glassbox/src/controls.js
import { stepReducer } from "./state.js";
import { renderStep } from "./render.js";

const AUTOPLAY_MS = 1500;

/**
 * Wire buttons, keyboard, and autoplay to the step state for one lesson.
 * @param {object} ctx
 * @param {object} ctx.trace current lesson trace
 * @param {number} ctx.startStep initial step
 * @param {object} ctx.els render element cache
 * @param {object} ctx.buttons { prev, play, next, reset }
 * @param {(step:number)=>void} ctx.onChange called after every step change (for persistence)
 * @returns {{ destroy: () => void }}
 */
export function initControls({ trace, startStep, els, buttons, onChange }) {
  let step = startStep;
  let timer = null;
  const total = trace.steps.length;

  function paint() {
    renderStep(els, trace, step);
    buttons.prev.disabled = step === 0;
    buttons.next.disabled = step === total - 1 && timer === null;
    onChange(step);
    if (timer !== null && step === total - 1) stopPlay();
  }

  function dispatch(action) {
    step = stepReducer(step, action, total);
    paint();
  }

  function startPlay() {
    if (step === total - 1) { step = 0; }
    buttons.play.textContent = "⏸ Pause";
    timer = setInterval(() => dispatch({ type: "next" }), AUTOPLAY_MS);
    paint();
  }

  function stopPlay() {
    clearInterval(timer);
    timer = null;
    buttons.play.textContent = "▶ Play";
    paint();
  }

  function togglePlay() {
    timer === null ? startPlay() : stopPlay();
  }

  function onKey(e) {
    if (e.key === "ArrowRight") dispatch({ type: "next" });
    else if (e.key === "ArrowLeft") dispatch({ type: "prev" });
  }

  buttons.prev.addEventListener("click", () => { stopPlay(); dispatch({ type: "prev" }); });
  buttons.next.addEventListener("click", () => { stopPlay(); dispatch({ type: "next" }); });
  buttons.reset.addEventListener("click", () => { stopPlay(); dispatch({ type: "reset" }); });
  buttons.play.addEventListener("click", togglePlay);
  window.addEventListener("keydown", onKey);

  paint();

  return {
    destroy() {
      stopPlay();
      window.removeEventListener("keydown", onKey);
    },
  };
}
```

- [ ] **Step 2: Create `glassbox/src/main.js`**

`destroy()` removes the keyboard listener and stops autoplay, but click listeners stay bound to the same persistent buttons across lessons. To avoid stacking duplicate click handlers each time a lesson is selected, the buttons are cloned-and-replaced once per selection before wiring fresh listeners.

```javascript
// glassbox/src/main.js
import { lessons } from "../lessons/index.js";
import { initControls } from "./controls.js";
import { loadProgress, saveProgress } from "./storage.js";

const $ = (id) => document.getElementById(id);

const els = {
  codeLines: $("code-lines"),
  frames: $("frames"),
  heap: $("heap"),
  arrowsSvg: $("arrows-svg"),
  narration: $("narration"),
  output: $("output"),
  stepCount: $("step-count"),
  memoryArea: $("memory-area"),
};

const rail = $("lesson-rail");
let active = null;

function freshButton(id) {
  // Replace the node with a clone to drop any previously-bound click listeners.
  const old = $(id);
  const clone = old.cloneNode(true);
  old.replaceWith(clone);
  return clone;
}

function buildRail() {
  rail.replaceChildren(
    ...lessons.map((lesson, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${i + 1}. ${lesson.title}`;
      btn.addEventListener("click", () => selectLesson(i, 0));
      return btn;
    }),
  );
}

function selectLesson(index, startStep) {
  [...rail.children].forEach((b, i) => b.setAttribute("aria-current", String(i === index)));
  if (active) active.destroy();

  const buttons = {
    prev: freshButton("btn-prev"),
    play: freshButton("btn-play"),
    next: freshButton("btn-next"),
    reset: freshButton("btn-reset"),
  };

  active = initControls({
    trace: lessons[index],
    startStep,
    els,
    buttons,
    onChange: (step) => saveProgress({ lessonIndex: index, step }),
  });
}

buildRail();
const saved = loadProgress();
const startLesson = saved && saved.lessonIndex >= 0 && saved.lessonIndex < lessons.length ? saved.lessonIndex : 0;
const startStep = saved ? saved.step : 0;
selectLesson(startLesson, startStep);
```

- [ ] **Step 3: Manual smoke check**

Run: `cd glassbox && python3 -m http.server 8000` and open `http://localhost:8000/`.
Expected:
- Lesson 1 renders with line 0 highlighted, one `x` box arrow-linked to a `5` box.
- **Next** advances; on lesson 3 step 2, both `a` and `b` arrows point at the one list box, which grows to `[1, 2, 3, 4]`.
- **Play** autoplays and stops on the last step; **Reset** returns to step 0.
- Switch lessons via the rail repeatedly, then click Next several times — confirm it advances exactly one step per click (no duplicate-listener double-stepping).
- Reload the page — it resumes on the same lesson/step.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add glassbox/src/controls.js glassbox/src/main.js
git commit -m "feat(glassbox): wire controls, autoplay, lesson rail, and resume"
```

---

### Task 11: How-it-works page + App Hub card + final verification

**Files:**
- Create: `glassbox/how-it-works.html`
- Modify: `index.html` (repo root — add a card to the grid)

- [ ] **Step 1: Create `glassbox/how-it-works.html`**

Copy the structure of the existing template for visual consistency:
```bash
cp _template/how-it-works.html glassbox/how-it-works.html
```
Then edit its title/intro/body to describe Glassbox: the names→arrows→heap model, why traces are authored (not interpreted), the pure `computeLayout` engine, and the `node --test` suite. Keep the template's CSS link and layout intact.

- [ ] **Step 2: Add the App Hub card to root `index.html`**

Insert this `<article>` immediately after the Subnet Trainer card (find `<!-- Subnet Trainer -->` … its closing `</article>`), matching the sibling structure exactly:

```html
                <!-- Glassbox -->
                <article class="card" data-tag="Education">
                    <a href="glassbox/index.html" class="card-link">
                        <div class="card-visual" style="--a:#0a0e14;--b:#121823;--c:#4af7ff">
                            <div class="orb orb1"></div>
                            <div class="orb orb2"></div>
                            <div class="card-icon">🔍</div>
                        </div>
                        <div class="card-body">
                            <div class="card-tag">Education</div>
                            <h3>Glassbox</h3>
                            <p>See what Python <em>actually</em> does. Step through tiny snippets and watch names, arrows, and memory change — building to the moment two names share one list.</p>
                            <span class="card-cta">Step through →</span>
                        </div>
                    </a>
                    <div class="card-actions">
                        <a href="https://github.com/Worldtraveler247/code_projects/tree/main/glassbox" class="action-btn" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" title="View source on GitHub">
                            <svg width="16" height="16" aria-hidden="true"><use href="#icon-github"/></svg>
                            <span>Source</span>
                        </a>
                        <a href="https://github1s.com/Worldtraveler247/code_projects/tree/main/glassbox" class="action-btn" target="_blank" rel="noopener noreferrer" aria-label="Browse code in VS Code (github1s)" title="Browse code in VS Code (github1s)">
                            <svg width="16" height="16" aria-hidden="true"><use href="#icon-code"/></svg>
                            <span>VS Code</span>
                        </a>
                        <a href="glassbox/how-it-works.html" class="action-btn action-btn--build" target="_blank" rel="noopener noreferrer" aria-label="How this app is built" title="How It's Built">
                            📖 <span>How It's Built</span>
                        </a>
                    </div>
                </article>
```

- [ ] **Step 3: Run the full test suite one last time**

Run: `cd glassbox && node --test`
Expected: PASS — all suites green (formatValue, validateTrace, layout, state, lessons).

- [ ] **Step 4: Manual smoke checklist (browser)**

Open `http://localhost:8000/` from repo root (`python3 -m http.server 8000`):
- [ ] App Hub card appears, links to `glassbox/index.html`.
- [ ] All 4 lessons load from the rail; current lesson is marked.
- [ ] Current code line and highlighted boxes change together each step.
- [ ] Arrows redraw correctly on window resize (resize the window mid-lesson).
- [ ] Keyboard ←/→ steps; Play autoplays and stops at the end; Reset works.
- [ ] Reload resumes the saved lesson/step.
- [ ] Mobile width (DevTools ~375px): panels stack, nothing overflows.
- [ ] No console errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add glassbox/how-it-works.html index.html
git commit -m "feat(glassbox): add how-it-works page and register App Hub card"
```

---

## Self-Review

**1. Spec coverage:**
- §3 pure-static / no-build / SVG / `render(trace,step)` engine → Tasks 1, 4, 9. ✓
- §4 data model (frames/heap/highlight/output) → Task 6 lessons + Task 3 validator. ✓
- §4 authoring guardrail (validator, Node-testable) → Task 3 + Task 6 `lessons.test.js`. ✓
- §5 UI (3 regions + rail), stepping-only, arrow animation, localStorage resume → Tasks 8, 9, 10. ✓
- §5 accessibility (color+motion+border, real-text narration, keyboard) → `style.css` (reduced-motion, hot border + shadow, not color alone), `index.html` (`aria-live`, real narration text), `controls.js` (arrow keys). ✓
- §6 four-lesson arc → Task 6, all four authored with the exact ramp from the spec. ✓
- §7 testing (validator unit tests, layout output asserts, state asserts, manual checklist) → Tasks 3, 4, 5, 11. ✓
- §2 non-goals respected: no interpreter, no editing, Python only, no backend. ✓

**2. Placeholder scan:** No "TBD"/"add error handling here"/"similar to Task N". Every code step shows complete code. The one copy-then-edit step (`how-it-works.html`) is a legitimate "follow the existing template" instruction, not a code placeholder.

**3. Type consistency:** `computeLayout` returns `{ frames, objects, arrows }` (Task 4) consumed identically in `render.js` (Task 9). Arrow `{ from, to, highlighted }` endpoints match the `data-endpoint` values written in `renderFrames`/`renderHeap` (`"<frame>.<var>"` for vars, bare `id` for objects). `stepReducer(step, action, total)` signature matches its call sites in `controls.js`. `validateTrace` returns `{ ok, errors }` used consistently in `lessons.test.js`. `initControls({ trace, startStep, els, buttons, onChange })` matches the call in `main.js`, and `freshButton` keeps click listeners from stacking across lesson switches. Lesson trace shape matches what the validator checks and what `computeLayout` reads. ✓

---

**Accessibility note carried from spec §5:** highlight is conveyed by border color + box-shadow + pulse animation (and reduced-motion users still get the border/shadow), not color alone — satisfying the colorblind-safety requirement. If smoke-testing reveals the shared-arrow case is ambiguous, add a small "shared" text tag in a follow-up.
