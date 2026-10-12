import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from '../vendor/js-yaml.mjs';
import { check } from '../checker.js';
import { EXERCISES } from '../exercises.js';

const PAGE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const decode = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('the page allows scripts from its own origin only and has no inline script', () => {
  assert.match(PAGE, /script-src 'self';/);
  assert.equal((PAGE.match(/<script/g) || []).length, 1);
  assert.match(PAGE, /<script type="module" src="app\.js"><\/script>/);
  assert.equal(/\son[a-z]+=/.test(PAGE), false, 'no inline event handlers');
});

test('nothing typed by the learner is written to the page as markup', () => {
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(APP), false);
});

test('every element the script looks up exists on the page', () => {
  const ids = [...APP.matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 15);
  for (const id of ids) assert.ok(PAGE.includes(`id="${id}"`), `missing #${id}`);
});

test('the annotated example in the guide is the capstone, and it passes the checker', () => {
  const pre = PAGE.match(/<pre tabindex="0" aria-label="Annotated example playbook">([\s\S]*?)<\/pre>/);
  assert.ok(pre);
  const text = decode(pre[1]);
  const capstone = EXERCISES.find((exercise) => exercise.id === 'capstone');
  assert.deepEqual(load(text), capstone.plays);
  assert.equal(check(text, capstone).passed, true);
});

test('the page links back to the hub and to its build notes', () => {
  assert.match(PAGE, /href="\.\.\/index\.html"/);
  assert.match(PAGE, /href="how-it-works\.html"/);
});
