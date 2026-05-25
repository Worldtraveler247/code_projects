// glassbox/lessons/05-passing-list-to-function.js
export default {
  id: "passing-list-to-function",
  title: "Passing a list into a function",
  code: [
    "def add_item(items):",
    "    items.append(99)",
    "data = [1, 2]",
    "add_item(data)",
    "print(data)",
  ],
  steps: [
    {
      line: 2,
      narration: "We build a list `[1, 2]` and pin the name `data` to it in the main (globals) frame.",
      frames: [{ name: "globals", vars: { data: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2] } },
      highlight: { vars: ["data"], objects: ["#1"] },
      output: "",
    },
    {
      line: 3,
      narration: "Calling `add_item(data)` runs the function. Its parameter `items` does NOT copy the list — it points at the SAME box as `data`. A new frame appears for the call.",
      frames: [
        { name: "globals", vars: { data: "#1" } },
        { name: "add_item", vars: { items: "#1" } },
      ],
      heap: { "#1": { type: "list", value: [1, 2] } },
      highlight: { vars: ["items"], objects: ["#1"] },
      output: "",
    },
    {
      line: 1,
      narration: "Inside the function, `items.append(99)` changes the shared list. There is only one box, so `data` is affected too.",
      frames: [
        { name: "globals", vars: { data: "#1" } },
        { name: "add_item", vars: { items: "#1" } },
      ],
      heap: { "#1": { type: "list", value: [1, 2, 99] } },
      highlight: { objects: ["#1"] },
      output: "",
    },
    {
      line: 4,
      narration: "The function returned and its frame is gone — but the change stuck. `print(data)` shows `[1, 2, 99]`: passing a list lets a function modify your data.",
      frames: [{ name: "globals", vars: { data: "#1" } }],
      heap: { "#1": { type: "list", value: [1, 2, 99] } },
      highlight: { vars: ["data"], objects: ["#1"] },
      output: "[1, 2, 99]",
    },
  ],
};
