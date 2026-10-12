import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charClasses, segments } from '../highlight.js';

const parts = (text) => segments(text).map((part) => `${part.cls || '-'}:${part.text}`);

test('a key and a plain value', () => {
  assert.deepEqual(parts('  hosts: servera'), ['lead:  ', 'tok-key:hosts', 'tok-punct::', '-: ', 'tok-val:servera']);
});

test('a dash opens an item; the document marker is all dash', () => {
  assert.deepEqual(parts('- name: A play'), ['tok-dash:-', '-: ', 'tok-key:name', 'tok-punct::', '-: ', 'tok-val:A play']);
  assert.deepEqual(parts('---'), ['tok-dash:---']);
  assert.deepEqual(parts('      - httpd'), ['lead:      ', 'tok-dash:-', '-: ', 'tok-val:httpd']);
});

test('booleans, numbers, quoted text and the pipe each get their own colour', () => {
  assert.equal(charClasses('  become: true').at(-1), 'tok-bool');
  assert.equal(charClasses('    http_port: 8080').at(-1), 'tok-num');
  assert.equal(charClasses("        mode: '0644'").at(-1), 'tok-str');
  assert.equal(charClasses('        name: "{{ web_packages }}"').at(-1), 'tok-str');
  assert.equal(charClasses('        content: |').at(-1), 'tok-pipe');
});

test('a trailing comment is a comment, but a # inside quotes is not', () => {
  assert.deepEqual(parts('  vars: # the variables'), ['lead:  ', 'tok-key:vars', 'tok-punct::', '-: ', 'tok-comment:# the variables']);
  assert.equal(charClasses('  name: "issue #4"').includes('tok-comment'), false);
  assert.deepEqual(parts('  # note'), ['lead:  ', 'tok-comment:# note']);
});

test('a module name with dots is one key; block text has no key', () => {
  assert.equal(parts('      ansible.builtin.dnf:')[1], 'tok-key:ansible.builtin.dnf');
  assert.deepEqual(parts('          ServerTokens Prod'), ['lead:          ', 'tok-val:ServerTokens Prod']);
});

test('one class per character, for any input', () => {
  for (const text of ['', ' ', '-', '- ', 'a:', ':', '  - a: b # c', "when: x == 'y'"]) {
    assert.equal(charClasses(text).length, text.length);
  }
});
