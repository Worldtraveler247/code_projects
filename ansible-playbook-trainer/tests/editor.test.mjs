import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, getText, handleKey, insertText } from '../editor.js';

function type(state, keys) {
  let event = null;
  for (const key of keys) event = handleKey(state, key) || event;
  return event;
}
const chars = (text) => [...text];

test('starts in normal mode and ignores text until i is pressed', () => {
  const state = createEditor();
  type(state, chars('zq'));
  assert.equal(getText(state), '');
  type(state, ['i', ...chars('---'), 'Escape']);
  assert.equal(getText(state), '---');
  assert.equal(state.mode, 'normal');
});

test('Enter keeps the indentation of the current line', () => {
  const state = createEditor();
  type(state, ['i', ...chars('- name: Play'), 'Enter', 'Tab', ...chars('hosts: a'), 'Enter', ...chars('become: true')]);
  assert.equal(getText(state), '- name: Play\n  hosts: a\n  become: true');
});

test('Tab inserts spaces to the next 2-space step, never a tab character', () => {
  const state = createEditor();
  type(state, ['i', 'Tab', 'Tab', 'x', 'Tab']);
  assert.equal(getText(state), '    x ');
  assert.equal(getText(state).includes('\t'), false);
});

test('Backspace inside the indentation removes one whole level', () => {
  const state = createEditor();
  type(state, ['i', 'Tab', 'Tab', 'Backspace']);
  assert.equal(getText(state), '  ');
  type(state, ['a', 'b', 'Backspace']);
  assert.equal(getText(state), '  a');
});

test('Backspace at the start of a line joins it to the one above', () => {
  const state = createEditor('ab\ncd');
  type(state, ['j', 'i', 'Backspace']);
  assert.equal(getText(state), 'abcd');
  assert.deepEqual([state.row, state.col], [0, 2]);
});

test('o and O open a line below and above with the same indentation', () => {
  const state = createEditor('  hosts: a');
  type(state, ['o', ...chars('become: true'), 'Escape', 'k', 'O', ...chars('name: x'), 'Escape']);
  assert.equal(getText(state), '  name: x\n  hosts: a\n  become: true');
});

test('a, A and I enter insert mode at the right place', () => {
  const state = createEditor('  bc');
  type(state, ['$', 'a', 'd', 'Escape', 'I', 'a', 'Escape', '0', 'A', 'e', 'Escape']);
  assert.equal(getText(state), '  abcde');
});

test('h j k l and 0 $ ^ gg G move without changing text', () => {
  const state = createEditor('  one\ntwo\nthree');
  type(state, ['$']);
  assert.equal(state.col, 4);
  type(state, ['^']);
  assert.equal(state.col, 2);
  type(state, ['G']);
  assert.equal(state.row, 2);
  type(state, ['g', 'g']);
  assert.equal(state.row, 0);
  type(state, ['j', 'l', 'l', 'l', 'l', 'l']);
  assert.deepEqual([state.row, state.col], [1, 2]);
  type(state, ['k', 'h', '0']);
  assert.deepEqual([state.row, state.col], [0, 0]);
  assert.equal(getText(state), '  one\ntwo\nthree');
});

test('x deletes a character and dd deletes a line', () => {
  const state = createEditor('abc\ndef\nghi');
  type(state, ['x', 'j', 'd', 'd']);
  assert.equal(getText(state), 'bc\nghi');
  type(state, ['d', 'd', 'd', 'd']);
  assert.equal(getText(state), '');
  assert.deepEqual(state.lines, ['']);
});

test('yy and p copy a line; dd and P move one', () => {
  const state = createEditor('a\nb');
  type(state, ['y', 'y', 'p']);
  assert.equal(getText(state), 'a\na\nb');
  type(state, ['G', 'd', 'd', 'g', 'g', 'P']);
  assert.equal(getText(state), 'b\na\na');
});

test('u undoes a whole insert session, then each earlier change', () => {
  const state = createEditor('abc');
  type(state, ['A', ...chars('def'), 'Escape', 'x', 'u']);
  assert.equal(getText(state), 'abcdef');
  type(state, ['u']);
  assert.equal(getText(state), 'abc');
  type(state, ['u']);
  assert.equal(state.message, 'Already at oldest change');
});

test('an insert session that changes nothing leaves no undo step', () => {
  const state = createEditor('abc');
  type(state, ['i', 'Escape']);
  assert.equal(state.undo.length, 0);
});

test('a half-typed command such as d then j is cancelled', () => {
  const state = createEditor('a\nb');
  type(state, ['d', 'j']);
  assert.equal(getText(state), 'a\nb');
});

test(':w, :wq and :x report a write; :n and :prev navigate', () => {
  for (const command of ['w', 'wq', 'x']) {
    const state = createEditor('a');
    assert.deepEqual(type(state, [':', ...chars(command), 'Enter']), { type: 'write' });
    assert.equal(state.mode, 'normal');
  }
  assert.deepEqual(type(createEditor(), [':', 'n', 'Enter']), { type: 'next' });
  assert.deepEqual(type(createEditor(), [':', ...chars('prev'), 'Enter']), { type: 'prev' });
});

test('unknown commands report E492; :q explains itself; Escape cancels', () => {
  const state = createEditor('a');
  type(state, [':', ...chars('foo'), 'Enter']);
  assert.equal(state.message, 'E492: Not an editor command: foo');
  type(state, [':', 'q', 'Enter']);
  assert.match(state.message, /:w/);
  assert.equal(type(state, [':', 'w', 'Escape']), null);
  assert.equal(state.mode, 'normal');
});

test(':3 jumps to a line and :%d clears the buffer, undoably', () => {
  const state = createEditor('a\nb\nc');
  type(state, [':', '3', 'Enter']);
  assert.equal(state.row, 2);
  type(state, [':', '%', 'd', 'Enter']);
  assert.equal(getText(state), '');
  type(state, ['u']);
  assert.equal(getText(state), 'a\nb\nc');
});

test('pasted text is inserted as is, with tabs turned into spaces', () => {
  const state = createEditor();
  type(state, ['i']);
  insertText(state, '- name: x\r\n\thosts: a');
  assert.equal(getText(state), '- name: x\n  hosts: a');
  assert.deepEqual([state.row, state.col], [1, 10]);
});

test('the cursor never leaves the text', () => {
  const state = createEditor('ab\n\nabcd');
  type(state, ['k', 'h', 'G', '$', 'k', 'k', 'l', 'l', 'l']);
  assert.deepEqual([state.row, state.col], [0, 1]);
  type(state, ['j']);
  assert.deepEqual([state.row, state.col], [1, 0]);
});

test('typing a whole play with Vim keys produces the expected file', () => {
  const state = createEditor();
  type(state, [
    'i', ...chars('---'), 'Enter', ...chars('- name: Check connectivity'), 'Enter',
    'Tab', ...chars('hosts: servera'), 'Escape',
  ]);
  assert.equal(getText(state), '---\n- name: Check connectivity\n  hosts: servera');
});
