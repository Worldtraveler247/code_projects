import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCode, appendRich } from '../rich.js';

// Minimal stand-in for `document`: enough to prove rich.js only ever creates nodes and sets text.
function fakeDocument() {
  const make = (tag) => ({
    tag, children: [], textContent: '', className: '',
    append(...nodes) { this.children.push(...nodes); },
  });
  return { createElement: make, createTextNode: (text) => ({ tag: '#text', text }) };
}

test('backticks split prose from code; unmatched backticks stay literal', () => {
  assert.deepEqual(splitCode('use `find .` here'), [
    { code: false, text: 'use ' }, { code: true, text: 'find .' }, { code: false, text: ' here' },
  ]);
  assert.deepEqual(splitCode('a lone ` tick'), [{ code: false, text: 'a lone ` tick' }]);
});

test('markup in level text renders as text, never as HTML', () => {
  const doc = fakeDocument();
  const p = doc.createElement('p');
  appendRich(doc, p, '<img src=x onerror=alert(1)> and `<script>`');
  assert.equal(p.children[0].tag, '#text');
  assert.equal(p.children[0].text, '<img src=x onerror=alert(1)> and ');
  assert.equal(p.children[1].tag, 'code');
  assert.equal(p.children[1].textContent, '<script>');
});
