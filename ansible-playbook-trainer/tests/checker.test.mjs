import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, parseLine } from '../checker.js';
import { FIXTURES } from './fixtures.mjs';

const byId = (id) => FIXTURES.find((exercise) => exercise.id === id);
const lineOf = (text, exercise, needle) => {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  return check(text, exercise).lines[index];
};

test('parseLine recognises the line shapes', () => {
  assert.equal(parseLine('').kind, 'blank');
  assert.equal(parseLine('  # note').kind, 'comment');
  assert.deepEqual(parseLine('---'), { kind: 'doc', indent: 0 });
  assert.deepEqual(parseLine('  hosts: servera'), { kind: 'entry', indent: 2, dash: false, key: 'hosts', value: 'servera' });
  assert.deepEqual(parseLine('- name: A play'), { kind: 'entry', indent: 0, dash: true, key: 'name', value: 'A play' });
  assert.deepEqual(parseLine('  vars:   # the variables'), { kind: 'entry', indent: 2, dash: false, key: 'vars', value: '' });
  assert.deepEqual(parseLine('      - httpd'), { kind: 'item', indent: 6, value: 'httpd' });
  assert.equal(parseLine('      ansible.builtin.dnf:').key, 'ansible.builtin.dnf');
});

test('parseLine explains the common typing mistakes', () => {
  assert.match(parseLine('\thosts: a').why, /tab/);
  assert.match(parseLine('   hosts: a').why, /3 spaces/);
  assert.match(parseLine('  hosts:servera').why, /space after the colon/);
  assert.match(parseLine('-name: x').why, /space after the dash/);
  assert.match(parseLine('-  name: x').why, /exactly one space/);
  assert.match(parseLine('  hosts servera').why, /colon/);
});

test('a play key at the wrong depth is red and says where it belongs', () => {
  const exercise = byId('play-become');
  const text = '---\n- name: Patch the database tier\n  hosts: serverb\n    become: true';
  const line = lineOf(text, exercise, 'become');
  assert.equal(line.status, 'bad');
  assert.match(line.why, /4 spaces/);
});

test('a play key in column 1 without a dash belongs to no play', () => {
  const exercise = byId('play-name-hosts');
  const line = lineOf('---\n- name: Check connectivity\nhosts: servera', exercise, 'hosts');
  assert.equal(line.status, 'bad');
  assert.match(line.why, /belongs to no play/);
});

test('a dash on a second play key is red', () => {
  const exercise = byId('play-name-hosts');
  const line = lineOf('---\n- name: Check connectivity\n  - hosts: servera', exercise, 'hosts');
  assert.equal(line.status, 'bad');
  assert.match(line.why, /Remove the dash/);
});

test('a right place with the wrong value is amber, not red', () => {
  const exercise = byId('play-name-hosts');
  const line = lineOf('---\n- name: Check connectivity\n  hosts: serverz', exercise, 'hosts');
  assert.equal(line.status, 'warn');
  assert.match(line.why, /"servera"/);
});

test('a key the brief does not ask for is amber', () => {
  const exercise = byId('play-name-hosts');
  const line = lineOf('---\n- name: Check connectivity\n  hosts: servera\n  become: true', exercise, 'become');
  assert.equal(line.status, 'warn');
  assert.equal(check('---\n- name: Check connectivity\n  hosts: servera\n  become: true', exercise).passed, false);
});

test('a misspelt play keyword is red', () => {
  const exercise = byId('play-name-hosts');
  const line = lineOf('---\n- name: Check connectivity\n  host: servera', exercise, 'host:');
  assert.equal(line.status, 'bad');
  assert.match(line.why, /not a play keyword/);
});

test('the document marker is required, once, on top', () => {
  const exercise = byId('play-name-hosts');
  const without = check('- name: Check connectivity\n  hosts: servera', exercise);
  assert.equal(without.passed, false);
  assert.equal(without.bad, 0);
  const late = check('- name: Check connectivity\n---\n  hosts: servera', exercise);
  assert.equal(late.lines[1].status, 'bad');
});

