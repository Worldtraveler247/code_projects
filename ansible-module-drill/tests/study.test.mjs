import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../modules.js';
import { SPECS } from '../specs.js';
import { DOCS } from '../examples.js';
import { studySheet } from '../game.js';
import { calls, optionsUsed, plain, splitExamples } from '../tools/build-examples.mjs';

test('the doc markup macros are reduced to their text', () => {
  assert.equal(plain('Set O(state=absent) to remove C(/etc/hosts).'), 'Set state=absent to remove /etc/hosts.');
  assert.equal(plain('See L(the guide,https://example.com) and M(ansible.builtin.copy).'), 'See the guide and ansible.builtin.copy.');
});

test('an EXAMPLES block splits into its tasks, and an indented chunk stays with its task', () => {
  const raw = '\n- name: One\n  ansible.builtin.cron:\n    name: a\n\n- name: Two\n  ansible.builtin.shell: |\n    echo a\n\n    echo b\n';
  const chunks = splitExamples(raw);
  assert.equal(chunks.length, 2);
  assert.match(chunks[1], /echo a\n\n {4}echo b$/);
});

test('the options an example passes are found in every form Ansible accepts', () => {
  const names = ['ansible.builtin.command', 'command'];
  assert.deepEqual(optionsUsed('- name: x\n  ansible.builtin.command:\n    cmd: ls\n    chdir: /tmp\n  register: out', names), ['cmd', 'chdir']);
  assert.deepEqual(optionsUsed('- name: x\n  ansible.builtin.command: /bin/make creates=/x\n  args:\n    chdir: /src', names).sort(), ['chdir', 'creates', 'free_form']);
  assert.deepEqual(optionsUsed("# ansible all -m command -a 'chdir=/tmp ls'", names), ['chdir']);
  assert.equal(calls('- name: x\n  ansible.builtin.debug:\n    msg: hi', names), false);
});

test('every module has real examples, and at least one of them calls the module', () => {
  for (const mod of MODULES) {
    const doc = DOCS[mod.fqcn];
    assert.ok(doc, `${mod.fqcn} has no docs`);
    assert.ok(doc.summary, `${mod.fqcn} has no summary`);
    assert.ok(doc.examples.some((example) => example.calls), `${mod.fqcn} has no example that calls it`);
    for (const example of doc.examples) {
      assert.ok(example.code.trim(), `${mod.fqcn}: empty example`);
      for (const name of example.uses) assert.ok(SPECS[mod.fqcn].options[name], `${mod.fqcn}: example uses unknown option ${name}`);
    }
  }
});

test('an example that calls the module names it as written in its playbook', () => {
  for (const mod of MODULES) {
    const doc = DOCS[mod.fqcn];
    const names = [mod.fqcn, ...(doc.realName ? [doc.realName] : [])];
    for (const example of doc.examples.filter((item) => item.calls && !item.code.startsWith('#'))) {
      assert.ok(names.some((name) => example.code.includes(name)) || example.code.includes(`${mod.id}:`), `${mod.fqcn}: ${example.title}`);
    }
  }
});

test('every option has a description from ansible-doc', () => {
  for (const mod of MODULES) {
    for (const name of Object.keys(SPECS[mod.fqcn].options)) assert.ok(DOCS[mod.fqcn].options[name], `${mod.fqcn}: ${name}`);
  }
});

test('the study sheet lists required options first, then by use in the examples, and loses none', () => {
  for (const mod of MODULES) {
    const sheet = studySheet(mod.fqcn);
    const spec = SPECS[mod.fqcn].options;
    assert.deepEqual(sheet.required.map((row) => row.name).sort(), Object.keys(spec).filter((name) => spec[name].required).sort());
    assert.equal(sheet.common.length + sheet.rest.length, Object.keys(spec).length, mod.fqcn);
    sheet.common.forEach((row, i) => {
      if (i === 0) return;
      const prev = sheet.common[i - 1];
      assert.ok(Number(prev.required) > Number(row.required) || (prev.required === row.required && prev.count >= row.count), `${mod.fqcn}: ${row.name}`);
    });
    for (const row of sheet.rest) assert.equal(row.count, 0);
  }
});

test('the cron sheet matches its ansible-doc page', () => {
  const sheet = studySheet('ansible.builtin.cron');
  assert.deepEqual(sheet.required.map((row) => row.name), ['name']);
  assert.equal(sheet.common[1].name, 'job');
  assert.match(sheet.examples[0].code, /^- name: Ensure a job that runs at 2 and 5 exists/);
});

test('systemd is studied under the name its documentation uses', () => {
  assert.equal(studySheet('ansible.builtin.systemd').realName, 'ansible.builtin.systemd_service');
});
