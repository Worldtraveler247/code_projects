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
