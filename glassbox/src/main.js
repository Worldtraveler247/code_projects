// glassbox/src/main.js
import { lessons } from "../lessons/index.js";
import { initControls } from "./controls.js";
import { clampStep } from "./state.js";
import { loadProgress, saveProgress } from "./storage.js";

const $ = (id) => document.getElementById(id);

const els = {
  codeLines: $("code-lines"),
  frames: $("frames"),
  heap: $("heap"),
  arrowsSvg: $("arrows-svg"),
  narration: $("narration"),
  output: $("output"),
  stepCount: $("step-count"),
  memoryArea: $("memory-area"),
};

const rail = $("lesson-rail");
let active = null;

function freshButton(id) {
  // Replace the node with a clone to drop any previously-bound click listeners.
  const old = $(id);
  const clone = old.cloneNode(true);
  old.replaceWith(clone);
  return clone;
}

function buildRail() {
  rail.replaceChildren(
    ...lessons.map((lesson, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${i + 1}. ${lesson.title}`;
      btn.addEventListener("click", () => selectLesson(i, 0));
      return btn;
    }),
  );
}

function selectLesson(index, startStep) {
  [...rail.children].forEach((b, i) => b.setAttribute("aria-current", String(i === index)));
  if (active) active.destroy();

  const buttons = {
    prev: freshButton("btn-prev"),
    play: freshButton("btn-play"),
    next: freshButton("btn-next"),
    reset: freshButton("btn-reset"),
  };

  active = initControls({
    trace: lessons[index],
    startStep,
    els,
    buttons,
    onChange: (step) => saveProgress({ lessonIndex: index, step }),
  });
}

buildRail();
const saved = loadProgress();
const startLesson = saved && saved.lessonIndex >= 0 && saved.lessonIndex < lessons.length ? saved.lessonIndex : 0;
const startStep = saved ? clampStep(saved.step, lessons[startLesson].steps.length) : 0;
selectLesson(startLesson, startStep);
