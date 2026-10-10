import { load } from './vendor/js-yaml.mjs';

export const MAX_BYTES = 10240;
export const isTooLarge = (text) => new TextEncoder().encode(String(text)).length > MAX_BYTES;

export const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const formatStep = (step) => (typeof step === 'number' ? `[${step}]` : `['${step}']`);

export function pathToExpr(path) {
  return `ansible_facts${path.map(formatStep).join('')}`;
}

function preview(value) {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function suggest(key, keys) {
  if (key.startsWith('ansible_') && keys.includes(key.slice(8))) return key.slice(8);
  if (keys.includes(`ansible_${key}`)) return `ansible_${key}`;
  let best = null;
  let bestDistance = 4;
  for (const candidate of keys) {
    const d = distance(key, candidate);
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}

// The type name Jinja2 uses in its own error text. `ansible` on a failure carries that text
// so the simulated run can print what a real run prints.
function pythonType(value) {
  if (typeof value === 'string') return 'str';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  return 'NoneType';
}

function walk(facts, path) {
  let current = facts;
  const seen = [];
  for (const step of path) {
    const where = pathToExpr(seen);
    if (Array.isArray(current)) {
      if (typeof step !== 'number') {
        return fail('UNDEFINED_FACT', `${where} is a list. Pick an item by position, for example [0].`,
          { ansible: `'list object' has no attribute '${step}'` });
      }
      if (step >= current.length) {
        return fail('UNDEFINED_FACT', `${where} has ${current.length} item(s); index ${step} is out of range.`,
          { ansible: `list object has no element ${step}` });
      }
      current = current[step];
    } else if (current !== null && typeof current === 'object') {
      const key = String(step);
      // Object.hasOwn keeps inherited names such as "constructor" from resolving.
      if (!Object.hasOwn(current, key)) {
        const hint = suggest(key, Object.keys(current));
        return fail('UNDEFINED_FACT', `No fact named '${key}' under ${where}.${hint ? ` Did you mean '${hint}'?` : ''}`,
          { ansible: `'dict object' has no attribute '${key}'` });
      }
      current = current[key];
    } else {
      return fail('UNDEFINED_FACT', `${where} is a plain value (${preview(current)}); it has no keys beneath it.`,
        { ansible: `'${pythonType(current)} object' has no attribute '${step}'` });
    }
    seen.push(step);
  }
  return { ok: true, value: current, path };
}

const ROOT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const STEP_RE = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*\])/;
const BARE_KEY_RE = /^\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/;

export function resolveExpression(source, facts) {
  const src = String(source).trim();
  if (src === '') return fail('BAD_EXPRESSION', 'The expression is empty.');
  if (/[‘’“”]/.test(src)) {
    return fail('BAD_EXPRESSION', "This contains curly quotes (‘ ’ or “ ”). Retype them as straight quotes: ' or \".");
  }
  const [base, ...filters] = splitPipes(src);
  const resolved = resolveLookup(base.trim(), facts);
  if (!resolved.ok || filters.length === 0) return resolved;
  return applyFilters(resolved, filters);
}

// Split on | outside quoted strings, honoring backslash escapes inside them.
function splitPipes(source) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < source.length) current += source[++i];
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === '|') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

const FILTER_RE = /^\s*([A-Za-z_][\w.]*)\s*(?:\(([\s\S]*)\))?\s*$/;
const STRING_ARG_RE = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*(,|$)/y;
const MAX_PATTERN = 200;
const SUPPORTED_FILTERS = "select('match', ...), select('search', ...), first, and list";

// Parse a comma-separated list of quoted strings. Returns null if anything else is present.
function parseStringArgs(text) {
  const args = [];
  if (text.trim() === '') return args;
  STRING_ARG_RE.lastIndex = 0;
  let position = 0;
  while (position < text.length) {
    STRING_ARG_RE.lastIndex = position;
    const match = STRING_ARG_RE.exec(text);
    if (!match) return null;
    // Ansible keeps backslashes in a string literal exactly as written.
    args.push(match[1] ?? match[2]);
    position = STRING_ARG_RE.lastIndex;
    if (match[3] !== ',') break;
  }
  return position >= text.length ? args : null;
}

