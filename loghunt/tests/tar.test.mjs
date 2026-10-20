import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTar } from '../tar.js';

const enc = new TextEncoder();
const longDir = `.cache/${'n'.repeat(90)}`;
const entries = [
  { path: 'var', dir: true, mtime: 1773000000 },
  { path: 'var/log/secure', data: enc.encode('line\n'), mtime: 1773454629 },
  { path: 'hello world.txt', data: enc.encode('a\r\nb\r\n'), mtime: 1773000000 },
  { path: `${longDir}/f.log`, data: new Uint8Array(1000).fill(7), mtime: 1773111111 },
  { path: 'empty.log', data: new Uint8Array(0), mtime: 1773000000 },
];

test('archive is block-aligned and ends with two zero blocks', () => {
  const tar = createTar(entries);
  assert.equal(tar.length % 512, 0);
  assert.ok(tar.subarray(tar.length - 1024).every((b) => b === 0));
});

test('same input gives identical bytes', () => {
  assert.deepEqual(createTar(entries), createTar(entries));
});

test('header checksum matches the ustar rule', () => {
  const h = createTar(entries).subarray(0, 512);
  const stored = parseInt(new TextDecoder().decode(h.subarray(148, 154)), 8);
  const copy = h.slice();
  copy.fill(0x20, 148, 156);
  assert.equal(stored, copy.reduce((n, b) => n + b, 0));
});

test('system tar extracts names, contents and modification times', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loghunt-tar-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.tar'), createTar(entries));
    fs.mkdirSync(path.join(dir, 'out'));
    execFileSync('tar', ['-xf', path.join(dir, 'a.tar'), '-C', path.join(dir, 'out')]);
    const out = (p) => path.join(dir, 'out', p);
    assert.equal(fs.readFileSync(out('hello world.txt'), 'latin1'), 'a\r\nb\r\n');
    assert.equal(fs.readFileSync(out(`${longDir}/f.log`)).length, 1000);
    assert.equal(fs.statSync(out('var/log/secure')).mtimeMs / 1000, 1773454629);
    assert.equal(fs.statSync(out('empty.log')).size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a path that cannot fit ustar fields', () => {
  assert.throws(() => createTar([{ path: 'x'.repeat(120), data: new Uint8Array(1), mtime: 0 }]), /too long/);
});
