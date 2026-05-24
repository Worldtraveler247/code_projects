// glassbox/src/render.js
import { computeLayout } from "./layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Cache of DOM elements the renderer writes into.
 * @typedef {{
 *   codeLines: HTMLElement, frames: HTMLElement, heap: HTMLElement,
 *   arrowsSvg: SVGSVGElement, narration: HTMLElement, output: HTMLElement,
 *   stepCount: HTMLElement, memoryArea: HTMLElement
 * }} RenderEls
 */

/**
 * Paint a single step.
 * @param {RenderEls} els
 * @param {object} trace
 * @param {number} stepIndex
 */
export function renderStep(els, trace, stepIndex) {
  const step = trace.steps[stepIndex];
  const layout = computeLayout(step);

  renderCode(els.codeLines, trace.code, step.line);
  renderFrames(els.frames, layout.frames);
  renderHeap(els.heap, layout.objects);
  els.narration.textContent = step.narration;
  els.output.textContent = step.output ?? "";
  els.stepCount.textContent = `Step ${stepIndex + 1} / ${trace.steps.length}`;

  // Arrows need final box positions, so draw after layout settles.
  requestAnimationFrame(() => renderArrows(els.arrowsSvg, els.memoryArea, layout.arrows));
}

function renderCode(container, code, currentLine) {
  container.replaceChildren(
    ...code.map((line, i) => {
      const li = document.createElement("li");
      li.textContent = line;
      if (i === currentLine) li.classList.add("now");
      return li;
    }),
  );
}

function renderFrames(container, frames) {
  container.replaceChildren(
    ...frames.map((frame) => {
      const wrap = document.createElement("div");
      const name = document.createElement("div");
      name.className = "gb-frame-name";
      name.textContent = frame.name;
      wrap.append(name);
      for (const v of frame.vars) {
        const box = document.createElement("div");
        box.className = "gb-var" + (v.highlighted ? " hot" : "");
        box.dataset.endpoint = `${frame.name}.${v.name}`;
        const nameSpan = document.createElement("span");
        nameSpan.className = "gb-var-name";
        nameSpan.textContent = v.name;
        box.append(nameSpan);
        wrap.append(box);
      }
      return wrap;
    }),
  );
}

function renderHeap(container, objects) {
  container.replaceChildren(
    ...objects.map((obj) => {
      const box = document.createElement("div");
      box.className = "gb-obj" + (obj.highlighted ? " hot" : "");
      box.dataset.endpoint = obj.id;
      const typeSpan = document.createElement("span");
      typeSpan.className = "gb-obj-type";
      typeSpan.textContent = obj.type;
      box.append(typeSpan, document.createTextNode(obj.valueText));
      return box;
    }),
  );
}

function renderArrows(svg, area, arrows) {
  // Clear previous arrows but keep <defs>.
  svg.querySelectorAll("line").forEach((el) => el.remove());
  const areaBox = area.getBoundingClientRect();
  const byEndpoint = new Map(
    [...area.querySelectorAll("[data-endpoint]")].map((el) => [el.dataset.endpoint, el]),
  );

  for (const arrow of arrows) {
    const fromEl = byEndpoint.get(arrow.from);
    const toEl = byEndpoint.get(arrow.to);
    if (!fromEl || !toEl) continue;
    const f = fromEl.getBoundingClientRect();
    const t = toEl.getBoundingClientRect();
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", f.right - areaBox.left);
    line.setAttribute("y1", f.top + f.height / 2 - areaBox.top);
    line.setAttribute("x2", t.left - areaBox.left - 2);
    line.setAttribute("y2", t.top + t.height / 2 - areaBox.top);
    if (arrow.highlighted) line.classList.add("hot");
    svg.append(line);
  }
}
