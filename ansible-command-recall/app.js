import { CARDS, DECKS } from './cards.js';
import { check } from './checker.js';
import { newRound, answer, isOver, record, known } from './game.js';

const STATS_KEY = 'ansible-command-recall:stats';
const BY_ID = new Map(CARDS.map((card) => [card.id, card]));

const $ = (id) => document.getElementById(id);
const el = {
  board: $('board'), play: $('play'), done: $('done'),
  score: $('score'), decks: $('decks'), listBody: $('list-body'), reset: $('reset-btn'),
  deckChip: $('deck-chip'), counter: $('counter'), quit: $('quit-btn'),
  question: $('question'), shown: $('shown'), typed: $('typed'), hint: $('hint'),
  check: $('check-btn'), reveal: $('reveal-btn'),
  feedback: $('feedback'), verdict: $('verdict'), reason: $('reason'), answer: $('answer'),
  why: $('why'), flags: $('flags'), next: $('next-btn'), override: $('override-btn'),
  doneSummary: $('done-summary'), doneMissed: $('done-missed'), again: $('again-btn'), toBoard: $('board-btn'),
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
    // Private windows may refuse storage; the round still works for this visit.
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Keep only well-formed entries for cards that still exist; anything else in storage is ignored.
function loadStats() {
  const raw = readStore(STATS_KEY, {});
  const clean = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, entry] of Object.entries(raw)) {
      const counts = [entry?.right, entry?.wrong, entry?.streak];
      if (BY_ID.has(id) && counts.every((n) => Number.isInteger(n) && n >= 0)) {
        clean[id] = { right: entry.right, wrong: entry.wrong, streak: entry.streak };
      }
    }
  }
  return clean;
}

let stats = loadStats();
let deck = 'all';
let round = null;
let answered = false;

function deckName(id) {
  return id === 'all' ? 'All cards' : DECKS.find((d) => d.id === id).name;
}

function show(view) {
  for (const section of [el.board, el.play, el.done]) section.hidden = section !== view;
  window.scrollTo(0, 0);
}

// ---- Board ----

function deckButton(id, cards) {
  const done = cards.filter((card) => known(stats, card.id)).length;
  const button = node('button', id === 'all' ? 'deck all' : 'deck');
  button.type = 'button';
  button.append(node('span', 'deck-name', deckName(id)), node('span', 'deck-count', `${done} of ${cards.length} known`));
  const bar = node('span', 'bar');
  const fill = node('span');
  fill.style.width = `${cards.length ? (100 * done) / cards.length : 0}%`;
  bar.append(fill);
  button.append(bar);
  button.addEventListener('click', () => start(id));
  return button;
}

function renderBoard() {
  const knownCount = CARDS.filter((card) => known(stats, card.id)).length;
  el.score.textContent = `${knownCount} / ${CARDS.length} known`;
  el.decks.replaceChildren(
    deckButton('all', CARDS),
    ...DECKS.map((d) => deckButton(d.id, CARDS.filter((card) => card.deck === d.id))),
  );
  el.listBody.replaceChildren();
  for (const d of DECKS) {
    el.listBody.append(node('h3', null, d.name));
    for (const card of CARDS.filter((c) => c.deck === d.id)) {
      const item = node('div', 'qa');
      const q = node('p', null, card.q);
      if (known(stats, card.id)) q.append(node('span', 'known', '✓ known'));
      item.append(q, node('pre', 'answer', card.answer));
      el.listBody.append(item);
    }
  }
}

// ---- Play ----

function start(id) {
  deck = id;
  round = newRound(CARDS, deck);
  show(el.play);
  ask();
}

