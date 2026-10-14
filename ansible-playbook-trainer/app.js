// Page wiring: draws the editor, feeds keys to editor.js, and shows what checker.js says.

import { createEditor, getText, handleKey, insertText } from './editor.js';
import { check } from './checker.js';
import { describe, nextHint } from './model.js';
import { EXERCISES, LEVELS } from './exercises.js';
import { charClasses, segments, valueClass } from './highlight.js';

const PROGRESS_KEY = 'ansible-playbook-trainer:progress:v1';
const GUIDE_KEY = 'ansible-playbook-trainer:guide:v1';
const MIN_ROWS = 18;
const HANDLED = new Set(['Enter', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const MARKS = { ok: '✓', bad: '✗', warn: '!', none: ' ' };
const HEADINGS = { ok: 'Correct', bad: 'Needs fixing', warn: 'Right place, wrong content', none: 'Not checked' };

const $ = (id) => document.getElementById(id);
const el = {
  guide: $('guide'), select: $('exercise-select'), level: $('level'), title: $('title'), focus: $('focus'),
  brief: $('brief'), vim: $('vim'), rows: $('vim-rows'), mode: $('vim-mode'), pos: $('vim-pos'),
  why: $('why'), whyHead: $('why-head'), summary: $('summary'), result: $('result'),
  hint: $('hint-btn'), hintText: $('hint-text'), checkBtn: $('check-btn'), next: $('next-btn'),
  reset: $('reset-btn'), progress: $('progress'), keys: $('key-row'),
};

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may refuse storage; the trainer still works for this visit.
  }
}

const saved = readStore(PROGRESS_KEY, {});
const passed = new Set(Array.isArray(saved.passed) ? saved.passed.filter((id) => EXERCISES.some((e) => e.id === id)) : []);
let index = 0;
let editor = createEditor();
let result = check('', EXERCISES[0]);

const unlocked = (i) => i === 0 || passed.has(EXERCISES[i - 1].id);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// ---- Exercise panel ----

function renderSelect() {
  el.select.replaceChildren();
  EXERCISES.forEach((exercise, i) => {
    const state = passed.has(exercise.id) ? '✓' : unlocked(i) ? '·' : '🔒';
    const option = node('option', '', `${state} ${i + 1}. ${exercise.title}`);
    option.value = String(i);
    option.disabled = !unlocked(i);
    el.select.append(option);
  });
  el.select.value = String(index);
  el.progress.textContent = `${passed.size} of ${EXERCISES.length} passed`;
}

function renderBrief() {
  const exercise = EXERCISES[index];
  el.level.textContent = LEVELS[exercise.level];
  el.title.textContent = `${index + 1}. ${exercise.title}`;
  el.focus.textContent = exercise.focus;
  el.brief.replaceChildren();
  describe(exercise.plays).forEach((row) => {
    const item = node('li', row.heading ? 'brief-head' : '');
    // One band per two spaces of the line's place in the answer, as in the guide's example.
    for (let level = 0; level < row.indent / 2; level += 1) item.append(node('span', `band band-${level % 4}`));
    const text = node('span', 'brief-text');
    if (row.dash) text.append(node('span', 'tok-dash', '- '));
    const label = row.value === undefined && !row.lines ? row.label : `${row.label}: `;
    text.append(node('span', row.key ? 'tok-key' : 'brief-label', label));
    if (row.value !== undefined) {
      // A Jinja2 value is typed in quotes, so it takes the colour of a string.
      const cls = row.module ? 'tok-key' : valueClass(row.value.includes('{{') ? `"${row.value}"` : row.value);
      text.append(node('code', cls, row.value));
    }
    if (row.lines) text.append(node('pre', '', row.lines.join('\n')));
    item.append(text);
    el.brief.append(item);
  });
}

function load(i) {
  index = i;
  editor = createEditor();
  el.hintText.hidden = true;
  el.result.textContent = '';
  el.result.className = 'result';
  renderSelect();
  renderBrief();
  refresh();
}

// ---- Editor ----

function segment(parent, className, text) {
  if (text !== '') parent.append(node('span', className, text));
}

function renderLine(text, cursorCol) {
  const line = node('span', 'vim-text');
  const classes = charClasses(text);
  // Leading spaces are drawn as dots so the indentation can be counted.
  const glyph = (i) => (classes[i] === 'lead' ? '·' : text[i]);
  let run = '';
  let runClass = '';
  const flush = () => { segment(line, runClass, run); run = ''; };
  for (let i = 0; i <= text.length; i += 1) {
    if (i === cursorCol) {
      flush();
      const cursor = node('span', `cursor ${editor.mode} ${i < text.length ? classes[i] : ''}`, i < text.length ? glyph(i) : ' ');
      line.append(cursor);
      continue;
    }
    if (i === text.length) break;
    if (classes[i] !== runClass) flush();
    runClass = classes[i];
    run += glyph(i);
  }
  flush();
  return line;
}

