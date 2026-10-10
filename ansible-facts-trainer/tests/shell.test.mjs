import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, PROMPT } from '../shell.js';
import { createPager, pagerKey, pagerSearch, pagerView } from '../pager.js';

const SETUP = [
  'servera | SUCCESS => {',
  '    "ansible_facts": {',
  '        "ansible_all_ipv4_addresses": [',
  '            "10.0.2.15",',
  '            "192.168.50.11"',
  '        ],',
  '        "ansible_default_ipv4": {',
  '            "address": "10.0.2.15",',
  '            "interface": "enp0s8"',
  '        },',
  '        "ansible_hostname": "servera",',
  '        "ansible_loadavg": {',
  '            "15m": 0.0',
  '        },',
  '        "discovered_interpreter_python": "/usr/bin/python3",',
  '        "module_setup": true',
  '    },',
  '    "changed": false',
  '}',
].join('\n');
const env = { setupOutput: SETUP, host: 'servera', fqdn: 'servera.ytt.lab', playbookFile: 'facts.yml', readPlaybook: () => '---\n- hosts: servera\n', runPlaybook: () => 'PLAY [x] ***\nok',
  hostCommand: (command) => (command === 'cat /root/hwreport.txt' ? { rc: 0, text: 'HOST=servera' } : { rc: 1, text: 'cat: /x: No such file or directory' }) };
const run = (line) => execute(line, env);
const text = (line) => { const r = run(line); assert.equal(r.type, 'text', `${line} -> ${r.type}`); return r.text; };

test('the prompt looks like the course control node', () => {
  assert.equal(PROMPT, '[student@ansible my-project-directory]$ ');
});

test('ansible servera -m setup prints the capture exactly, byte for byte', () => {
  for (const line of ['ansible servera -m setup', 'ansible servera -m ansible.builtin.setup', '  ansible  all   -m  setup ', 'ansible servera.ytt.lab -m setup', 'ansible -m setup servera']) {
    assert.equal(text(line), SETUP, line);
  }
});

test('a host that is not in the inventory gets the two Ansible warnings', () => {
  const out = text('ansible serverz -m setup');
  assert.match(out, /\[WARNING\]: Could not match supplied host pattern, ignoring: serverz/);
  assert.match(out, /\[WARNING\]: No hosts matched, nothing to do/);
});

test('grep filters lines, with the common flags', () => {
  assert.equal(text('ansible servera -m setup | grep hostname'), '        "ansible_hostname": "servera",');
  assert.equal(text('ansible servera -m setup | grep HOSTNAME'), '');
  assert.equal(text('ansible servera -m setup | grep -i HOSTNAME'), '        "ansible_hostname": "servera",');
  assert.equal(text('ansible servera -m setup | grep -n hostname'), '11:        "ansible_hostname": "servera",');
  assert.equal(text('ansible servera -m setup | grep -c ipv4'), '2');
  assert.equal(text('ansible servera -m setup|grep "ansible_hostname"'), '        "ansible_hostname": "servera",');
  assert.equal(text("ansible servera -m setup | grep -v ' '").split('\n').length, 1);
});

test('grep context flags print neighbors, with -- between separate groups', () => {
  assert.equal(text('ansible servera -m setup | grep -A2 default_ipv4'),
    '        "ansible_default_ipv4": {\n            "address": "10.0.2.15",\n            "interface": "enp0s8"');
  assert.equal(text('ansible servera -m setup | grep -A 1 -i default_ipv4').split('\n').length, 2);
  assert.equal(text('ansible servera -m setup | grep -B1 hostname').split('\n')[0], '        },');
  const grouped = text('ansible servera -m setup | grep -C0 -e xx -E "all_ipv4|hostname"');
  assert.deepEqual(grouped.split('\n'), ['        "ansible_all_ipv4_addresses": [', '--', '        "ansible_hostname": "servera",']);
});

test('grep without -E treats | and + as plain characters, as basic grep does', () => {
  assert.equal(text('ansible servera -m setup | grep "ipv4|hostname"'), '');
  assert.equal(text('ansible servera -m setup | grep -E "all_ipv4|hostname"').split('\n').length, 2);
});

