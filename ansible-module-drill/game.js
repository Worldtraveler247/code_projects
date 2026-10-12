// The rules of the drill, with no screen access, so the same code runs in the browser and
// under the Node tests. Everything shown to the player is derived from modules.js and specs.js.

import { renderModel } from '../ansible-playbook-trainer/model.js';
import { SPECS } from './specs.js';
import { MESSAGES } from './messages.js';

export const ROUNDS = ['Look up', 'Write', 'Predict', 'Reverse', 'Break'];
export const PAR_SECONDS = 600;
export const OUTCOMES = ['ok', 'changed', 'skipped', 'failed'];
export const HOST = 'servera';
// A hint costs one miss. Showing the answer costs enough to cap the drill at one star.
export const REVEAL_COST = 3;

const COLLECTIONS = ['ansible.builtin', 'ansible.posix', 'community.general'];

export const shortName = (fqcn) => fqcn.split('.').pop();
export const collectionOf = (fqcn) => fqcn.split('.').slice(0, 2).join('.');
export const specOf = (fqcn) => SPECS[fqcn].options;

function taskOf(mod, part) {
  return { name: part.name || mod.name, [part.fqcn || mod.fqcn]: part.args, ...(part.keywords || {}) };
}

function playOf(mod, task) {
  return [{
    name: `Drill the ${shortName(mod.fqcn)} module`,
    hosts: HOST,
    become: mod.become !== false,
    gather_facts: false,
    tasks: [task],
  }];
}

// The playbook each editor round must end up with.
export const writePlays = (mod) => playOf(mod, taskOf(mod, mod));
export const reversePlays = (mod) => playOf(mod, taskOf(mod, mod.reverse));
export const reverseFqcn = (mod) => mod.reverse.fqcn || mod.fqcn;

const isTaskLine = (line) => Array.isArray(line.path) && line.path[1] === 'tasks';

// The play header is given, so the player types only the task. A blank line after
// gather_facts is conventional and the checker ignores it.
export function starterText(mod) {
  const lines = modelLines(writePlays(mod));
  const header = lines.slice(0, lines.indexOf('  tasks:'));
  // The last line carries the task's indentation, ready for "A" and a dash.
  return [...header, '', '  tasks:', '    '].join('\n');
}

export function modelLines(plays) {
  return renderModel(plays).map((line) => line.text);
}

// The task alone, as [{ text, option }]: option is set on the line of a module argument.
export function taskLines(mod) {
  const model = renderModel(writePlays(mod));
  const first = model.findIndex((line) => isTaskLine(line) && line.path.length > 2);
  return model.slice(first).map((line) => {
    const isArg = line.path && line.path.length === 5 && line.path[3] === mod.fqcn;
    return { text: line.text, option: isArg ? line.path[4] : null, block: Boolean(line.block) };
  });
}

// ---- Round 1: look up ----

export function collectionQuestion(mod) {
  const name = shortName(mod.fqcn);
  return {
    prompt: `Which full name does the ${name} module have?`,
    choices: COLLECTIONS.map((collection) => ({ label: `${collection}.${name}`, correct: `${collection}.${name}` === mod.fqcn })),
    why: `ansible-doc -l | grep ${name} lists it as ${mod.fqcn}. ${collectionNote(mod.fqcn)}`,
  };
}

function collectionNote(fqcn) {
  const collection = collectionOf(fqcn);
  if (collection === 'ansible.builtin') return 'ansible.builtin ships inside ansible-core, so it is always there.';
  return `${collection} is a separate collection. If ansible-doc cannot find the module, the collection is not installed: ansible-galaxy collection install ${collection}.`;
}

const CANDIDATES = 6;

export function requiredQuestion(mod) {
  const spec = specOf(mod.fqcn);
  const required = Object.keys(spec).filter((name) => spec[name].required);
  const used = Object.keys(mod.args);
  const rest = Object.keys(spec).filter((name) => !required.includes(name) && !used.includes(name));
  const names = [...new Set([...required, ...used, ...rest])].slice(0, Math.max(CANDIDATES, required.length)).sort();
  const none = required.length === 0;
  return {
    prompt: `ansible-doc ${mod.fqcn} marks each required option with = and each optional one with -. Tick every required option, then check.`,
    options: names.map((name) => ({ name, required: required.includes(name) })),
    why: none
      ? 'None of them is required on its own. The module decides from the combination you give it, so read the EXAMPLES section for the usual set.'
      : `Required: ${required.join(', ')}. Leave one out and the task fails before it touches the host.`,
  };
}

export function requiredCorrect(question, ticked) {
  return question.options.every((option) => option.required === ticked.includes(option.name));
}

