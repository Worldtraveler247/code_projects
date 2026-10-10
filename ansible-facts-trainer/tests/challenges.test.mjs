import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES as ALL_CHALLENGES } from '../challenges.js';

// This file covers the sixteen fundamentals. The exam-style scenarios are in scenarios.test.mjs.
const CHALLENGES = ALL_CHALLENGES.filter((c) => c.kind !== 'scenario');
import { FACTS, HOST } from '../facts.js';
import { PLACEHOLDER, runPlaybook } from '../runner.js';

const HEADER = '---\n- name: Display facts\n  hosts: servera\n  tasks:\n';
const run = (c, text) => runPlaybook(text, c, FACTS, HOST);
const check = (c, text) => run(c, text).verdict;
const byId = (id) => CHALLENGES.find((c) => c.id === id);
// Tier 1 is fill-in-the-blank: put an expression where the placeholder is.
const fill = (c, expression) => c.starter.replace(PLACEHOLDER, expression);
// Tiers 2 and up: indent a bare task beneath the play header, as a learner would type it.
const play = (task) => HEADER + task.split('\n').map((line) => (line.trim() ? `    ${line}` : line)).join('\n');

test('there are 16 challenges: five in each of three tiers, then one capstone, with unique ids', () => {
  assert.equal(CHALLENGES.length, 16);
  assert.deepEqual(CHALLENGES.map((c) => c.tier), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4]);
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, 16);
});

test('every challenge has the full record', () => {
  for (const c of CHALLENGES) {
    for (const field of ['id', 'prompt', 'hint', 'starter', 'solution']) {
      assert.equal(typeof c[field], 'string', `${c.id}.${field}`);
      assert.ok(c[field].length > 0, `${c.id}.${field}`);
    }
    assert.ok(Array.isArray(c.requires) && c.requires.length >= 1, `${c.id}.requires`);
    if (c.tier === 3) assert.ok(c.requires.length >= 2, `${c.id} must combine facts`);
  }
});

test('every starter is a playbook that opens with the play header', () => {
  for (const c of CHALLENGES) assert.ok(c.starter.startsWith(HEADER), c.id);
});

test('a tier-1 starter has exactly one blank and is caught if run untouched', () => {
  for (const c of CHALLENGES.filter((x) => x.tier === 1)) {
    assert.equal(c.starter.split(PLACEHOLDER).length - 1, 1, c.id);
    assert.equal(check(c, c.starter).code, 'PLACEHOLDER', c.id);
  }
});

test('a starter for the later tiers has no task yet, and says so when run', () => {
  for (const c of CHALLENGES.filter((x) => x.tier > 1)) {
    assert.equal(c.starter.includes(PLACEHOLDER), false, c.id);
    assert.equal(check(c, c.starter).code, 'NO_TASKS', c.id);
  }
});

test('every model answer is a whole playbook that passes against the real capture', () => {
  for (const c of CHALLENGES) {
    assert.ok(c.solution.startsWith(HEADER), c.id);
    const r = run(c, c.solution);
    assert.equal(r.verdict.ok, true, `${c.id}: ${r.verdict.code} ${r.verdict.message}`);
    assert.equal(r.verdict.note, undefined, `${c.id} should use the fully qualified module name`);
    assert.match(r.terminal, /ok=2 .*failed=0/, c.id);
  }
});

test('the trap: distribution does not answer the Red Hat family question', () => {
  const trap = byId('t1-os-family');
  assert.equal(check(trap, fill(trap, "ansible_facts['distribution']")).code, 'WRONG_FACT');
});

test('notation variants of a tier-1 answer all pass', () => {
  const c = byId('t1-ipv4');
  for (const expression of [
    "ansible_facts['default_ipv4']['address']",
    'ansible_facts.default_ipv4.address',
    "ansible_facts.default_ipv4['address']",
    'ansible_default_ipv4.address',
  ]) assert.equal(check(c, fill(c, expression)).ok, true, expression);
});

test('notation variants of a tier-2 answer all pass', () => {
  const c = byId('t2-hostname');
  for (const text of [
    "- name: Show it\n  ansible.builtin.debug:\n    msg: \"{{ ansible_facts['hostname'] }}\"\n",
    "- name: Show it\n  debug:\n    msg: 'Host: {{ ansible_facts.hostname }}'\n",
    '- name: Show it\n  debug:\n    msg: "{{ ansible_hostname }}"\n',
    "- name: Show it\n  ansible.builtin.debug:\n    var: ansible_facts['hostname']\n",
    '- name: Show it\n  debug:\n    var: ansible_facts.hostname\n',
  ]) assert.equal(check(c, play(text)).ok, true, text);
  const crlf = play("- name: Show it\n  debug:\n    msg: \"{{ ansible_facts['hostname'] }}\"\n").replaceAll('\n', '\r\n');
  assert.equal(check(c, crlf).ok, true, 'Windows line endings');
});

