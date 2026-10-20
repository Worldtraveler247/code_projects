import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateArena, arenaTar } from '../generator.js';
import { SEED, NOW } from '../story.js';

// Changing the generator changes every answer. When this digest changes on purpose, update it here and
// rerun `node tools/selftest.mjs` so the stored answer hashes are checked against the new data.
const GOLDEN_SHA256 = '809e940f5f92c9cc06d3869cf5303afd151b996a0b417c21f8e26fea4d8d6d28';

const text = (arena, path) => new TextDecoder().decode(arena.entries.find((e) => e.path === path).data);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = (arena) => arena.entries.filter((e) => !e.dir);

test('two runs with the same seed produce identical bytes', () => {
  assert.equal(digest(arenaTar(generateArena(SEED))), digest(arenaTar(generateArena(SEED))));
});

test('a different seed produces different data', () => {
  assert.notEqual(digest(arenaTar(generateArena(SEED))), digest(arenaTar(generateArena(SEED + 1))));
});

test('arena matches the pinned golden digest', () => {
  assert.equal(digest(arenaTar(generateArena())), GOLDEN_SHA256);
});

test('generation does not read the clock or Math.random', () => {
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => { throw new Error('Date.now called'); };
  Math.random = () => { throw new Error('Math.random called'); };
  try {
    generateArena();
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
});

test('every file the spec names exists', () => {
  const paths = new Set(files(generateArena()).map((f) => f.path));
  for (const p of [
    'var/log/httpd/access_log', 'var/log/httpd/access_log.1', 'var/log/httpd/access_log.2', 'var/log/secure',
    'var/log/secure-20260313', 'var/log/messages', 'var/log/firewalld/fw.log', 'var/log/audit/audit.log',
    'opt/app/logs/app.log', 'metrics/node_metrics.csv', 'metrics/sar_cpu.txt', 'training/web.log',
  ]) assert.ok(paths.has(p), p);
});

test('traps are present: empty files, binaries, a space in a name, CRLF, a hidden dir, misleading names', () => {
  const arena = generateArena();
  const byPath = new Map(files(arena).map((f) => [f.path, f]));
  assert.equal(byPath.get('var/log/maillog').data.length, 0);
  assert.ok(byPath.get('var/log/wtmp').data.some((b) => b === 0 || b > 127));
  assert.ok(byPath.has('opt/app/logs/app old.log'));
  assert.match(text(arena, 'metrics/hosts.csv'), /\r\n$/);
  assert.ok(byPath.has('tmp/.x/kworkerd'));
  assert.deepEqual([...byPath.get('tmp/.x/kworkerd').data.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
  assert.doesNotMatch(text(arena, 'opt/app/logs/debug.log.gz'), /^\x1f\x8b/);
  assert.deepEqual(arena.gzip.find((g) => g.final)?.final, 'var/log/httpd/old_access.txt');
});

test('every file the guest must gzip exists in the archive', () => {
  const arena = generateArena();
  const paths = new Set(files(arena).map((f) => f.path));
  for (const { path } of arena.gzip) assert.ok(paths.has(path), path);
});

test('no file is modified after the story clock', () => {
  for (const f of files(generateArena())) assert.ok(f.mtime <= NOW, `${f.path} mtime ${f.mtime} > ${NOW}`);
});

test('only RFC 5737 documentation addresses appear in the data', () => {
  const allowed = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
  const arena = generateArena();
  for (const f of files(arena)) {
    if (f.path === 'var/log/wtmp' || f.path === 'var/log/btmp' || f.path === 'tmp/.x/kworkerd') continue;
    const body = new TextDecoder().decode(f.data);
    // Dotted quads only; version strings such as 5.14.0-427.13.1 have a different shape.
    for (const [ip] of body.matchAll(/(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\d.])/g)) {
      assert.match(ip, allowed, `${f.path}: ${ip}`);
    }
  }
});

test('only example.com domains and rsyslog/pool references appear', () => {
  const allowed = new Set(['www.example.com', 'www.rsyslog.com', '2.rhel.pool.ntp.org']);
  for (const f of files(generateArena())) {
    if (!/\.(log|csv|txt)$|access_log|secure|messages|error_log/.test(f.path)) continue;
    const body = new TextDecoder().decode(f.data);
    for (const [, host] of body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      if (/^\d/.test(host)) continue;
      assert.ok(allowed.has(host), `${f.path}: ${host}`);
    }
  }
});
