import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeYaml } from '../highlight.js';

const join = (tokens) => tokens.map((t) => t.text).join('');
const classesOf = (text) => tokenizeYaml(text).filter((t) => t.cls).map((t) => `${t.cls}:${t.text}`);

test('tokenizing is lossless for every input, so the overlay always lines up with the text', () => {
  for (const text of [
    '', '\n', '---\n', '- name: x', "  msg: \"{{ ansible_facts['hostname'] }}\"\n", 'a\r\nb\r\n', '\tkey: v', ': : :', '{{ {{ }} }}',
    '# only a comment', 'key: "unterminated', "key: 'it''s'", '   ', '- - - x', 'msg: {{ unbalanced', 'k: v # trailing', '🙂: ünïcode',
  ]) assert.equal(join(tokenizeYaml(text)), text, JSON.stringify(text));
});

test('a playbook line is split into dash, key, colon, and value', () => {
  assert.deepEqual(classesOf('    - name: Display facts'), ['dash:-', 'key:name', 'punct::']);
  assert.deepEqual(classesOf('  hosts: servera'), ['key:hosts', 'punct::']);
  assert.deepEqual(classesOf('      ansible.builtin.debug:'), ['key:ansible.builtin.debug', 'punct::']);
});

test('the document marker and comments get their own classes', () => {
  assert.deepEqual(classesOf('---'), ['doc:---']);
  assert.deepEqual(classesOf('  # a note'), ['comment:# a note']);
});

test('a quoted value is a string, with each Jinja expression marked inside it', () => {
  assert.deepEqual(classesOf("msg: \"Host {{ ansible_facts['hostname'] }} up\""), [
    'key:msg', 'punct::', 'str:"Host ', "jinja:{{ ansible_facts['hostname'] }}", 'str: up"',
  ]);
});

test('a list item that is a quoted string with Jinja is colored the same way', () => {
  assert.deepEqual(classesOf('          - "FQDN: {{ ansible_facts[\'fqdn\'] }}"'), [
    'dash:-', 'str:"FQDN: ', "jinja:{{ ansible_facts['fqdn'] }}", 'str:"',
  ]);
});

test('booleans and numbers are marked; plain words are not', () => {
  assert.deepEqual(classesOf('  gather_facts: false'), ['key:gather_facts', 'punct::', 'num:false']);
  assert.deepEqual(classesOf('  port: 22'), ['key:port', 'punct::', 'num:22']);
  assert.deepEqual(classesOf('  hosts: all'), ['key:hosts', 'punct::']);
});

test('a colon inside a quoted list item is not mistaken for a key', () => {
  assert.deepEqual(classesOf('- "Hostname: x"'), ['dash:-', 'str:"Hostname: x"']);
});
