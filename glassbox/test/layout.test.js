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
    { from: "globals.a", to: "#1", highlighted: true },
    { from: "globals.b", to: "#1", highlighted: true },
  ]);
});

test("an unhighlighted step marks nothing highlighted", () => {
  const step = { ...sharedStep, highlight: undefined };
  const layout = computeLayout(step);
  assert.ok(layout.objects.every((o) => o.highlighted === false));
  assert.ok(layout.arrows.every((a) => a.highlighted === false));
});
