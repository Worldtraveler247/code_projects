import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JinjaError, render } from '../jinja.js';

// Compare the trainer's evaluator with the real Ansible templating engine, expression by
// expression. Each expression is embedded in text, so both sides produce a string.
// Rule: if Ansible renders it, the trainer must render the same text, or say plainly that the
// construct is outside its scope. If Ansible fails, the trainer must fail too.

const VARIABLES = {
  ansible_facts: {
    hostname: 'servera', fqdn: 'servera.ytt.lab', os_family: 'RedHat', distribution: 'CentOS',
    distribution_major_version: '9', memtotal_mb: 567, processor_vcpus: 1, fips: false,
    all_ipv4_addresses: ['10.0.2.15', '192.168.50.11'], interfaces: ['enp0s9', 'enp0s8', 'lo'],
    default_ipv4: { address: '10.0.2.15', interface: 'enp0s8' },
    devices: { sda: { size: '20.00 GB', removable: '0' }, sr0: { size: '1024.00 MB', removable: '1' } },
    mounts: [{ mount: '/', fstype: 'xfs', size_total: 17553162240 }, { mount: '/boot', fstype: 'xfs', size_total: 1006632960 }, { mount: '/boot/efi', fstype: 'vfat', size_total: 627900416 }],
    selinux: { status: 'enabled', mode: 'enforcing' },
    ansible_local: { video: { info: { owner: 'student' } } },
    enp0s8: { ipv4: { address: '10.0.2.15' } },
  },
  ansible_hostname: 'servera', ansible_memtotal_mb: 567,
  item: 'enp0s8', threshold: 1024, empty: [], nothing: null, words: 'alpha beta  gamma',
};

