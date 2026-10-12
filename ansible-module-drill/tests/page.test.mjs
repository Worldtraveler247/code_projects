import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MODULES } from '../modules.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const PAGE = read('index.html');
const APP = read('app.js');
const HUB = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('the page allows scripts from its own origin only and has no inline script', () => {
  assert.match(PAGE, /script-src 'self';/);
  assert.equal((PAGE.match(/<script/g) || []).length, 1);
  assert.match(PAGE, /<script type="module" src="app\.js"><\/script>/);
  assert.equal(/\son[a-z]+=/.test(PAGE), false, 'no inline event handlers');
});

test('nothing typed by the player is written to the page as markup', () => {
  for (const name of ['app.js', 'game.js']) {
    assert.equal(/innerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(read(name)), false, name);
  }
});

test('every element the script looks up exists on the page, once', () => {
  const ids = [...APP.matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 40);
  for (const id of ids) assert.equal(PAGE.split(`id="${id}"`).length - 1, 1, `#${id}`);
});

test('every file the page imports is in the repository', () => {
  for (const name of ['app.js', 'game.js']) {
    for (const match of read(name).matchAll(/from '(\.[^']+)'/g)) {
      assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), `${name} imports ${match[1]}`);
    }
  }
});

test('the page says how many modules it has, and links to the hub and its build notes', () => {
  assert.equal(MODULES.length, 31);
  assert.match(PAGE, /Thirty-one modules across ten/);
  assert.match(PAGE, /href="\.\.\/index\.html"/);
  assert.match(PAGE, /href="how-it-works\.html"/);
  assert.ok(existsSync(new URL('../how-it-works.html', import.meta.url)));
});

test('the hub has a card for the drill', () => {
  assert.match(HUB, /href="ansible-module-drill\/index\.html"/);
  assert.match(HUB, /href="ansible-module-drill\/how-it-works\.html"/);
});
