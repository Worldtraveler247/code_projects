// glassbox/src/validateTrace.js

/**
 * Validate an authored lesson trace.
 * @param {object} trace
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTrace(trace) {
  const errors = [];

  if (typeof trace?.id !== "string" || trace.id === "") errors.push("id must be a non-empty string");
  if (typeof trace?.title !== "string" || trace.title === "") errors.push("title must be a non-empty string");

  const code = trace?.code;
  if (!Array.isArray(code) || code.length === 0) {
    errors.push("code must be a non-empty array");
  } else if (!code.every((line) => typeof line === "string")) {
    errors.push("code must contain only strings");
  }

  const steps = trace?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push("steps must be a non-empty array");
    return { ok: errors.length === 0, errors };
  }

  const codeLen = Array.isArray(code) ? code.length : 0;

  steps.forEach((step, i) => {
    const where = `step ${i}`;

    if (!Number.isInteger(step?.line) || step.line < 0 || step.line >= codeLen) {
      errors.push(`${where}: line ${step?.line} out of range 0..${codeLen - 1}`);
    }
    if (typeof step?.narration !== "string" || step.narration.trim() === "") {
      errors.push(`${where}: narration must be a non-empty string`);
    }
    if (typeof step?.heap !== "object" || step.heap === null) {
      errors.push(`${where}: heap must be an object`);
    }
    if (!Array.isArray(step?.frames) || step.frames.length === 0) {
      errors.push(`${where}: frames must be a non-empty array`);
    }

    const heap = step?.heap ?? {};

    (step?.frames ?? []).forEach((frame, f) => {
      if (typeof frame?.name !== "string" || frame.name === "") {
        errors.push(`${where} frame ${f}: name must be a non-empty string`);
      }
      const vars = frame?.vars ?? {};
      for (const [varName, id] of Object.entries(vars)) {
        if (!(id in heap)) {
          errors.push(`${where}: var "${varName}" points at missing heap id ${id}`);
        }
      }
    });

    const hl = step?.highlight;
    if (hl) {
      for (const id of hl.objects ?? []) {
        if (!(id in heap)) errors.push(`${where}: highlight object ${id} not in heap`);
      }
      const knownVars = new Set(
        (step?.frames ?? []).flatMap((fr) => Object.keys(fr?.vars ?? {})),
      );
      for (const v of hl.vars ?? []) {
        if (!knownVars.has(v)) errors.push(`${where}: highlight var "${v}" not defined in any frame`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