const EXPRESSIONS = [
  // lookups
  "ansible_facts['hostname']", 'ansible_facts.hostname', 'ansible_hostname', "ansible_facts['default_ipv4']['address']",
  'ansible_facts.default_ipv4.address', "ansible_facts['mounts'][0]['mount']", 'ansible_facts.mounts.1.fstype',
  "ansible_facts['mounts'][-1].mount", "ansible_facts[item]['ipv4']['address']", "ansible_facts['ansible_local']['video']['info']['owner']",
  "ansible_facts['hostname'][0]", "ansible_facts['hostname'][:4]", "ansible_facts['hostname'][4:]", "ansible_facts['all_ipv4_addresses'][1:]",
  // whole values, to check Python's text forms
  "ansible_facts['all_ipv4_addresses']", "ansible_facts['default_ipv4']", "ansible_facts['mounts'][0]", 'ansible_facts.fips', 'nothing', 'empty',
  "[1, 'a', 2.5, true, none]", "{'a': 1, 'b': [1, 2]}", '1.0', '2.50', '1e3 if false else 10',
  // undefined handling
  "ansible_facts['devices']['sdb']['size'] | default('NONE')", "ansible_facts['devices']['sdb'] | default('NONE')", "ansible_facts.nope.deeper.still | default('x')",
  "ansible_facts['devices']['sdb'] is defined", "ansible_facts['devices']['sda'] is defined", "ansible_facts['devices']['sdb'] is not defined",
  "ansible_facts['devices']['sdb']['size'] is undefined", 'missing is defined', 'missing | default(5)', "missing | d('fallback')",
  "ansible_facts['devices']['sdb']['size']", 'missing', "missing == 'x'", "ansible_facts['nope'] ~ 'x'", 'not missing', "missing | upper",
  "nothing | default('x')", "nothing | default('x', true)", "'' | default('x', true)", "'' | default('x')", '0 | default(7, true)',
  // comparisons and logic
  "ansible_facts['os_family'] == 'RedHat'", "ansible_facts['os_family'] != 'Debian'", "ansible_facts['memtotal_mb'] < 1024",
  "ansible_facts['memtotal_mb'] >= threshold", "ansible_facts['distribution_major_version'] == '9'", "ansible_facts['distribution_major_version'] == 9",
  "ansible_facts['distribution_major_version'] | int >= 9", "ansible_facts['distribution_major_version'] >= 9",
  "ansible_facts['distribution'] == 'CentOS' and ansible_facts['distribution_major_version'] == '9'",
  "ansible_facts['os_family'] == 'Debian' or ansible_facts['memtotal_mb'] > 500", "not ansible_facts['fips']", 'not not 1',
  "'sdb' in ansible_facts['devices']", "'sda' in ansible_facts['devices']", "'sdb' not in ansible_facts['devices']", "'lo' in ansible_facts['interfaces']",
  "'192.168.50.11' in ansible_facts['all_ipv4_addresses']", "'serv' in ansible_facts['hostname']", "1 in ansible_facts['hostname']",
  '1 == 1.0', "1 == '1'", 'true == 1', '1 < 2 < 3', '3 > 2 > 1', '1 < 3 < 2', "'a' < 'b'", "'a' < 1", '[1, 2] == [1, 2]', "{'a': 1} == {'a': 1}",
  '1 and 2', '0 or 3', "'' or 'fallback'", "ansible_facts['fips'] or 'no fips'", '(1 == 1) and (2 == 3)', 'none == none', "nothing is none", 'nothing == none',
  "'yes' if ansible_facts['memtotal_mb'] < 1024 else 'no'", "'low' if ansible_facts['memtotal_mb'] < 100", '1 if 1 else 2 if 3 else 4',
  // tests
  "ansible_facts['hostname'] is string", "ansible_facts['memtotal_mb'] is number", "ansible_facts['memtotal_mb'] is string", "ansible_facts['devices'] is mapping",
  "ansible_facts['mounts'] is iterable", "ansible_facts['hostname'] is match('serv')", "ansible_facts['hostname'] is match('erv')", "ansible_facts['hostname'] is search('erv')",
  "ansible_facts['fips'] is false", '4 is even', '3 is odd', "'x' is not none", "3 is in [1, 2, 3]",
  // arithmetic and text
  "ansible_facts['memtotal_mb'] / 1024", "(ansible_facts['memtotal_mb'] / 1024) | round(2)", "ansible_facts['memtotal_mb'] // 1024", "ansible_facts['memtotal_mb'] % 100",
  "ansible_facts['memtotal_mb'] * 2", "ansible_facts['memtotal_mb'] + 1", "ansible_facts['memtotal_mb'] - 600", '-5 + 2', '7 / 2', '4 / 2', '7 // 2', '-7 // 2', '-7 % 3',
  '2 * 3.0', '2 ** 10', '2 + 3 * 4', '(2 + 3) * 4', '10 - 2 - 3', '1 / 0', "'a' ~ 1 ~ 'b'", "'a' + 'b'", "'a' + 1", "1 + '1'", "[1] + [2]", "'ab' * 2",
  "ansible_facts['hostname'] ~ '.' ~ 'lab'", "ansible_facts['mounts'][0]['size_total'] / 1024 / 1024 / 1024", "(ansible_facts['mounts'][0]['size_total'] / 1024 ** 3) | round(1)",
  "ansible_facts['memtotal_mb'] | int + 1", "ansible_facts['distribution_major_version'] | int + 1", "ansible_facts['distribution_major_version'] + 1",
  // filters
  "ansible_facts['hostname'] | upper", "'ABC' | lower", "'hello world' | capitalize", "'  x  ' | trim", "ansible_facts['hostname'] | length", "ansible_facts['mounts'] | length",
  "ansible_facts['devices'] | length", "ansible_facts['all_ipv4_addresses'] | first", "ansible_facts['all_ipv4_addresses'] | last", "ansible_facts['hostname'] | first",
  "empty | first", "ansible_facts['interfaces'] | join(', ')", "ansible_facts['interfaces'] | join", "ansible_facts['interfaces'] | sort", "ansible_facts['interfaces'] | sort | first",
  "[3, 1, 2] | max", "[3, 1, 2] | min", "[3, 1, 2] | sum", "[1, 1, 2] | unique", "'3' | int", "'3.7' | int", "'abc' | int", "'abc' | int(-1)", "3.7 | int", "'3' | float", '5 | float',
  "5 | string ~ 'x'", "2.5 | round", "5 | round", "5 | round(1)", "567 / 1024 | round(3)", "(567 / 1024) | round(3)", "-3 | abs", "'yes' | bool", "'no' | bool", "1 | bool", "'true' | bool",
  "ansible_facts['fqdn'] | replace('.lab', '')", "ansible_facts['fqdn'] | split('.')", "ansible_facts['fqdn'].split('.')", "ansible_facts['fqdn'].split('.')[0]", "words.split()",
  "ansible_facts['hostname'].upper()", "ansible_facts['hostname'].startswith('serv')", "ansible_facts['fqdn'].endswith('.lab')", "ansible_facts['devices'].keys() | list",
  "ansible_facts['devices'] | list", "ansible_facts['devices'] | dict2items | length", "(ansible_facts['devices'] | dict2items)[0].key", "ansible_facts['selinux'].get('mode')",
  "ansible_facts['selinux'].get('nope', 'none set')", "ansible_facts['all_ipv4_addresses'] | select('match', '192.168.50.') | first",
  "ansible_facts['all_ipv4_addresses'] | select('match', '168') | list", "ansible_facts['all_ipv4_addresses'] | select('search', '168') | list",
  "ansible_facts['all_ipv4_addresses'] | reject('match', '10\\\\.') | list", "ansible_facts['interfaces'] | reject('equalto', 'lo') | list",
  "ansible_facts['mounts'] | map(attribute='mount') | list", "ansible_facts['mounts'] | map(attribute='mount') | join(' ')", "ansible_facts['interfaces'] | map('upper') | list",
  "ansible_facts['mounts'] | selectattr('fstype', 'equalto', 'xfs') | list | length", "ansible_facts['mounts'] | selectattr('fstype', 'equalto', 'vfat') | map(attribute='mount') | first",
  "ansible_facts['mounts'] | rejectattr('fstype', 'equalto', 'xfs') | map(attribute='mount') | list", "ansible_facts['mounts'] | map(attribute='size_total') | sum",
  "ansible_facts['all_ipv4_addresses'] | select('match', '172.') | first | default('none found')", "ansible_facts['all_ipv4_addresses'] | select('match', '172.') | list | length",
  // Python rounding (ties go to the even digit), exponents, and backslashes kept as written
  '0.5 | round', '1.5 | round', '0.125 | round(2)', '0.375 | round(2)', '2.345 | round(2)', '1234.5678 | round(1)', '-0.5 | round', '0.55371 | round(2)', '10 | round(2)', '7 / 3 | round(4)', '2.5 | round(0)', '3.5 | round', '2.675 | round(2)', '1.005 | round(2)', '-2.5 | round', '1e3', '2.5e-1 + 1',
  String.raw`ansible_facts['fqdn'] is match('.*\.lab$')`, String.raw`ansible_facts['fqdn'] is match('.*\\.lab$')`,
  String.raw`ansible_facts['all_ipv4_addresses'] | reject('match', '10\.') | list`, String.raw`'a\nb' | length`, String.raw`'it\'s'`,
  "ansible_facts['fqdn'] | replace('.', '-')",
  // pipelines of the kind exam answers use
  "ansible_facts['interfaces'] | select('match', 'enp') | map('upper') | join('+')", "ansible_facts['mounts'] | map(attribute='fstype') | unique | sort",
  "ansible_facts['devices'] | dict2items | map(attribute='key') | list",
  "ansible_facts['devices'] | dict2items | selectattr('value.removable', 'equalto', '0') | map(attribute='key') | list",
  "(ansible_facts['memtotal_mb'] / 1024) | round(2) ~ ' GB'", "ansible_facts['memtotal_mb'] | string | length", "ansible_facts['hostname'] in ['servera', 'serverb']",
  "ansible_facts['interfaces'] | length > 2", "ansible_facts['mounts'] | selectattr('mount', 'equalto', '/') | map(attribute='fstype') | first",
  '3 is in [1, 2] or 2 is in [2]', "'low' if ansible_facts['memtotal_mb'] < 1000", "ansible_facts['devices']['sda']['size'] | default('NONE')",
  "'DISK_SIZE_SDB=' ~ (ansible_facts['devices']['sdb']['size'] | default('NONE'))", "ansible_facts['interfaces'] | reject('equalto', 'lo') | sort | join(',')",
  // syntax errors
  "ansible_facts['hostname'", 'ansible_facts[hostname]', "ansible_facts['hostname']]", '1 +', '== 1', "ansible_facts..hostname", "'unterminated", '(1 + 2',
];

