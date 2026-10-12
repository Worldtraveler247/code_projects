// Page wiring: the board of modules, the five rounds of a drill, and the editor.
// The editor, checker and syntax colours are the Playbook Trainer's, imported as they are.

import { createEditor, getText, handleKey, insertText } from '../ansible-playbook-trainer/editor.js';
import { check } from '../ansible-playbook-trainer/checker.js';
import { describe, nextHint } from '../ansible-playbook-trainer/model.js';
import { charClasses, valueClass } from '../ansible-playbook-trainer/highlight.js';
import { AREAS, MODULES } from './modules.js';
import {
  OUTCOMES, PAR_SECONDS, REVEAL_COST, ROUNDS, better, clock, collectionOf, collectionQuestion, docSummary,
  faultCase, labCommands, modelLines, predictQuestion, requiredCorrect, requiredQuestion, reverseFqcn,
  reversePlays, shortName, stars, starterText, writePlays,
} from './game.js';

const PROGRESS_KEY = 'ansible-module-drill:progress:v1';
const MIN_ROWS = 14;
const HANDLED = new Set(['Enter', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const MARKS = { ok: '✓', bad: '✗', warn: '!', none: ' ' };
const HEADINGS = { ok: 'Correct', bad: 'Needs fixing', warn: 'Right place, wrong content', none: 'Not checked' };
const MAX_STARS = 3;

const $ = (id) => document.getElementById(id);
const el = {
  board: $('board'), drill: $('drill'), areas: $('areas'), score: $('score'), resume: $('resume-btn'), reset: $('reset-btn'),
  back: $('back-btn'), modTitle: $('mod-title'), timer: $('timer'), misses: $('misses'), stepper: $('stepper'), given: $('given'),
  quiz: $('panel-quiz'), quizTitle: $('quiz-title'), quizPrompt: $('quiz-prompt'), quizTerm: $('quiz-term'),
  quizShown: $('quiz-shown'), quizPicks: $('quiz-picks'), quizCheck: $('quiz-check'), quizOutput: $('quiz-output'),
  quizFeedback: $('quiz-feedback'), quizNext: $('quiz-next'),
  editorPanel: $('panel-editor'), editorTitle: $('editor-title'), goal: $('goal'), briefTitle: $('brief-title'), brief: $('brief'),
  checkBtn: $('check-btn'), hint: $('hint-btn'), reveal: $('reveal-btn'), editorNext: $('editor-next'), hintText: $('hint-text'),
  doc: $('doc'), docCommand: $('doc-command'), docList: $('doc-list'),
  vim: $('vim'), rows: $('vim-rows'), mode: $('vim-mode'), pos: $('vim-pos'), why: $('why'), whyHead: $('why-head'),
  summary: $('summary'), result: $('result'), keys: $('key-row'),
  done: $('panel-done'), doneStars: $('done-stars'), doneLine: $('done-line'), doneRule: $('done-rule'),
  doneInsight: $('done-insight'), doneReverse: $('done-reverse'), doneLab: $('done-lab'),
  nextMod: $('next-mod-btn'), again: $('again-btn'), toBoard: $('board-btn'),
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
    // Private windows may refuse storage; the drill still works for this visit.
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Only well-formed results for modules that still exist are kept from storage.
const saved = readStore(PROGRESS_KEY, {});
const best = {};
for (const mod of MODULES) {
  const entry = saved && saved.best && saved.best[mod.id];
  if (entry && Number.isInteger(entry.stars) && entry.stars >= 1 && entry.stars <= MAX_STARS && Number.isFinite(entry.seconds)) {
    best[mod.id] = { stars: entry.stars, seconds: entry.seconds, misses: Number(entry.misses) || 0 };
  }
}

let drill = null;
let ticker = null;
let editor = createEditor();
let editorRound = null;
let result = null;
let quizKeys = null;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : (word.endsWith('s') ? 'es' : 's')}`;

function starSpans(parent, count) {
  parent.replaceChildren();
  for (let i = 0; i < MAX_STARS; i += 1) parent.append(node('span', i < count ? 'on' : '', i < count ? '★' : '☆'));
}

// ---- Board ----

function nextUp() {
  const fresh = MODULES.find((mod) => !best[mod.id]);
  if (fresh) return { mod: fresh, label: Object.keys(best).length ? `Next up: ${shortName(fresh.fqcn)}` : `Start with ${shortName(fresh.fqcn)}` };
  const weakest = MODULES.slice().sort((a, b) => best[a.id].stars - best[b.id].stars || best[b.id].seconds - best[a.id].seconds)[0];
  return { mod: weakest, label: `Replay your weakest: ${shortName(weakest.fqcn)}` };
}

function renderBoard() {
  const earned = Object.values(best).reduce((sum, entry) => sum + entry.stars, 0);
  el.score.textContent = `★ ${earned} of ${MODULES.length * MAX_STARS} stars · ${Object.keys(best).length} of ${MODULES.length} modules drilled`;
  el.resume.textContent = `${nextUp().label} →`;
  el.areas.replaceChildren();
  AREAS.forEach((area) => {
    const section = node('section', 'area');
    section.append(node('h2', '', area.title));
    const cards = node('div', 'cards');
    MODULES.filter((mod) => mod.area === area.id).forEach((mod) => {
      const entry = best[mod.id];
      const card = node('button', `mod-card${entry ? ' done' : ''}`);
      card.type = 'button';
      card.dataset.module = mod.id;
      card.append(node('span', 'mod-name', shortName(mod.fqcn)), node('span', 'mod-coll', collectionOf(mod.fqcn)));
      const starRow = node('span', 'mod-stars');
      starSpans(starRow, entry ? entry.stars : 0);
      card.append(starRow, node('span', 'mod-best', entry ? `best ${clock(entry.seconds)} · ${plural(entry.misses, 'miss')}` : 'not drilled yet'));
      card.setAttribute('aria-label', `${mod.fqcn}, ${entry ? `${entry.stars} of 3 stars` : 'not drilled yet'}`);
      cards.append(card);
    });
    section.append(cards);
    el.areas.append(section);
  });
}

function showBoard() {
  stopClock();
  drill = null;
  quizKeys = null;
  el.drill.hidden = true;
  el.board.hidden = false;
  history.replaceState(null, '', location.pathname + location.search);
  renderBoard();
}

// ---- Drill frame ----

function stopClock() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

const seconds = () => (drill.finished !== null ? drill.finished : (Date.now() - drill.started) / 1000);

function renderMeters() {
  const elapsed = seconds();
  el.timer.textContent = `⏱ ${clock(elapsed)} / ${clock(PAR_SECONDS)}`;
  el.timer.className = elapsed > PAR_SECONDS ? 'over' : '';
  el.misses.textContent = plural(drill.misses, 'miss');
  el.misses.className = drill.misses ? 'some' : '';
}

function renderStepper() {
  el.stepper.replaceChildren();
  ROUNDS.forEach((name, i) => {
    const item = node('li', i < drill.round ? 'past' : i === drill.round ? 'now' : '', `${i + 1}. ${name}`);
    if (i === drill.round) item.setAttribute('aria-current', 'step');
    el.stepper.append(item);
  });
}

function miss(count = 1) {
  drill.misses += count;
  renderMeters();
}

function startDrill(mod) {
  stopClock();
  drill = { mod, round: 0, step: 0, misses: 0, started: Date.now(), finished: null };
  ticker = setInterval(renderMeters, 1000);
  el.board.hidden = true;
  el.drill.hidden = false;
  el.modTitle.textContent = mod.fqcn;
  el.given.textContent = `Starting state: ${mod.given}`;
  el.given.hidden = false;
  history.replaceState(null, '', `#${mod.id}`);
  showStep();
  window.scrollTo(0, 0);
}

function advance() {
  const steps = [2, 1, drill.mod.predict.length, 1, drill.mod.faults.length];
  drill.step += 1;
  if (drill.step >= steps[drill.round]) {
    drill.round += 1;
    drill.step = 0;
  }
  if (drill.round >= ROUNDS.length) finish();
  else showStep();
}

function showPanel(panel) {
  for (const candidate of [el.quiz, el.editorPanel, el.done]) candidate.hidden = candidate !== panel;
}

function showStep() {
  renderStepper();
  renderMeters();
  const { mod, round, step } = drill;
  if (round === 0) lookupStep(mod, step);
  else if (round === 1) editorStep(mod, 'write');
  else if (round === 2) predictStep(mod, step);
  else if (round === 3) editorStep(mod, 'reverse');
  else breakStep(mod, step);
}

// ---- Quiz rounds (look up, predict, break) ----

function fillTerm(target, lines) {
  target.replaceChildren();
  lines.forEach((line, i) => {
    if (i > 0) target.append('\n');
    target.append(line.cls ? node('span', line.cls, line.text) : line.text);
  });
  target.hidden = lines.length === 0;
}

// One question. Single choice answers on the first click; multiple choice waits for Check.
function quiz({ title, prompt, term = [], shown = [], picks, layout = '', multi = false, output = [], why, isCorrect }) {
  showPanel(el.quiz);
  el.quizTitle.textContent = title;
  el.quizPrompt.textContent = prompt;
  fillTerm(el.quizTerm, term);
  fillTerm(el.quizShown, shown.map((text) => ({ text })));
  fillTerm(el.quizOutput, []);
  el.quizFeedback.textContent = '';
  el.quizFeedback.className = 'feedback';
  el.quizNext.hidden = true;
  el.quizCheck.hidden = !multi;
  el.quizPicks.className = layout;
  el.quizPicks.replaceChildren();

  const buttons = picks.map((pick) => {
    const button = node('button', 'pick', pick.label);
    button.type = 'button';
    if (multi) button.setAttribute('aria-pressed', 'false');
    el.quizPicks.append(button);
    return button;
  });
  let answered = false;

  const settle = (correct) => {
    answered = true;
    buttons.forEach((button, i) => {
      button.disabled = true;
      const chosen = button.classList.contains('sel');
      button.classList.remove('sel');
      if (picks[i].correct) button.classList.add('right');
      else if (chosen) button.classList.add('wrong');
    });
    el.quizCheck.hidden = true;
    if (!correct) miss();
    fillTerm(el.quizOutput, output);
    el.quizFeedback.className = `feedback ${correct ? 'pass' : 'fail'}`;
    el.quizFeedback.replaceChildren(node('strong', '', correct ? 'Correct. ' : 'Not this time. '), why);
    el.quizNext.hidden = false;
    el.quizNext.focus({ preventScroll: true });
    el.quizNext.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i) => {
    if (answered || !buttons[i]) return;
    if (multi) {
      const on = buttons[i].classList.toggle('sel');
      buttons[i].setAttribute('aria-pressed', String(on));
      return;
    }
    buttons[i].classList.add('sel');
    settle(picks[i].correct);
  };
  buttons.forEach((button, i) => button.addEventListener('click', () => choose(i)));
  el.quizCheck.onclick = () => settle(isCorrect(buttons.map((button, i) => (button.classList.contains('sel') ? i : -1)).filter((i) => i >= 0)));
  // Digits pick an answer, so a round can be played from the keyboard.
  quizKeys = (key) => {
    if (/^[1-9]$/.test(key)) choose(Number(key) - 1);
    else if (key === 'Enter' && !answered && multi) el.quizCheck.click();
  };
}

function lookupStep(mod, step) {
  const title = `Round 1 · Look up · ${step + 1} of 2`;
  if (step === 0) {
    const question = collectionQuestion(mod);
    quiz({
      title,
      prompt: question.prompt,
      term: [{ cls: 'prompt', text: `$ ansible-doc -l | grep ${shortName(mod.fqcn)}` }],
      picks: question.choices,
      why: question.why,
    });
    return;
  }
  const question = requiredQuestion(mod);
  quiz({
    title,
    prompt: question.prompt,
    term: [{ cls: 'prompt', text: `$ ansible-doc -s ${mod.fqcn}` }],
    picks: question.options.map((option) => ({ label: option.name, correct: option.required })),
    layout: 'row',
    multi: true,
    isCorrect: (ticked) => requiredCorrect(question, ticked.map((i) => question.options[i].name)),
    why: question.why,
  });
}

function predictStep(mod, step) {
  const question = predictQuestion(mod, step);
  quiz({
    title: `Round 3 · Predict · ${step + 1} of ${mod.predict.length}`,
    prompt: `You run ${question.label}. What does Ansible report for the task?`,
    term: [{ cls: 'prompt', text: `$ ${question.command}` }],
    picks: OUTCOMES.map((outcome) => ({ label: outcome, correct: outcome === question.answer })),
    layout: 'row',
    output: question.output.map((text, i) => ({ text, cls: i === 1 ? question.answer : '' })),
    why: question.why,
  });
}

function breakStep(mod, step) {
  const fault = faultCase(mod, mod.faults[step]);
  quiz({
    title: `Round 5 · Break · ${step + 1} of ${mod.faults.length}`,
    prompt: fault.prompt,
    term: [{ cls: 'prompt', text: '$ ansible-playbook drill.yml' }, { cls: 'fatal', text: fault.error }],
    shown: fault.shown || [],
    picks: fault.picks,
    layout: fault.shown ? 'row' : 'code',
    why: fault.why,
  });
}

// ---- Editor rounds (write, reverse) ----

function renderBrief(plays) {
  el.brief.replaceChildren();
  const rows = describe(plays);
  rows.slice(rows.findIndex((row) => row.label === 'Task 1')).forEach((row) => {
    const item = node('li', row.heading ? 'brief-head' : '');
    // One band per two spaces of the line's place in the file, as in the Playbook Trainer.
    for (let level = 0; level < row.indent / 2; level += 1) item.append(node('span', `band band-${level % 4}`));
    const text = node('span', 'brief-text');
    if (row.dash) text.append(node('span', 'tok-dash', '- '));
    const name = row.heading ? 'The task' : row.label;
    text.append(node('span', row.key ? 'tok-key' : 'brief-label', row.value === undefined && !row.lines ? name : `${name}: `));
    if (row.value !== undefined) {
      const cls = row.module ? 'tok-key' : valueClass(row.value.includes('{{') ? `"${row.value}"` : row.value);
      text.append(node('code', cls, row.value));
    }
    if (row.lines) text.append(node('pre', '', row.lines.join('\n')));
    item.append(text);
    el.brief.append(item);
  });
}

function renderDoc(fqcn) {
  el.doc.open = false;
  el.docCommand.textContent = `$ ansible-doc -s ${fqcn}   (free to open)`;
  el.docList.replaceChildren();
  docSummary(fqcn).forEach((option) => {
    const item = node('li');
    item.append(node('span', option.required ? 'req' : 'opt', `${option.required ? '=' : '-'} ${option.name}`), node('span', 'detail', `  ${option.detail}`));
    el.docList.append(item);
  });
}

function editorStep(mod, kind) {
  showPanel(el.editorPanel);
  const plays = kind === 'write' ? writePlays(mod) : reversePlays(mod);
  editorRound = { plays, passed: false };
  el.hintText.hidden = true;
  el.result.textContent = '';
  el.result.className = 'feedback';
  el.editorNext.hidden = true;
  for (const button of [el.checkBtn, el.hint, el.reveal]) button.disabled = false;

  if (kind === 'write') {
    el.editorTitle.textContent = 'Round 2 · Write the task';
    el.goal.textContent = mod.goal;
    el.briefTitle.textContent = 'The play header is already in the file. Type exactly this task under tasks. Each colored bar is two spaces of indentation.';
    renderBrief(plays);
    el.brief.hidden = false;
    editor = createEditor(starterText(mod));
    editor.row = editor.lines.length - 1;
    editor.col = editor.lines[editor.row].length;
    renderDoc(mod.fqcn);
  } else {
    const count = Object.keys(mod.reverse.args).length;
    el.editorTitle.textContent = mod.reverseKind === 'vary' ? 'Round 4 · Change it' : 'Round 4 · Reverse it';
    el.goal.textContent = mod.reverseKind === 'vary' ? `This module changes nothing, so there is nothing to undo. ${mod.reverse.goal}` : mod.reverse.goal;
    el.briefTitle.textContent = `Your task is in the editor. Edit it: keep the task name, and finish with ${plural(count, 'module argument')}. Delete a line you no longer need with dd. The option you need is in the documentation panel below.`;
    el.brief.hidden = true;
    const lines = modelLines(writePlays(mod));
    editor = createEditor(lines.join('\n'));
    editor.row = lines.indexOf('  tasks:') + 1;
    editor.col = lines[editor.row].search(/\S/);
    renderDoc(reverseFqcn(mod));
  }
  refresh();
}

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
      line.append(node('span', `cursor ${editor.mode} ${i < text.length ? classes[i] : ''}`, i < text.length ? glyph(i) : ' '));
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
  const column = node('div', 'cursor-column');
  column.style.setProperty('--col', String(editor.col));
  column.style.setProperty('--lines', String(editor.lines.length));
  if (editor.mode !== 'command') el.rows.append(column);
  const current = el.rows.children[editor.row];
  if (current && document.activeElement === el.vim) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  if (editor.mode === 'command') el.mode.textContent = `:${editor.command}█`;
  else if (editor.message) el.mode.textContent = editor.message;
  else if (editor.mode === 'insert') el.mode.textContent = '-- INSERT --';
  else el.mode.textContent = editor.pending || 'NORMAL  (A to type, :w to check)';
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
    el.why.textContent = verdict.why || 'An empty line, ready for the task. Press A and start with a dash.';
  }
  const parts = [`${result.ok} correct`];
  if (result.bad) parts.push(`${result.bad} to fix`);
  if (result.warn) parts.push(`${result.warn} to review`);
  parts.push(`${result.missing.length} still to add`);
  el.summary.textContent = parts.join(' · ');
}

