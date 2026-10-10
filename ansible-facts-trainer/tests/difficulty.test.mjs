import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustLevel, maxLevel, scaffold } from '../difficulty.js';
import { CHALLENGES } from '../challenges.js';
import { FACTS, HOST } from '../facts.js';
import { runPlaybook } from '../runner.js';

const byId = (id) => CHALLENGES.find((c) => c.id === id);
const TIER1 = byId('t1-hostname');
const TIER2 = byId('t2-hostname');
const EXAM = byId('exam-conditional-install');

test('level 0 is the full starter, unchanged, with nothing listed as removed', () => {
  for (const c of CHALLENGES) {
    const s = scaffold(c, 0);
    assert.equal(s.starter, c.starter, c.id);
    assert.deepEqual(s.removed, [], c.id);
  }
});

test('each level removes exactly one more pre-written row, nearest the task first', () => {
  const rows = (level) => scaffold(TIER2, level).starter.split('\n').filter((line) => line.trim() !== '');
  assert.deepEqual(rows(0), ['---', '- name: Display facts', '  hosts: servera', '  tasks:']);
  assert.deepEqual(rows(1), ['---', '- name: Display facts', '  hosts: servera']);
  assert.deepEqual(rows(2), ['---', '- name: Display facts']);
  assert.deepEqual(rows(3), ['---']);
  assert.deepEqual(rows(4), []);
});

test('a fill-in challenge loses its task rows first, then the play header', () => {
  const rows = (level) => scaffold(TIER1, level).starter.split('\n').filter((line) => line.trim() !== '');
  assert.equal(rows(0).length, 7);
  assert.equal(rows(1).at(-1), '      ansible.builtin.debug:');
  assert.equal(rows(2).at(-1), '    - name: Display the fact');
  assert.equal(rows(3).at(-1), '  tasks:');
  assert.equal(rows(7).length, 0);
});

test('the level is capped at the number of rows a starter has', () => {
  assert.equal(maxLevel(TIER2), 4);
  assert.equal(maxLevel(TIER1), 7);
  assert.equal(maxLevel(EXAM), 4);
  assert.equal(scaffold(TIER2, 99).starter, scaffold(TIER2, 4).starter);
  assert.equal(scaffold(TIER2, 99).level, 4);
  assert.equal(scaffold(TIER2, -3).level, 0);
});

test('every removed row is named in plain words, in the order it was removed', () => {
  assert.deepEqual(scaffold(TIER2, 3).removed, ['the tasks: line', 'the hosts: line', 'the line that starts the play (- name: ...)']);
  assert.deepEqual(scaffold(TIER1, 3).removed, ['the msg: line with the expression', 'the module line (ansible.builtin.debug:)', "the task's - name: line"]);
  assert.equal(scaffold(TIER2, 4).removed.at(-1), 'the --- line (optional, but good practice)');
});

test('above level 0 the starter ends with a newline and no dangling indent', () => {
  for (const level of [1, 2, 3]) {
    const { starter } = scaffold(TIER2, level);
    assert.ok(starter.endsWith('\n'), `level ${level}`);
    assert.equal(/[ \t]+$/.test(starter), false, `level ${level}`);
  }
  assert.equal(scaffold(TIER2, 4).starter, '');
});

test('the placeholder note is only shown while the placeholder is still in the file', () => {
  assert.equal(scaffold(TIER1, 0).placeholderGone, false);
  assert.equal(scaffold(TIER1, 1).placeholderGone, true);
  assert.equal(scaffold(TIER2, 1).placeholderGone, false);
});

test('a reduced starter says what is missing when run untouched, and never crashes', () => {
  for (const c of [TIER1, TIER2, EXAM]) {
    for (let level = 0; level <= maxLevel(c); level++) {
      const r = runPlaybook(scaffold(c, level).starter, c, FACTS, HOST);
      assert.equal(r.verdict.ok, false, `${c.id} level ${level}`);
      assert.ok(r.verdict.message.length > 10, `${c.id} level ${level}`);
    }
  }
});

test('every challenge can still be solved from an empty file, so the hardest level is fair', () => {
  for (const c of CHALLENGES) {
    assert.equal(scaffold(c, maxLevel(c)).starter, '', c.id);
    assert.equal(runPlaybook(c.solution, c, FACTS, HOST).verdict.ok, true, c.id);
  }
});

test('the level rises by one on a first, unaided pass, and never on a repeat or after the answer was shown', () => {
  assert.equal(adjustLevel(0, { type: 'pass', firstTime: true, revealed: false }), 1);
  assert.equal(adjustLevel(3, { type: 'pass', firstTime: true, revealed: false }), 4);
  assert.equal(adjustLevel(3, { type: 'pass', firstTime: false, revealed: false }), 3);
  assert.equal(adjustLevel(3, { type: 'pass', firstTime: true, revealed: true }), 3);
});

test('showing the answer eases the level by one, and it never goes below zero or above the ceiling', () => {
  assert.equal(adjustLevel(3, { type: 'reveal' }), 2);
  assert.equal(adjustLevel(0, { type: 'reveal' }), 0);
  assert.equal(adjustLevel(7, { type: 'pass', firstTime: true, revealed: false }), 7);
  assert.equal(adjustLevel(5, { type: 'reset' }), 0);
  assert.equal(adjustLevel(2, { type: 'something-else' }), 2);
});
