import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/manifest.json'), 'utf8'));

for (const [file, expected] of Object.entries(manifest.files)) {
  test(`${file} matches its pinned SHA-256`, () => {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(actual, expected);
  });
}

test('every file under vendor/ is pinned in the manifest', () => {
  const unpinned = fs.readdirSync(path.join(root, 'vendor'), { recursive: true })
    .map((f) => `vendor/${f}`)
    .filter((f) => fs.statSync(path.join(root, f)).isFile())
    .filter((f) => !['vendor/manifest.json', 'vendor/README.md'].includes(f) && !(f in manifest.files));
  assert.deepEqual(unpinned, []);
});

test('the image snapshot exists and is zstd-compressed', () => {
  const head = fs.readFileSync(path.join(root, 'image/state.bin.zst')).subarray(0, 4);
  assert.deepEqual([...head], [0x28, 0xb5, 0x2f, 0xfd]);
});
