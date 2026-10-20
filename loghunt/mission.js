// Renders one level into the mission panel and the level strip. All text goes through rich.js
// (createElement + textContent); nothing from a level file is parsed as HTML.
import { appendRich, el, renderBlocks } from './rich.js';
import { HINT_PENALTY } from './progress.js';

// "Level 3", or "Side quest" for the unnumbered bonus levels.
export function levelLabel(level) {
  return level.number === undefined ? 'Side quest' : `Level ${level.number}`;
}

export function renderLevelStrip(doc, container, levels, progress, currentId, onPick) {
  container.replaceChildren();
  for (const level of levels) {
    const state = progress.get(level.id);
    const btn = el(doc, 'button', `level-chip${state.solved ? ' solved' : ''}${level.id === currentId ? ' current' : ''}`);
    btn.type = 'button';
    btn.textContent = level.number === 10 ? 'Boss' : level.number === undefined ? '★' : String(level.number);
    btn.title = `${levelLabel(level)}. ${level.title} (${level.tool})${state.solved ? ` — solved, ${state.score} points` : ''}`;
    btn.setAttribute('aria-label', btn.title);
    if (level.id === currentId) btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => onPick(level.id));
    container.append(btn);
  }
}

export function renderLevel(doc, container, level, state, { onTypeCommand }) {
  container.replaceChildren();

  const head = el(doc, 'header', 'level-head');
  head.append(el(doc, 'p', 'level-kicker', `${levelLabel(level)} · ${level.tool}`), el(doc, 'h3', 'level-title', level.title));
  container.append(head);

  const briefing = el(doc, 'section', 'briefing');
  briefing.append(el(doc, 'h4', '', 'Briefing'));
  for (const p of level.briefing) briefing.append(appendRich(doc, el(doc, 'p'), p));
  container.append(briefing);

  const lesson = el(doc, 'details', 'lesson');
  lesson.open = !state.solved;
  lesson.append(el(doc, 'summary', '', `Lesson: ${level.tool}`));
  renderBlocks(doc, lesson, level.lesson);
  container.append(lesson);

  const examples = el(doc, 'details', 'examples');
  examples.open = !state.solved;
  examples.append(el(doc, 'summary', '', `Worked examples (${level.examples.length})`));
  level.examples.forEach((ex, i) => {
    const card = el(doc, 'article', 'example');
    card.append(el(doc, 'h5', '', `${i + 1}. ${ex.title}`));
    const cmdRow = el(doc, 'div', 'cmd-row');
    cmdRow.append(el(doc, 'pre', 'cmd', `$ ${ex.command}`));
    const type = el(doc, 'button', 'type-btn', 'Type it');
    type.type = 'button';
    type.title = 'Put this command in the terminal (you press Enter)';
    type.addEventListener('click', () => onTypeCommand(ex.command));
    cmdRow.append(type);
    card.append(cmdRow);
    const stages = el(doc, 'ol', 'stages');
    for (const s of ex.stages) {
      const li = el(doc, 'li');
      li.append(el(doc, 'code', '', s.code), doc.createTextNode(' '));
      appendRich(doc, li, s.why);
      stages.append(li);
    }
    card.append(stages);
    const out = el(doc, 'details', 'expected');
    out.append(el(doc, 'summary', '', 'Expected output'), el(doc, 'pre', 'output', ex.output || '(no output)'));
    card.append(out);
    examples.append(card);
  });
  container.append(examples);

  const challenge = el(doc, 'section', 'challenge');
  challenge.append(el(doc, 'h4', '', 'Challenge'));
  challenge.append(appendRich(doc, el(doc, 'p', 'question'), level.challenge.question));
  challenge.append(appendRich(doc, el(doc, 'p', 'format'), `Answer format: ${level.challenge.format}`));
  container.append(challenge);

  const hints = el(doc, 'section', 'hints');
  hints.id = 'hints';
  renderHints(doc, hints, level, state.hintsUsed);
  container.append(hints);

  if (state.solved) container.append(renderDebrief(doc, level, state));
}

export function renderHints(doc, section, level, used) {
  section.replaceChildren();
  if (!used) return;
  section.append(el(doc, 'h4', '', 'Hints'));
  const list = el(doc, 'ol', 'hint-list');
  level.hints.slice(0, used).forEach((h) => list.append(appendRich(doc, el(doc, 'li'), h)));
  section.append(list);
}

export function hintButtonLabel(state) {
  if (state.hintsUsed >= HINT_PENALTY.length) return 'No more hints';
  const next = state.hintsUsed + 1;
  return state.solved ? `Hint ${next} of 3` : `Hint ${next} of 3 (−${HINT_PENALTY[state.hintsUsed]})`;
}

export function renderDebrief(doc, level, state) {
  const d = el(doc, 'section', 'debrief');
  d.id = 'debrief';
  d.append(el(doc, 'h4', '', `Debrief — solved, ${state.score} points`));
  d.append(el(doc, 'p', 'label', 'Reference solution'), el(doc, 'pre', 'cmd', `$ ${level.debrief.solution}`));
  d.append(el(doc, 'p', 'label', 'Another way'), el(doc, 'pre', 'cmd', `$ ${level.debrief.alternative}`));
  d.append(el(doc, 'p', 'label', 'Why it matters on a real host'));
  for (const p of level.debrief.why) d.append(appendRich(doc, el(doc, 'p'), p));
  return d;
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
