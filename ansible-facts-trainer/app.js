import { FACTS, HOST } from './facts.js';
import { SETUP_OUTPUT } from './setup-output.js';
import { CHALLENGES } from './challenges.js';
import { PLAYBOOK_FILE, runPlaybook } from './runner.js';
import { tokenizeYaml } from './highlight.js';
import { execute, PROMPT } from './shell.js';
import { createPager, pagerKey, pagerSearch, pagerView } from './pager.js';
import { colorize } from './terminal-color.js';
import { hostCommand, newHost } from './executor.js';
import { adjustLevel, scaffold, TOP_LEVEL } from './difficulty.js';

const STORAGE_KEY = 'ansible-facts-trainer:solved:v1';
const LEVEL_KEY = 'ansible-facts-trainer:level:v1';
const TIER_NAMES = { 1: 'Fill in the fact', 2: 'Write a task', 3: 'Combine facts', 4: 'Capstone', 5: 'Exam-style scenario' };
const MAX_SCROLLBACK = 4000;
const PAGER_HEIGHT = 24;
const WELCOME = 'Practice terminal on the control node. Type a command and press Enter.\nStart with:  ansible servera -m setup | less        (type help for more)';
const $ = (id) => document.getElementById(id);

function loadSolved() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const known = new Set(CHALLENGES.map((c) => c.id));
    return new Set(Array.isArray(stored) ? stored.filter((id) => known.has(id)) : []);
  } catch {
    // Storage is blocked or holds something unreadable: start with no progress.
    return new Set();
  }
}

function saveSolved(solved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...solved]));
  } catch {
    // Storage is unavailable: progress lasts for this page view only.
  }
}

