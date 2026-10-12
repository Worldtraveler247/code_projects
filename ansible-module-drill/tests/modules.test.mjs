import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../ansible-playbook-trainer/checker.js';
import { AREAS, MODULES } from '../modules.js';
import { SPECS } from '../specs.js';
import { MESSAGES } from '../messages.js';
import { modelLines, reverseFqcn, reversePlays, starterText, writePlays } from '../game.js';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every name the module accepts for an option, aliases included.
const accepted = (fqcn) => Object.entries(SPECS[fqcn].options).flatMap(([name, option]) => [name, ...(option.aliases || [])]);

test('the deck is the 31 modules of the 10 objective areas, each listed once', () => {
  assert.equal(MODULES.length, 31);
  assert.equal(AREAS.length, 10);
  assert.equal(new Set(MODULES.map((mod) => mod.id)).size, 31);
  for (const area of AREAS) assert.ok(MODULES.some((mod) => mod.area === area.id), `${area.id} has no module`);
  for (const mod of MODULES) {
    assert.ok(AREAS.some((area) => area.id === mod.area), `${mod.id} names an unknown area`);
    assert.ok(SPECS[mod.fqcn], `${mod.fqcn} has no spec`);
    assert.equal(mod.fqcn.split('.').pop(), mod.id);
  }
});

function checkArgs(label, fqcn, args) {
  const spec = SPECS[fqcn].options;
  for (const [name, value] of Object.entries(args)) {
    assert.ok(spec[name], `${label}: ${fqcn} has no option ${name}`);
    if (spec[name].choices && spec[name].type !== 'bool') {
      assert.ok(spec[name].choices.includes(String(value)), `${label}: ${name}=${value} is not a valid choice`);
    }
    if (spec[name].type === 'bool') assert.equal(typeof value, 'boolean', `${label}: ${name} must be true or false`);
  }
  for (const name of Object.keys(spec)) {
    if (spec[name].required) assert.ok(name in args, `${label}: required option ${name} is missing`);
  }
}

for (const mod of MODULES) {
  test(`${mod.id}: both tasks use real options, valid choices and every required option`, () => {
    checkArgs('write', mod.fqcn, mod.args);
    checkArgs('reverse', reverseFqcn(mod), mod.reverse.args);
  });

  test(`${mod.id}: the model answers pass the checker, and the starter file has no faults`, () => {
    for (const plays of [writePlays(mod), reversePlays(mod)]) {
      assert.equal(check(modelLines(plays).join('\n'), { plays }).passed, true);
    }
    const starter = check(starterText(mod), { plays: writePlays(mod) });
    assert.equal(starter.bad + starter.warn, 0);
    assert.equal(starter.passed, false);
    assert.notDeepEqual(mod.reverse.args, mod.args, 'the reverse round must change something');
  });

  test(`${mod.id}: the three predictions are valid, and a mode is always quoted`, () => {
    assert.equal(mod.predict.length, 3);
    for (const run of mod.predict) {
      assert.ok(['ok', 'changed', 'skipped'].includes(run.answer));
      assert.ok(run.why.length > 20);
    }
    for (const args of [mod.args, mod.reverse.args]) {
      if ('mode' in args) assert.equal(typeof args.mode, 'string', 'an unquoted mode loses its leading zero');
    }
  });

  test(`${mod.id}: each fault is a real fault, and its message is the one Ansible prints for it`, () => {
    assert.ok(mod.faults.length >= 1);
    const spec = SPECS[mod.fqcn].options;
    mod.faults.forEach((fault, n) => {
      const message = fault.message || MESSAGES[mod.id][n];
      assert.ok(message && message !== 'NO MESSAGE', `fault ${n} has no message`);
      assert.ok(fault.option in mod.args, `fault ${n}: ${fault.option} is not in the task`);
      if (fault.kind === 'choice') {
        assert.ok(!spec[fault.option].choices.includes(fault.value), `fault ${n}: ${fault.value} is a valid choice`);
        assert.match(message, new RegExp(`^value of ${fault.option} must be one of: .+, got: ${escape(fault.value)}$`));
        for (const choice of spec[fault.option].choices) assert.ok(message.includes(choice), `fault ${n}: message omits ${choice}`);
      } else if (fault.kind === 'unsupported') {
        assert.ok(!accepted(mod.fqcn).includes(fault.typo), `fault ${n}: ${fault.typo} is accepted by the module`);
        assert.ok(!spec[fault.option].required, `fault ${n}: renaming a required option reports it as missing instead`);
        assert.match(message, new RegExp(`^Unsupported parameters for \\(.+\\) module: ${escape(fault.typo)}\\. Supported parameters include: `));
      } else if (fault.kind === 'missing') {
        assert.ok(spec[fault.option].required, `fault ${n}: ${fault.option} is not required`);
        assert.match(message, new RegExp(`\\b${fault.option}\\b.*required|required.*\\b${fault.option}\\b`));
      } else {
        assert.equal(fault.kind, 'custom');
        assert.ok(fault.why.length > 40);
        if (fault.typo) assert.ok(!accepted(mod.fqcn).includes(fault.typo));
      }
    });
  });
}

test('no practice value looks like a real secret or a private address', () => {
  const text = JSON.stringify(MODULES);
  assert.equal(/password:|passwd|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(text), false);
  const hosts = [...text.matchAll(/https?:\/\/([^/"\s]+)/g)].map((match) => match[1]);
  for (const host of hosts) assert.equal(host, 'repo.example.com');
  assert.equal(/http:\/\//.test(text), false, 'practice URLs use HTTPS');
});