function renderEditor() {
  const typingRow = editor.mode === 'insert' ? editor.row : -1;
  el.rows.replaceChildren();
  editor.lines.forEach((text, i) => {
    const verdict = result.lines[i] || { status: 'none' };
    const status = i === typingRow ? 'typing' : verdict.status;
    const row = node('div', `vim-row s-${status}${i === editor.row ? ' current' : ''}`);
    row.append(node('span', 'vim-mark', i === typingRow ? '…' : MARKS[verdict.status]));
    row.append(node('span', 'vim-num', String(i + 1)));
    row.append(renderLine(text, i === editor.row && editor.mode !== 'command' ? editor.col : -1));
    el.rows.append(row);
  });
  for (let i = editor.lines.length; i < MIN_ROWS; i += 1) {
    const row = node('div', 'vim-row tilde');
    row.append(node('span', 'vim-mark', ' '), node('span', 'vim-num', '~'));
    el.rows.append(row);
  }
  // Vim's cursorcolumn: a band through the cursor's column, down every line of the file.
  const column = node('div', 'cursor-column');
  column.style.setProperty('--col', String(editor.col));
  column.style.setProperty('--lines', String(editor.lines.length));
  if (editor.mode !== 'command') el.rows.append(column);
  const current = el.rows.children[editor.row];
  if (current && document.activeElement === el.vim) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  if (editor.mode === 'command') el.mode.textContent = `:${editor.command}█`;
  else if (editor.message) el.mode.textContent = editor.message;
  else if (editor.mode === 'insert') el.mode.textContent = '-- INSERT --';
  else el.mode.textContent = editor.pending || 'NORMAL  (i to type, :w to check)';
  const indent = editor.lines[editor.row].match(/^ */)[0].length;
  el.pos.textContent = `line ${editor.row + 1}, column ${editor.col + 1} · indent ${indent}`;
}

function renderWhy() {
  const verdict = result.lines[editor.row] || { status: 'none', why: '' };
  const typing = editor.mode === 'insert';
  el.why.className = `why s-${typing ? 'typing' : verdict.status}`;
  if (typing) {
    el.whyHead.textContent = `Line ${editor.row + 1}: typing`;
    el.why.textContent = 'This line is checked as soon as you press Esc or move to another line.';
  } else {
    el.whyHead.textContent = `Line ${editor.row + 1}: ${HEADINGS[verdict.status]}`;
    el.why.textContent = verdict.why || 'An empty buffer. Press i and start with the document marker.';
  }
  const parts = [`${result.ok} correct`];
  if (result.bad) parts.push(`${result.bad} to fix`);
  if (result.warn) parts.push(`${result.warn} to review`);
  parts.push(`${result.missing.length + (result.docSeen ? 0 : 1)} still to add`);
  el.summary.textContent = parts.join(' · ');
}

function refresh() {
  result = check(getText(editor), EXERCISES[index]);
  renderEditor();
  renderWhy();
  el.next.disabled = !(passed.has(EXERCISES[index].id) && index < EXERCISES.length - 1);
}

// ---- Actions ----

function write() {
  const exercise = EXERCISES[index];
  result = check(getText(editor), exercise);
  if (result.passed) {
    passed.add(exercise.id);
    writeStore(PROGRESS_KEY, { passed: [...passed] });
    const last = index === EXERCISES.length - 1;
    el.result.className = 'result pass';
    el.result.textContent = last
      ? 'Passed. That was the capstone: you have written a complete playbook from an empty file.'
      : 'Passed. Every line is in the right place with the right value. Type :n or press Next for the next exercise.';
    el.hintText.hidden = true;
    editor.message = '"playbook.yml" written, all checks passed';
    renderSelect();
  } else {
    const problems = [];
    if (result.bad) problems.push(`${result.bad} ${result.bad === 1 ? 'line is' : 'lines are'} in the wrong place (red)`);
    if (result.warn) problems.push(`${result.warn} ${result.warn === 1 ? 'line does' : 'lines do'} not match the brief (amber)`);
    const absent = result.missing.length + (result.docSeen ? 0 : 1);
    if (absent) problems.push(`${absent} ${absent === 1 ? 'item is' : 'items are'} still missing`);
    if (problems.length === 0 && result.parseError) problems.push(`YAML could not read the file: ${result.parseError}`);
    el.result.className = 'result fail';
    el.result.textContent = `Not yet: ${problems.join('; ')}. Move the cursor to a marked line to see why, or press Hint.`;
    editor.message = 'Not yet: see the notes beside the editor';
  }
  refresh();
}

