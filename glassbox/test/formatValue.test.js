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
