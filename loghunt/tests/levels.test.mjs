import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLevel, loadLevels } from '../levels.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../levels');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const levels = index.levels.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

test('index.json lists every level file in the directory, once', () => {
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  assert.deepEqual([...index.levels].sort(), onDisk);
  assert.equal(new Set(index.levels).size, index.levels.length);
});

test('every level passes the schema', () => {
  for (const [i, level] of levels.entries()) assert.deepEqual(validateLevel(level, index.levels[i]), []);
});

test('level ids are unique and main levels are numbered 1..n in order', () => {
  assert.equal(new Set(levels.map((l) => l.id)).size, levels.length);
  const main = levels.filter((l) => !l.id.startsWith('side-'));
  assert.deepEqual(main.map((l) => l.number), main.map((_, i) => i + 1));
});

test('the validator rejects the mistakes an author is likely to make', () => {
  const good = levels[0];
  const broken = { ...good, hints: good.hints.slice(0, 2), challenge: { ...good.challenge, answerHash: 'abc' }, examples: [{ ...good.examples[0], command: 'cat /etc/passwd' }] };
  const errors = validateLevel(broken, 'x.json').join('\n');
  assert.match(errors, /exactly three tiers/);
  assert.match(errors, /64 hex/);
  assert.match(errors, /3 to 5 worked examples/);
  assert.match(errors, /under training\//);
  assert.match(validateLevel({ ...good, setup: 'rm -rf /' }, 'x.json').join('\n'), /setup must be one of: live-feed/);
});

test('no level ships a plain-text answer field', () => {
  for (const level of levels) {
    assert.equal('answer' in level.challenge, false, level.id);
  }
});

test('loadLevels reads the index and refuses an invalid level', async () => {
  const files = { 'levels/index.json': { levels: ['a.json'] }, 'levels/a.json': { id: 'bad' } };
  await assert.rejects(loadLevels(async (url) => files[url]), /a\.json/);
});
