import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng, apacheTime, syslogTime, isoTime, appTime, sarTime, sarDate, auditStamp } from '../gen-util.js';

const t = Date.UTC(2026, 2, 13, 22, 14, 3) / 1000;
const morning = Date.UTC(2026, 2, 3, 0, 5, 9) / 1000;

test('timestamp formats match each RHEL source', () => {
  assert.equal(apacheTime(t), '13/Mar/2026:22:14:03 +0000');
  assert.equal(syslogTime(t), 'Mar 13 22:14:03');
  assert.equal(syslogTime(morning), 'Mar  3 00:05:09');
  assert.equal(isoTime(t), '2026-03-13T22:14:03Z');
  assert.equal(appTime(t, 7), '2026-03-13 22:14:03,007');
  assert.equal(sarTime(t), '10:14:03 PM');
  assert.equal(sarTime(morning), '12:05:09 AM');
  assert.equal(sarDate(t), '03/13/2026');
  assert.equal(auditStamp(t, 123, 4512), `audit(${t}.123:4512)`);
});

test('the epoch in an audit stamp converts back to the same instant', () => {
  const stamp = auditStamp(t, 0, 1);
  const epoch = Number(stamp.match(/audit\((\d+)\./)[1]);
  assert.equal(isoTime(epoch), '2026-03-13T22:14:03Z');
});

test('rng is deterministic for a seed and differs across seeds', () => {
  const a = rng(42);
  const b = rng(42);
  const c = rng(43);
  const seqA = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => c.next()));
});

test('rng helpers stay in range', () => {
  const r = rng(7);
  for (let i = 0; i < 1000; i++) {
    const n = r.int(3, 9);
    assert.ok(n >= 3 && n <= 9 && Number.isInteger(n));
    assert.ok(['a', 'b'].includes(r.pick(['a', 'b'])));
    assert.ok(['x', 'y'].includes(r.weighted([['x', 1], ['y', 3]])));
  }
});