test('when under the module is red and names the right column', () => {
  const exercise = byId('task-when');
  const text = [
    '---', '- name: Install the web server', '  hosts: servera', '  become: true', '  gather_facts: true',
    '  tasks:', '    - name: Install httpd on Red Hat systems', '      ansible.builtin.dnf:',
    '        name: httpd', '        state: present', "        when: ansible_facts['os_family'] == 'RedHat'",
  ].join('\n');
  const line = lineOf(text, exercise, 'when');
  assert.equal(line.status, 'bad');
  assert.match(line.why, /sits at 6 spaces/);
});

test('module arguments left at 6 spaces are red', () => {
  const exercise = byId('task-one');
  const text = [
    '---', '- name: Install time sync', '  hosts: servera', '  become: true', '  tasks:',
    '    - name: Install chrony', '      ansible.builtin.dnf:', '      name: chrony', '      state: present',
  ].join('\n');
  const result = check(text, exercise);
  assert.equal(result.lines[7].status, 'bad');
  assert.match(result.lines[7].why, /already appears/);
  assert.equal(result.lines[8].status, 'bad');
  assert.match(result.lines[8].why, /exactly one module/);
});

test('a task without its dash is red', () => {
  const exercise = byId('task-one');
  const text = '---\n- name: Install time sync\n  hosts: servera\n  become: true\n  tasks:\n    name: Install chrony';
  const line = check(text, exercise).lines[5];
  assert.equal(line.status, 'bad');
  assert.match(line.why, /holds a list/);
});

test('an unquoted Jinja2 value is red and an unquoted mode is amber', () => {
  const vars = byId('task-with-vars');
  const head = '---\n- name: Deploy the database\n  hosts: serverb\n  become: true\n  vars:\n    db_package: mariadb-server\n    db_service: mariadb\n  tasks:\n    - name: Install the database package\n      ansible.builtin.dnf:\n';
  const jinja = lineOf(`${head}        name: {{ db_package }}`, vars, '{{ db_package }}');
  assert.equal(jinja.status, 'bad');
  assert.match(jinja.why, /quotes/);

  const modes = byId('task-three');
  const text = '---\n- name: Prepare the application account\n  hosts: serverc\n  become: true\n  tasks:\n    - name: Create the application group\n      ansible.builtin.group:\n        name: appsvc\n        state: present\n\n    - name: Create the application user\n      ansible.builtin.user:\n        name: appsvc\n        group: appsvc\n        shell: /sbin/nologin\n\n    - name: Create the application directory\n      ansible.builtin.file:\n        path: /opt/inventory\n        mode: 0750';
  const mode = lineOf(text, modes, 'mode');
  assert.equal(mode.status, 'warn');
  assert.match(mode.why, /Quote this value/);
});

test('single or double quotes are both accepted for text', () => {
  const exercise = byId('play-name-hosts');
  assert.equal(check('---\n- name: "Check connectivity"\n  hosts: \'servera\'', exercise).passed, true);
});

test('a flow-style list on one line is accepted', () => {
  const exercise = byId('vars-list');
  const text = '---\n- name: List the base packages\n  hosts: all\n  vars:\n    base_packages: [chrony, firewalld, vim-enhanced]';
  assert.equal(check(text, exercise).passed, true);
});

test('list items out of order do not pass', () => {
  const exercise = byId('vars-list');
  const text = '---\n- name: List the base packages\n  hosts: all\n  vars:\n    base_packages:\n      - firewalld\n      - chrony\n      - vim-enhanced';
  const result = check(text, exercise);
  assert.equal(result.passed, false);
  assert.equal(result.lines[5].status, 'warn');
});

