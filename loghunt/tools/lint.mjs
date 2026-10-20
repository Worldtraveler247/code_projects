#!/usr/bin/env node
// Zero-dependency lint for LOGHUNT. The hub has no ESLint; this enforces what matters here:
// every module parses, and app code never evaluates strings or writes raw HTML.
// Usage: node tools/lint.mjs   (exit 1 on any finding)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['vendor', 'image', 'build', 'node_modules']);
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(m?js)$/.test(entry.name)) check(full);
  }
}

const banned = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\.(innerHTML|outerHTML)\s*[+]?=/, 'innerHTML/outerHTML assignment (use textContent or DOM nodes)'],
  [/\binsertAdjacentHTML\s*\(/, 'insertAdjacentHTML()'],
  [/\bdocument\.write\s*\(/, 'document.write()'],
];

function check(file) {
  const rel = path.relative(root, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    findings.push(`${rel}: does not parse\n${err.stderr}`);
  }
  if (rel.startsWith('tools/lint.mjs')) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, what] of banned) if (re.test(line)) findings.push(`${rel}:${i + 1}: ${what}`);
  });
}

walk(root);

// Level files must parse and pass the schema the page enforces at load time.
const { validateLevel } = await import('../levels.js');
const levelDir = path.join(root, 'levels');
const index = JSON.parse(fs.readFileSync(path.join(levelDir, 'index.json'), 'utf8'));
for (const file of index.levels) {
  try {
    findings.push(...validateLevel(JSON.parse(fs.readFileSync(path.join(levelDir, file), 'utf8')), `levels/${file}`));
  } catch (err) {
    findings.push(`levels/${file}: ${err.message}`);
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('lint: ok');