function ask() {
  const card = BY_ID.get(round.queue[0]);
  answered = false;
  el.deckChip.textContent = deckName(card.deck);
  const done = round.total - round.queue.length;
  el.counter.textContent = `${done} of ${round.total} done${round.missed.has(card.id) ? ' · second try' : ''}`;
  el.question.textContent = card.q;
  el.shown.hidden = !card.show;
  if (card.show) el.shown.firstElementChild.textContent = card.show;
  const multi = card.kind === 'ini' && card.answer.includes('\n');
  el.typed.rows = multi ? Math.min(card.answer.split('\n').length + 1, 14) : 2;
  el.typed.value = '';
  el.typed.readOnly = false;
  el.hint.textContent = multi
    ? 'Several lines. Press Ctrl+Enter or ⌘+Enter to check.'
    : card.kind === 'hosts' ? 'Host names separated by spaces. Press Enter to check.' : 'Press Enter to check.';
  el.check.disabled = false;
  el.reveal.disabled = false;
  el.feedback.hidden = true;
  el.typed.focus();
}

function reveal(card, verdict, typed) {
  answered = true;
  el.typed.readOnly = true;
  el.check.disabled = true;
  el.reveal.disabled = true;
  el.feedback.hidden = false;
  el.feedback.className = verdict.ok ? 'right' : 'wrong';
  el.verdict.textContent = verdict.ok ? 'Right.' : typed === null ? 'The answer:' : 'Not quite. The answer:';
  el.reason.hidden = !verdict.reason;
  el.reason.textContent = verdict.reason ?? '';
  el.answer.textContent = card.answer;
  el.why.textContent = card.why;
  el.flags.hidden = !card.flags;
  el.flags.tBodies[0].replaceChildren(...(card.flags ?? []).map(([flag, meaning]) => {
    const row = node('tr');
    row.append(node('td', null, flag), node('td', null, meaning));
    return row;
  }));
  // Only offer the override when the checker found no specific fault to point at.
  el.override.hidden = verdict.ok || typed === null || Boolean(verdict.reason);
  el.next.focus();
}

function grade(result) {
  const id = round.queue[0];
  stats = record(stats, id, result);
  writeStore(STATS_KEY, stats);
  round = answer(round, result);
}

function onCheck() {
  if (answered) return;
  const card = BY_ID.get(round.queue[0]);
  const typed = el.typed.value;
  if (!typed.trim()) {
    el.typed.focus();
    return;
  }
  const verdict = check(card, typed);
  reveal(card, verdict, typed);
  el.next.dataset.result = verdict.ok ? 'right' : 'wrong';
}

function onReveal() {
  if (answered) return;
  reveal(BY_ID.get(round.queue[0]), { ok: false, reason: null }, null);
  el.next.dataset.result = 'wrong';
}

function onNext(result) {
  grade(result);
  if (isOver(round)) finish();
  else ask();
}

function finish() {
  const missed = [...round.missed].map((id) => BY_ID.get(id));
  el.doneSummary.textContent = `${round.firstTry} of ${round.total} right on the first try in "${deckName(deck)}".`
    + (missed.length ? ' These needed a second try:' : ' Clean round.');
  el.doneMissed.replaceChildren(...missed.map((card) => node('li', null, card.q)));
  el.doneMissed.hidden = missed.length === 0;
  show(el.done);
  el.again.focus();
}

el.check.addEventListener('click', onCheck);
el.reveal.addEventListener('click', onReveal);
el.next.addEventListener('click', () => onNext(el.next.dataset.result));
el.override.addEventListener('click', () => onNext('right'));
el.typed.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || answered) return;
  const card = BY_ID.get(round.queue[0]);
  const multi = card.kind === 'ini' && card.answer.includes('\n');
  if (multi && !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  // Without this the same Enter reaches the document handler below and skips past the feedback.
  event.stopPropagation();
  onCheck();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && answered && !el.play.hidden && document.activeElement.tagName !== 'BUTTON') {
    event.preventDefault();
    onNext(el.next.dataset.result);
  }
});
el.quit.addEventListener('click', () => {
  renderBoard();
  show(el.board);
});
el.again.addEventListener('click', () => start(deck));
el.toBoard.addEventListener('click', () => {
  renderBoard();
  show(el.board);
});
el.reset.addEventListener('click', () => {
  stats = {};
  writeStore(STATS_KEY, stats);
  renderBoard();
});

renderBoard();
