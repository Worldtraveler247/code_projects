import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../modules.js';
import { SPECS } from '../specs.js';
import {
  OUTCOMES, PAR_SECONDS, better, clock, collectionQuestion, docSummary, faultCase, labCommands, predictQuestion,
  requiredCorrect, requiredQuestion, stars, starterText, taskLines,
} from '../game.js';

const byId = (id) => MODULES.find((mod) => mod.id === id);

test('the starter file is the play header, with the cursor line indented for a task', () => {
  assert.equal(starterText(byId('user')), [
    '---', '- name: Drill the user module', '  hosts: servera', '  become: true', '  gather_facts: false', '', '  tasks:', '    ',
  ].join('\n'));
  assert.match(starterText(byId('debug')), /become: false/);
  // A block of text under an argument must not leak into the header.
  assert.equal(starterText(byId('blockinfile')).includes('log_level'), false);
});

test('the full-name question has exactly one right answer: the real collection', () => {
  for (const mod of MODULES) {
    const right = collectionQuestion(mod).choices.filter((choice) => choice.correct);
    assert.deepEqual(right.map((choice) => choice.label), [mod.fqcn]);
  }
  assert.match(collectionQuestion(byId('firewalld')).why, /ansible-galaxy collection install ansible\.posix/);
});

test('the required-options question matches the module spec', () => {
  for (const mod of MODULES) {
    const question = requiredQuestion(mod);
    const spec = SPECS[mod.fqcn].options;
    const required = Object.keys(spec).filter((name) => spec[name].required);
    assert.ok(question.options.length >= Math.min(6, Object.keys(spec).length), mod.id);
    assert.deepEqual(question.options.filter((option) => option.required).map((option) => option.name).sort(), required.sort());
    assert.equal(requiredCorrect(question, required), true);
    assert.equal(requiredCorrect(question, [...required, question.options.find((option) => !option.required).name]), false);
  }
  const none = requiredQuestion(byId('dnf'));
  assert.equal(requiredCorrect(none, []), true);
  assert.match(none.why, /None of them is required/);
});

test('the documentation panel lists required options first', () => {
  const summary = docSummary('ansible.posix.mount');
  assert.deepEqual(summary.slice(0, 2).map((option) => option.name), ['path', 'state']);
  assert.match(summary[1].detail, /one of: .*mounted/);
  assert.equal(summary.every((option) => typeof option.required === 'boolean'), true);
});

test('a prediction shows the command, and output that agrees with the answer', () => {
  const check = predictQuestion(byId('user'), 0);
  assert.equal(check.command, 'ansible-playbook drill.yml --check');
  assert.equal(check.output[1], 'changed: [servera]');
  assert.match(check.output[4], /ok=1 {2}changed=1 .*skipped=0/);
  const second = predictQuestion(byId('user'), 2);
  assert.equal(second.command, 'ansible-playbook drill.yml');
  assert.equal(second.output[1], 'ok: [servera]');
  assert.match(second.output[4], /ok=1 {2}changed=0/);
  const skipped = predictQuestion(byId('at'), 0);
  assert.equal(skipped.output[1], 'skipping: [servera]');
  assert.match(skipped.output[4], /ok=0 {2}changed=0 .*skipped=1/);
  for (const mod of MODULES) for (const run of [0, 1, 2]) assert.ok(OUTCOMES.includes(predictQuestion(mod, run).answer));
});

test('the modules that break the usual pattern are the ones the drill says they are', () => {
  const pattern = (id) => byId(id).predict.map((run) => run.answer).join(' ');
  assert.equal(pattern('user'), 'changed changed ok');
  assert.equal(pattern('systemd'), 'changed changed changed');
  assert.equal(pattern('at'), 'skipped changed ok');
  assert.equal(pattern('unarchive'), 'skipped changed ok');
  assert.equal(pattern('command'), 'changed changed ok');
  for (const id of ['debug', 'setup', 'stat']) assert.equal(pattern(id), 'ok ok ok');
});

test('every broken task has exactly one right pick, and the error names the host', () => {
  for (const mod of MODULES) {
    for (const fault of mod.faults) {
      const broken = faultCase(mod, fault);
      assert.equal(broken.picks.filter((pick) => pick.correct).length, 1, `${mod.id} ${fault.kind}`);
      assert.match(broken.error, /^fatal: \[servera\]: FAILED! => \{"changed": false, "msg": ".+"\}$/);
      assert.ok(broken.why.length > 40);
    }
  }
});

test('a wrong value or a wrong key is shown on its own line of the task', () => {
  const user = byId('user');
  const choice = faultCase(user, user.faults[0]);
  assert.equal(choice.picks.find((pick) => pick.correct).label, '        state: gone');
  assert.equal(choice.picks.length, taskLines(user).length);
  const typo = faultCase(user, user.faults[1]);
  assert.equal(typo.picks.find((pick) => pick.correct).label, '        shel: /bin/bash');
  const debug = byId('debug');
  assert.equal(faultCase(debug, debug.faults[0]).picks.find((pick) => pick.correct).label, '        msg: "Drilling on {{ inventory_hostnam }}"');
});

test('a missing option is removed from the task shown, lines under it included', () => {
  const repo = byId('yum_repository');
  const missing = faultCase(repo, repo.faults[0]);
  assert.equal(missing.shown.some((line) => /^ {8}name:/.test(line)), false);
  assert.equal(missing.shown[0], '    - name: Manage the drill repository');
  assert.deepEqual(missing.picks.filter((pick) => pick.correct).map((pick) => pick.label), ['name:']);
  assert.equal(missing.picks.length, 3);
  const block = byId('blockinfile');
  assert.equal(faultCase(block, block.faults[0]).shown.join('\n').includes('log_level'), true);
});

test('stars reward accuracy first, then pace', () => {
  assert.equal(stars(0, PAR_SECONDS), 3);
  assert.equal(stars(0, PAR_SECONDS + 1), 2);
  assert.equal(stars(2, 30), 2);
  assert.equal(stars(3, 30), 1);
});

test('the better of two results is kept', () => {
  const two = { stars: 2, seconds: 300, misses: 1 };
  assert.equal(better(undefined, two), two);
  assert.equal(better(two, { stars: 3, seconds: 500, misses: 0 }).stars, 3);
  assert.equal(better(two, { stars: 1, seconds: 100, misses: 4 }), two);
  assert.equal(better(two, { stars: 2, seconds: 250, misses: 2 }).seconds, 250);
});

test('the clock and the lab commands read as a person would type them', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(605.9), '10:05');
  const commands = labCommands(byId('copy'));
  assert.equal(commands[0], 'ansible-doc -l | grep copy');
  assert.ok(commands.includes('ansible-doc -s ansible.builtin.file'));
  assert.equal(commands.filter((command) => command === 'ansible-playbook drill.yml').length, 2);
  assert.equal(labCommands(byId('user')).some((command) => command.includes('ansible.builtin.file')), false);
  assert.equal(commands.some((command) => command.includes('#')), false);
});