function findAnsiblePython() {
  if (process.env.ANSIBLE_PYTHON) return process.env.ANSIBLE_PYTHON;
  try {
    const script = execFileSync('which', ['ansible'], { encoding: 'utf8' }).trim();
    const shebang = readFileSync(script, 'utf8').split('\n')[0];
    return shebang.startsWith('#!') ? shebang.slice(2).trim().split(' ')[0] : null;
  } catch {
    return null;
  }
}

const python = findAnsiblePython();
let reference = null;
if (python) {
  try {
    const out = execFileSync(python, [new URL('./reference_templar.py', import.meta.url).pathname], {
      input: JSON.stringify({ variables: VARIABLES, expressions: EXPRESSIONS }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    });
    reference = JSON.parse(out);
  } catch {
    reference = null;
  }
}

test('the corpus is large enough to mean something', () => {
  assert.ok(EXPRESSIONS.length >= 200, `only ${EXPRESSIONS.length} expressions`);
  assert.equal(new Set(EXPRESSIONS).size, EXPRESSIONS.length, 'no duplicates');
});

test('every expression matches the real Ansible engine', { skip: reference ? false : 'no Ansible installation found on this machine; set ANSIBLE_PYTHON to run it' }, () => {
  const mismatches = [];
  let outOfScope = 0;
  EXPRESSIONS.forEach((expression, i) => {
    const real = reference[i];
    let mine;
    try {
      mine = { ok: true, text: render(`<{{ ${expression} }}>`, VARIABLES) };
    } catch (error) {
      if (!(error instanceof JinjaError)) throw error;
      mine = { ok: false, kind: error.kind, error: error.message };
    }
    if (!mine.ok && mine.kind === 'unsupported') { outOfScope++; return; }
    if (real.ok !== mine.ok) mismatches.push(`${expression}\n    ansible: ${real.ok ? JSON.stringify(real.text) : real.error}\n    trainer: ${mine.ok ? JSON.stringify(mine.text) : mine.error}`);
    else if (real.ok && real.text !== mine.text) mismatches.push(`${expression}\n    ansible: ${JSON.stringify(real.text)}\n    trainer: ${JSON.stringify(mine.text)}`);
  });
  assert.equal(mismatches.length, 0, `${mismatches.length} of ${EXPRESSIONS.length} differ:\n\n${mismatches.join('\n\n')}`);
  assert.ok(outOfScope <= 5, `${outOfScope} corpus expressions were declined as out of scope; the corpus should exercise supported syntax`);
});