function loadLevel() {
  try {
    const stored = Number(localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(stored) && stored >= 0 && stored <= TOP_LEVEL ? stored : 0;
  } catch {
    // Storage is blocked: start at the easiest level.
    return 0;
  }
}

function saveLevel(level) {
  try {
    localStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    // Storage is unavailable: the level lasts for this page view only.
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- Editor: a textarea with a colored layer and a line-number gutter beneath it ----

const editor = $('editor');

function updateCursor() {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  $('cursor').textContent = `Ln ${line}, Col ${column}`;
}

function syncScroll() {
  $('highlight').scrollTop = editor.scrollTop;
  $('highlight').scrollLeft = editor.scrollLeft;
  $('gutter').scrollTop = editor.scrollTop;
}

function paintEditor() {
  const text = editor.value;
  const spans = tokenizeYaml(text).map((token) => (token.cls ? el('span', `tok-${token.cls}`, token.text) : document.createTextNode(token.text)));
  // A trailing newline has no height in a <pre>; the extra space keeps the last line.
  $('highlight').replaceChildren(...spans, document.createTextNode(' '));
  const lineCount = text.split('\n').length;
  $('gutter').textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  syncScroll();
  updateCursor();
}

function setEditor(text) {
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.scrollTop = editor.scrollHeight;
  paintEditor();
}

// ---- Challenge flow ----------------------------------------------------------

const solved = loadSolved();
let hostState = newHost();
// Difficulty: each unaided pass removes one more pre-written row from the next starter.
let level = loadLevel();
let current = null; // the scaffold for the challenge on screen
let revealed = false; // whether Show answer was used on this challenge
let index = Math.max(0, CHALLENGES.findIndex((c) => !solved.has(c.id)));

function renderStatus() {
  const challenge = CHALLENGES[index];
  $('tier').textContent = challenge.tier >= 4 ? TIER_NAMES[challenge.tier] : `Tier ${challenge.tier} · ${TIER_NAMES[challenge.tier]}`;
  $('jump').value = String(index);
  for (const option of $('jump').options) {
    const c = CHALLENGES[Number(option.value)];
    option.textContent = `${solved.has(c.id) ? '✔ ' : ''}${Number(option.value) + 1}. ${c.title ?? c.prompt.slice(0, 46)}${c.title || c.prompt.length <= 46 ? '' : '…'}`;
  }
  $('progress').textContent = `Challenge ${index + 1} of ${CHALLENGES.length} · ${solved.size} solved${solved.has(challenge.id) ? ' · this one is solved' : ''} · difficulty ${level} of ${TOP_LEVEL}`;
}

function showChallenge() {
  const challenge = CHALLENGES[index];
  current = scaffold(challenge, level);
  revealed = false;
  const notes = [];
  if (current.removed.length) {
    notes.push(`Difficulty ${current.level}: ${current.removed.length === 1 ? 'one starter line is' : `${current.removed.length} starter lines are`} no longer written for you. Add ${current.removed.length === 1 ? 'it' : 'them'} yourself: ${current.removed.join('; ')}.`);
  }
  if (current.placeholderGone) notes.push('There is no FACT_GOES_HERE to replace at this level. Write the task so that it prints that fact.');
  $('prompt').textContent = [challenge.prompt, ...notes].join('\n\n');
  setEditor(current.starter);
  hostState = newHost();
  $('coach').textContent = '';
  $('coach').className = 'coach';
  $('hint-text').hidden = true;
  $('answer').hidden = true;
  $('prev').disabled = index === 0;
  $('next').disabled = index === CHALLENGES.length - 1;
  renderStatus();
}

// Judge the playbook in the editor, update the coach line, and return the terminal text.
function runCurrentPlaybook() {
  const challenge = CHALLENGES[index];
  const { verdict, terminal, state } = runPlaybook(editor.value, challenge, FACTS, HOST);
  // Each run starts from a clean host; this is the state it left, for inspection afterwards.
  hostState = state ?? newHost();
  const checks = (verdict.checks ?? []).map((check) => `${check.ok ? '✔' : '✘'} ${check.label}`);
  const lines = verdict.ok ? [`✔ ${verdict.message}`, verdict.note, ...checks] : [`✘ ${verdict.code}`, verdict.message, ...checks];
  $('coach').className = `coach ${verdict.ok ? 'pass' : 'fail'}`;
  $('coach').textContent = lines.filter(Boolean).join('\n');
  if (verdict.ok) {
    const raised = adjustLevel(level, { type: 'pass', firstTime: !solved.has(challenge.id), revealed });
    if (raised > level) {
      level = raised;
      saveLevel(level);
      $('coach').textContent += `\nDifficulty is now ${level} of ${TOP_LEVEL}: the next challenge starts with one more line for you to write.`;
    }
    solved.add(challenge.id);
    saveSolved(solved);
    renderStatus();
  }
  return terminal;
}

function go(step) {
  const target = index + step;
  if (target < 0 || target >= CHALLENGES.length) return;
  index = target;
  showChallenge();
  editor.focus();
}

// ---- Terminal ------------------------------------------------------------------

const screen = $('screen');
const command = $('command');
const shellEnv = {
  setupOutput: SETUP_OUTPUT,
  host: HOST,
  fqdn: FACTS.fqdn,
  playbookFile: PLAYBOOK_FILE,
  readPlaybook: () => editor.value,
  runPlaybook: runCurrentPlaybook,
  hostCommand: (command) => hostCommand(hostState, command),
};
let scrollback = WELCOME.split('\n');
const history = [];
let historyAt = 0;
let pager = null; // { state, searching }

function drawTerminal() {
  if (pager) {
    const view = pagerView(pager.state);
    screen.textContent = view.rows.join('\n');
    $('ps1').textContent = pager.searching ? '/' : view.status;
    command.readOnly = !pager.searching;
  } else {
    // Scrollback lines are plain strings, or lists of colored segments. All text nodes.
    const nodes = [];
    scrollback.forEach((line, i) => {
      if (typeof line === 'string') nodes.push(line);
      else for (const segment of line) nodes.push(segment.cls ? el('span', `t-${segment.cls}`, segment.text) : segment.text);
      if (i < scrollback.length - 1) nodes.push('\n');
    });
    screen.replaceChildren(...nodes);
    $('ps1').textContent = PROMPT;
    command.readOnly = false;
  }
  $('pager-keys').hidden = !pager;
  // The pager starts at the top of its screen; the shell follows the newest output.
  $('scroll').scrollTop = pager ? 0 : $('scroll').scrollHeight;
  $('scroll').scrollLeft = 0;
  $('terminal-window').classList.toggle('paging', Boolean(pager));
}

function print(text, colored = false) {
  scrollback.push(...(colored ? colorize(text) : text.split('\n')));
  if (scrollback.length > MAX_SCROLLBACK) scrollback = scrollback.slice(-MAX_SCROLLBACK);
}

function submit(line) {
  print(PROMPT + line);
  if (line.trim() !== '') {
    history.push(line);
    historyAt = history.length;
  }
  const result = execute(line, shellEnv);
  if (result.type === 'clear') scrollback = [];
  else if (result.type === 'text' && result.text !== '') print(result.text, result.colored);
  else if (result.type === 'pager') pager = { state: createPager(result.lines, PAGER_HEIGHT), searching: false };
  drawTerminal();
}

function pagerPress(key) {
  if (!pager) return;
  const { state, quit } = pagerKey(pager.state, key);
  pager = quit ? null : { state, searching: false };
  drawTerminal();
}

command.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (pager && !pager.searching) {
    // In the pager, keys drive less; nothing is typed.
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === '/') {
      pager.searching = true;
      command.value = '';
      drawTerminal();
    } else {
      pagerPress(event.key);
    }
    return;
  }
  if (pager && pager.searching) {
    if (event.key === 'Enter') {
      event.preventDefault();
      pager = { state: command.value === '' ? pager.state : pagerSearch(pager.state, command.value), searching: false };
      command.value = '';
      drawTerminal();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      pager.searching = false;
      command.value = '';
      drawTerminal();
    }
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const line = command.value;
    command.value = '';
    submit(line);
  } else if (event.key === 'ArrowUp' && history.length) {
    event.preventDefault();
    historyAt = Math.max(0, historyAt - 1);
    command.value = history[historyAt];
  } else if (event.key === 'ArrowDown' && history.length) {
    event.preventDefault();
    historyAt = Math.min(history.length, historyAt + 1);
    command.value = history[historyAt] ?? '';
  }
});

