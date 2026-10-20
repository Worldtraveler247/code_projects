// LOGHUNT page wiring: levels, answers, progress, the terminal, and the VM lifecycle.
import { Terminal } from './vendor/xterm/xterm.mjs';
import { FitAddon } from './vendor/xterm/addon-fit.mjs';
import { GuestVM, downloadState, IntegrityError } from './vm.js';
import { OutputThrottle } from './output-throttle.js';
import { STATE_SIZE } from './image/state-meta.js';
import { generateArena } from './generator.js';
import { loadLevels } from './levels.js';
import { checkAnswer } from './checker.js';
import { Progress, browserStorage } from './progress.js';
import { renderLevel, renderLevelStrip, renderHints, renderDebrief, hintButtonLabel, formatDuration, levelLabel } from './mission.js';
import { el } from './rich.js';

const $ = (id) => document.getElementById(id);
const ui = {
  terminal: $('terminal'), overlay: $('overlay'), overlayText: $('overlay-text'),
  progress: $('progress'), progressBar: $('progress-bar'), load: $('load-btn'),
  restart: $('restart-btn'), reset: $('reset-btn'), status: $('status'),
  strip: $('level-strip'), level: $('level'), totals: $('totals'), prev: $('prev-btn'), next: $('next-btn'),
  form: $('answer-form'), answer: $('answer'), submit: $('submit-btn'), hint: $('hint-btn'), feedback: $('feedback'),
  progressTable: $('progress-table'), resetProgress: $('reset-progress-btn'),
  historyList: $('history-list'), copy: $('copy-btn'),
};

const BASE = new URL('./', import.meta.url);
const CURRENT_KEY = 'loghunt:current:v1';
const megabytes = (n) => (n / 1e6).toFixed(1);
const storage = browserStorage();

// ---------------------------------------------------------------- terminal + VM

const term = new Terminal({
  fontFamily: "'Fira Code', ui-monospace, Menlo, monospace",
  fontSize: 14,
  cursorBlink: true,
  scrollback: 5000,
  // Binary output (`cat` on a gzip file) is a normal mistake here; don't log every bad escape sequence.
  logLevel: 'off',
  theme: { background: '#0a0613', foreground: '#dcdfe8', cursor: '#4af7ff', selectionBackground: '#4af7ff55' },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(ui.terminal);

const throttle = new OutputThrottle({ write: (bytes) => term.write(bytes) });
let vm = null;

// The arena is the same bytes on every run, so build it once per page load.
let arena = null;
async function seedArena() {
  arena ??= generateArena();
  await vm.seed(arena);
  await startLevelSetup();
}

// A side quest's background writer (live.js). Restarted whenever the level opens or ~/arena is reseeded,
// because the seed script stops it.
async function startLevelSetup() {
  if (!vm || !current?.setup) return;
  try {
    await vm.setup(current.setup);
  } catch (err) {
    setStatus(`${err.message}. Press Reset files to try again.`);
  }
}

function setStatus(text) {
  ui.status.textContent = text;
}

function showOverlay(text, { progress = false, button = null, error = false } = {}) {
  ui.overlay.hidden = false;
  ui.overlayText.textContent = text;
  ui.overlayText.className = error ? 'error' : '';
  ui.progress.hidden = !progress;
  ui.load.hidden = !button;
  if (button) ui.load.textContent = button;
}

function setProgress(received, total) {
  const pct = Math.min(100, Math.round((received / total) * 100));
  ui.progressBar.style.width = `${pct}%`;
  ui.progress.setAttribute('aria-valuenow', String(pct));
  ui.overlayText.textContent = `Downloading the Bastion-7 VM… ${megabytes(received)} / ${megabytes(total)} MB`;
}

let resizeTimer = 0;
term.onResize(({ cols, rows }) => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => vm?.resize(cols, rows).catch(() => {}), 150);
});
new ResizeObserver(() => fit.fit()).observe(ui.terminal);

let historyTimer = 0;
term.onData((data) => {
  vm?.type(data);
  // Enter ran a command: refresh the history panel once bash has appended it.
  if (data.includes('\r')) {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(refreshHistory, 400);
  }
});

