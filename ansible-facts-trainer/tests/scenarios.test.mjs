import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAM_CHALLENGES } from '../exam-challenges.js';
import { CHALLENGES } from '../challenges.js';
import { FACTS, HOST } from '../facts.js';
import { patchFacts, runPlaybook } from '../runner.js';
import { hostCommand, newHost } from '../executor.js';

const HEADER = '---\n- name: Exam-style task\n  hosts: all\n  tasks:\n';
const byId = (id) => EXAM_CHALLENGES.find((c) => c.id === id);
const play = (tasks) => HEADER + tasks.split('\n').map((line) => (line.trim() ? `    ${line}` : line)).join('\n');
const run = (id, tasks) => runPlaybook(play(tasks), byId(id), FACTS, HOST);
const failed = (r) => r.verdict.checks.filter((c) => !c.ok).map((c) => c.label);

test('the scenarios extend the challenge list past the original sixteen', () => {
  assert.equal(EXAM_CHALLENGES.length, 10);
  assert.equal(CHALLENGES.length, 26);
  assert.deepEqual(CHALLENGES.slice(16).map((c) => c.id), EXAM_CHALLENGES.map((c) => c.id));
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, 26);
});

test('every scenario is a complete record and is checked on a second host', () => {
  for (const c of EXAM_CHALLENGES) {
    assert.equal(c.kind, 'scenario', c.id);
    assert.equal(c.tier, 5, c.id);
    for (const field of ['prompt', 'hint', 'starter', 'solution']) assert.ok(typeof c[field] === 'string' && c[field].length > 20, `${c.id}.${field}`);
    assert.ok(c.expect.length >= 1, `${c.id} needs a check on servera`);
    assert.ok(c.variants.length >= 1, `${c.id} needs a second host, or a hard-coded answer would pass`);
    for (const check of [...c.expect, ...c.variants.flatMap((v) => v.expect)]) assert.ok(check.label.length > 5, `${c.id} check label`);
  }
});

test('every model answer leaves the required state on servera and on every other host', () => {
  for (const c of EXAM_CHALLENGES) {
    const r = runPlaybook(c.solution, c, FACTS, HOST);
    assert.equal(r.verdict.ok, true, `${c.id}: ${r.verdict.message} ${JSON.stringify(r.verdict.checks?.filter((k) => !k.ok))}`);
    assert.ok(r.verdict.checks.length >= 2, c.id);
    assert.match(r.terminal, /failed=0/, c.id);
  }
});

test('an empty starter says there is no task yet', () => {
  for (const c of EXAM_CHALLENGES) assert.equal(runPlaybook(c.starter, c, FACTS, HOST).verdict.code, 'NO_TASKS', c.id);
});

test('every expected value on servera is the real value in the capture', () => {
  assert.equal(FACTS.os_family, 'RedHat');
  assert.deepEqual([FACTS.distribution, FACTS.distribution_major_version], ['CentOS', '9']);
  assert.deepEqual([FACTS.hostname, FACTS.memtotal_mb, FACTS.devices.sda.size, Object.hasOwn(FACTS.devices, 'sdb')], ['servera', 567, '20.00 GB', false]);
  assert.deepEqual(FACTS.mounts.map((m) => `${m.mount} uses ${m.fstype}`), ['/ uses xfs', '/boot uses xfs', '/boot/efi uses vfat']);
  assert.deepEqual(FACTS.interfaces.filter((i) => i !== 'lo').sort().map((i) => `${i}: ${FACTS[i].ipv4.address}`), ['enp0s8: 10.0.2.15', 'enp0s9: 192.168.50.11']);
  assert.equal(`${FACTS.default_ipv4.address} ${FACTS.fqdn} ${FACTS.hostname}`, '10.0.2.15 servera.ytt.lab servera');
  assert.equal(FACTS.ansible_local.video.info.owner, 'student');
});

// ---- conditional install -----------------------------------------------------------------

test('conditional install: installing unconditionally passes on servera but fails the other host', () => {
  const r = run('exam-conditional-install', '- name: Install\n  ansible.builtin.dnf:\n    name: httpd\n    state: present\n');
  assert.equal(r.verdict.code, 'WRONG_STATE');
  assert.equal(r.verdict.checks[0].ok, true);
  assert.match(failed(r)[0], /Debian-family host: httpd is not installed/);
  assert.match(r.terminal, /^changed: \[servera\]$/m);
  assert.match(r.terminal, /ok=2 +changed=1/);
});

