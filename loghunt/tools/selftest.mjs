#!/usr/bin/env node
// Definition of done for content: regenerate the arena in the real guest, then for every level
//   - run each worked example and compare its output with the level file byte for byte
//   - run the reference solution AND the alternative, and check both hash to challenge.answerHash
// Usage:
//   node tools/selftest.mjs                 check every level (exit 1 on any failure)
//   node tools/selftest.mjs --print [id]    show real outputs and hashes, for writing a level
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreGuest } from './guest-node.mjs';
import { generateArena } from '../generator.js';
import { seedGuest } from '../seed.js';
import { validateLevel } from '../levels.js';
import { hashAnswer } from '../checker.js';
import { SETUPS } from '../live.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const printMode = args.includes('--print');
const only = args.find((a) => !a.startsWith('--'));

const index = JSON.parse(fs.readFileSync(path.join(root, 'levels/index.json'), 'utf8'));
const levels = index.levels.map((file) => ({ file, level: JSON.parse(fs.readFileSync(path.join(root, 'levels', file), 'utf8')) }))
  .filter(({ level }) => !only || level.id === only);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const guest = await restoreGuest();
await guest.control.run('stty -echo -onlcr', { timeoutMs: 15_000 });
const seed = () => seedGuest(guest.emulator, guest.control, generateArena());


// Run as the learner: user analyst, in ~/arena, with the learner's locale and timezone. The command goes
// into a script file rather than a quoted string, so level JSON can never break the harness's quoting.
let scriptSeq = 0;
async function runAsLearner(command) {
  const script = `/var/lib/loghunt/selftest-${++scriptSeq}.sh`;
  await guest.emulator.create_file(script, encoder.encode(`export LC_ALL=C TZ=UTC\ncd ~/arena || exit 99\n${command}\n`));
  const { status, output } = await guest.control.run(`su -s /bin/bash analyst -c 'bash ${script}' < /dev/null; rc=$?; rm -f ${script}; (exit $rc)`, { timeoutMs: 120_000 });
  return { status, out: decoder.decode(output) };
}

const failures = [];
let checks = 0;
await seed();
for (const { file, level } of levels) {
  const schema = validateLevel(level, file);
  if (schema.length && !printMode) { failures.push(...schema); continue; }
  console.log(`\n== ${level.id} — ${level.title}`);
  if (level.setup) await SETUPS[level.setup](guest.emulator, guest.control);

  for (const [i, ex] of (level.examples ?? []).entries()) {
    const { out } = await runAsLearner(ex.command);
    checks += 1;
    if (printMode) console.log(`-- example ${i + 1}: ${ex.command}\n${out}`);
    else if (out !== ex.output) failures.push(`${level.id} example ${i + 1} (${ex.command}): output differs\n--- expected\n${ex.output}--- actual\n${out}`);
  }

  for (const kind of ['solution', 'alternative']) {
    const command = level.debrief?.[kind];
    if (!command) continue;
    const { status, out } = await runAsLearner(command);
    const answer = out.trim();
    const hash = await hashAnswer(level.id, answer);
    checks += 1;
    if (printMode) console.log(`-- ${kind}: ${command}\n   answer: ${JSON.stringify(answer)}  hash: ${hash}  exit: ${status}`);
    else if (answer.includes('\n')) failures.push(`${level.id} ${kind} prints more than one line: ${JSON.stringify(out)}`);
    else if (hash !== level.challenge?.answerHash) failures.push(`${level.id} ${kind} answer ${JSON.stringify(answer)} does not match answerHash`);
  }
  // A reset must restore the arena: a level may delete or edit files.
  await seed();
}

await guest.emulator.destroy();
if (printMode) process.exit(0);
if (failures.length) {
  console.error(`\nSELFTEST FAILED (${failures.length} of ${checks} checks):\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`\nselftest: ${levels.length} levels, ${checks} checks, all passed`);