function setVmButtons(enabled) {
  ui.restart.disabled = !enabled;
  ui.reset.disabled = !enabled;
}

async function load() {
  ui.load.hidden = true;
  showOverlay('Downloading the Bastion-7 VM…', { progress: true });
  try {
    const state = await downloadState(new URL('image/state.bin.zst', BASE), setProgress);
    showOverlay('Starting the VM…');
    vm = new GuestVM({ state, base: BASE, onOutput: (byte) => throttle.push(byte) });
    await vm.start();
    showOverlay('Unpacking the incident files…');
    await seedArena();
    await vm.resize(term.cols, term.rows);
    ui.overlay.hidden = true;
    setVmButtons(true);
    setStatus('Connected as analyst@bastion-7. No network: the VM is sealed inside this tab.');
    refreshHistory();
    term.focus();
  } catch (err) {
    vm = null;
    const reason = err instanceof IntegrityError
      ? `${err.message}. Reload the page; if it persists, the file on the server is not the published one.`
      : `The VM could not start: ${err.message}`;
    showOverlay(reason, { error: true, button: 'Try again' });
    setStatus('');
  }
}

ui.load.addEventListener('click', load);

ui.restart.addEventListener('click', async () => {
  if (!vm) return;
  setVmButtons(false);
  setStatus('Restarting the terminal from a clean snapshot…');
  throttle.reset();
  term.reset();
  try {
    await vm.restart();
    await seedArena();
    await vm.resize(term.cols, term.rows);
    setStatus('Terminal restarted. Files are back to their starting state.');
    refreshHistory();
    term.focus();
  } catch (err) {
    showOverlay(`Restart failed: ${err.message}`, { error: true, button: 'Try again' });
    vm = null;
  } finally {
    setVmButtons(Boolean(vm));
  }
});

// Put ~/arena back to its starting state without touching the rest of the machine.
ui.reset.addEventListener('click', async () => {
  if (!vm) return;
  setVmButtons(false);
  setStatus('Restoring ~/arena…');
  try {
    await seedArena();
    setStatus('~/arena restored. Run cd ~/arena if your shell was inside a folder that was replaced.');
  } catch (err) {
    setStatus(`Reset failed: ${err.message}. Try Restart terminal.`);
  } finally {
    setVmButtons(Boolean(vm));
  }
});

// ---------------------------------------------------------------- command history + copy

let lastCommands = [];

async function refreshHistory() {
  if (!vm) return;
  try {
    lastCommands = await vm.history(15);
  } catch {
    return; // guest busy (a long command, a fork bomb): keep the last list
  }
  ui.historyList.replaceChildren(...lastCommands.map((cmd) => el(document, 'li', '', cmd)));
  ui.copy.disabled = lastCommands.length === 0;
}

ui.copy.addEventListener('click', async () => {
  const pipeline = lastCommands.at(-1);
  if (!pipeline) return;
  try {
    await navigator.clipboard.writeText(pipeline);
    setStatus(`Copied: ${pipeline}`);
  } catch {
    setStatus('Clipboard blocked by the browser. Select the command in the list and copy it by hand.');
  }
});

// ---------------------------------------------------------------- levels, answers, progress

const progress = new Progress({ storage });
let levels = [];
let current = null;

