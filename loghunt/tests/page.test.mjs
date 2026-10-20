import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateMeta } from '../tools/state-meta.mjs';
import { STATE_SHA256, STATE_SIZE } from '../image/state-meta.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Any change to this policy is a security decision; update DECISIONS.md with it.
const EXPECTED_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; " +
  "base-uri 'none'; object-src 'none'; form-action 'none';";

test('index.html carries exactly the reviewed Content-Security-Policy', () => {
  const policies = [...html.matchAll(/http-equiv="Content-Security-Policy" content="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(policies, [EXPECTED_CSP]);
});

test('no inline scripts or inline event handlers', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /\bsrc="/);
    assert.equal(body.trim(), '');
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('every script is same-origin; no CDN', () => {
  for (const [, src] of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.doesNotMatch(src, /^(https?:)?\/\//);
});

test('page links back to the App Hub like every other hub app', () => {
  assert.match(html, /<a class="back-btn" href="\.\.\/index\.html">← App Hub<\/a>/);
});

test('layout has the mission panel, the terminal, and the answer bar', () => {
  for (const id of ['mission', 'terminal', 'answer-form', 'hint-btn', 'restart-btn', 'reset-btn']) assert.match(html, new RegExp(`id="${id}"`));
});

test('state-meta.js matches the committed snapshot', () => {
  const actual = stateMeta(path.join(root, 'image/state.bin.zst'));
  assert.equal(STATE_SHA256, actual.sha256);
  assert.equal(STATE_SIZE, actual.size);
});
