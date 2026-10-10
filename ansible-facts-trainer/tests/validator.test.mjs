import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpression, renderTemplate, pathToExpr, checkTask } from '../validator.js';

export const FACTS = {
  hostname: 'servera',
  os_family: 'RedHat',
  memtotal_mb: 567,
  fips: false,
  default_ipv4: { address: '10.0.2.15', interface: 'enp0s8' },
  mounts: [{ mount: '/', device: '/dev/mapper/cs-root' }, { mount: '/boot', device: '/dev/sda2' }],
  selinux: { mode: 'enforcing' },
  all_ipv4_addresses: ['10.0.2.15'],
  memory_mb: { real: { total: 567 } },
  ansible_local: { site: { owner: 'student' } },
};

test('resolver: every correct notation reaches the same value', () => {
  for (const src of [
    "ansible_facts['hostname']",
    'ansible_facts["hostname"]',
    'ansible_facts.hostname',
    'ansible_hostname',
    "  ansible_facts[ 'hostname' ]  ",
  ]) {
    const r = resolveExpression(src, FACTS);
    assert.equal(r.ok, true, src);
    assert.equal(r.value, 'servera', src);
    assert.deepEqual(r.path, ['hostname'], src);
  }
});

test('resolver: nested keys, list indexes, and mixed notation', () => {
  assert.equal(resolveExpression("ansible_facts['default_ipv4']['address']", FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression('ansible_facts.default_ipv4.address', FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression('ansible_default_ipv4.address', FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression("ansible_facts['mounts'][0]['device']", FACTS).value, '/dev/mapper/cs-root');
  assert.equal(resolveExpression('ansible_facts.mounts.1.mount', FACTS).value, '/boot');
  assert.deepEqual(resolveExpression("ansible_facts['mounts'][0]['device']", FACTS).path, ['mounts', 0, 'device']);
});

test('resolver: unknown key suggests the nearest one', () => {
  const r = resolveExpression("ansible_facts['host_name']", FACTS);
  assert.equal(r.code, 'UNDEFINED_FACT');
  assert.match(r.message, /Did you mean 'hostname'/);
});

test('resolver: the ansible_ prefix inside ansible_facts is explained', () => {
  const r = resolveExpression("ansible_facts['ansible_hostname']", FACTS);
  assert.equal(r.code, 'UNDEFINED_FACT');
  assert.match(r.message, /Did you mean 'hostname'/);
});

test('resolver: a string key on a list, an index out of range, a key on a scalar', () => {
  assert.equal(resolveExpression("ansible_facts['mounts']['device']", FACTS).code, 'UNDEFINED_FACT');
  assert.match(resolveExpression("ansible_facts['mounts']['device']", FACTS).message, /is a list/);
  assert.equal(resolveExpression("ansible_facts['mounts'][9]", FACTS).code, 'UNDEFINED_FACT');
  assert.equal(resolveExpression("ansible_facts['hostname']['x']", FACTS).code, 'UNDEFINED_FACT');
});

test('resolver: an unquoted key is a bad expression with a fix', () => {
  const r = resolveExpression('ansible_facts[hostname]', FACTS);
  assert.equal(r.code, 'BAD_EXPRESSION');
  assert.match(r.message, /\['hostname'\]/);
});

test('resolver: non-fact variables and empty input are bad expressions', () => {
  assert.equal(resolveExpression('inventory_hostname', FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression('', FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression("ansible_facts['hostname'] + 'x'", FACTS).code, 'BAD_EXPRESSION');
});

test('resolver: filters are reported as out of scope, but a pipe inside quotes is not a filter', () => {
  assert.equal(resolveExpression("ansible_facts['hostname'] | upper", FACTS).code, 'UNSUPPORTED_FILTER');
  assert.equal(resolveExpression("ansible_facts['a|b']", FACTS).code, 'UNDEFINED_FACT');
});

test('review focus: curly quotes get a specific message', () => {
  const r = resolveExpression('ansible_facts[‘hostname’]', FACTS);
  assert.equal(r.code, 'BAD_EXPRESSION');
  assert.match(r.message, /curly quotes/i);
});

test('review focus: prototype keys are undefined facts, never inherited values', () => {
  for (const src of ["ansible_facts['constructor']", 'ansible_facts.__proto__', "ansible_facts['toString']", 'ansible_facts.hostname.length']) {
    assert.equal(resolveExpression(src, FACTS).code, 'UNDEFINED_FACT', src);
  }
});

test('template: mixed text renders to a string and records each path', () => {
  const r = renderTemplate("{{ ansible_facts['hostname'] }} has {{ ansible_facts.memtotal_mb }} MB", FACTS);
  assert.equal(r.ok, true);
  assert.equal(r.value, 'servera has 567 MB');
  assert.deepEqual(r.paths, [['hostname'], ['memtotal_mb']]);
});

test('template: a lone expression keeps its native type', () => {
  assert.equal(renderTemplate('{{ ansible_facts.memtotal_mb }}', FACTS).value, 567);
  assert.deepEqual(renderTemplate("{{ ansible_facts['selinux'] }}", FACTS).value, { mode: 'enforcing' });
});

test('template: booleans print the way Ansible prints them', () => {
  assert.equal(renderTemplate('fips={{ ansible_facts.fips }}', FACTS).value, 'fips=False');
});

test('template: plain text has no paths; unbalanced braces and statements fail', () => {
  assert.deepEqual(renderTemplate('hello', FACTS).paths, []);
  assert.equal(renderTemplate("{{ ansible_facts['hostname'] }", FACTS).code, 'BAD_EXPRESSION');
  assert.equal(renderTemplate('{% if x %}y{% endif %}', FACTS).code, 'BAD_EXPRESSION');
});

test('template: a failing expression returns that failure', () => {
  assert.equal(renderTemplate("a {{ ansible_facts['nope'] }} b", FACTS).code, 'UNDEFINED_FACT');
});

test('pathToExpr formats keys and indexes', () => {
  assert.equal(pathToExpr(['mounts', 0, 'device']), "ansible_facts['mounts'][0]['device']");
});
const HOSTNAME = { id: 't', tier: 2, requires: [['hostname']] };
const TWO = { id: 't3', tier: 3, requires: [['hostname'], ['default_ipv4', 'address']] };
const code = (text, challenge = HOSTNAME) => checkTask(text, challenge, FACTS, 'servera').code;

test('task check: the model answer passes and shows the run output', () => {
  const r = checkTask(
    "- name: Display the hostname\n  ansible.builtin.debug:\n    msg: \"The hostname is {{ ansible_facts['hostname'] }}\"\n",
    HOSTNAME, FACTS, 'servera');
  assert.equal(r.ok, true);
  assert.equal(r.rendered, 'ok: [servera] => {\n    "msg": "The hostname is servera"\n}');
  assert.equal(r.note, undefined);
});

test('task check: the short module name passes with advice', () => {
  const r = checkTask("- name: n\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", HOSTNAME, FACTS);
  assert.equal(r.ok, true);
  assert.match(r.note, /ansible\.builtin\.debug/);
});

test('task check: var is accepted and keys the output by the expression', () => {
  const r = checkTask("- name: n\n  ansible.builtin.debug:\n    var: ansible_facts['hostname']\n", HOSTNAME, FACTS, 'servera');
  assert.equal(r.ok, true);
  assert.match(r.rendered, /"ansible_facts\['hostname'\]": "servera"/);
});

test('task check: an unquoted msg and a list msg both pass', () => {
  assert.equal(checkTask('- name: n\n  debug:\n    msg: Host is {{ ansible_facts.hostname }}\n', HOSTNAME, FACTS).ok, true);
  const r = checkTask("- name: n\n  debug:\n    msg:\n      - \"{{ ansible_facts.hostname }}\"\n      - \"{{ ansible_facts.default_ipv4.address }}\"\n", TWO, FACTS);
  assert.equal(r.ok, true);
});

test('task check: harmless keywords are ignored', () => {
  assert.equal(checkTask("- name: n\n  become: true\n  tags: [facts]\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", HOSTNAME, FACTS).ok, true);
});

test('task check: a tier-3 answer missing one fact is the wrong fact', () => {
  const r = checkTask("- name: n\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", TWO, FACTS);
  assert.equal(r.code, 'WRONG_FACT');
  assert.match(r.message, /default_ipv4/);
});

test('task check: a hard-coded value does not pass', () => {
  assert.equal(code('- name: n\n  debug:\n    msg: "The hostname is servera"\n'), 'WRONG_FACT');
});

test('each structural error has its own code', () => {
  assert.equal(code(''), 'NOT_A_LIST');
  assert.equal(code('name: n\ndebug:\n  msg: "x"\n'), 'NOT_A_LIST');
  assert.equal(code('- name: a\n  debug:\n    msg: "x"\n- name: b\n  debug:\n    msg: "y"\n'), 'EXTRA_TASKS');
  assert.equal(code('- debug:\n    msg: "{{ ansible_hostname }}"\n'), 'MISSING_NAME');
  assert.equal(code('- name: n\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  msg: "{{ ansible_hostname }}"\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  debug:\n  msg: "{{ ansible_hostname }}"\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  debugg:\n    msg: "x"\n'), 'UNKNOWN_MODULE');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n  copy:\n    src: a\n'), 'UNKNOWN_MODULE');
  assert.equal(code('- name: n\n  debug:\n    mesg: "x"\n'), 'MISSING_MSG');
  assert.equal(code('- name: n\n  debug: msg="x"\n'), 'UNSUPPORTED_SYNTAX');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n    var: ansible_hostname\n'), 'MISSING_MSG');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n  when: true\n'), 'UNSUPPORTED_KEYWORD');
  assert.equal(code("- name: n\n  debug:\n    var: \"{{ ansible_hostname }}\"\n"), 'BAD_EXPRESSION');
  assert.equal(code("- name: n\n  debug:\n    msg: \"{{ ansible_facts['host_name'] }}\"\n"), 'UNDEFINED_FACT');
  assert.equal(code("- name: n\n  debug:\n    msg: \"{{ ansible_hostname | upper }}\"\n"), 'UNSUPPORTED_FILTER');
  assert.equal(code(`- name: n\n  debug:\n    msg: "${'x'.repeat(10300)}"\n`), 'TOO_LARGE');
});

test('an unquoted value starting with {{ is a YAML error that says to quote it', () => {
  for (const body of ["msg: {{ ansible_facts['hostname'] }}", 'msg: {{ ansible_facts.hostname }}']) {
    const r = checkTask(`- name: n\n  debug:\n    ${body}\n`, HOSTNAME, FACTS);
    assert.equal(r.code, 'YAML_SYNTAX', body);
    assert.match(r.message, /quote/i, body);
  }
});

test('a YAML syntax error reports a one-based line number', () => {
  const r = checkTask('- name: n\n  debug:\n    msg: "unterminated\n', HOSTNAME, FACTS);
  assert.equal(r.code, 'YAML_SYNTAX');
  assert.equal(typeof r.line, 'number');
  assert.ok(r.line >= 1);
});

test('review focus: tab indentation is explained', () => {
  const r = checkTask('- name: n\n\tdebug:\n\t\tmsg: "x"\n', HOSTNAME, FACTS);
  assert.equal(r.code, 'YAML_SYNTAX');
  assert.match(r.message, /tab/i);
});

test('review focus: a whole play is redirected to a single task', () => {
  const play = "- hosts: all\n  tasks:\n    - name: n\n      debug:\n        msg: \"{{ ansible_hostname }}\"\n";
  const r = checkTask(play, HOSTNAME, FACTS);
  assert.equal(r.code, 'PLAY_NOT_TASK');
  assert.match(r.message, /only the task/i);
});

test('a task that prints every fact is truncated, not dumped', () => {
  const big = { ...FACTS, blob: 'y'.repeat(5000) };
  const r = checkTask('- name: n\n  debug:\n    var: ansible_facts\n', HOSTNAME, big);
  assert.equal(r.code, 'WRONG_FACT');
  assert.ok(r.rendered.length < 2100);
});

test('final review 1: ansible_local keeps its prefix inside ansible_facts, as in real Ansible', () => {
  assert.equal(resolveExpression("ansible_facts['ansible_local']['site']['owner']", FACTS).value, 'student');
  assert.equal(resolveExpression('ansible_local.site.owner', FACTS).value, 'student');
  assert.deepEqual(resolveExpression('ansible_local.site.owner', FACTS).path, ['ansible_local', 'site', 'owner']);
  const wrong = resolveExpression("ansible_facts['local']['site']['owner']", FACTS);
  assert.equal(wrong.code, 'UNDEFINED_FACT');
  assert.match(wrong.message, /Did you mean 'ansible_local'/);
});

test('final review 2: valid Ansible outside the trainer scope is called out of scope, never invalid', () => {
  const inline = checkTask('- name: n\n  ansible.builtin.debug: msg="{{ ansible_hostname }}"\n', HOSTNAME, FACTS);
  assert.equal(inline.code, 'UNSUPPORTED_SYNTAX');
  assert.match(inline.message, /valid Ansible/);
  for (const keyword of ['delegate_to: localhost', 'no_log: true', 'run_once: true', 'notify: restart']) {
    const r = checkTask(`- name: n\n  debug:\n    msg: "{{ ansible_hostname }}"\n  ${keyword}\n`, HOSTNAME, FACTS);
    assert.equal(r.code, 'UNSUPPORTED_KEYWORD', keyword);
    assert.match(r.message, /valid Ansible/, keyword);
  }
});

test('final review 2: keywords that cannot change the output are ignored, and ansible.legacy.debug is debug', () => {
  for (const keyword of ['changed_when: false', 'check_mode: false', 'become_method: sudo']) {
    assert.equal(checkTask(`- name: n\n  debug:\n    msg: "{{ ansible_hostname }}"\n  ${keyword}\n`, HOSTNAME, FACTS).ok, true, keyword);
  }
  assert.equal(checkTask('- name: n\n  ansible.legacy.debug:\n    msg: "{{ ansible_hostname }}"\n', HOSTNAME, FACTS).ok, true);
});

test('final review 3: a different fact holding the same value is rejected, and the message says why', () => {
  const c = { id: 'e', tier: 1, requires: [['default_ipv4', 'address']] };
  const r = checkTask('- name: n\n  debug:\n    msg: "{{ ansible_facts[\'all_ipv4_addresses\'][0] }}"\n', c, FACTS);
  assert.equal(r.code, 'WRONG_FACT');
  assert.match(r.message, /same value/);
  assert.equal(checkTask('- name: n\n  debug:\n    msg: "{{ ansible_default_ipv4.address }}"\n', c, FACTS).ok, true);
});

test('final review 3: a challenge can list equivalent facts', () => {
  const mem = { id: 'm', tier: 2, requires: [['memtotal_mb']], equivalents: [[['memory_mb', 'real', 'total']]] };
  assert.equal(checkTask('- name: n\n  debug:\n    msg: "{{ ansible_facts.memory_mb.real.total }} MB"\n', mem, FACTS).ok, true);
  assert.equal(checkTask('- name: n\n  debug:\n    msg: "{{ ansible_facts.hostname }}"\n', mem, FACTS).code, 'WRONG_FACT');
});

const LIST_FACTS = { ...FACTS, all_ipv4_addresses: ['10.0.2.15', '192.168.50.11'], empty: [] };

test('filters: select with match, then first, picks the address on the lab subnet', () => {
  for (const src of [
    "ansible_facts['all_ipv4_addresses'] | select('match', '192.168.50.') | first",
    'ansible_facts.all_ipv4_addresses|select("match","192.168.50.")|first',
    "ansible_facts['all_ipv4_addresses'] | select('match', '192\\.168\\.50\\.') | first",
    "ansible_all_ipv4_addresses | select('search', '168.50') | first",
  ]) {
    const r = resolveExpression(src, LIST_FACTS);
    assert.equal(r.ok, true, `${src}: ${r.message}`);
    assert.equal(r.value, '192.168.50.11', src);
    assert.equal(r.path, null, 'a filtered expression is not a plain fact path');
    assert.deepEqual(r.basePath, ['all_ipv4_addresses']);
  }
});

test('filters: match is anchored at the start, like Python re.match; search is not', () => {
  assert.equal(resolveExpression("ansible_facts.all_ipv4_addresses | select('match', '168') | list", LIST_FACTS).value.length, 0);
  assert.deepEqual(resolveExpression("ansible_facts.all_ipv4_addresses | select('search', '168') | list", LIST_FACTS).value, ['192.168.50.11']);
});

test('filters: first and list on their own', () => {
  assert.equal(resolveExpression('ansible_facts.all_ipv4_addresses | first', LIST_FACTS).value, '10.0.2.15');
  assert.deepEqual(resolveExpression('ansible_facts.all_ipv4_addresses | list', LIST_FACTS).value, ['10.0.2.15', '192.168.50.11']);
});

test('filters: select without first or list is a generator, and the message says how to finish it', () => {
  const r = resolveExpression("ansible_facts.all_ipv4_addresses | select('match', '192')", LIST_FACTS);
  assert.equal(r.code, 'BAD_EXPRESSION');
  assert.match(r.message, /generator/);
  assert.match(r.message, /first/);
});

test('filters: first on nothing is undefined, as in Ansible', () => {
  assert.equal(resolveExpression("ansible_facts.all_ipv4_addresses | select('match', '172.') | first", LIST_FACTS).code, 'UNDEFINED_FACT');
  assert.equal(resolveExpression('ansible_facts.empty | first', LIST_FACTS).code, 'UNDEFINED_FACT');
});

test('filters: misuse gets a specific error', () => {
  assert.equal(resolveExpression("ansible_facts.hostname | select('match', 's') | first", LIST_FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression("ansible_facts.all_ipv4_addresses | select('match') | first", LIST_FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression("ansible_facts.all_ipv4_addresses | select('match', '(') | first", LIST_FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression("ansible_facts.all_ipv4_addresses | select('match', '" + 'a'.repeat(201) + "') | first", LIST_FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression('ansible_facts.all_ipv4_addresses | first(2)', LIST_FACTS).code, 'BAD_EXPRESSION');
});

test('filters: anything else is still out of scope, and names the filter', () => {
  for (const src of ['ansible_facts.hostname | upper', "ansible_facts.all_ipv4_addresses | select('defined') | first", "ansible_facts.all_ipv4_addresses | ansible.utils.ipaddr('192.168.50.0/24')", 'ansible_facts.all_ipv4_addresses | map("upper") | list']) {
    assert.equal(resolveExpression(src, LIST_FACTS).code, 'UNSUPPORTED_FILTER', src);
  }
  assert.match(resolveExpression('ansible_facts.hostname | upper', LIST_FACTS).message, /upper/);
});

test('filters: a filtered fact does not satisfy a plain-path requirement', () => {
  const c = { id: 'h', tier: 2, requires: [['hostname']] };
  assert.equal(checkTask('- name: n\n  debug:\n    msg: "{{ ansible_facts.hostname | first }}"\n', c, LIST_FACTS).code, 'WRONG_FACT');
});

test('a value requirement is met by any fact expression that yields that value', () => {
  const c = { id: 'v', tier: 4, requires: [['hostname'], { value: '192.168.50.11', label: 'the 192.168.50.x address' }] };
  const task = (expr) => `- name: n\n  debug:\n    msg:\n      - "{{ ansible_facts.hostname }}"\n      - "IPv4: {{ ${expr} }}"\n`;
  assert.equal(checkTask(task("ansible_facts['all_ipv4_addresses'] | select('match', '192.168.50.') | first"), c, LIST_FACTS).ok, true);
  assert.equal(checkTask(task('ansible_facts.all_ipv4_addresses[1]'), c, LIST_FACTS).ok, true);
  const wrong = checkTask(task('ansible_facts.default_ipv4.address'), c, LIST_FACTS);
  assert.equal(wrong.code, 'WRONG_FACT');
  assert.match(wrong.message, /the 192\.168\.50\.x address/);
  assert.equal(checkTask('- name: n\n  debug:\n    msg: "{{ ansible_facts.hostname }} 192.168.50.11"\n', c, LIST_FACTS).code, 'WRONG_FACT');
});
