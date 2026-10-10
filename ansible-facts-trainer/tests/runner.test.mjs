import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPlaybook } from '../runner.js';

const FACTS = { hostname: 'servera', fqdn: 'servera.ytt.lab', os_family: 'RedHat', memtotal_mb: 567 };
const HOSTNAME = { id: 't', tier: 2, requires: [['hostname']] };
const HEADER = '---\n- name: Display facts\n  hosts: servera\n  tasks:\n';
const TASK = '    - name: Display the hostname\n      ansible.builtin.debug:\n        msg: "The hostname is {{ ansible_facts[\'hostname\'] }}"\n';
const run = (text, challenge = HOSTNAME) => runPlaybook(text, challenge, FACTS, 'servera');
const lines = (r) => r.terminal.split('\n');

test('a correct playbook prints a full simulated run and passes', () => {
  const r = run(HEADER + TASK);
  assert.equal(r.verdict.ok, true);
  assert.equal(lines(r)[0].startsWith('PLAY [Display facts] '), true, 'the output starts at the PLAY banner; the shell prints the command');
  assert.match(r.terminal, /^PLAY \[Display facts\] \*{3,}$/m);
  assert.match(r.terminal, /^TASK \[Gathering Facts\] \*{3,}\nok: \[servera\]$/m);
  assert.match(r.terminal, /^TASK \[Display the hostname\] \*{3,}\nok: \[servera\] => \{\n    "msg": "The hostname is servera"\n\}$/m);
  assert.match(r.terminal, /^PLAY RECAP \*{3,}$/m);
  assert.match(r.terminal, /^servera +: ok=2 +changed=0 +unreachable=0 +failed=0 +skipped=0 +rescued=0 +ignored=0$/m);
});

test('every banner line is the same width', () => {
  const widths = lines(run(HEADER + TASK)).filter((l) => /\*{3,}$/.test(l)).map((l) => l.length);
  assert.equal(widths.length, 4);
  assert.equal(new Set(widths).size, 1);
});

test('a play without a name is titled by its hosts, as Ansible does', () => {
  const r = run('---\n- hosts: servera\n  tasks:\n' + TASK);
  assert.equal(r.verdict.ok, true);
  assert.match(r.terminal, /^PLAY \[servera\] \*/m);
});

test('hosts: all and a host list that includes the target both run', () => {
  assert.equal(run(HEADER.replace('hosts: servera', 'hosts: all') + TASK).verdict.ok, true);
  assert.equal(run(HEADER.replace('hosts: servera', 'hosts:\n    - serverb\n    - servera') + TASK).verdict.ok, true);
});

test('a valid task that reads the wrong fact still runs; only the coach verdict fails', () => {
  const r = run(HEADER + TASK.replace("['hostname']", "['fqdn']"));
  assert.equal(r.verdict.ok, false);
  assert.equal(r.verdict.code, 'WRONG_FACT');
  assert.match(r.terminal, /"msg": "The hostname is servera\.ytt\.lab"/);
  assert.match(r.terminal, /ok=2 .*failed=0/);
});

test('a YAML error is reported the way ansible-playbook reports it, with the file line', () => {
  const r = run(HEADER + '    - name: x\n      ansible.builtin.debug:\n        msg: "unterminated\n');
  assert.equal(r.verdict.code, 'YAML_SYNTAX');
  assert.match(r.terminal, /^Syntax Error while loading YAML\.$/m);
  assert.match(r.terminal, /The error appears to be in '\/home\/student\/my-project-directory\/facts\.yml': line \d+, column \d+/);
  assert.doesNotMatch(r.terminal, /PLAY RECAP/);
  assert.ok(r.verdict.line >= 5, 'the line number counts from the top of the file');
});

