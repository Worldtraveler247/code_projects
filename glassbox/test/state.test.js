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
