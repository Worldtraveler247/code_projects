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