test('notation variants of a tier-3 answer all pass', () => {
  const c = byId('t3-network');
  for (const text of [
    "- name: n\n  debug:\n    msg: \"{{ ansible_facts['default_ipv4']['interface'] }} has {{ ansible_facts['default_ipv4']['address'] }}\"\n",
    '- name: n\n  debug:\n    msg: "{{ ansible_default_ipv4.address }} on {{ ansible_default_ipv4.interface }}"\n',
    "- name: n\n  debug:\n    msg:\n      - \"{{ ansible_facts.default_ipv4.interface }}\"\n      - \"{{ ansible_facts.default_ipv4.address }}\"\n",
  ]) assert.equal(check(c, play(text)).ok, true, text);
});

test('final review 1: the custom-fact challenge accepts the real Ansible path only', () => {
  const c = byId('t3-custom-fact');
  const answer = (expr) => play(`- name: n\n  debug:\n    msg: "{{ ansible_facts['hostname'] }} {{ ${expr} }}"\n`);
  assert.equal(check(c, answer("ansible_facts['ansible_local']['video']['info']['owner']")).ok, true);
  assert.equal(check(c, answer('ansible_local.video.info.owner')).ok, true);
  assert.equal(check(c, answer("ansible_facts['local']['video']['info']['owner']")).code, 'UNDEFINED_FACT');
});

test('final review 3: same-value facts are rejected in tier 1; true equivalents are accepted', () => {
  const ipv4 = byId('t1-ipv4');
  const lookalike = check(ipv4, fill(ipv4, "ansible_facts['all_ipv4_addresses'][0]"));
  assert.equal(lookalike.code, 'WRONG_FACT');
  assert.match(lookalike.message, /same value/);
  const mount = byId('t1-first-mount-device');
  assert.equal(check(mount, fill(mount, "ansible_facts['cmdline']['root']")).code, 'WRONG_FACT');
  assert.equal(check(byId('t2-memory'), play("- name: n\n  debug:\n    msg: \"{{ ansible_facts['memory_mb']['real']['total'] }} MB\"\n")).ok, true);
  assert.equal(check(byId('t3-network'), play('- name: n\n  debug:\n    msg: "{{ ansible_facts.default_ipv4.alias }} {{ ansible_facts.default_ipv4.address }}"\n')).ok, true);
});

test('capstone: the model answer is the course task, and prints all five lines', () => {
  const c = byId('capstone');
  assert.match(c.solution, /- name: Display Ansible Facts\n {6}ansible\.builtin\.debug:\n {8}msg:\n/);
  assert.match(c.solution, /select\('match', '192\.168\.50\.'\) \| first/);
  const r = run(c, c.solution);
  assert.equal(r.verdict.ok, true);
  for (const line of [
    '"Hostname: servera"',
    '"FQDN: servera.ytt.lab"',
    '"Distribution: CentOS 9"',
    '"Memory (MB): 567"',
    '"IPv4: 192.168.50.11"',
  ]) assert.ok(r.terminal.includes(line), `terminal should show ${line}`);
});

test('capstone: the lab address must come from a fact, and the NAT address is not it', () => {
  const c = byId('capstone');
  const withIp = (expr) => c.solution.replace("ansible_facts['all_ipv4_addresses'] | select('match', '192.168.50.') | first", expr);
  assert.notEqual(withIp('x'), c.solution, 'the replacement must find the model expression');
  assert.equal(check(c, withIp("ansible_facts['all_ipv4_addresses'] | select('match', '192\\\\.168\\\\.50\\\\.') | first")).ok, true, 'escaped dots');
  assert.equal(check(c, withIp("ansible_facts['all_ipv4_addresses'] | select('search', '168.50') | first")).ok, true, 'search');
  const nat = check(c, withIp("ansible_facts['default_ipv4']['address']"));
  assert.equal(nat.code, 'WRONG_FACT');
  assert.match(nat.message, /192\.168\.50/);
  const noFirst = check(c, withIp("ansible_facts['all_ipv4_addresses'] | select('match', '192.168.50.')"));
  assert.equal(noFirst.code, 'BAD_EXPRESSION');
  assert.match(noFirst.message, /generator/);
  assert.equal(check(c, c.solution.replace(/\{\{ ansible_facts\['all_ipv4_addresses'\].*?\}\}/, '192.168.50.11')).code, 'WRONG_FACT', 'hard-coded');
});

test('capstone: a missing line is named in the coach note', () => {
  const c = byId('capstone');
  const withoutFqdn = c.solution.split('\n').filter((line) => !line.includes('FQDN')).join('\n');
  const r = check(c, withoutFqdn);
  assert.equal(r.code, 'WRONG_FACT');
  assert.match(r.message, /ansible_facts\['fqdn'\]/);
});