test('a dash under vars is red; mixing items and keys is red', () => {
  const exercise = byId('vars-one');
  const line = lineOf('---\n- name: Set one variable\n  hosts: servera\n  vars:\n    - web_service: httpd', exercise, 'web_service');
  assert.equal(line.status, 'bad');
  const nested = byId('vars-nested');
  const text = '---\n- name: Describe the application\n  hosts: servera\n  vars:\n    app:\n      name: inventory\n      - port';
  assert.match(check(text, nested).lines[6].why, /mix/);
});

test('block text is compared exactly, and a wrong line turns the block amber', () => {
  const exercise = byId('task-notify-handler');
  const good = [
    '---', '- name: Harden the SSH daemon', '  hosts: serverb', '  become: true', '  tasks:',
    '    - name: Deploy the hardening settings', '      ansible.builtin.copy:',
    '        dest: /etc/ssh/sshd_config.d/50-hardening.conf', '        content: |',
    '          PermitRootLogin no', '          PasswordAuthentication no',
    "        owner: root", '        group: root', "        mode: '0600'", '      notify: Restart sshd',
    '  handlers:', '    - name: Restart sshd', '      ansible.builtin.service:',
    '        name: sshd', '        state: restarted',
  ];
  assert.equal(check(good.join('\n'), exercise).passed, true);
  const wrong = good.slice();
  wrong[9] = '          PermitRootLogin yes';
  const result = check(wrong.join('\n'), exercise);
  assert.equal(result.passed, false);
  assert.equal(result.lines[8].status, 'warn');
  assert.equal(result.lines[9].status, 'warn');
});

test('comments and blank lines are ignored', () => {
  const exercise = byId('play-name-hosts');
  assert.equal(check('# my first play\n---\n\n- name: Check connectivity\n  # target\n  hosts: servera\n', exercise).passed, true);
});

test('every reason for a correct line names its indentation', () => {
  const exercise = byId('capstone');
  // Covered per exercise elsewhere; here, spot-check the wording a learner reads.
  const text = '---\n- name: Deploy a hardened web server\n  hosts: servera';
  const result = check(text, exercise);
  assert.match(result.lines[0].why, /Column 1/);
  assert.match(result.lines[1].why, /dash in column 1 opens play 1/);
  assert.match(result.lines[2].why, /^2 spaces/);
});

test('a comment after a value or after a pipe is ignored', () => {
  const exercise = byId('play-name-hosts');
  assert.equal(check('---\n- name: Check connectivity  # the label\n  hosts: servera # who', exercise).passed, true);
  const block = byId('task-notify-handler');
  const text = [
    '---', '- name: Harden the SSH daemon', '  hosts: serverb', '  become: true', '  tasks:',
    '    - name: Deploy the hardening settings', '      ansible.builtin.copy:',
    '        dest: /etc/ssh/sshd_config.d/50-hardening.conf', '        content: |   # keep these lines',
    '          PermitRootLogin no', '          PasswordAuthentication no',
    '        owner: root', '        group: root', "        mode: '0600'", '      notify: Restart sshd',
    '  handlers:', '    - name: Restart sshd', '      ansible.builtin.service:',
    '        name: sshd', '        state: restarted',
  ].join('\n');
  assert.equal(check(text, block).passed, true);
});

test('gather_subset is accepted as an argument of the setup module, and still refused under others', () => {
  const play = (module) => ({
    plays: [{ name: 'Gather facts', hosts: 'servera', tasks: [{ name: 'Gather', [module]: { gather_subset: 'network' } }] }],
  });
  const text = (module) => `---\n- name: Gather facts\n  hosts: servera\n  tasks:\n    - name: Gather\n      ${module}:\n        gather_subset: network`;
  assert.equal(check(text('ansible.builtin.setup'), play('ansible.builtin.setup')).passed, true);
  assert.equal(check(text('ansible.builtin.dnf'), play('ansible.builtin.dnf')).bad, 1);
});
