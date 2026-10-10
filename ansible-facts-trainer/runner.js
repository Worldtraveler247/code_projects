import { fail, isMapping, isTooLarge, judgeTask, parseYaml } from './validator.js';
import { executeTasks, newHost, prepareTasks } from './executor.js';
import { JinjaError, pyStr, render } from './jinja.js';

export const PLAYBOOK_FILE = 'facts.yml';
export const PLACEHOLDER = 'FACT_GOES_HERE';

const BANNER_WIDTH = 72;
const NOT_RUN = 'Not run: see the coach note below.';
const PLAY_KEYS = ['name', 'hosts', 'tasks', 'gather_facts', 'become', 'become_user', 'become_method', 'remote_user'];
// Valid play keywords that change which facts exist or what runs. Out of scope.
const UNSUPPORTED_PLAY_KEYS = ['vars', 'vars_files', 'vars_prompt', 'roles', 'pre_tasks', 'post_tasks', 'handlers',
  'environment', 'serial', 'strategy', 'connection', 'tags', 'collections', 'any_errors_fatal', 'ignore_errors',
  'ignore_unreachable', 'max_fail_percentage', 'module_defaults', 'order', 'port', 'run_once', 'throttle', 'timeout',
  'check_mode', 'diff', 'force_handlers', 'gather_subset', 'gather_timeout', 'fact_path', 'debugger', 'no_log',
  'become_exe', 'become_flags'];
const FALSE_WORDS = [false, 'false', 'False', 'no', 'No', 'off'];
// Failures real Ansible raises while templating a task, after the play has started.
const RUNTIME_CODES = ['UNDEFINED_FACT', 'BAD_EXPRESSION'];

const FILE_PATH = `/home/student/my-project-directory/${PLAYBOOK_FILE}`;

// Ansible's "where it went wrong" block: the line before, the line itself, and a caret.
function locate(source, line, column) {
  const lines = source.split('\n');
  let at = Math.min(Math.max(1, line), lines.length);
  while (at > 1 && lines[at - 1].trim() === '') at--;
  const quoted = at > 1 ? [lines[at - 2], lines[at - 1]] : [lines[at - 1]];
  return [
    `The error appears to be in '${FILE_PATH}': line ${at}, column ${column}, but may`,
    'be elsewhere in the file depending on the exact syntax problem.',
    '',
    'The offending line appears to be:',
    '',
    ...quoted,
    `${' '.repeat(Math.max(0, column - 1))}^ here`,
  ];
}

// Where the play's nth task starts: Ansible reports a failing task by this position.
function taskPosition(source, index = 0) {
  const lines = source.split('\n');
  const tasksAt = lines.findIndex((line) => /^\s*tasks\s*:/.test(line));
  let indent = null;
  let seen = 0;
  for (let i = tasksAt + 1; i < lines.length; i++) {
    const item = /^(\s*)(-\s+)\S/.exec(lines[i]);
    if (!item) continue;
    // Only dashes at the task list's own indentation start a task; deeper ones are list values.
    if (indent === null) indent = item[1].length;
    if (item[1].length !== indent) continue;
    if (seen++ === index) return { line: i + 1, column: item[1].length + item[2].length + 1 };
  }
  return { line: Math.max(1, tasksAt + 1), column: 1 };
}

const banner = (text) => `${text} ${'*'.repeat(Math.max(3, BANNER_WIDTH - text.length - 1))}`;
const firstSentence = (text) => text.split(/(?<=[.?!])\s/)[0];

function recap(host, ok, failed, changed = 0, skipped = 0) {
  return `${host.padEnd(26)} : ok=${ok}    changed=${changed}    unreachable=0    failed=${failed}    skipped=${skipped}    rescued=0    ignored=0`;
}

function pythonType(value) {
  if (isMapping(value)) return "<class 'dict'>";
  if (typeof value === 'string') return "<class 'str'>";
  if (typeof value === 'number') return "<class 'int'>";
  return "<class 'bool'>";
}

// The line ansible-playbook itself would print for a problem it detects while loading.
function loadError(verdict) {
  switch (verdict.code) {
    case 'MISSING_MODULE': return 'ERROR! no module/action detected in task.';
    case 'UNKNOWN_MODULE': return verdict.detail
      ? `ERROR! couldn't resolve module/action '${verdict.detail}'. This often indicates a misspelling, missing collection, or incorrect module path.`
      : NOT_RUN;
    default: return NOT_RUN;
  }
}

/**
 * Check a whole playbook file and simulate the run.
 * Returns { verdict, terminal }: the coach's judgment, and the text a terminal would show.
 * The terminal text follows ansible-playbook's format but is produced here, not by Ansible.
 */