test('grep errors are reported the way grep reports them', () => {
  assert.match(text('ansible servera -m setup | grep'), /^Usage: grep/);
  assert.match(text('ansible servera -m setup | grep -E "("'), /grep: .*[Rr]egular expression/);
  assert.match(text('ansible servera -m setup | grep -Z x'), /grep: invalid option -- 'Z'/);
});

test('pipes chain, and head limits the output', () => {
  assert.equal(text('ansible servera -m setup | grep ipv4 | grep default'), '        "ansible_default_ipv4": {');
  assert.equal(text('ansible servera -m setup | head -n 2'), 'servera | SUCCESS => {\n    "ansible_facts": {');
  assert.equal(text('ansible servera -m setup | head -3').split('\n').length, 3);
  assert.equal(text('ansible servera -m setup | head').split('\n').length, 10);
});

test('less at the end of the pipeline opens the pager with every line', () => {
  for (const line of ['ansible servera -m setup | less', 'ansible servera -m setup | more', 'ansible servera -m setup | grep -i ipv4 | less']) {
    const r = run(line);
    assert.equal(r.type, 'pager', line);
    assert.ok(r.lines.length >= 2, line);
  }
  assert.equal(run('ansible servera -m setup | less').lines.length, 19);
});

test('the setup filter argument narrows the facts and keeps the real wrapper', () => {
  const out = text("ansible servera -m setup -a 'filter=ansible_hostname'");
  assert.equal(out, [
    'servera | SUCCESS => {',
    '    "ansible_facts": {',
    '        "ansible_hostname": "servera",',
    '        "discovered_interpreter_python": "/usr/bin/python3"',
    '    },',
    '    "changed": false',
    '}',
  ].join('\n'));
  assert.match(text('ansible servera -m setup -a "filter=ansible_*ipv4*"'), /ansible_all_ipv4_addresses[\s\S]*ansible_default_ipv4[\s\S]*"interface": "enp0s8"\n        \},\n        "discovered_interpreter_python"/);
  assert.match(text('ansible servera -m setup -a filter=hostname'), /"ansible_hostname": "servera"/);
  assert.equal(text('ansible servera -m setup -a filter=nothing_matches').split('\n').length, 6);
  assert.match(text('ansible servera -m setup -a filter=ansible_loadavg'), /"15m": 0\.0\n/);
});

test('ping works; other modules are declined honestly', () => {
  assert.equal(text('ansible servera -m ping'), 'servera | SUCCESS => {\n    "changed": false,\n    "ping": "pong"\n}');
  assert.match(text('ansible servera -m dnf -a name=httpd'), /practice terminal/);
  assert.match(text('ansible servera -m setup -a gather_subset=network'), /practice terminal/);
  assert.match(text('ansible'), /^usage: ansible/);
});

test('ansible-playbook runs the editor file; any other file is not found', () => {
  assert.equal(text('ansible-playbook facts.yml'), 'PLAY [x] ***\nok');
  assert.equal(text('ansible-playbook facts.yml | grep PLAY'), 'PLAY [x] ***');
  assert.match(text('ansible-playbook site.yml'), /ERROR! the playbook: site\.yml could not be found/);
  assert.match(text('ansible-playbook'), /^usage: ansible-playbook/);
});

test('small shell conveniences: cat, ls, clear, help, empty input, unknown commands', () => {
  assert.equal(text('cat facts.yml'), '---\n- hosts: servera', 'shown without the trailing newline, as a terminal shows it');
  assert.match(text('cat nope.yml'), /cat: nope\.yml: No such file or directory/);
  assert.match(text('ls'), /facts\.yml/);
  assert.equal(run('clear').type, 'clear');
  assert.equal(run('   ').type, 'empty');
  assert.match(text('help'), /ansible servera -m setup/);
  assert.equal(text('sudo rm -rf /'), 'bash: sudo: command not found...');
  assert.equal(text('ansible servera -m setup | foo'), 'bash: foo: command not found...');
  assert.match(text('ansible servera -m setup |'), /syntax error/);
  assert.match(text('vim facts.yml'), /editor/i);
});

test('quotes and markup in a command are data, never code', () => {
  assert.equal(text("ansible servera -m setup | grep '<img src=x>'"), '');
  assert.equal(text('ansible servera -m setup | grep -F "(["'), '');
  assert.match(text('ansible servera -m setup | grep "' + 'a'.repeat(300) + '"'), /grep: .*too long/);
});

