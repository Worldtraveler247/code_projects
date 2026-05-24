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