const fetchJson = async (url) => {
  const res = await fetch(new URL(url, BASE));
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

function levelById(id) {
  return levels.find((l) => l.id === id) ?? levels[0];
}

function renderTotals() {
  const t = progress.totals(levels.map((l) => l.id));
  ui.totals.textContent = `${t.solved}/${t.levels} solved · ${t.score} pts`;
}

function renderProgressTable() {
  const head = el(document, 'tr');
  for (const h of ['Level', 'Tool', 'Status', 'Hints', 'Attempts', 'Time', 'Score']) head.append(el(document, 'th', '', h));
  const rows = levels.map((l) => {
    const s = progress.get(l.id);
    const tr = el(document, 'tr');
    for (const v of [`${levelLabel(l)}: ${l.title}`, l.tool, s.solved ? 'Solved' : s.attempts ? 'In progress' : '—', String(s.hintsUsed), String(s.attempts), s.activeMs ? formatDuration(s.activeMs) : '—', s.solved ? String(s.score) : '—']) {
      tr.append(el(document, 'td', '', v));
    }
    return tr;
  });
  ui.progressTable.replaceChildren(head, ...rows);
}

function refreshChrome() {
  renderLevelStrip(document, ui.strip, levels, progress, current.id, showLevel);
  renderTotals();
  renderProgressTable();
  const state = progress.get(current.id);
  ui.hint.textContent = hintButtonLabel(state);
  ui.hint.disabled = state.hintsUsed >= 3;
  const i = levels.indexOf(current);
  ui.prev.disabled = i <= 0;
  ui.next.disabled = i >= levels.length - 1;
}

function showLevel(id) {
  current = levelById(id);
  progress.open(current.id);
  storage.write(CURRENT_KEY, current.id);
  history.replaceState(null, '', `#${current.id}`);
  renderLevel(document, ui.level, current, progress.get(current.id), {
    onTypeCommand(command) {
      if (!vm) { setStatus('Load the terminal first.'); return; }
      vm.type(`\x15${command}`); // Ctrl+U clears any half-typed line first
      term.focus();
    },
  });
  ui.answer.value = '';
  ui.answer.disabled = false;
  ui.submit.disabled = false;
  ui.feedback.textContent = '';
  ui.feedback.className = 'feedback';
  refreshChrome();
  startLevelSetup();
}

ui.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!current || !ui.answer.value.trim()) return;
  ui.submit.disabled = true;
  const level = current;
  const correct = await checkAnswer(level.id, ui.answer.value, level.challenge.answerHash);
  const wasSolved = progress.get(level.id).solved;
  const state = progress.recordAttempt(level.id, correct);
  ui.submit.disabled = false;
  if (level !== current) return;
  if (correct) {
    ui.feedback.textContent = wasSolved ? 'Correct again.' : `Correct! +${state.score} points. The debrief is below.`;
    ui.feedback.className = 'feedback ok';
    if (!wasSolved) {
      const debrief = renderDebrief(document, level, state);
      ui.level.append(debrief);
      debrief.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  } else {
    ui.feedback.textContent = `Not it (attempt ${state.attempts}). Check the answer format, or take a hint.`;
    ui.feedback.className = 'feedback bad';
  }
  refreshChrome();
});

ui.hint.addEventListener('click', () => {
  if (!current) return;
  const used = progress.useHint(current.id);
  const section = ui.level.querySelector('#hints');
  renderHints(document, section, current, used);
  section.lastElementChild?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  refreshChrome();
});

ui.prev.addEventListener('click', () => showLevel(levels[levels.indexOf(current) - 1].id));
ui.next.addEventListener('click', () => showLevel(levels[levels.indexOf(current) + 1].id));

// Two clicks instead of a confirm() dialog: dialogs block the page and the VM's event loop.
let resetArmed = 0;
ui.resetProgress.addEventListener('click', () => {
  if (!resetArmed) {
    ui.resetProgress.textContent = 'Click again to erase all progress';
    resetArmed = setTimeout(() => { resetArmed = 0; ui.resetProgress.textContent = 'Reset progress'; }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = 0;
  ui.resetProgress.textContent = 'Reset progress';
  progress.reset();
  showLevel(current.id);
  setStatus('Progress reset. Scores, hints, and times are cleared; the VM is untouched.');
});

document.addEventListener('visibilitychange', () => (document.hidden ? progress.pause() : progress.resume()));
window.addEventListener('pagehide', () => progress.pause());

try {
  levels = await loadLevels(fetchJson);
  const fromHash = location.hash.slice(1);
  showLevel(levels.some((l) => l.id === fromHash) ? fromHash : storage.read(CURRENT_KEY) ?? levels[0].id);
} catch (err) {
  ui.level.replaceChildren(el(document, 'p', 'error', `Could not load the levels: ${err.message}`));
}

// ---------------------------------------------------------------- start

// Phones and tablets get the lessons straight away and download the VM only when asked.
const handheld = window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
if (handheld) {
  showOverlay(`The terminal downloads ${megabytes(STATE_SIZE)} MB and works best with a keyboard.`, { button: 'Load the terminal' });
} else {
  load();
}
