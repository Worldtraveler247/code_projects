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
