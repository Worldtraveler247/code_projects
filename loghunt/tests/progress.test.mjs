import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, scoreFor, memoryStorage, PROGRESS_KEY } from '../progress.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('score is 100 minus 10, 20, 35 for each hint tier used, never below 10', () => {
  assert.deepEqual([0, 1, 2, 3].map(scoreFor), [100, 90, 70, 35]);
});

test('a fresh level is unsolved with no hints, attempts, or time', () => {
  const p = new Progress({ storage: memoryStorage() });
  assert.deepEqual(p.get('find-01'), { solved: false, hintsUsed: 0, attempts: 0, activeMs: 0, score: 0 });
});

test('attempts count every submission; a correct one solves and scores the level', () => {
  const p = new Progress({ storage: memoryStorage() });
  p.useHint('find-01');
  p.recordAttempt('find-01', false);
  p.recordAttempt('find-01', true);
  const s = p.get('find-01');
  assert.equal(s.attempts, 2);
  assert.equal(s.solved, true);
  assert.equal(s.score, 90);
});

test('hints after solving are free and capped at three', () => {
  const p = new Progress({ storage: memoryStorage() });
  p.recordAttempt('grep-02', true);
  assert.equal(p.useHint('grep-02'), 1);
  assert.equal(p.get('grep-02').score, 100);
  p.useHint('grep-02');
  p.useHint('grep-02');
  assert.equal(p.useHint('grep-02'), 3);
});

test('a second correct answer does not change the score or the solve', () => {
  const p = new Progress({ storage: memoryStorage() });
  p.recordAttempt('x', true);
  p.useHint('x');
  p.recordAttempt('x', true);
  assert.equal(p.get('x').score, 100);
});

test('active time accrues only while a level is open and the page is visible', () => {
  const c = clock();
  const p = new Progress({ storage: memoryStorage(), now: c.now });
  p.open('find-01');
  c.advance(5000);
  p.pause();
  c.advance(60_000);
  p.resume();
  c.advance(2000);
  p.open('grep-02');
  c.advance(1000);
  p.pause();
  assert.equal(p.get('find-01').activeMs, 7000);
  assert.equal(p.get('grep-02').activeMs, 1000);
});

test('the clock stops when the level is solved', () => {
  const c = clock();
  const p = new Progress({ storage: memoryStorage(), now: c.now });
  p.open('x');
  c.advance(3000);
  p.recordAttempt('x', true);
  c.advance(9000);
  p.pause();
  assert.equal(p.get('x').activeMs, 3000);
});

test('progress persists through the storage adapter and survives a reload', () => {
  const storage = memoryStorage();
  const a = new Progress({ storage });
  a.recordAttempt('find-01', true);
  const b = new Progress({ storage });
  assert.equal(b.get('find-01').solved, true);
  assert.ok(storage.read(PROGRESS_KEY));
});

test('totals sum scores and count solved levels', () => {
  const p = new Progress({ storage: memoryStorage() });
  p.recordAttempt('a', true);
  p.useHint('b');
  p.recordAttempt('b', true);
  assert.deepEqual(p.totals(['a', 'b', 'c']), { solved: 2, score: 190, levels: 3 });
});

test('reset wipes everything', () => {
  const storage = memoryStorage();
  const p = new Progress({ storage });
  p.recordAttempt('a', true);
  p.reset();
  assert.equal(p.get('a').solved, false);
  assert.equal(new Progress({ storage }).get('a').solved, false);
});

test('corrupt or unavailable storage falls back to a fresh start', () => {
  const broken = { read: () => '{not json', write: () => { throw new Error('quota'); } };
  const p = new Progress({ storage: broken });
  p.recordAttempt('a', true);
  assert.equal(p.get('a').solved, true);
});