export function runPlaybook(text, challenge, facts, host) {
  const source = String(text);
  // Leading blank lines are dropped: the shell prints the prompt and the command itself.
  const stop = (verdict, ...lines) => ({ verdict, terminal: lines.join('\n').replace(/^\n+/, '') });

  if (isTooLarge(source)) return stop(fail('TOO_LARGE', 'The file is too long. One short play is enough.'), NOT_RUN);
  if (source.includes(PLACEHOLDER)) {
    return stop(fail('PLACEHOLDER', `Replace ${PLACEHOLDER} with the fact lookup, then run the playbook.`), NOT_RUN);
  }

  const parsed = parseYaml(source);
  if (!parsed.ok) {
    const where = parsed.line ? ['', ...locate(source, parsed.line, parsed.column)] : [];
    return stop(parsed,
      'ERROR! We were unable to read either as JSON nor YAML, these are the errors we got from each:',
      'JSON: Expecting value: line 1 column 1 (char 0)',
      '',
      'Syntax Error while loading YAML.',
      `  ${parsed.reason}`,
      ...where);
  }

  const doc = parsed.doc;
  if (doc == null || (Array.isArray(doc) && doc.length === 0)) {
    return stop(fail('NOT_A_PLAY', 'The file is empty. A playbook is a list of plays: start with "- name:" at the left margin, then hosts and tasks.'),
      'ERROR! Empty playbook, nothing to do');
  }
  if (!Array.isArray(doc)) {
    return stop(fail('NOT_A_PLAY', 'A playbook is a list of plays. The play must start with a dash at the left margin: "- name: ...".'),
      `ERROR! A playbook must be a list of plays, got a ${pythonType(doc)} instead`);
  }
  if (doc.length > 1) {
    return stop(fail('EXTRA_PLAYS', `This file has ${doc.length} plays. The trainer runs one play; a second dash at the left margin starts a new play.`), NOT_RUN);
  }
  const play = doc[0];
  if (!isMapping(play)) {
    return stop(fail('NOT_A_PLAY', 'A play is a set of keys: name, hosts, and tasks.'),
      "ERROR! playbook entries must be either valid plays or 'import_playbook' statements");
  }

  // Checked before stray keys: a bare task pasted without its play has no hosts either.
  if (!Object.hasOwn(play, 'hosts')) {
    return stop(fail('NOT_A_PLAY', 'The play has no hosts key. A play needs hosts and tasks; check that the header lines were not deleted or re-indented.'),
      "ERROR! the field 'hosts' is required but was not set");
  }
  const badKey = Object.keys(play).find((key) => !PLAY_KEYS.includes(key) && !UNSUPPORTED_PLAY_KEYS.includes(key));
  if (badKey) {
    return stop(fail('BAD_PLAY_KEY', `"${badKey}" sits at the play level. Task keys belong under tasks:, indented beneath a "- name:" list item.`),
      `ERROR! '${badKey}' is not a valid attribute for a Play`);
  }
  // Scenarios run on the full executor, which understands play-level vars.
  const scenario = challenge.kind === 'scenario';
  const outOfScope = Object.keys(play).find((key) => UNSUPPORTED_PLAY_KEYS.includes(key) && !(scenario && key === 'vars'));
  if (outOfScope) {
    return stop(fail('UNSUPPORTED_KEYWORD', `"${outOfScope}" is valid Ansible, but it is outside this trainer's scope. Keep the play to name, hosts, and tasks.`), NOT_RUN);
  }

  const targets = (Array.isArray(play.hosts) ? play.hosts : [play.hosts]).map(String);
  const playName = typeof play.name === 'string' && play.name.trim() !== '' ? play.name : targets.join(',');
  const playBanner = banner(`PLAY [${playName}]`);
  const matches = targets.some((target) => target === host || target === 'all' || target === '*' || target === facts.fqdn);
  if (!matches) {
    return stop(fail('NO_HOSTS_MATCHED', `This play targets "${targets.join(', ')}", which is not in the inventory. The lab host is ${host}.`),
      `[WARNING]: Could not match supplied host pattern, ignoring: ${targets.join(',')}`, '', playBanner,
      'skipping: no hosts matched', '', banner('PLAY RECAP'), '');
  }

  const gather = !FALSE_WORDS.includes(play.gather_facts);
  const opening = ['', playBanner];
  if (gather) opening.push('', banner('TASK [Gathering Facts]'), `ok: [${host}]`);
  const closing = (ok, failed) => ['', banner('PLAY RECAP'), recap(host, ok, failed)];
  const gathered = gather ? 1 : 0;

  const tasks = play.tasks;
  if (tasks == null || (Array.isArray(tasks) && tasks.length === 0)) {
    return stop(fail('NO_TASKS', 'The play has no task yet. Add one beneath tasks:, starting with "- name:" indented four spaces.'),
      ...opening, ...closing(gathered, 0));
  }
  if (!Array.isArray(tasks)) {
    return stop(fail('NOT_A_LIST', 'Tasks are a list. Start the task with a dash: "    - name: ...".'),
      'ERROR! A malformed block was encountered while loading tasks: the value of tasks should be a list.');
  }
  if (scenario) return runScenario({ source, play, tasks, challenge, facts, host, gather, opening, stop });
  if (tasks.length > 1) {
    return stop(fail('EXTRA_TASKS', `Submit exactly one task; this play has ${tasks.length}.`), NOT_RUN);
  }

  const task = tasks[0];
  const verdict = judgeTask(task, challenge, gather ? facts : {}, host);
  const taskName = isMapping(task) && typeof task.name === 'string' && task.name.trim() !== '' ? task.name : 'debug';
  const taskBanner = ['', banner(`TASK [${taskName}]`)];

  if (verdict.ok || verdict.code === 'WRONG_FACT') {
    return stop(verdict, ...opening, ...taskBanner, verdict.rendered, ...closing(gathered + 1, 0));
  }
  if (RUNTIME_CODES.includes(verdict.code)) {
    if (!gather && verdict.code === 'UNDEFINED_FACT') {
      verdict.message += ' gather_facts is turned off in this play, so ansible_facts is empty.';
    }
    // `ansible` holds Jinja2's own wording when the failure has one. Ansible prints the
    // whole message, location block included, as one JSON string on a single line.
    const cause = verdict.ansible ?? firstSentence(verdict.message).replace(/\.$/, '');
    const summary = verdict.ansible
      ? `The task includes an option with an undefined variable. The error was: ${cause}. ${cause}`
      : `template error while templating string: ${cause}. String: ${verdict.template ?? ''}. ${cause}`;
    const position = taskPosition(source);
    const reason = `${summary}\n\n${locate(source, position.line, position.column).join('\n')}\n`;
    return stop(verdict, ...opening, ...taskBanner,
      `fatal: [${host}]: FAILED! => {"msg": ${JSON.stringify(reason)}}`, ...closing(gathered, 1));
  }
  return stop(verdict, loadError(verdict));
}