function go(delta) {
  const target = index + delta;
  if (target < 0 || target >= EXERCISES.length) return;
  if (!unlocked(target)) {
    editor.message = 'Pass this exercise first (:w) to unlock the next one';
    renderEditor();
    return;
  }
  load(target);
}

function act(event) {
  if (!event) return;
  if (event.type === 'write') write();
  else if (event.type === 'next') go(1);
  else if (event.type === 'prev') go(-1);
  else if (event.type === 'help') {
    el.guide.open = true;
    $('vim-keys').scrollIntoView({ block: 'start' });
  }
}

function press(key) {
  const event = handleKey(editor, key);
  if (event) act(event);
  else refresh();
}

el.vim.addEventListener('keydown', (event) => {
  let { key } = event;
  if (event.ctrlKey && key === '[') key = 'Escape';
  else if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  // In normal mode Tab keeps its page meaning, so keyboard users can leave the editor.
  if (key === 'Tab' && editor.mode !== 'insert') return;
  if ([...key].length !== 1 && !HANDLED.has(key) && key !== 'Tab') return;
  event.preventDefault();
  press(key);
});

el.vim.addEventListener('paste', (event) => {
  event.preventDefault();
  if (editor.mode !== 'insert') {
    editor.message = 'Press i first, then paste';
    renderEditor();
    return;
  }
  insertText(editor, event.clipboardData.getData('text/plain'));
  refresh();
});

el.vim.addEventListener('focus', renderEditor);
el.vim.addEventListener('blur', renderEditor);

el.keys.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (!button) return;
  el.vim.focus({ preventScroll: true });
  press(button.dataset.key);
});

el.checkBtn.addEventListener('click', () => { write(); el.vim.focus({ preventScroll: true }); });
el.next.addEventListener('click', () => { go(1); el.vim.focus({ preventScroll: true }); });
el.select.addEventListener('change', () => load(Number(el.select.value)));

el.hint.addEventListener('click', () => {
  result = check(getText(editor), EXERCISES[index]);
  el.hintText.textContent = nextHint(result, EXERCISES[index].plays);
  el.hintText.hidden = false;
});

el.reset.addEventListener('click', () => {
  if (el.reset.dataset.armed !== 'yes') {
    el.reset.dataset.armed = 'yes';
    el.reset.textContent = 'Click again to erase progress';
    return;
  }
  el.reset.dataset.armed = '';
  el.reset.textContent = 'Reset progress';
  passed.clear();
  writeStore(PROGRESS_KEY, { passed: [] });
  load(0);
});

// Colours the example in the guide and draws a band per indentation level, so the
// nesting can be read at a glance. Without scripts the plain text is still there.
function decorateExample(pre) {
  const lines = pre.textContent.split('\n');
  const depth = (line) => line.match(/^ */)[0].length / 2;
  const bands = (parent, count) => {
    for (let level = 0; level < count; level += 1) parent.append(node('span', `band band-${level % 4}`, '  '));
  };
  pre.replaceChildren();
  lines.forEach((line, i) => {
    const row = node('span', 'code-row');
    if (line.trim() === '') {
      // Carry the bands across a blank line, as an editor does.
      const before = lines.slice(0, i).reverse().find((other) => other.trim() !== '') || '';
      const after = lines.slice(i + 1).find((other) => other.trim() !== '') || '';
      bands(row, Math.floor(Math.min(depth(before), depth(after))));
    } else {
      bands(row, Math.floor(depth(line)));
      const parts = segments(line);
      parts.forEach((part, index) => {
        if (part.cls === 'lead') return;
        const next = parts[index + 1];
        // The gap before a note becomes a faint dashed leader, so the eye can follow it across.
        const gap = next && next.cls === 'tok-comment' ? part.text.match(/ {4,}$/) : null;
        if (gap && part.text.trim() === '') {
          row.append(' ', node('span', 'leader', part.text.slice(2)), ' ');
        } else if (gap) {
          // A plain value such as a path or `|` arrives with the gap still attached.
          row.append(node('span', part.cls, part.text.slice(0, gap.index)), ' ', node('span', 'leader', gap[0].slice(2)), ' ');
        } else {
          row.append(node('span', part.cls, part.text));
        }
      });
    }
    row.append('\n');
    pre.append(row);
  });
}

decorateExample($('example'));

el.guide.open = readStore(GUIDE_KEY, true) !== false;
el.guide.addEventListener('toggle', () => writeStore(GUIDE_KEY, el.guide.open));

// Start on the first exercise not yet passed.
const start = EXERCISES.findIndex((exercise) => !passed.has(exercise.id));
load(start === -1 ? EXERCISES.length - 1 : start);
