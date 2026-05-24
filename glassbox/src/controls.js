// glassbox/src/controls.js
import { stepReducer } from "./state.js";
import { renderStep } from "./render.js";

const AUTOPLAY_MS = 1500;

/**
 * Wire buttons, keyboard, and autoplay to the step state for one lesson.
 * @param {object} ctx
 * @param {object} ctx.trace current lesson trace
 * @param {number} ctx.startStep initial step
 * @param {object} ctx.els render element cache
 * @param {object} ctx.buttons { prev, play, next, reset }
 * @param {(step:number)=>void} ctx.onChange called after every step change (for persistence)
 * @returns {{ destroy: () => void }}
 */
export function initControls({ trace, startStep, els, buttons, onChange }) {
  let step = startStep;
  let timer = null;
  const total = trace.steps.length;

  function paint() {
    renderStep(els, trace, step);
    buttons.prev.disabled = step === 0;
    buttons.next.disabled = step === total - 1 && timer === null;
    onChange(step);
    if (timer !== null && step === total - 1) stopPlay();
  }

  function dispatch(action) {
    step = stepReducer(step, action, total);
    paint();
  }

  function startPlay() {
    if (step === total - 1) { step = 0; }
    buttons.play.textContent = "⏸ Pause";
    timer = setInterval(() => dispatch({ type: "next" }), AUTOPLAY_MS);
    paint();
  }

  function stopPlay() {
    clearInterval(timer);
    timer = null;
    buttons.play.textContent = "▶ Play";
    paint();
  }

  function togglePlay() {
    timer === null ? startPlay() : stopPlay();
  }

  function onKey(e) {
    if (e.key === "ArrowRight") dispatch({ type: "next" });
    else if (e.key === "ArrowLeft") dispatch({ type: "prev" });
  }

  buttons.prev.addEventListener("click", () => { if (timer !== null) stopPlay(); dispatch({ type: "prev" }); });
  buttons.next.addEventListener("click", () => { if (timer !== null) stopPlay(); dispatch({ type: "next" }); });
  buttons.reset.addEventListener("click", () => { if (timer !== null) stopPlay(); dispatch({ type: "reset" }); });
  buttons.play.addEventListener("click", togglePlay);
  window.addEventListener("keydown", onKey);

  paint();

  return {
    destroy() {
      stopPlay();
      window.removeEventListener("keydown", onKey);
    },
  };
}