function applyFilters(resolved, filters) {
  let value = resolved.value;
  // Jinja2's select returns a lazy generator; printing it without first or list shows
  // "<generator object ...>", which is never what the author wanted.
  let generator = false;
  for (const raw of filters) {
    const parsed = FILTER_RE.exec(raw);
    if (!parsed) return fail('BAD_EXPRESSION', `Could not read the filter "${raw.trim()}".`);
    const [, name, argText] = parsed;
    if (name === 'select') {
      const args = argText === undefined ? [] : parseStringArgs(argText);
      if (!Array.isArray(value)) return fail('BAD_EXPRESSION', 'select filters a list, but the value to its left is not a list.');
      if (args === null || args.length === 0) return fail('BAD_EXPRESSION', "select needs a test name and a pattern, both quoted: select('match', '192.168.50.').");
      if (args[0] !== 'match' && args[0] !== 'search') {
        return fail('UNSUPPORTED_FILTER', `The "${args[0]}" test is valid Jinja2, but it is outside this trainer's scope. Supported here: ${SUPPORTED_FILTERS}.`);
      }
      if (args.length !== 2) return fail('BAD_EXPRESSION', `select('${args[0]}', ...) needs exactly one pattern after the test name.`);
      if (args[1].length > MAX_PATTERN) return fail('BAD_EXPRESSION', `The pattern is too long (limit ${MAX_PATTERN} characters).`);
      let pattern;
      try {
        // match is anchored at the start of the string, like Python's re.match.
        pattern = new RegExp(args[0] === 'match' ? `^(?:${args[1]})` : args[1]);
      } catch {
        return fail('BAD_EXPRESSION', `"${args[1]}" is not a valid regular expression.`);
      }
      value = value.filter((item) => typeof item === 'string' && pattern.test(item));
      generator = true;
    } else if (name === 'first' || name === 'list') {
      if (argText !== undefined && argText.trim() !== '') return fail('BAD_EXPRESSION', `${name} takes no arguments.`);
      if (!Array.isArray(value) && typeof value !== 'string') return fail('BAD_EXPRESSION', `${name} needs a list, but the value to its left is not a list.`);
      generator = false;
      if (name === 'list') {
        value = [...value];
      } else {
        if (value.length === 0) {
          return fail('UNDEFINED_FACT', 'first found nothing: the list to its left is empty, so the result is undefined.',
            { ansible: 'No first item, sequence was empty.' });
        }
        value = value[0];
      }
    } else {
      return fail('UNSUPPORTED_FILTER', `The "${name}" filter is valid Jinja2, but it is outside this trainer's scope. Supported here: ${SUPPORTED_FILTERS}.`);
    }
  }
  if (generator) {
    return fail('BAD_EXPRESSION', 'select returns a generator, not a value you can print. Add | first for one item, or | list for all of them.');
  }
  // path is null so a filtered value never counts as reading the plain fact.
  return { ok: true, value, path: null, basePath: resolved.path };
}

function resolveLookup(src, facts) {
  if (src === '') return fail('BAD_EXPRESSION', 'There is no fact lookup before the | character.');
  const root = ROOT_RE.exec(src);
  if (!root) {
    return fail('BAD_EXPRESSION', `"${src}" is not a fact lookup. Start with ansible_facts, for example ansible_facts['hostname'].`);
  }
  const path = [];
  if (root[0] !== 'ansible_facts') {
    if (!root[0].startsWith('ansible_') || root[0].length === 8) {
      return fail('BAD_EXPRESSION', `"${root[0]}" is not a fact variable. Facts live under ansible_facts, for example ansible_facts['hostname'].`);
    }
    // Ansible strips the ansible_ prefix from every fact except ansible_local.
    path.push(root[0] === 'ansible_local' ? root[0] : root[0].slice(8));
  }
  let position = root[0].length;
  while (position < src.length) {
    const rest = src.slice(position);
    const step = STEP_RE.exec(rest);
    if (!step) {
      const bare = BARE_KEY_RE.exec(rest);
      if (bare) {
        return fail('BAD_EXPRESSION', `[${bare[1]}] has no quotes, so Jinja2 reads ${bare[1]} as a variable name, not a key. Write ['${bare[1]}'].`,
          { ansible: `'${bare[1]}' is undefined` });
      }
      return fail('BAD_EXPRESSION', `Could not read "${rest.trim()}". Only fact lookups are supported: .key, ['key'], or [0].`);
    }
    if (step[1] !== undefined) path.push(/^\d+$/.test(step[1]) ? Number(step[1]) : step[1]);
    else if (step[4] !== undefined) path.push(Number(step[4]));
    else path.push(step[2] ?? step[3]);
    position += step[0].length;
  }
  return walk(facts, path);
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null) return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const EXPRESSION_RE = /\{\{([\s\S]*?)\}\}/g;

