import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeAnswer, hashAnswer, checkAnswer } from '../checker.js';

test('normalize trims, lowercases, and collapses inner whitespace', () => {
  assert.equal(normalizeAnswer('  ./TMP/.x/KWorkerd \n'), './tmp/.x/kworkerd');
  assert.equal(normalizeAnswer('203.0.113.66   4444'), '203.0.113.66 4444');
  assert.equal(normalizeAnswer('a|b'), 'a|b');
});

test('hash is SHA-256 hex of the namespaced, normalized answer', async () => {
  const h = await hashAnswer('find-01', ' 42 ');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashAnswer('find-01', '42'));
});

test('the same answer hashes differently for different levels', async () => {
  assert.notEqual(await hashAnswer('find-01', '42'), await hashAnswer('grep-02', '42'));
});

test('checkAnswer accepts formatting variants and rejects wrong answers', async () => {
  const stored = await hashAnswer('boss-10', '203.0.113.66|svc_backup|2026-03-12T19:47:21Z|4444');
  assert.equal(await checkAnswer('boss-10', '203.0.113.66|SVC_BACKUP|2026-03-12t19:47:21z|4444 ', stored), true);
  assert.equal(await checkAnswer('boss-10', '203.0.113.66|svc_backup|2026-03-13T22:14:03Z|4444', stored), false);
});

test('empty answers never match', async () => {
  const stored = await hashAnswer('x', '');
  assert.equal(await checkAnswer('x', '   ', stored), false);
});

test('the recipe is sha256("loghunt:v1:<level>:<normalized>"), checked with Node crypto', async () => {
  const expected = createHash('sha256').update('loghunt:v1:find-01:./tmp/.x/kworkerd').digest('hex');
  assert.equal(await hashAnswer('find-01', ' ./TMP/.x/kworkerd'), expected);
});
