// Progressive difficulty: each challenge passed unaided removes one more pre-written row
// from the next challenge's starting playbook, until the player writes the whole file.
// Pure functions; the page stores the level.

import { PLACEHOLDER } from './runner.js';

// The highest level any starter can reach: three task rows plus four header rows.
export const TOP_LEVEL = 7;

function describe(line) {
  if (line.includes(PLACEHOLDER) || /^\s*msg:/.test(line)) return 'the msg: line with the expression';
  if (/^\s*tasks:/.test(line)) return 'the tasks: line';
  if (/^\s*hosts:/.test(line)) return 'the hosts: line';
  if (line.trim() === '---') return 'the --- line (optional, but good practice)';
  if (/^- name:/.test(line)) return 'the line that starts the play (- name: ...)';
  if (/^\s+- name:/.test(line)) return "the task's - name: line";
  const module = /^\s*([\w.]+):\s*$/.exec(line);
  return module ? `the module line (${module[1]}:)` : `the line "${line.trim()}"`;
}

const rowsOf = (challenge) => challenge.starter.split('\n').filter((line) => line.trim() !== '');

/** How many rows this challenge's starter has to lose. */
export function maxLevel(challenge) {
  return rowsOf(challenge).length;
}

/**
 * The starting playbook for a challenge at a difficulty level.
 * Rows are removed from the bottom up: the ones nearest the player's own work go first.
 * Returns { starter, removed, level, placeholderGone }.
 */
export function scaffold(challenge, level) {
  const rows = rowsOf(challenge);
  const applied = Math.min(Math.max(0, Math.trunc(level) || 0), rows.length);
  if (applied === 0) return { starter: challenge.starter, removed: [], level: 0, placeholderGone: false };
  const kept = rows.slice(0, rows.length - applied);
  const removed = rows.slice(rows.length - applied).reverse();
  return {
    starter: kept.length ? `${kept.join('\n')}\n` : '',
    removed: removed.map(describe),
    level: applied,
    placeholderGone: challenge.starter.includes(PLACEHOLDER) && !kept.some((line) => line.includes(PLACEHOLDER)),
  };
}

/**
 * The level after an event.
 * A first, unaided pass raises it by one. Showing the answer lowers it by one. Reset clears it.
 */
export function adjustLevel(level, event) {
  if (event.type === 'reset') return 0;
  if (event.type === 'reveal') return Math.max(0, level - 1);
  if (event.type === 'pass' && event.firstTime && !event.revealed) return Math.min(TOP_LEVEL, level + 1);
  return level;
}
