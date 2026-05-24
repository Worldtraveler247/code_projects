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