const LINES = Array.from({ length: 100 }, (_, i) => `line ${i + 1}${i === 59 ? ' needle' : ''}${i === 79 ? ' needle' : ''}`);

test('pager: the first screen shows height-1 lines and a colon prompt', () => {
  const view = pagerView(createPager(LINES, 24));
  assert.equal(view.rows.length, 23);
  assert.equal(view.rows[0], 'line 1');
  assert.equal(view.status, ':');
});

test('pager: space, b, j, k, g, and G move the way less does, and stop at the ends', () => {
  let s = createPager(LINES, 24);
  s = pagerKey(s, ' ').state; assert.equal(pagerView(s).rows[0], 'line 24');
  s = pagerKey(s, 'b').state; assert.equal(pagerView(s).rows[0], 'line 1');
  s = pagerKey(s, 'k').state; assert.equal(pagerView(s).rows[0], 'line 1');
  s = pagerKey(s, 'j').state; assert.equal(pagerView(s).rows[0], 'line 2');
  s = pagerKey(s, 'ArrowDown').state; assert.equal(pagerView(s).rows[0], 'line 3');
  s = pagerKey(s, 'G').state; assert.equal(pagerView(s).rows.at(-1), 'line 100'); assert.equal(pagerView(s).status, '(END)');
  s = pagerKey(s, ' ').state; assert.equal(pagerView(s).rows.at(-1), 'line 100');
  s = pagerKey(s, 'g').state; assert.equal(pagerView(s).rows[0], 'line 1');
});

test('pager: q quits and every other key does not', () => {
  const s = createPager(LINES, 24);
  assert.equal(pagerKey(s, 'q').quit, true);
  assert.equal(pagerKey(s, ' ').quit, false);
  assert.equal(pagerKey(s, 'x').quit, false);
});

test('pager: search jumps to the next match, n repeats, N goes back, and a miss says so', () => {
  let s = pagerSearch(createPager(LINES, 24), 'needle');
  assert.equal(pagerView(s).rows[0], 'line 60 needle');
  s = pagerKey(s, 'n').state; assert.equal(pagerView(s).rows[0], 'line 80 needle');
  s = pagerKey(s, 'n').state; assert.equal(pagerView(s).status, 'Pattern not found  (press RETURN)');
  s = pagerKey(s, 'N').state; assert.equal(pagerView(s).rows[0], 'line 60 needle');
  assert.equal(pagerView(pagerSearch(createPager(LINES, 24), 'absent')).status, 'Pattern not found  (press RETURN)');
  assert.match(pagerView(pagerSearch(createPager(LINES, 24), '(')).status, /Invalid pattern/);
});

test('pager: a short file fits on one screen and is at the end immediately', () => {
  const view = pagerView(createPager(['a', 'b'], 24));
  assert.deepEqual(view.rows, ['a', 'b']);
  assert.equal(view.status, '(END)');
});

test('ansible output is colored only when it goes straight to the terminal, not through a pipe', () => {
  assert.equal(run('ansible servera -m setup').colored, true);
  assert.equal(run('ansible-playbook facts.yml').colored, true);
  assert.equal(run('ansible servera -m ping').colored, true);
  assert.equal(Boolean(run('ansible servera -m setup | grep hostname').colored), false);
  assert.equal(Boolean(run('ansible-playbook facts.yml | head').colored), false);
  assert.equal(Boolean(run('ls').colored), false);
  assert.equal(Boolean(run('help').colored), false);
});

test('an ad-hoc command checks the managed host, in the format Ansible prints', () => {
  for (const line of ["ansible servera -a 'cat /root/hwreport.txt'", 'ansible servera -m command -a "cat /root/hwreport.txt"', "ansible all -m ansible.builtin.shell -a 'cat /root/hwreport.txt'"]) {
    assert.equal(text(line), 'servera | CHANGED | rc=0 >>\nHOST=servera', line);
  }
  assert.equal(text("ansible servera -a 'cat /x'"), 'servera | FAILED | rc=1 >>\ncat: /x: No such file or directorynon-zero return code');
  assert.equal(run("ansible servera -a 'cat /root/hwreport.txt'").colored, true);
  assert.match(text('ansible servera -m command'), /No argument passed to command module/);
  assert.equal(text("ansible servera -a 'cat /root/hwreport.txt' | grep HOST"), 'HOST=servera');
});
