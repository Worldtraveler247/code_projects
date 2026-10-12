// Compares the error messages the game composes with what Ansible really prints:
//   node tools/verify-faults.mjs
// Each broken task is run against localhost in check mode. A task with a bad argument fails
// during argument validation, before the module does any work, so nothing is changed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULES } from '../modules.js';
import { errorText } from '../game.js';

const cases = MODULES.flatMap((mod) => mod.faults.map((fault) => ({ mod, fault })));

function brokenArgs({ mod, fault }) {
  const args = { ...mod.args };
  if (fault.kind === 'choice') args[fault.option] = fault.value;
  else if (fault.kind === 'missing') delete args[fault.option];
  else {
    args[fault.typo] = args[fault.option];
    delete args[fault.option];
  }
  return args;
}

const tasks = cases.map((entry, i) => ({
  name: `case ${i}`,
  [entry.mod.fqcn]: brokenArgs(entry),
  ignore_errors: true,
  register: `r${i}`,
}));
const report = cases.map((_, i) => ({ name: `report ${i}`, 'ansible.builtin.debug': { msg: `CASE ${i} >>> {{ r${i}.msg | default('NO MESSAGE') }}` } }));
const dir = mkdtempSync(join(tmpdir(), 'module-drill-'));
const file = join(dir, 'faults.json');
// JSON is valid YAML, so the playbook needs no YAML writer.
writeFileSync(file, JSON.stringify([{ name: 'Verify fault messages', hosts: 'localhost', connection: 'local', gather_facts: false, tasks: [...tasks, ...report] }]));

let output = '';
try {
  output = execFileSync('ansible-playbook', ['--check', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  output = `${error.stdout || ''}${error.stderr || ''}`;
}

let same = 0;
cases.forEach((entry, i) => {
  const match = output.match(new RegExp(`CASE ${i} >>> (.*)"\\n`));
  const real = match ? match[1].replace(/\\"/g, '"') : '(no output)';
  const wanted = errorText(entry.mod, entry.fault).replace(/, \.\.\.$/, '');
  if (real.startsWith(wanted)) {
    same += 1;
  } else {
    console.log(`\n${entry.mod.fqcn} [${entry.fault.kind}]\n  game: ${wanted}\n  real: ${real.slice(0, 220)}`);
  }
});
console.log(`\n${same} of ${cases.length} messages match what Ansible prints.`);
