import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, DECKS } from '../cards.js';
import { newRound, answer, isOver, record, known, RETRY_GAP } from '../game.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('every card is complete, in a known deck, with a unique id', () => {
  const decks = new Set(DECKS.map((d) => d.id));
  const ids = new Set();
  for (const c of CARDS) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or empty id ${c.id}`);
    ids.add(c.id);
    assert.ok(decks.has(c.deck), c.id);
    for (const field of ['q', 'answer', 'why']) assert.equal(typeof c[field], 'string', `${c.id}.${field}`);
    assert.ok([undefined, 'command', 'ini', 'hosts'].includes(c.kind), c.id);
  }
});

test('no answer contains a curly quote or a dash the shell would reject', () => {
  for (const c of CARDS) assert.equal(/[‘’“”–—]/.test(c.answer), false, c.id);
});

test('a missed card comes back RETRY_GAP cards later and is not counted as first-try', () => {
  const cards = CARDS.filter((c) => c.deck === 'prep');
  let round = newRound(cards, 'prep', () => 0.5);
  const first = round.queue[0];
  round = answer(round, 'wrong');
  assert.equal(round.queue[RETRY_GAP], first);
  while (!isOver(round)) round = answer(round, 'right');
  assert.equal(round.firstTry, cards.length - 1);
});

test('three right answers in a row make a card known; a miss resets the streak', () => {
  let stats = {};
  for (let i = 0; i < 3; i++) stats = record(stats, 'x', 'right');
  assert.ok(known(stats, 'x'));
  stats = record(stats, 'x', 'wrong');
  assert.equal(known(stats, 'x'), false);
});

test('the page loads one module script and writes no markup from strings', () => {
  const page = read('index.html');
  assert.match(page, /script-src 'self';/);
  assert.equal((page.match(/<script/g) || []).length, 1);
  assert.equal(/\son[a-z]+=/.test(page), false);
  for (const name of ['app.js', 'checker.js', 'game.js']) {
    assert.equal(/innerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(read(name)), false, name);
  }
});

test('the App Hub links to the app', () => {
  const hub = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(hub, /href="ansible-command-recall\/index\.html"/);
});
