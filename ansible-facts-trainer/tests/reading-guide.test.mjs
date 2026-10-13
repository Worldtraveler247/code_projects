import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACTS, HOST } from '../facts.js';
import { SETUP_OUTPUT } from '../setup-output.js';
import { execute } from '../shell.js';

// The reading guide on index.html is hand-written prose about one fact in the capture.
// These tests fail if the capture is regenerated and the prose no longer describes it.

const PAGE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const LINES = SETUP_OUTPUT.split('\n');
const OPENER = '        "ansible_device_links": {';
const FILTER_COMMAND = "ansible servera -m ansible.builtin.setup -a 'filter=ansible_device_links'";
const EXPRESSION = "ansible_facts['device_links']['ids']['dm-0'][0]";

test('ansible_device_links has exactly the four keys the guide names', () => {
  assert.deepEqual(Object.keys(FACTS.device_links), ['ids', 'labels', 'masters', 'uuids']);
  assert.deepEqual(FACTS.device_links.labels, {});
});

test('the skeleton lists the same children, in the same order, as the capture', () => {
  assert.deepEqual(Object.keys(FACTS.device_links.ids), ['dm-0', 'dm-1', 'sda3']);
  assert.deepEqual(Object.keys(FACTS.device_links.masters), ['sda3']);
  assert.deepEqual(Object.keys(FACTS.device_links.uuids), ['dm-0', 'dm-1', 'sda1', 'sda2']);
});

test('the closer sits in the column of the key, and the next fact is a sibling', () => {
  const open = LINES.indexOf(OPENER);
  assert.notEqual(open, -1, 'opener at 8 spaces');
  const close = LINES.findIndex((line, index) => index > open && /^ {8}\}/.test(line));
  assert.equal(LINES[close], '        },');
  assert.equal(LINES[close + 1], '        "ansible_devices": {');
});

test('a different "ids" lives inside ansible_devices', () => {
  assert.ok(Array.isArray(FACTS.devices['dm-0'].links.ids));
});

test('the filter command on the page returns only that fact, inside the ansible_facts envelope', () => {
  assert.ok(PAGE.includes(`data-command="${FILTER_COMMAND}"`), 'the page offers the command as a button');
  const env = { setupOutput: SETUP_OUTPUT, host: HOST, fqdn: `${HOST}.ytt.lab` };
  const result = execute(FILTER_COMMAND, env);
  assert.equal(result.type, 'text');
  const out = result.text.split('\n');
  assert.equal(out[1], '    "ansible_facts": {');
  assert.equal(out[2], OPENER);
  assert.ok(!result.text.includes('"ansible_devices"'));
});

test('the transcription example on the page resolves to the value it claims', () => {
  assert.equal(FACTS.device_links.ids['dm-0'][0], 'dm-name-cs-root');
  assert.ok(PAGE.includes(EXPRESSION), 'the page shows the expression');
  assert.ok(PAGE.includes('dm-name-cs-root'), 'the page shows the value');
});

test('the annotated block shows the whole fact, line for line as the capture prints it', () => {
  const block = PAGE.match(/<pre[^>]*aria-label="Annotated ansible_device_links, every line">([\s\S]*?)<\/pre>/);
  assert.ok(block, 'the page has the annotated block');
  const shown = block[1].split('\n').map((line) => line.replace(/<span class="note">.*<\/span>/, '').trimEnd());
  const open = LINES.indexOf(OPENER);
  const close = LINES.findIndex((line, index) => index > open && /^ {8}\}/.test(line));
  // The page drops the capture's 8 leading spaces and adds the next fact's opener as the last line.
  const captured = LINES.slice(open, close + 2).map((line) => line.slice(8));
  assert.deepEqual(shown, captured);
});

test('the date_time filter buttons on the page return what the guide says they return', () => {
  const env = { setupOutput: SETUP_OUTPUT, host: HOST, fqdn: `${HOST}.ytt.lab` };
  for (const filter of ['ansible_date_time', 'ansible_date*']) {
    const command = `ansible servera -m ansible.builtin.setup -a 'filter=${filter}'`;
    assert.ok(PAGE.includes(`data-command="${command}"`), `the page offers ${filter} as a button`);
    const out = execute(command, env).text.split('\n');
    assert.equal(out[2], '        "ansible_date_time": {');
    assert.ok(out.length < 30, 'the reply is under 30 lines, as the guide claims');
    assert.ok(out.includes('            "weekday": "Friday",'));
  }
  assert.ok(SETUP_OUTPUT.split('\n').length > 750, 'the full output is close to 800 lines');
  assert.ok(Object.values(FACTS.date_time).every((value) => typeof value === 'string'), 'every value is text');
  const miss = execute("ansible servera -m ansible.builtin.setup -a 'filter=ansible_nope'", env).text;
  assert.ok(miss.includes('discovered_interpreter_python') && !miss.includes('ansible_nope'));
});

test('the guide\'s rule about quotes and numbers matches the capture', () => {
  const env = { setupOutput: SETUP_OUTPUT, host: HOST, fqdn: `${HOST}.ytt.lab` };
  const command = "ansible servera -m setup | grep -E 'major_version|memtotal'";
  assert.ok(PAGE.includes(`data-command="${command}"`), 'the page offers the command as a button');
  assert.deepEqual(execute(command, env).text.split('\n').map((line) => line.trim()), [
    '"ansible_distribution_major_version": "9",',
    '"ansible_memtotal_mb": 567,',
  ]);
  assert.equal(typeof FACTS.distribution_major_version, 'string');
  assert.equal(typeof FACTS.memtotal_mb, 'number');
  assert.equal(FACTS.distribution, 'CentOS');
  assert.ok(PAGE.includes("ansible_facts['distribution_major_version'] | int &gt;= 9"));
});

test('the guide names the user the play connects as and the line that makes a task root', () => {
  assert.equal(FACTS.user_id, 'student');
  assert.equal(FACTS.user_dir, '/home/student');
  for (const text of ['become: true', 'This command has to be run under the root user.', 'Destination /root not writable']) {
    assert.ok(PAGE.includes(text), text);
  }
});

test('no element joins two typed characters into one glyph', () => {
  assert.match(PAGE, /\*, \*::before, \*::after \{ font-variant-ligatures:none; \}/);
});