test('conditional install: equivalent correct answers pass', () => {
  for (const tasks of [
    "- name: i\n  ansible.builtin.package:\n    name: httpd\n  when: ansible_facts['os_family'] == 'RedHat'\n",
    '- name: i\n  yum:\n    name:\n      - httpd\n    state: latest\n  when: ansible_os_family == "RedHat"\n',
    "- name: i\n  dnf:\n    name: httpd\n  when: ansible_facts.os_family in ['RedHat', 'Suse']\n",
    "- name: i\n  dnf:\n    name: httpd\n  when: \"{{ ansible_facts['os_family'] == 'RedHat' }}\"\n",
    "- name: i\n  dnf:\n    name: httpd\n  when: ansible_facts['pkg_mgr'] == 'dnf'\n",
  ]) assert.equal(run('exam-conditional-install', tasks).verdict.ok, true, tasks);
});

test('conditional install: a condition that is false on servera skips the task, in cyan-style output', () => {
  const r = run('exam-conditional-install', "- name: i\n  dnf:\n    name: httpd\n  when: ansible_facts['os_family'] == 'Debian'\n");
  assert.equal(r.verdict.code, 'WRONG_STATE');
  assert.match(r.terminal, /^skipping: \[servera\]$/m);
  assert.match(r.terminal, /ok=1 .*skipped=1/);
});

test('a package the repositories do not have fails the way dnf fails', () => {
  const r = run('exam-conditional-install', '- name: i\n  dnf:\n    name: htpd\n');
  assert.equal(r.verdict.code, 'TASK_FAILED');
  assert.match(r.terminal, /^fatal: \[servera\]: FAILED! => \{"changed": false, "failures": \["No package htpd available\."\], "msg": "Failed to install some of the specified packages", "rc": 1, "results": \[\]\}$/m);
  assert.match(r.terminal, /failed=1/);
});

// ---- version gate ------------------------------------------------------------------------

test('version gate: comparing the version as text passes servera and fails CentOS 10', () => {
  const r = run('exam-version-gate', "- name: i\n  dnf:\n    name: php\n  when: ansible_facts['distribution'] == 'CentOS' and ansible_facts['distribution_major_version'] >= '9'\n");
  assert.equal(r.verdict.code, 'WRONG_STATE');
  assert.deepEqual(failed(r).length, 1);
  assert.match(failed(r)[0], /CentOS 10 host/);
});

