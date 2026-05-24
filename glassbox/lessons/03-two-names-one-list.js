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