test('an undefined fact fails at run time with a fatal line and failed=1', () => {
  const r = run(HEADER + TASK.replace("['hostname']", "['host_name']"));
  assert.equal(r.verdict.code, 'UNDEFINED_FACT');
  assert.match(r.terminal, /^TASK \[Display the hostname\] \*/m);
  assert.match(r.terminal, /^fatal: \[servera\]: FAILED! => \{"msg": "The task includes an option with an undefined variable\./m);
  assert.match(r.terminal, /ok=1 .*failed=1/);
});

test('a malformed expression fails at run time as a template error', () => {
  const r = run(HEADER + TASK.replace("['hostname']", "['hostname'"));
  assert.equal(r.verdict.code, 'BAD_EXPRESSION');
  assert.match(r.terminal, /^fatal: \[servera\]: FAILED! => \{"msg": "template error while templating string/m);
  assert.match(r.terminal, /failed=1/);
});

test('gather_facts: false leaves ansible_facts empty, and the coach says why', () => {
  for (const off of ['false', 'no']) {
    const r = run(HEADER.replace('  tasks:', `  gather_facts: ${off}\n  tasks:`) + TASK);
    assert.equal(r.verdict.code, 'UNDEFINED_FACT', off);
    assert.match(r.verdict.message, /gather_facts/, off);
    assert.doesNotMatch(r.terminal, /Gathering Facts/, off);
    assert.match(r.terminal, /ok=0 .*failed=1/, off);
  }
});

test('a host pattern that matches nothing skips the play, as Ansible does', () => {
  const r = run(HEADER.replace('hosts: servera', 'hosts: serverz') + TASK);
  assert.equal(r.verdict.code, 'NO_HOSTS_MATCHED');
  assert.match(r.terminal, /\[WARNING\]: Could not match supplied host pattern, ignoring: serverz/);
  assert.match(r.terminal, /^skipping: no hosts matched$/m);
});

test('a play with no task yet gathers facts and tells the learner to add one', () => {
  for (const text of [HEADER, HEADER + '    ', HEADER.replace('  tasks:\n', '')]) {
    const r = run(text);
    assert.equal(r.verdict.code, 'NO_TASKS');
    assert.match(r.terminal, /ok=1 .*failed=0/);
  }
});

test('a broken play header is explained in playbook terms', () => {
  assert.equal(run('').verdict.code, 'NOT_A_PLAY');
  assert.match(run('').terminal, /ERROR! Empty playbook, nothing to do/);
  const mapping = run('name: p\nhosts: servera\ntasks: []\n');
  assert.equal(mapping.verdict.code, 'NOT_A_PLAY');
  assert.match(mapping.terminal, /ERROR! A playbook must be a list of plays/);
  const noHosts = run('---\n- name: p\n  tasks:\n' + TASK);
  assert.equal(noHosts.verdict.code, 'NOT_A_PLAY');
  assert.match(noHosts.terminal, /ERROR! the field 'hosts' is required but was not set/);
});

test('a bare task pasted without the play header is told to restore the header', () => {
  const r = run("- name: n\n  ansible.builtin.debug:\n    msg: \"{{ ansible_facts['hostname'] }}\"\n");
  assert.equal(r.verdict.code, 'NOT_A_PLAY');
  assert.match(r.verdict.message, /hosts/);
});

test('a task key at the play level is reported as a bad play attribute', () => {
  const r = run(HEADER + '  ansible.builtin.debug:\n    msg: "x"\n');
  assert.equal(r.verdict.code, 'BAD_PLAY_KEY');
  assert.match(r.terminal, /ERROR! 'ansible\.builtin\.debug' is not a valid attribute for a Play/);
  assert.match(r.verdict.message, /tasks:/);
});

test('a misspelled module is reported the way Ansible reports it', () => {
  const r = run(HEADER + '    - name: x\n      debugg:\n        msg: "x"\n');
  assert.equal(r.verdict.code, 'UNKNOWN_MODULE');
  assert.match(r.terminal, /ERROR! couldn't resolve module\/action 'debugg'\./);
});

test('tasks written as a mapping, two tasks, and two plays are each explained', () => {
  assert.equal(run(HEADER + '    name: x\n    ansible.builtin.debug:\n      msg: "x"\n').verdict.code, 'NOT_A_LIST');
  assert.equal(run(HEADER + TASK + TASK).verdict.code, 'EXTRA_TASKS');
  assert.equal(run(HEADER + TASK + '- name: second\n  hosts: servera\n  tasks: []\n').verdict.code, 'EXTRA_PLAYS');
});

test('play keywords outside the trainer scope are called valid but out of scope', () => {
  const r = run(HEADER.replace('  tasks:', '  vars:\n    x: 1\n  tasks:') + TASK);
  assert.equal(r.verdict.code, 'UNSUPPORTED_KEYWORD');
  assert.match(r.verdict.message, /valid Ansible/);
  assert.match(r.terminal, /Not run/);
});

test('an untouched fill-in placeholder is caught before anything runs', () => {
  const r = run(HEADER + TASK.replace("ansible_facts['hostname']", 'FACT_GOES_HERE'));
  assert.equal(r.verdict.code, 'PLACEHOLDER');
  assert.match(r.terminal, /Not run/);
});

test('an oversized file is refused', () => {
  assert.equal(run(HEADER + TASK + '#'.repeat(11000)).verdict.code, 'TOO_LARGE');
});

test('the short module name passes with advice, and the advice reaches the verdict', () => {
  const r = run(HEADER + TASK.replace('ansible.builtin.debug', 'debug'));
  assert.equal(r.verdict.ok, true);
  assert.match(r.verdict.note, /ansible\.builtin\.debug/);
});

// ---- Failures should read like the real thing ---------------------------------------

test('an undefined fact: the fatal line carries Ansible\'s own wording and the task location', () => {
  const r = run(HEADER + TASK.replace("['hostname']", "['host_name']"));
  const fatal = lines(r).find((l) => l.startsWith('fatal:'));
  const msg = JSON.parse(fatal.slice(fatal.indexOf('=> ') + 3)).msg;
  assert.ok(msg.startsWith("The task includes an option with an undefined variable. The error was: 'dict object' has no attribute 'host_name'. 'dict object' has no attribute 'host_name'\n"), msg);
  assert.match(msg, /The error appears to be in '\/home\/student\/my-project-directory\/facts\.yml': line 5, column 7, but may\nbe elsewhere in the file depending on the exact syntax problem\./);
  assert.ok(msg.endsWith('The offending line appears to be:\n\n  tasks:\n    - name: Display the hostname\n      ^ here\n'), msg);
  assert.equal(lines(r).filter((l) => l.startsWith('fatal:')).length, 1, 'the whole message is one JSON line, as Ansible prints it');
});

test('undefined-variable wording follows the kind of value that was indexed', () => {
  const big = { ...FACTS, mounts: [{ device: '/dev/sda1' }] };
  const wording = (expr) => {
    const r = runPlaybook(HEADER + TASK.replace("ansible_facts['hostname']", expr), HOSTNAME, big, 'servera');
    const fatal = r.terminal.split('\n').find((l) => l.startsWith('fatal:'));
    return JSON.parse(fatal.slice(fatal.indexOf('=> ') + 3)).msg.split('\n')[0];
  };
  assert.match(wording("ansible_facts['mounts']['device']"), /'list object' has no attribute 'device'/);
  assert.match(wording("ansible_facts['mounts'][5]"), /list object has no element 5/);
  assert.match(wording("ansible_facts['hostname']['x']"), /'str object' has no attribute 'x'/);
  assert.match(wording("ansible_facts['memtotal_mb']['x']"), /'int object' has no attribute 'x'/);
  assert.match(wording("ansible_facts['mounts'] | select('match', 'zzz') | first"), /No first item, sequence was empty\./);
  assert.match(wording('ansible_facts[hostname]'), /The error was: 'hostname' is undefined\. 'hostname' is undefined/, 'an unquoted key is an undefined variable in real Jinja2');
});

test('a YAML error prints Ansible\'s preamble and points at the offending line with a caret', () => {
  const r = run(HEADER + '    - name: x\n      ansible.builtin.debug:\n        msg: "unterminated\n');
  const out = lines(r);
  assert.equal(out[0], 'ERROR! We were unable to read either as JSON nor YAML, these are the errors we got from each:');
  assert.match(out[1], /^JSON: /);
  assert.equal(out[3], 'Syntax Error while loading YAML.');
  const at = out.indexOf('The offending line appears to be:');
  assert.ok(at > 0);
  assert.equal(out[at + 1], '');
  assert.match(out.at(-1), /^ *\^ here$/);
  assert.ok(out.slice(at + 2, -1).length >= 1, 'at least the offending line is quoted');
  assert.ok(out.slice(at + 2, -1).every((l) => (HEADER + '    - name: x\n      ansible.builtin.debug:\n        msg: "unterminated\n').split('\n').includes(l)), 'quoted lines come from the file');
});

test('a template error names the string that failed, as Ansible does', () => {
  const r = run(HEADER + TASK.replace("['hostname']", "['hostname'"));
  const fatal = lines(r).find((l) => l.startsWith('fatal:'));
  const msg = JSON.parse(fatal.slice(fatal.indexOf('=> ') + 3)).msg;
  assert.match(msg, /^template error while templating string: /);
  assert.match(msg, /String: The hostname is \{\{ ansible_facts\['hostname' \}\}/);
});

test('with facts off, the wording is still Ansible\'s, and the coach adds the reason', () => {
  const r = run(HEADER.replace('  tasks:', '  gather_facts: false\n  tasks:') + TASK);
  const fatal = lines(r).find((l) => l.startsWith('fatal:'));
  assert.match(fatal, /'dict object' has no attribute 'hostname'/);
  assert.match(r.verdict.message, /gather_facts/);
});