test('version gate: comparing text with a number is a type error, as in real Jinja2', () => {
  const r = run('exam-version-gate', "- name: i\n  dnf:\n    name: php\n  when: ansible_facts['distribution_major_version'] >= 9\n");
  assert.equal(r.verdict.code, 'BAD_EXPRESSION');
  assert.match(r.terminal, /fatal: \[servera\]: FAILED! => \{"msg": "The conditional check 'ansible_facts\['distribution_major_version'\] >= 9' failed\. The error was: error while evaluating conditional/);
  assert.match(r.terminal, /'>=' not supported between instances of 'str' and 'int'/);
});

test('version gate: forgetting the distribution check fails the Rocky host', () => {
  const r = run('exam-version-gate', "- name: i\n  dnf:\n    name: php\n  when: ansible_facts['distribution_major_version'] | int >= 9\n");
  assert.match(failed(r).join('|'), /Rocky 9 host/);
});

// ---- hardware report ---------------------------------------------------------------------

test('hardware report: hard-coding servera\'s values passes servera and fails the other host', () => {
  const r = run('exam-hardware-report', '- name: w\n  copy:\n    dest: /root/hwreport.txt\n    content: |\n      HOST=servera\n      MEMORY=567\n      DISK_SIZE_SDA=20.00 GB\n      DISK_SIZE_SDB=NONE\n');
  assert.equal(r.verdict.code, 'WRONG_STATE');
  assert.equal(r.verdict.checks[0].ok, true);
  assert.match(failed(r)[0], /serverb/);
  assert.match(failed(r)[0], /The file contains:\nHOST=servera/);
});

test('hardware report: without a fallback, the missing disk is an undefined variable', () => {
  const r = run('exam-hardware-report', "- name: w\n  copy:\n    dest: /root/hwreport.txt\n    content: \"DISK_SIZE_SDB={{ ansible_facts['devices']['sdb']['size'] }}\\n\"\n");
  assert.equal(r.verdict.code, 'UNDEFINED_FACT');
  assert.match(r.terminal, /The task includes an option with an undefined variable\. The error was: 'dict object' has no attribute 'sdb'/);
});

test('hardware report: a conditional expression is as good as default()', () => {
  const r = run('exam-hardware-report', [
    '- name: w', '  ansible.builtin.copy:', '    dest: /root/hwreport.txt', '    content: |',
    '      HOST={{ ansible_hostname }}', '      MEMORY={{ ansible_memtotal_mb }}', '      DISK_SIZE_SDA={{ ansible_facts.devices.sda.size }}',
    "      DISK_SIZE_SDB={{ ansible_facts.devices.sdb.size if 'sdb' in ansible_facts.devices else 'NONE' }}", '',
  ].join('\n'));
  assert.equal(r.verdict.ok, true, JSON.stringify(failed(r)));
});

test('hardware report: the wrong path or a wrong line is reported with what was written', () => {
  const wrongPath = run('exam-hardware-report', "- name: w\n  copy:\n    dest: /tmp/hwreport.txt\n    content: \"HOST={{ ansible_hostname }}\\n\"\n");
  assert.match(failed(wrongPath)[0], /The file was not created/);
  const relative = run('exam-hardware-report', '- name: w\n  copy:\n    dest: hwreport.txt\n    content: x\n');
  assert.equal(relative.verdict.code, 'TASK_FAILED');
});

// ---- missing disk, low memory -------------------------------------------------------------

test('missing disk: three correct conditions pass; printing always fails the host that has sdb', () => {
  for (const when of ["\"'sdb' not in ansible_facts['devices']\"", "ansible_facts['devices']['sdb'] is not defined", "ansible_facts.devices.sdb is undefined", "not ('sdb' in ansible_devices)"]) {
    assert.equal(run('exam-missing-disk', `- name: m\n  debug:\n    msg: Disk sdb does not exist\n  when: ${when}\n`).verdict.ok, true, when);
  }
  const always = run('exam-missing-disk', '- name: m\n  debug:\n    msg: Disk sdb does not exist\n');
  assert.match(failed(always)[0], /host that has an sdb disk: nothing is printed/);
  const wrongText = run('exam-missing-disk', "- name: m\n  debug:\n    msg: no sdb here\n  when: \"'sdb' not in ansible_facts['devices']\"\n");
  assert.match(failed(wrongText)[0], /It printed: "no sdb here"/);
});

test('low memory: the boundary host catches <= in place of <', () => {
  const r = run('exam-low-memory', "- name: l\n  copy:\n    dest: /etc/motd\n    content: \"Low memory host\\n\"\n  when: ansible_facts['memtotal_mb'] <= 1024\n");
  assert.equal(failed(r).length, 1);
  assert.match(failed(r)[0], /exactly 1024 MB/);
});

// ---- set_fact, loops -----------------------------------------------------------------------

test('set_fact: the variable is stored and reused; without parentheses the rounding is wrong', () => {
  const noParens = run('exam-set-fact', "- name: s\n  set_fact:\n    mem_gb: \"{{ ansible_facts['memtotal_mb'] / 1024 | round(2) }}\"\n- name: p\n  debug:\n    msg: \"Memory: {{ mem_gb }} GB\"\n");
  assert.equal(noParens.verdict.code, 'WRONG_STATE');
  assert.match(failed(noParens)[0], /It is "0\.5537109375"/);
  const wrongName = run('exam-set-fact', "- name: s\n  set_fact:\n    memory: \"{{ (ansible_facts['memtotal_mb'] / 1024) | round(2) }}\"\n- name: p\n  debug:\n    msg: \"Memory: {{ memory }} GB\"\n");
  assert.match(failed(wrongName)[0], /No variable with that name was set/);
  const unset = run('exam-set-fact', '- name: p\n  debug:\n    msg: "Memory: {{ mem_gb }} GB"\n');
  assert.equal(unset.verdict.code, 'UNDEFINED_FACT');
  assert.match(unset.terminal, /'mem_gb' is undefined/);
});

test('loop over mounts: output has one result per item, with the item shown as Ansible shows it', () => {
  const r = runPlaybook(byId('exam-loop-mounts').solution, byId('exam-loop-mounts'), FACTS, HOST);
  assert.match(r.terminal, /^ok: \[servera\] => \(item=\{'block_available': \d+/m);
  assert.equal(r.terminal.split('\n').filter((l) => l.includes('"msg": ')).length, 3);
  const hardCoded = run('exam-loop-mounts', '- name: m\n  debug:\n    msg: "{{ item }}"\n  loop:\n    - / uses xfs\n    - /boot uses xfs\n    - /boot/efi uses vfat\n');
  assert.equal(hardCoded.verdict.code, 'WRONG_STATE');
  assert.equal(hardCoded.verdict.checks.slice(0, 3).every((c) => c.ok), true);
});

test('loop over mounts: a string where a list is needed fails the way Ansible fails', () => {
  const r = run('exam-loop-mounts', "- name: m\n  debug:\n    msg: \"{{ item }}\"\n  loop: \"{{ ansible_facts['hostname'] }}\"\n");
  assert.equal(r.verdict.code, 'TASK_FAILED');
  assert.match(r.terminal, /Invalid data passed to 'loop', it requires a list, got this instead: servera/);
});

test('loop over interfaces: a per-item condition skips only lo; map and select also solve it', () => {
  const r = runPlaybook(byId('exam-loop-interfaces').solution, byId('exam-loop-interfaces'), FACTS, HOST);
  assert.match(r.terminal, /^skipping: \[servera\] => \(item=lo\) $/m);
  assert.match(r.terminal, /^ok: \[servera\] => \(item=enp0s8\) => \{\n    "msg": "enp0s8: 10\.0\.2\.15"\n\}$/m);
  const filtered = run('exam-loop-interfaces', "- name: a\n  debug:\n    msg: \"{{ item }}: {{ ansible_facts[item].ipv4.address }}\"\n  loop: \"{{ ansible_facts['interfaces'] | reject('equalto', 'lo') | list }}\"\n");
  assert.equal(filtered.verdict.ok, true, JSON.stringify(failed(filtered)));
  const withLo = run('exam-loop-interfaces', "- name: a\n  debug:\n    msg: \"{{ item }}: {{ ansible_facts[item]['ipv4']['address'] }}\"\n  loop: \"{{ ansible_facts['interfaces'] }}\"\n");
  assert.match(failed(withLo).join('|'), /loopback interface is left out/);
});

test('custom fact: the fallback is required on a host with no custom facts', () => {
  const r = run('exam-custom-fact', "- name: o\n  copy:\n    dest: /root/owner.txt\n    content: \"Owner: {{ ansible_local.video.info.owner }}\\n\"\n");
  assert.equal(r.verdict.code, 'WRONG_STATE');
  assert.match(failed(r)[0], /no custom facts, the playbook fails/);
  const wrongPrefix = run('exam-custom-fact', "- name: o\n  copy:\n    dest: /root/owner.txt\n    content: \"Owner: {{ ansible_facts['local']['video']['info']['owner'] | default('unknown') }}\\n\"\n");
  assert.match(failed(wrongPrefix)[0], /Owner: unknown/, 'the wrong key silently falls back, and the check on servera catches it');
});

// ---- play and task structure ----------------------------------------------------------------

test('multiple tasks, play vars, register, and ignore_errors work together', () => {
  const text = '---\n- name: p\n  hosts: all\n  vars:\n    pkg: httpd\n    label: "pkg={{ pkg }}"\n  tasks:\n'
    + '    - name: one\n      dnf:\n        name: "{{ pkg }}"\n      register: result\n      when: ansible_facts["os_family"] == "RedHat"\n'
    + '    - name: two\n      debug:\n        msg: "{{ label }} changed={{ result.changed }}"\n      when: result is not skipped | default(true)\n';
  const r = runPlaybook(text, byId('exam-conditional-install'), FACTS, HOST);
  assert.match(r.terminal, /"msg": "pkg=httpd changed=True"/);
  assert.equal(r.verdict.checks[0].ok, true);
});

test('trainer limits are stated as limits: real modules it does not model, and unsupported keywords', () => {
  const template = run('exam-hardware-report', '- name: t\n  ansible.builtin.template:\n    src: x.j2\n    dest: /root/hwreport.txt\n');
  assert.equal(template.verdict.code, 'UNSUPPORTED_MODULE');
  assert.match(template.verdict.message, /real Ansible module/);
  assert.match(template.terminal, /Not run/);
  assert.equal(run('exam-hardware-report', '- name: t\n  debug:\n    msg: x\n  notify: restart\n').verdict.code, 'UNSUPPORTED_KEYWORD');
  assert.equal(run('exam-set-fact', "- name: t\n  debug:\n    msg: \"{{ lookup('env', 'HOME') }}\"\n").verdict.code, 'UNSUPPORTED_FILTER');
});

test('mistakes Ansible itself rejects are reported in its words', () => {
  const misspelled = run('exam-conditional-install', '- name: t\n  dnff:\n    name: httpd\n');
  assert.equal(misspelled.verdict.code, 'UNKNOWN_MODULE');
  assert.match(misspelled.terminal, /ERROR! couldn't resolve module\/action 'dnff'/);
  const badParam = run('exam-conditional-install', '- name: t\n  dnf:\n    name: httpd\n    stat: present\n');
  assert.match(badParam.terminal, /Unsupported parameters for \(dnf\) module: stat\. Supported parameters include: /);
  const badState = run('exam-conditional-install', '- name: t\n  dnf:\n    name: httpd\n    state: instaled\n');
  assert.match(badState.terminal, /value of state must be one of: absent, installed, latest, present, removed, got: instaled/);
  const outdented = run('exam-conditional-install', '- name: t\n  dnf:\n  name: httpd\n');
  assert.ok(['MISSING_MSG', 'TASK_FAILED', 'BAD_TASK_KEY'].includes(outdented.verdict.code));
  const service = run('exam-conditional-install', '- name: t\n  service:\n    name: httpd\n    state: started\n');
  assert.match(service.terminal, /Could not find the requested service httpd: host/);
});

test('a failing task stops the play and reports where it is in the file', () => {
  const r = run('exam-set-fact', "- name: first\n  debug:\n    msg: ok\n- name: second\n  debug:\n    msg: \"{{ ansible_facts['nope'] }}\"\n- name: third\n  debug:\n    msg: never\n");
  assert.match(r.terminal, /TASK \[first\]/);
  assert.match(r.terminal, /TASK \[second\]/);
  assert.doesNotMatch(r.terminal, /TASK \[third\]/);
  assert.match(r.terminal, /facts\.yml': line 8, column 7/);
  assert.match(r.terminal, /ok=2 +changed=0 +unreachable=0 +failed=1/);
});

// ---- helpers -------------------------------------------------------------------------------

test('patchFacts merges nested keys, replaces lists, deletes on request, and leaves the original alone', () => {
  const base = { a: { b: 1, c: 2 }, list: [1, 2], gone: 'x' };
  const patched = patchFacts(base, { a: { b: 9 }, list: [3], gone: '__DELETE__', added: { deep: true } });
  assert.deepEqual(patched, { a: { b: 9, c: 2 }, list: [3], added: { deep: true } });
  assert.deepEqual(base, { a: { b: 1, c: 2 }, list: [1, 2], gone: 'x' });
});

test('the host can be inspected after a run, the way you would verify your own work', () => {
  const r = runPlaybook(byId('exam-hardware-report').solution, byId('exam-hardware-report'), FACTS, HOST);
  assert.deepEqual(hostCommand(r.state, 'cat /root/hwreport.txt'), { rc: 0, text: 'HOST=servera\nMEMORY=567\nDISK_SIZE_SDA=20.00 GB\nDISK_SIZE_SDB=NONE' });
  assert.equal(hostCommand(r.state, 'cat /root/nope').rc, 1);
  const installed = runPlaybook(byId('exam-conditional-install').solution, byId('exam-conditional-install'), FACTS, HOST);
  assert.equal(hostCommand(installed.state, 'rpm -q httpd').rc, 0);
  assert.deepEqual(hostCommand(newHost(), 'rpm -q httpd'), { rc: 1, text: 'package httpd is not installed' });
  assert.equal(hostCommand(newHost(), 'systemctl is-active sshd').text, 'active');
  assert.equal(hostCommand(newHost(), 'rm -rf /').rc, 127);
});
