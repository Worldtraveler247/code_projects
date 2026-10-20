import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveFeedLines, BURST, SETUPS } from '../live.js';
import { ATTACKER } from '../story.js';
import { hashAnswer } from '../checker.js';

const lines = liveFeedLines();
const attacker = lines.findIndex((l) => l.includes(ATTACKER.ip));

test('the live feed is the same on every run', () => {
  assert.deepEqual(liveFeedLines(), lines);
});

test('the attacker arrives after the initial burst, so only following the file catches it live', () => {
  assert.ok(attacker >= BURST, `attacker line ${attacker} is inside the burst of ${BURST}`);
  // Still inside tail's default 10 lines once the feed has finished, for a learner who arrives late.
  assert.ok(lines.length - attacker <= 10);
});

test('the side quest answer hash is the port of the first new attempt', async () => {
  const level = JSON.parse(fs.readFileSync(new URL('../levels/side-tail-f.json', import.meta.url), 'utf8'));
  const port = lines[attacker].match(/ port (\d+) /)[1];
  assert.equal(await hashAnswer(level.id, port), level.challenge.answerHash);
});

test('setups are a fixed registry of functions', () => {
  assert.deepEqual(Object.keys(SETUPS), ['live-feed']);
  for (const fn of Object.values(SETUPS)) assert.equal(typeof fn, 'function');
});