function refresh() {
  result = check(getText(editor), { plays: editorRound.plays });
  renderEditor();
  renderWhy();
}

function pass(message) {
  editorRound.passed = true;
  el.result.className = 'feedback pass';
  el.result.textContent = message;
  el.hintText.hidden = true;
  for (const button of [el.checkBtn, el.hint, el.reveal]) button.disabled = true;
  el.editorNext.hidden = false;
  editor.message = '"drill.yml" written, all checks passed';
}

function write() {
  if (!editorRound || editorRound.passed) return;
  result = check(getText(editor), { plays: editorRound.plays });
  if (result.passed) {
    const note = drill.round === 3 ? ` ${drill.mod.reverseNote}` : '';
    pass(`Passed.${note} Type :n or press Continue.`);
  } else {
    miss();
    const problems = [];
    if (result.bad) problems.push(`${plural(result.bad, 'line')} in the wrong place (red)`);
    if (result.warn) problems.push(`${plural(result.warn, 'line')} that the task should not have, or with the wrong value (amber)`);
    if (result.missing.length) problems.push(`${plural(result.missing.length, 'item')} still missing`);
    if (problems.length === 0 && result.parseError) problems.push(`YAML could not read the file: ${result.parseError}`);
    el.result.className = 'feedback fail';
    el.result.textContent = `Not yet: ${problems.join('; ')}. Move the cursor to a marked line to see why.`;
    editor.message = 'Not yet: see the notes above the editor';
  }
  refresh();
}