// What `ansible-doc -s` would list, as [{ name, required, detail }], required options first.
export function docSummary(fqcn) {
  const spec = specOf(fqcn);
  return Object.keys(spec)
    .sort((a, b) => Number(Boolean(spec[b].required)) - Number(Boolean(spec[a].required)) || a.localeCompare(b))
    .map((name) => {
      const option = spec[name];
      const parts = [option.type];
      if (option.choices) parts.push(`one of: ${option.choices.join(', ')}`);
      if (option.default !== undefined) parts.push(`default: ${option.default}`);
      return { name, required: Boolean(option.required), detail: parts.join(' · ') };
    });
}

// ---- Round 3: predict ----

const RUNS = [
  { flag: ' --check', label: 'a dry run' },
  { flag: '', label: 'the first real run' },
  { flag: '', label: 'the same command a second time' },
];

const VERB = { ok: 'ok', changed: 'changed', skipped: 'skipping', failed: 'fatal' };

export function predictQuestion(mod, run) {
  const { answer, why } = mod.predict[run];
  const count = (status) => (status === answer ? 1 : 0);
  const ran = answer === 'skipped' ? 0 : 1;
  return {
    command: `ansible-playbook drill.yml${RUNS[run].flag}`,
    label: RUNS[run].label,
    answer,
    why,
    output: [
      `TASK [${mod.name}] ${'*'.repeat(12)}`,
      `${VERB[answer]}: [${HOST}]`,
      '',
      `PLAY RECAP ${'*'.repeat(12)}`,
      `${HOST} : ok=${ran}  changed=${count('changed')}  unreachable=0  failed=0  skipped=${count('skipped')}`,
    ],
  };
}

// ---- Round 5: break ----

// What Ansible prints for a fault: recorded from a real run, or given with the fault itself.
export function errorText(mod, fault) {
  return fault.message || MESSAGES[mod.id][mod.faults.indexOf(fault)];
}

const WHY = {
  choice: (fault) => `${fault.option} accepts only the listed values, and "${fault.value}" is not one of them. The message prints the valid choices, so read it before reaching for the documentation.`,
  unsupported: (fault) => `${fault.typo} is not an option of this module; the real name is ${fault.option}. The message names the bad key and lists the supported ones.`,
  missing: (fault) => `${fault.option} is required and the task does not give it. The message names the missing option, so the fix is to add that line.`,
  custom: (fault) => fault.why,
};

// One broken task: { error, prompt, shown, picks: [{ label, correct }], why }.
// For a wrong value or a wrong key the player picks the faulty line of the task itself.
// For a missing option the task is shown without it and the player picks what to add.
export function faultCase(mod, fault) {
  const lines = taskLines(mod);
  const error = `fatal: [${HOST}]: FAILED! => {"changed": false, "msg": "${errorText(mod, fault)}"}`;
  const why = WHY[fault.kind](fault);
  const at = lines.findIndex((line) => line.option === fault.option);
  const indent = lines[at].text.match(/^ */)[0];

  if (fault.kind === 'missing') {
    // Drop the option's line and anything nested under it.
    let end = at + 1;
    while (end < lines.length && lines[end].text.match(/^ */)[0].length > indent.length) end += 1;
    const shown = lines.filter((_, i) => i < at || i >= end).map((line) => line.text);
    const spec = specOf(mod.fqcn);
    const others = Object.keys(spec).filter((name) => !spec[name].required && !(name in mod.args) && name !== 'free_form');
    const picks = [fault.option, ...others.slice(0, 2)].sort().map((name) => ({ label: `${name}:`, correct: name === fault.option }));
    return { error, prompt: 'The task below fails with this error. Which option must be added?', shown, picks, why };
  }

  const broken = fault.value !== undefined
    ? `${indent}${fault.option}: ${fault.value}`
    : lines[at].text.replace(`${fault.option}:`, `${fault.typo}:`);
  const picks = lines.map((line, i) => ({ label: i === at ? broken : line.text, correct: i === at, block: line.block }));
  return { error, prompt: 'This task fails with the error below. Pick the line that causes it.', shown: null, picks, why };
}

// ---- Scoring ----

export function stars(misses, seconds) {
  if (misses === 0 && seconds <= PAR_SECONDS) return 3;
  return misses <= 2 ? 2 : 1;
}

// Keeps the better of two results: more stars, then fewer seconds.
export function better(previous, next) {
  if (!previous) return next;
  if (next.stars !== previous.stars) return next.stars > previous.stars ? next : previous;
  return next.seconds < previous.seconds ? next : previous;
}

export function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// The commands for repeating the drill on a real lab, in the order they are run.
export function labCommands(mod) {
  const commands = [`ansible-doc -l | grep ${shortName(mod.fqcn)}`, `ansible-doc -s ${mod.fqcn}`];
  if (reverseFqcn(mod) !== mod.fqcn) commands.push(`ansible-doc -s ${reverseFqcn(mod)}`);
  return [...commands, 'vim drill.yml', 'ansible-playbook drill.yml --syntax-check', 'ansible-playbook drill.yml --check --diff', 'ansible-playbook drill.yml', 'ansible-playbook drill.yml'];
}
