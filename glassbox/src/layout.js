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
      highlighted: highlightVars.has(name),
    })),
  );

  return { frames, objects, arrows };
}
