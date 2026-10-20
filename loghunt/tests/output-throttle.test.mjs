import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutputThrottle } from '../output-throttle.js';

const decode = (chunks) => chunks.map((c) => new TextDecoder().decode(c)).join('');

function harness(options = {}) {
  const writes = [];
  const queued = [];
  const throttle = new OutputThrottle({
    write: (bytes) => writes.push(bytes.slice()),
    schedule: (fn) => queued.push(fn),
    perFlush: 8,
    maxBacklog: 32,
    ...options,
  });
  const tick = () => queued.splice(0).forEach((fn) => fn());
  const pushText = (text) => [...new TextEncoder().encode(text)].forEach((b) => throttle.push(b));
  return { throttle, writes, tick, pushText, queued };
}

test('writes nothing until the scheduled flush runs, then writes in order', () => {
  const { writes, tick, pushText } = harness();
  pushText('hello');
  assert.equal(writes.length, 0);
  tick();
  assert.equal(decode(writes), 'hello');
});

test('schedules one flush per frame no matter how many bytes arrive', () => {
  const { queued, pushText } = harness();
  pushText('abcdef');
  assert.equal(queued.length, 1);
});

test('writes at most perFlush bytes per frame and keeps the rest for later frames', () => {
  const { writes, tick, pushText } = harness();
  pushText('0123456789abcdef'); // 16 bytes, perFlush 8
  tick();
  assert.equal(decode(writes), '01234567');
  tick();
  assert.equal(decode(writes), '0123456789abcdef');
});

test('drops the backlog past maxBacklog and says so once, with the byte count', () => {
  const { writes, tick, pushText } = harness();
  pushText('x'.repeat(40)); // backlog limit 32
  tick();
  const text = decode(writes);
  assert.match(text, /output throttled/);
  assert.match(text, /40 bytes skipped/);
  assert.equal((text.match(/output throttled/g) ?? []).length, 1);
});

test('normal output resumes after a throttled burst', () => {
  const { writes, tick, pushText } = harness();
  pushText('x'.repeat(40));
  tick();
  writes.length = 0;
  pushText('ok');
  tick();
  assert.equal(decode(writes), 'ok');
});

test('reset discards pending output', () => {
  const { throttle, writes, tick, pushText } = harness();
  pushText('stale');
  throttle.reset();
  tick();
  assert.equal(decode(writes), '');
});