function act(event) {
  if (!event) return;
  if (event.type === 'write') write();
  else if (event.type === 'next' && editorRound.passed) advance();
  else if (event.type === 'next') { editor.message = 'Pass the check first (:w)'; renderEditor(); }
  else if (event.type === 'help') { el.doc.open = true; el.doc.scrollIntoView({ block: 'nearest' }); }
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
el.editorNext.addEventListener('click', advance);

el.hint.addEventListener('click', () => {
  miss();
  result = check(getText(editor), { plays: editorRound.plays });
  el.hintText.textContent = nextHint(result, editorRound.plays);
  el.hintText.hidden = false;
});

el.reveal.addEventListener('click', () => {
  miss(REVEAL_COST);
  editor = createEditor(modelLines(editorRound.plays).join('\n'));
  result = check(getText(editor), { plays: editorRound.plays });
  pass('This is the model answer. Read each line, then press Continue. Drill the module again later to earn the stars.');
  refresh();
});

// ---- Finish ----

function finish() {
  stopClock();
  drill.finished = (Date.now() - drill.started) / 1000;
  const { mod, misses } = drill;
  const earned = stars(misses, drill.finished);
  best[mod.id] = better(best[mod.id], { stars: earned, seconds: Math.round(drill.finished), misses });
  writeStore(PROGRESS_KEY, { best });
  quizKeys = null;

  drill.round = ROUNDS.length;
  renderStepper();
  renderMeters();
  showPanel(el.done);
  el.given.hidden = true;
  starSpans(el.doneStars, earned);
  el.doneLine.textContent = `${earned} of 3 stars for ${shortName(mod.fqcn)}: finished in ${clock(drill.finished)} with ${plural(misses, 'miss')}.`;
  if (earned === MAX_STARS) el.doneRule.textContent = 'No misses, inside the ten-minute target. That is exam pace.';
  else if (misses === 0) el.doneRule.textContent = `No misses, but over the ${clock(PAR_SECONDS)} target. Drill it again for speed.`;
  else el.doneRule.textContent = `Three stars need no misses inside ${clock(PAR_SECONDS)}. Drill it again while it is fresh.`;
  el.doneInsight.textContent = mod.insight;
  el.doneReverse.textContent = mod.reverseNote;
  fillTerm(el.doneLab, labCommands(mod).map((text) => ({ text: `$ ${text}`, cls: 'prompt' })));
  el.nextMod.textContent = `${nextUp().label} →`;
  el.nextMod.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---- Page events ----

el.areas.addEventListener('click', (event) => {
  const card = event.target.closest('button[data-module]');
  if (card) startDrill(MODULES.find((mod) => mod.id === card.dataset.module));
});
el.resume.addEventListener('click', () => startDrill(nextUp().mod));
el.back.addEventListener('click', showBoard);
el.toBoard.addEventListener('click', showBoard);
el.again.addEventListener('click', () => startDrill(drill.mod));
el.nextMod.addEventListener('click', () => startDrill(nextUp().mod));
el.quizNext.addEventListener('click', advance);

document.addEventListener('keydown', (event) => {
  if (!quizKeys || el.quiz.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLButtonElement && event.key === 'Enter') return;
  quizKeys(event.key);
});

el.reset.addEventListener('click', () => {
  if (el.reset.dataset.armed !== 'yes') {
    el.reset.dataset.armed = 'yes';
    el.reset.textContent = 'Click again to erase progress';
    return;
  }
  el.reset.dataset.armed = '';
  el.reset.textContent = 'Reset progress';
  for (const id of Object.keys(best)) delete best[id];
  writeStore(PROGRESS_KEY, { best });
  renderBoard();
});

// A link such as index.html#user opens that module's drill directly.
const linked = MODULES.find((mod) => mod.id === location.hash.slice(1));
if (linked) startDrill(linked);
else renderBoard();
