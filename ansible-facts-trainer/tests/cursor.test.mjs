import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { locateCaret } from '../cursor.js';

const PLAY = '---\n- name: Facts\n  hosts: all\n';

test('the start of the text is line 1, column 1', () => {
  assert.deepEqual(locateCaret(PLAY, 0), { line: 1, column: 1, cell: 0 });
});

test('a caret at the end of a line stays on that line', () => {
  assert.deepEqual(locateCaret(PLAY, 3), { line: 1, column: 4, cell: 3 });
});

test('a caret just after a newline is at the start of the next line', () => {
  assert.deepEqual(locateCaret(PLAY, 4), { line: 2, column: 1, cell: 0 });
});

test('indentation counts one screen column per space', () => {
  const offset = PLAY.indexOf('hosts');
  assert.deepEqual(locateCaret(PLAY, offset), { line: 3, column: 3, cell: 2 });
});

test('the end of text after a trailing newline is an empty last line', () => {
  assert.deepEqual(locateCaret(PLAY, PLAY.length), { line: 4, column: 1, cell: 0 });
});

test('a tab advances the screen column to the next tab stop', () => {
  assert.deepEqual(locateCaret('\tkey', 1), { line: 1, column: 2, cell: 2 });
  assert.deepEqual(locateCaret('a\tkey', 2), { line: 1, column: 3, cell: 2 });
});

test('an offset outside the text is clamped', () => {
  assert.deepEqual(locateCaret('ab', 99), { line: 1, column: 3, cell: 2 });
  assert.deepEqual(locateCaret('ab', -5), { line: 1, column: 1, cell: 0 });
  assert.deepEqual(locateCaret('', NaN), { line: 1, column: 1, cell: 0 });
});

test('the tab size in cursor.js matches the editor stylesheet', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../cursor.js', import.meta.url), 'utf8');
  assert.equal(/TAB_SIZE = (\d+)/.exec(source)[1], /#editor \{[^}]*tab-size:(\d+)/.exec(page)[1]);
});

test('the page has the cursor layer the script draws into', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['cursor-marks', 'cursor-line', 'cursor-column', 'cursor-block']) {
    assert.ok(page.includes(`id="${id}"`), `missing #${id}`);
  }
});