export function renderTemplate(template, facts) {
  const text = String(template);
  if (/\{%/.test(text)) {
    return fail('BAD_EXPRESSION', "Jinja2 statements ({% ... %}) are outside this trainer's scope.");
  }
  if (/\{\{|\}\}/.test(text.replace(EXPRESSION_RE, ''))) {
    return fail('BAD_EXPRESSION', 'Unbalanced braces: every {{ needs a matching }}.');
  }
  const paths = [];
  const values = [];
  let failure = null;
  const rendered = text.replace(EXPRESSION_RE, (_, expression) => {
    if (failure) return '';
    const result = resolveExpression(expression, facts);
    if (!result.ok) { failure = { ...result, template: text }; return ''; }
    paths.push(result.path);
    values.push(result.value);
    return toText(result.value);
  });
  if (failure) return failure;
  const trimmed = text.trim();
  const lone = values.length === 1 && trimmed.startsWith('{{') && trimmed.endsWith('}}');
  return { ok: true, value: lone ? values[0] : rendered, paths, values };
}
const DEBUG_MODULES = ['debug', 'ansible.builtin.debug', 'ansible.legacy.debug'];
// Task keywords that cannot change what a debug task prints.
const HARMLESS_KEYWORDS = ['tags', 'become', 'become_user', 'become_method', 'become_flags', 'become_exe',
  'ignore_errors', 'ignore_unreachable', 'changed_when', 'check_mode', 'diff'];
// Valid task keywords that can change whether or what the task prints. Out of scope.
const UNSUPPORTED_KEYWORDS = ['when', 'loop', 'loop_control', 'until', 'retries', 'delay', 'vars', 'register',
  'block', 'rescue', 'always', 'action', 'local_action', 'args', 'async', 'poll', 'delegate_to', 'delegate_facts',
  'run_once', 'no_log', 'notify', 'failed_when', 'environment', 'module_defaults', 'collections', 'connection',
  'remote_user', 'port', 'any_errors_fatal', 'debugger', 'throttle', 'timeout'];
const MAX_RENDERED = 2000;
const SHAPE = "- name: Describe the task\n  ansible.builtin.debug:\n    msg: \"Text with {{ ansible_facts['hostname'] }}\"";
const QUOTE_HINT = ' A value that starts with {{ must be quoted, or YAML reads the braces as a mapping: msg: "{{ ... }}".';

const tooLarge = isTooLarge;
const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A path requirement is met by its own path or by any path the challenge lists as
// equivalent. A { value, label } requirement is met by any fact expression that yields
// that value, however it was reached.
function satisfies(challenge, index, evaluated) {
  const required = challenge.requires[index];
  if (!Array.isArray(required)) {
    return evaluated.values.some((value) => JSON.stringify(value) === JSON.stringify(required.value));
  }
  const accepted = [required, ...(challenge.equivalents?.[index] ?? [])];
  return evaluated.paths.some((path) => path !== null && accepted.some((candidate) => samePath(path, candidate)));
}

const describeRequirement = (required) => (Array.isArray(required) ? pathToExpr(required) : required.label);

export function parseYaml(text) {
  try {
    // json: true makes a repeated key keep its last value, as Ansible's own YAML loader does
    // (with a warning), instead of rejecting the file.
    return { ok: true, doc: load(String(text), { json: true }) };
  } catch (error) {
    const line = error.mark ? error.mark.line + 1 : undefined;
    const column = error.mark ? error.mark.column + 1 : undefined;
    let message = `YAML syntax error${line ? ` at line ${line}, column ${column}` : ''}: ${error.reason ?? error.message}.`;
    if (/\t/.test(text)) message += ' YAML forbids tab characters for indentation; use spaces.';
    if (/:\s*\{\{/.test(text)) message += QUOTE_HINT;
    return fail('YAML_SYNTAX', message, { line, column, reason: error.reason ?? error.message });
  }
}

function findModule(task) {
  const keys = Object.keys(task).filter((key) => key !== 'name' && !HARMLESS_KEYWORDS.includes(key));
  const blocked = keys.find((key) => UNSUPPORTED_KEYWORDS.includes(key) || key.startsWith('with_'));
  if (blocked) {
    return fail('UNSUPPORTED_KEYWORD', `"${blocked}" is valid Ansible, but it is outside this trainer's scope. Submit a task with only a name and the debug module.`);
  }
  if (keys.includes('msg') || keys.includes('var')) {
    return fail('MISSING_MODULE', `msg and var belong under the module, one indent level deeper. Expected:\n${SHAPE}`);
  }
  if (keys.length === 0) {
    return fail('MISSING_MODULE', `The task has a name but no module. Expected:\n${SHAPE}`);
  }
  const module = keys.find((key) => DEBUG_MODULES.includes(key));
  if (!module) {
    return fail('UNKNOWN_MODULE', `"${keys[0]}" is not the module this trainer expects. Use debug or ansible.builtin.debug.`, { detail: keys[0] });
  }
  if (keys.length > 1) {
    return fail('UNKNOWN_MODULE', `A task runs one module. Unexpected key: "${keys.find((key) => key !== module)}".`);
  }
  return { ok: true, module };
}

function evaluateArgs(args, module, facts) {
  if (typeof args === 'string' && /\b(?:msg|var)\s*=/.test(args)) {
    return fail('UNSUPPORTED_SYNTAX', `The inline key=value form is valid Ansible, but it is outside this trainer's scope. Write the argument as a nested key:\n${SHAPE}`);
  }
  if (!isMapping(args)) {
    return fail('MISSING_MSG', `${module} needs a msg or var key nested beneath it, not inline text. Expected:\n${SHAPE}`);
  }
  const hasMsg = Object.hasOwn(args, 'msg');
  const hasVar = Object.hasOwn(args, 'var');
  if (hasMsg && hasVar) return fail('MISSING_MSG', 'Use msg or var, not both. Ansible rejects a debug task that sets both.');
  if (!hasMsg && !hasVar) {
    const found = Object.keys(args).map((key) => `"${key}"`).join(', ') || 'nothing';
    return fail('MISSING_MSG', `${module} accepts msg or var. Found: ${found}.`);
  }
  if (hasVar) {
    if (typeof args.var !== 'string') return fail('BAD_EXPRESSION', 'var takes one fact expression as text.');
    if (args.var.includes('{{')) {
      return fail('BAD_EXPRESSION', "var takes a bare expression with no braces: var: ansible_facts['hostname'].");
    }
    const result = resolveExpression(args.var, facts);
    if (!result.ok) return { ...result, template: args.var };
    return { ok: true, key: args.var.trim(), value: result.value, paths: [result.path], values: [result.value] };
  }
  const parts = Array.isArray(args.msg) ? args.msg : [args.msg];
  const rendered = [];
  const paths = [];
  const values = [];
  for (const part of parts) {
    if (part !== null && typeof part === 'object') {
      return fail('YAML_SYNTAX', `YAML read your msg as a mapping, not as text.${QUOTE_HINT}`);
    }
    const result = renderTemplate(part ?? '', facts);
    if (!result.ok) return result;
    rendered.push(result.value);
    paths.push(...result.paths);
    values.push(...result.values);
  }
  return { ok: true, key: 'msg', value: Array.isArray(args.msg) ? rendered : rendered[0], paths, values };
}

export function checkTask(text, challenge, facts, host = 'localhost') {
  if (tooLarge(text)) return fail('TOO_LARGE', 'The answer is too long. One short task is enough.');
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const doc = parsed.doc;
  if (!Array.isArray(doc)) {
    return fail('NOT_A_LIST', doc == null
      ? 'The answer is empty. Write one task, starting with a dash.'
      : 'Tasks are a list. Start the task with a dash: "- name: ...".');
  }
  if (doc.length !== 1) return fail('EXTRA_TASKS', `Submit exactly one task; this answer has ${doc.length}.`);
  const task = doc[0];
  if (!isMapping(task)) return fail('MISSING_MODULE', `A task is a set of keys: a name, then a module. Expected:\n${SHAPE}`);
  if (Object.hasOwn(task, 'hosts') || Object.hasOwn(task, 'tasks')) {
    return fail('PLAY_NOT_TASK', 'This is a whole play. Submit only the task: the part that starts with "- name:" under tasks.');
  }
  return judgeTask(task, challenge, facts, host);
}

// Judge one already-parsed task. Shared by checkTask and the playbook runner.
export function judgeTask(task, challenge, facts, host = 'localhost') {
  if (!isMapping(task)) return fail('MISSING_MODULE', `A task is a set of keys: a name, then a module. Expected:\n${SHAPE}`);
  if (typeof task.name !== 'string' || task.name.trim() === '') {
    return fail('MISSING_NAME', 'Every task needs a name key that describes what it does: "- name: Display the hostname".');
  }
  const found = findModule(task);
  if (!found.ok) return found;
  const evaluated = evaluateArgs(task[found.module], found.module, facts);
  if (!evaluated.ok) return evaluated;

  let rendered = `ok: [${host}] => ${JSON.stringify({ [evaluated.key]: evaluated.value }, null, 4)}`;
  if (rendered.length > MAX_RENDERED) rendered = `${rendered.slice(0, MAX_RENDERED)}\n… (truncated)`;

  const missing = challenge.requires.filter((_, index) => !satisfies(challenge, index, evaluated));
  if (missing.length > 0) {
    let message = `Your task is valid and would print the output shown, but it does not read what this challenge asks for: ${missing.map(describeRequirement).join(', ')}.`;
    const lookalike = missing.some((required) => Array.isArray(required)
      && evaluated.values.some((value) => JSON.stringify(value) === JSON.stringify(walk(facts, required).value)));
    if (lookalike) {
      message += ' One fact you used holds the same value on this host, but it is a different fact and would not be the right one on every host.';
    }
    return fail('WRONG_FACT', message, { rendered });
  }
  const verdict = { ok: true, code: 'OK', message: 'Correct.', rendered };
  if (found.module === 'debug') {
    verdict.note = 'This passes. On the exam and in production, prefer the fully qualified name ansible.builtin.debug.';
  }
  return verdict;
}
