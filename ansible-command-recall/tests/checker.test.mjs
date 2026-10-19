import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, tokenize } from '../checker.js';
import { CARDS } from '../cards.js';

const card = (id) => CARDS.find((c) => c.id === id);
const ok = (id, typed) => check(card(id), typed).ok;

test('every card accepts its own answer', () => {
  for (const c of CARDS) assert.equal(check(c, c.answer).ok, true, c.id);
});

test('tokenize groups quoted words and drops the quotes', () => {
  assert.deepEqual(tokenize(`a -a "name=x comment='A B'"`), ['a', '-a', "name=x comment='A B'"]);
  assert.throws(() => tokenize('echo "open'), /unclosed/);
});

test('option order and -i placement do not matter', () => {
  assert.ok(ok('ping', 'ansible webservers -m ping -i inventory'));
  assert.ok(ok('hosts-web', 'ansible -i inventory --list-hosts webservers'));
  assert.ok(ok('inv-list', 'ansible-inventory --list -i inventory'));
});

test('key=value order, short module names, booleans and quote style do not matter', () => {
  assert.ok(ok('user-add', `ansible webservers -m user -a "state=present shell=/bin/bash name=ljames comment=\\"Lebron James\\""`));
  assert.ok(ok('user-remove', 'ansible webservers -m user -a "name=ljames remove=yes state=absent"'));
  assert.ok(ok('user-verify', "ansible webservers -a 'id ljames'"));
});

test('wrong values, modules and hosts are wrong', () => {
  assert.equal(ok('user-remove', 'ansible webservers -m user -a "name=ljames state=absent"'), false);
  assert.equal(ok('mkdir', 'ansible all -m file -a "path=/tmp/directory1 state=touch"'), false);
  assert.equal(ok('touch', 'ansible all -m file -a "path=/tmp/directory1/dev.txt state=touch"'), false);
  assert.equal(ok('facts', 'ansible servera -m setup > facts.txt'), false);
});

test('redirection may touch the file name', () => {
  assert.ok(ok('facts', 'ansible servera -b -m setup >facts.txt'));
});

test('curly quotes and en dashes are named, not just marked wrong', () => {
  assert.match(check(card('sudoers'), 'echo “ecamacho ALL=(ALL) NOPASSWD: ALL” > /etc/sudoers.d/ecamacho').reason, /Curly quotes/);
  assert.match(check(card('version'), 'ansible –version').reason, /en or em dash/);
});

test('case matters and the reason says so', () => {
  const verdict = check(card('passwd'), 'Passwd ecamacho');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /case-sensitive/);
});

test('ini answers ignore section order, line order, spacing and comments', () => {
  assert.ok(ok('cfg-full', '[privilege_escalation]\nbecome=False\n\n# lab\n[defaults]\nhost_key_checking=false\nremote_user = ecamacho\ninventory = /home/ecamacho/my-ansible-project/inventory'));
  assert.ok(ok('inv-full', '[webservers:children]\nprod\n[balancers]\nserverd\n[prod]\nserverc\nserverb\n[test]\nserverb\n[dev]\nservera'));
  assert.equal(ok('inv-full', '[webservers]\nprod\n[balancers]\nserverd\n[prod]\nserverc\nserverb\n[test]\nserverb\n[dev]\nservera'), false);
  assert.equal(ok('cfg-become', '[privilege_escalation]\nbecome = true'), false);
});

test('host lists ignore order, commas and repeats', () => {
  assert.ok(ok('predict-web', 'serverc, serverb'));
  assert.ok(ok('predict-all', 'serverd serverb servera serverc serverb'));
  assert.equal(ok('predict-web', 'serverb serverc serverd'), false);
});

test('a one-setting card accepts the line with or without its section header', () => {
  assert.ok(ok('cfg-remote-user', '[defaults]\nremote_user = ecamacho'));
  assert.ok(ok('cfg-remote-user', 'remote_user=ecamacho'));
  assert.equal(ok('cfg-remote-user', '[defaults]\nremote_user = root'), false);
});
