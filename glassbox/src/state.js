// glassbox/src/state.js

/**
 * Clamp a step index into the valid range for a trace of `total` steps.
 * @param {number} index
 * @param {number} total
 * @returns {number}
 */
export function clampStep(index, total) {
  return Math.max(0, Math.min(index, total - 1));
}

/**
 * Pure reducer for stepping through a trace.
 * @param {number} step current step index
 * @param {{ type: string, index?: number }} action
 * @param {number} total total number of steps
 * @returns {number} next step index
 */
export function stepReducer(step, action, total) {
  switch (action.type) {
    case "next":
      return clampStep(step + 1, total);
    case "prev":
      return clampStep(step - 1, total);
    case "reset":
      return 0;
    case "goto":
      return clampStep(action.index, total);
    default:
      return step;
  }
}