// ---- Exam-style scenarios: run every task, then grade the state left on the host -----------

const DELETE = '__DELETE__';

/** Copy the facts and apply a patch: nested keys merge, lists and plain values replace. */
export function patchFacts(facts, patch) {
  const merge = (target, changes) => {
    for (const [key, value] of Object.entries(changes)) {
      if (value === DELETE) delete target[key];
      else if (isMapping(value) && isMapping(target[key])) merge(target[key], value);
      else target[key] = structuredClone(value);
    }
    return target;
  };
  return merge(structuredClone(facts), patch);
}

// Ansible prints a failed result as one line of JSON, with a space after each colon and comma.
function inlineJson(value) {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
  // Keys are sorted, as Ansible sorts them.
  if (isMapping(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}: ${inlineJson(value[key])}`).join(', ')}}`;
  return JSON.stringify(value);
}

const normalize = (text) => String(text).replace(/\s+$/, '');

function runCheck(check, run) {
  switch (check.type) {
    case 'package': return run.state.packages.has(check.name) === check.installed;
    case 'file': {
      const file = run.state.files.get(check.path);
      return check.absent ? !file : Boolean(file) && normalize(file.content) === normalize(check.content);
    }
    case 'message': return run.messages.some((message) => normalize(message).trim() === check.text) === check.present;
    case 'var': return Object.hasOwn(run.state.vars, check.name) && pyStr(run.state.vars[check.name]) === check.equals;
    default: return false;
  }
}

// What the learner got instead, so a failed check says more than "wrong".
function describeActual(check, run) {
  if (check.type === 'file' && !check.absent) {
    const file = run.state.files.get(check.path);
    return file ? ` The file contains:\n${normalize(file.content)}` : ' The file was not created.';
  }
  if (check.type === 'message' && check.present) {
    return run.messages.length ? ` It printed: ${run.messages.map((m) => JSON.stringify(m)).join(', ')}.` : ' Nothing was printed.';
  }
  if (check.type === 'var') {
    return Object.hasOwn(run.state.vars, check.name) ? ` It is ${JSON.stringify(pyStr(run.state.vars[check.name]))}.` : ' No variable with that name was set.';
  }
  return '';
}

function playVars(play, facts, host) {
  if (!isMapping(play.vars)) return {};
  const vars = {};
  // Rendered in order, so a later variable can use an earlier one.
  for (const [key, value] of Object.entries(play.vars)) {
    vars[key] = typeof value === 'string' ? render(value, { ansible_facts: facts, inventory_hostname: host, ...vars }) : value;
  }
  return vars;
}

function failureMessage(error, source, index, gather) {
  const position = taskPosition(source, index);
  const where = `\n\n${locate(source, position.line, position.column).join('\n')}\n`;
  if (!(error instanceof JinjaError)) return { code: 'TASK_FAILED', coach: error.result.msg, result: error.result };
  const cause = error.ansible;
  if (error.kind === 'unsupported') return { code: 'UNSUPPORTED_FILTER', coach: error.message, notRun: true };
  if (error.condition !== undefined) {
    return {
      code: error.kind === 'undefined' ? 'UNDEFINED_FACT' : 'BAD_EXPRESSION',
      coach: `The condition "${error.condition}" could not be evaluated: ${error.message}.`,
      result: { msg: `The conditional check '${error.condition}' failed. The error was: error while evaluating conditional (${error.condition}): ${cause}${where}` },
    };
  }
  if (error.kind === 'undefined') {
    return {
      code: 'UNDEFINED_FACT',
      coach: `Ansible could not find a value: ${error.message}. Check the name against the output of ansible servera -m setup.${gather ? '' : ' gather_facts is turned off in this play, so ansible_facts is empty.'}`,
      result: { msg: `The task includes an option with an undefined variable. The error was: ${cause}. ${cause}${where}` },
    };
  }
  if (error.kind === 'type') {
    return { code: 'BAD_EXPRESSION', coach: `The expression mixes types that cannot be combined: ${error.message}.`, result: { msg: `Unexpected templating type error occurred on the template: ${cause}${where}` } };
  }
  return { code: 'BAD_EXPRESSION', coach: `The expression is not valid Jinja2: ${error.message}.`, result: { msg: `template error while templating string: ${cause}.${where}` } };
}

function runScenario({ source, play, tasks, challenge, facts, host, gather, opening, stop }) {
  const prepared = prepareTasks(tasks);
  if (!prepared.ok) return stop(fail(prepared.code, prepared.message, { detail: prepared.detail }), prepared.load ?? NOT_RUN);

  const runOn = (hostFacts) => {
    const visible = gather ? hostFacts : {};
    return executeTasks(prepareTasks(tasks).tasks, { facts: visible, host, state: newHost(), vars: playVars(play, visible, host) });
  };

  let run;
  try {
    run = runOn(facts);
  } catch (error) {
    if (!(error instanceof JinjaError)) throw error;
    return stop(fail('BAD_EXPRESSION', `A value under vars: could not be evaluated: ${error.message}.`), NOT_RUN);
  }

  const lines = [...opening];
  for (const event of run.events) {
    lines.push('', banner(`TASK [${event.label}]`));
    if (event !== run.failed) lines.push(...event.lines);
  }
  const closing = () => ['', banner('PLAY RECAP'), recap(host, run.counts.ok + (gather ? 1 : 0), run.counts.failed, run.counts.changed, run.counts.skipped)];

  if (run.failed) {
    const failure = failureMessage(run.failed.error, source, run.failed.index, gather);
    if (failure.notRun) return { ...stop(fail(failure.code, failure.coach), NOT_RUN), state: newHost() };
    lines.push(...run.failed.lines, `fatal: [${host}]: FAILED! => ${inlineJson({ ...(failure.result.changed === undefined ? {} : { changed: failure.result.changed }), ...failure.result })}`);
    return { ...stop(fail(failure.code, failure.coach), ...lines, ...closing()), state: run.state };
  }

  const checks = challenge.expect.map((check) => {
    const ok = runCheck(check, run);
    return { ok, label: check.label + (ok ? '' : describeActual(check, run)) };
  });
  for (const variant of challenge.variants ?? []) {
    const other = runOn(patchFacts(facts, variant.patch));
    if (other.failed) {
      const reason = other.failed.error instanceof JinjaError ? other.failed.error.message : other.failed.error.result.msg;
      checks.push({ ok: false, label: `On ${variant.label}, the playbook fails: ${reason}` });
      continue;
    }
    for (const check of variant.expect) {
      const ok = runCheck(check, other);
      checks.push({ ok, label: `On ${variant.label}: ${check.label}${ok ? '' : describeActual(check, other)}` });
    }
  }
  const passed = checks.every((check) => check.ok);
  const verdict = passed
    ? { ok: true, code: 'OK', message: 'Correct. The host ends in the required state.', checks }
    : fail('WRONG_STATE', 'The playbook ran, but the result does not match the task.', { checks });
  return { ...stop(verdict, ...lines, ...closing()), state: run.state };
}