$('terminal-window').addEventListener('click', (event) => {
  // Clicking anywhere in the terminal focuses the prompt, unless text is being selected.
  if (event.target.closest('button') || String(window.getSelection())) return;
  command.focus({ preventScroll: true });
});
for (const button of document.querySelectorAll('#pager-keys button')) {
  button.addEventListener('click', () => { pagerPress(button.dataset.key); command.focus({ preventScroll: true }); });
}
for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => {
    if (pager) pagerPress('q');
    submit(button.dataset.command);
    command.focus({ preventScroll: true });
  });
}

// ---- Wiring ------------------------------------------------------------------

$('run').addEventListener('click', () => {
  if (pager) pagerPress('q');
  submit(`ansible-playbook ${PLAYBOOK_FILE}`);
});
// The jump menu: every challenge, grouped by tier.
for (const tier of [1, 2, 3, 4, 5]) {
  const group = document.createElement('optgroup');
  group.label = tier >= 4 ? TIER_NAMES[tier] : `Tier ${tier}: ${TIER_NAMES[tier]}`;
  CHALLENGES.forEach((challenge, i) => {
    if (challenge.tier !== tier) return;
    const option = document.createElement('option');
    option.value = String(i);
    group.append(option);
  });
  $('jump').append(group);
}
$('jump').addEventListener('change', () => go(Number($('jump').value) - index));
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('hint').addEventListener('click', () => {
  $('hint-text').textContent = `Hint: ${CHALLENGES[index].hint}`;
  $('hint-text').hidden = false;
});
$('reveal').addEventListener('click', () => {
  $('answer').textContent = `One correct playbook:\n\n${CHALLENGES[index].solution}`;
  $('answer').hidden = false;
  if (!revealed) {
    // Needing the answer eases the next challenge by one line.
    revealed = true;
    level = adjustLevel(level, { type: 'reveal' });
    saveLevel(level);
    renderStatus();
  }
});
$('reset-file').addEventListener('click', () => {
  setEditor(current.starter);
  editor.focus();
});
$('reset').addEventListener('click', () => {
  if (!window.confirm('Clear all saved progress for this trainer?')) return;
  solved.clear();
  saveSolved(solved);
  level = adjustLevel(level, { type: 'reset' });
  saveLevel(level);
  index = 0;
  showChallenge();
});

editor.addEventListener('input', paintEditor);
editor.addEventListener('scroll', syncScroll);
for (const type of ['keyup', 'click', 'select', 'focus']) editor.addEventListener(type, updateCursor);
editor.addEventListener('keydown', (event) => {
  const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $('run').click();
  } else if (event.key === 'Tab' && plain) {
    event.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    paintEditor();
  } else if (event.key === 'Enter' && plain && !event.isComposing) {
    // Carry the current line's indentation to the new line, as a code editor does.
    event.preventDefault();
    const lineStart = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    const indent = /^ */.exec(editor.value.slice(lineStart, editor.selectionStart))[0];
    editor.setRangeText(`\n${indent}`, editor.selectionStart, editor.selectionEnd, 'end');
    paintEditor();
  }
});

$('file-tab').textContent = PLAYBOOK_FILE;
drawTerminal();
showChallenge();
