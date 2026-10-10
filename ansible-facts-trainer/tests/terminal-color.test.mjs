import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorize } from '../terminal-color.js';

const classes = (text) => colorize(text).map((line) => line.map((seg) => `${seg.cls || '-'}:${seg.text}`));
const lineClasses = (text) => colorize(text).map((line) => [...new Set(line.map((seg) => seg.cls))].join(','));
const joined = (text) => colorize(text).map((line) => line.map((seg) => seg.text).join('')).join('\n');

const OK_RUN = [
  'PLAY [Display facts] ***',
  '',
  'TASK [Gathering Facts] ***',
  'ok: [servera]',
  '',
  'TASK [Display the hostname] ***',
  'ok: [servera] => {',
  '    "msg": "The hostname is servera"',
  '}',
  '',
  'PLAY RECAP ***',
  'servera                    : ok=2    changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0',
].join('\n');

test('coloring never changes the text', () => {
  for (const text of [OK_RUN, '', 'plain', 'ERROR! x\n\n  y', 'fatal: [h]: FAILED! => {"msg": "x"}\n\nPLAY RECAP ***\nh : ok=1 failed=1']) {
    assert.equal(joined(text), text);
  }
});

test('a successful run: banners are plain, ok results are green through the closing brace', () => {
  assert.deepEqual(lineClasses(OK_RUN).slice(0, 10), ['', '', '', 'ok', '', '', 'ok', 'ok', 'ok', '']);
});

test('the recap colors the host and each non-zero count, as Ansible does', () => {
  const recap = classes(OK_RUN).at(-1);
  assert.equal(recap[0], 'ok:servera');
  assert.ok(recap.includes('ok:ok=2'));
  assert.ok(recap.includes('-:failed=0'), 'a zero count is not colored');
  const failed = classes('servera                    : ok=1    changed=0    unreachable=0    failed=1    skipped=0').at(-1);
  assert.equal(failed[0], 'fatal:servera');
  assert.ok(failed.includes('fatal:failed=1'));
  assert.ok(failed.includes('ok:ok=1'));
});

test('a fatal task line is red', () => {
  const text = 'TASK [x] ***\nfatal: [servera]: FAILED! => {"msg": "boom"}\n\nPLAY RECAP ***';
  assert.deepEqual(lineClasses(text), ['', 'fatal', '', '']);
});

test('a load error is red from ERROR! to the end of the output, blank lines included', () => {
  const text = 'ERROR! Syntax Error while loading YAML.\n  did not find expected key\n\nThe offending line appears to be:\n\n  x\n  ^ here';
  assert.deepEqual([...new Set(lineClasses(text))], ['fatal']);
});

test('warnings are purple and a skipped play is cyan', () => {
  const text = '[WARNING]: Could not match supplied host pattern, ignoring: serverz\n\nPLAY [x] ***\nskipping: no hosts matched';
  assert.deepEqual(lineClasses(text), ['warn', '', '', 'skip']);
});

test('ad-hoc output: SUCCESS is green to the closing brace; anything else is plain', () => {
  assert.deepEqual(lineClasses('servera | SUCCESS => {\n    "changed": false,\n    "ping": "pong"\n}'), ['ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(lineClasses('bash: foo: command not found...'), ['']);
});

test('a changed task is yellow, a skipped item is cyan, and a looped result is green to its brace', () => {
  const text = 'changed: [servera]\nskipping: [servera] => (item=lo) \nok: [servera] => (item=enp0s8) => {\n    "msg": "x"\n}\nchanged: [servera] => (item=httpd)';
  assert.deepEqual(lineClasses(text), ['changed', 'skip', 'ok', 'ok', 'ok', 'changed']);
});

test('a recap with changes colors the host and the changed count yellow', () => {
  const recap = classes('servera                    : ok=2    changed=1    unreachable=0    failed=0    skipped=1').at(-1);
  assert.equal(recap[0], 'changed:servera');
  assert.ok(recap.includes('changed:changed=1'));
  assert.ok(recap.includes('skip:skipped=1'));
});

test('ad-hoc command output is yellow when it ran and red when it failed, to the end', () => {
  assert.deepEqual(lineClasses('servera | CHANGED | rc=0 >>\nHOST=servera\nMEMORY=567'), ['changed', 'changed', 'changed']);
  assert.deepEqual(lineClasses('servera | FAILED | rc=1 >>\ncat: nope'), ['fatal', 'fatal']);
});
