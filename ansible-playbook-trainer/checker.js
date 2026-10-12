// Judges a playbook buffer one line at a time, so an unfinished or broken file still gets
// useful feedback. A full YAML parse confirms the verdict before an exercise can pass.
//
// The checker enforces the layout used in the Ansible documentation: 2 spaces per level,
// list items indented under the key that owns them.

import { load } from './vendor/js-yaml.mjs';

export const PLAY_KEYS = new Set([
  'name', 'hosts', 'become', 'become_user', 'become_method', 'gather_facts', 'gather_subset',
  'vars', 'vars_files', 'tasks', 'handlers', 'pre_tasks', 'post_tasks', 'roles', 'remote_user',
  'serial', 'environment', 'tags', 'any_errors_fatal', 'max_fail_percentage', 'strategy',
  'connection', 'collections', 'ignore_errors', 'force_handlers', 'order', 'port', 'timeout',
  'check_mode', 'diff', 'no_log', 'module_defaults',
]);

export const TASK_KEYS = new Set([
  'name', 'when', 'loop', 'register', 'notify', 'become', 'become_user', 'become_method', 'tags',
  'ignore_errors', 'changed_when', 'failed_when', 'vars', 'delegate_to', 'until', 'retries',
  'delay', 'no_log', 'environment', 'with_items', 'listen', 'loop_control', 'check_mode', 'diff',
  'args', 'run_once',
]);

const TASK_ONLY = new Set([
  'when', 'loop', 'register', 'notify', 'changed_when', 'failed_when', 'until', 'retries',
  'delay', 'listen', 'delegate_to', 'with_items', 'loop_control',
]);

const PLAY_ONLY = new Set([
  'hosts', 'gather_facts', 'gather_subset', 'tasks', 'handlers', 'pre_tasks', 'post_tasks',
  'roles', 'vars_files', 'serial', 'strategy', 'remote_user',
]);

const TASK_LISTS = new Set(['tasks', 'handlers', 'pre_tasks', 'post_tasks']);

const KEY_NOTES = {
  play: {
    name: 'The name is the label printed in the output when the play runs.',
    hosts: 'It says which inventory hosts the play targets, and is the one key a play cannot omit.',
    become: 'It turns on privilege escalation (sudo) for every task in the play.',
    gather_facts: 'It controls whether Ansible collects facts before the first task.',
    remote_user: 'It sets the account Ansible logs in as.',
    vars: 'It opens a dictionary of variables; each variable goes at 4 spaces.',
    vars_files: 'It opens a list of files that hold variables; each path goes at 4 spaces with a dash.',
    tasks: 'It opens the list of tasks. Each task starts with a dash at 4 spaces, and they run in the order written.',
    handlers: 'It opens the list of handlers: tasks that run only when another task notifies them.',
  },
  task: {
    name: 'The name is what you read in the output when this task runs or fails.',
    when: 'It is a condition: the task runs only if it is true. It is already an expression, so it takes no {{ }}.',
    loop: 'It repeats the task once per item; the current one is available as item.',
    register: 'It saves the result of the task in a variable that later tasks can read.',
    notify: 'It triggers the named handler, but only if this task reports a change. The text must match the handler name exactly.',
    changed_when: 'It overrides when the task counts as changed.',
    become: 'Here it applies to this task only.',
  },
};

const KEY_LINE = /^( *)(- )?([A-Za-z_][\w.-]*):(?: +(.*))?$/;
const ITEM_LINE = /^( *)- (.*)$/;
const BLOCK_HEADER = /^[|>][+-]?$/;

function spaces(count) {
  return count === 0 ? 'no indentation' : `${count} spaces`;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
}

function show(value) {
  if (typeof value === 'string') return value.includes('\n') ? 'the block of text in the brief' : `"${value}"`;
  if (Array.isArray(value)) return 'a list';
  if (isObject(value)) return 'a set of keys';
  return String(value);
}

export function parseLine(raw) {
  if (raw.trim() === '') return { kind: 'blank' };
  const lead = raw.match(/^\s*/)[0];
  if (lead.includes('\t')) {
    return { kind: 'error', why: 'This line is indented with a tab. YAML forbids tabs for indentation: use spaces, 2 per level.' };
  }
  const text = raw.trimEnd();
  const indent = lead.length;
  const body = text.slice(indent);
  if (body.startsWith('#')) return { kind: 'comment' };
  if (/^---(\s+#.*)?$/.test(body)) return { kind: 'doc', indent };
  if (indent % 2 !== 0) {
    return { kind: 'error', indent, why: `This line starts with ${indent} spaces. Every level is exactly 2 spaces, so a line can only start at 0, 2, 4, 6, 8 and so on.` };
  }
  if (body === '-') {
    return { kind: 'error', indent, why: 'A dash with nothing after it is an empty list item. Put the first key or value on the same line, after one space.' };
  }
  if (/^-\S/.test(body)) {
    return { kind: 'error', indent, why: 'Put one space after the dash. YAML only reads "- " (dash, space) as the start of a list item.' };
  }
  if (/^- {2,}/.test(body)) {
    return { kind: 'error', indent, why: 'Use exactly one space after the dash. The key after it sets the column for every other key of this item, and the convention is dash, one space, key.' };
  }
  const entry = text.match(KEY_LINE);
  if (entry) {
    const value = entry[4] === undefined || entry[4].trim().startsWith('#') ? '' : entry[4].trim();
    return { kind: 'entry', indent, dash: Boolean(entry[2]), key: entry[3], value };
  }
  if (/^[A-Za-z_][\w.-]*:\S/.test(body)) {
    return { kind: 'error', indent, why: 'Put a space after the colon. YAML reads "key: value" as a key and a value, but "key:value" as one piece of text.' };
  }
  const item = text.match(ITEM_LINE);
  if (item) return { kind: 'item', indent, value: item[2].trim() };
  return { kind: 'error', indent, why: 'YAML cannot read this as a key. A key is a word followed by a colon and a space, as in "hosts: servera".' };
}

function lookup(root, path) {
  let node = root;
  for (const step of path) {
    if (!isObject(node)) return undefined;
    node = node[step];
    if (node === undefined) return undefined;
  }
  return node;
}

function leaves(value, path, out) {
  if (Array.isArray(value)) value.forEach((item, i) => leaves(item, path.concat(i), out));
  else if (isObject(value)) Object.keys(value).forEach((key) => leaves(value[key], path.concat(key), out));
  else out.push(path);
  return out;
}

function intent(key) {
  if (!key) return '';
  if (key.includes('.')) return ` \`${key}\` is a module name, and a module sits at 6 spaces inside a task.`;
  if (PLAY_ONLY.has(key)) return ` \`${key}\` is a play key, and play keys sit at 2 spaces.`;
  if (TASK_ONLY.has(key)) return ` \`${key}\` is a task keyword, which sits at 6 spaces, level with the module.`;
  return '';
}

function readScalar(text) {
  if (text.startsWith('{{')) {
    return { error: 'A value that starts with {{ must be wrapped in quotes. Unquoted, YAML reads the brace as the start of a dictionary, not as a Jinja2 expression.' };
  }
  try {
    return { value: load(text) };
  } catch (error) {
    return { error: `YAML cannot read this value (${error.reason || 'syntax error'}). Check the quotes and brackets.` };
  }
}

export function check(text, exercise) {
  const expected = exercise.plays;
  const rawLines = text.split('\n');
  const lines = rawLines.map(() => ({ status: 'none', why: '' }));
  const seen = new Set();
  const openBlocks = new Set();
  const stack = [{ indent: 0, kind: 'top', path: [], count: 0 }];
  let block = null;
  let contentStarted = false;
  let docSeen = false;

  const mark = (path) => seen.add(JSON.stringify(path));
  const set = (index, status, why) => { lines[index] = { status, why }; };
  const top = () => stack[stack.length - 1];

  function judge(path, key, got) {
    const want = lookup(expected, path);
    if (want === undefined) {
      return { status: 'warn', note: 'It is in a valid place, but the brief does not ask for it here. Check the spelling of the key, or remove the line.' };
    }
    if (got.container) {
      if (isObject(want)) {
        mark(path);
        return { status: 'ok' };
      }
      return { status: 'warn', note: `The brief gives \`${key}\` a single value, ${show(want)}, on the same line as the key.` };
    }
    if (deepEqual(got.value, want)) {
      mark(path);
      leaves(want, path, []).forEach(mark);
      return { status: 'ok' };
    }
    if (isObject(want)) {
      return { status: 'warn', note: 'The brief puts several values under this key. Leave nothing after the colon and write them on the lines below, 2 spaces deeper.' };
    }
    if (typeof want === 'string' && typeof got.value !== 'string') {
      return { status: 'warn', note: `Quote this value. The brief wants the text ${show(want)}; unquoted, YAML reads it as ${got.value === null ? 'empty' : `a ${typeof got.value}`} and the exact text is lost.` };
    }
    return { status: 'warn', note: `It is in the right place, but the brief asks for ${show(want)}.` };
  }

  function closeBlock() {
    if (!block) return;
    let value = '';
    try {
      const parsed = load(`k: ${block.header}\n${block.lines.join('\n')}\n`);
      value = parsed.k;
    } catch {
      value = undefined;
    }
    const verdict = judge(block.path, block.key, { value });
    openBlocks.add(JSON.stringify(block.path));
    const unmatched = typeof lookup(expected, block.path) === 'string'
      ? 'The text under it does not match the brief yet. Check every line, including spelling and capital letters.'
      : verdict.note;
    const why = verdict.status === 'ok' ? block.why : `${block.why} ${unmatched}`;
    set(block.opener, verdict.status, why);
    block.members.forEach((index) => set(index, verdict.status, 'Text under a pipe is kept exactly as typed, line breaks included. It only has to sit deeper than its key; the convention is 2 spaces deeper.'));
    block = null;
  }

  function explain(container, parsed, opener) {
    const { key, indent } = parsed;
    const below = ` Nothing follows the colon, so its value is on the lines below, at ${indent + (parsed.dash ? 4 : 2)} spaces.`;
    if (container.kind === 'play') {
      const note = KEY_NOTES.play[key] || '';
      if (parsed.dash) {
        return `No indentation: the dash in column 1 opens play ${container.number}, one item in the playbook's list. \`${key}\` lands in column 3, and every other key of this play must line up with it at 2 spaces. ${note}`;
      }
      return `2 spaces: \`${key}\` is a key of the play, so it lines up with the play's first key in column 3. Keys of a play may come in any order, but they must share this column. ${note}`;
    }
    if (container.kind === 'task') {
      const what = container.handler ? 'handler' : 'task';
      const isModule = !TASK_KEYS.has(key);
      const note = isModule
        ? `It names the module: the one action this ${what} performs.${opener ? ' Its arguments follow at 8 spaces.' : ''}`
        : (KEY_NOTES.task[key] || '');
      if (parsed.dash) {
        return `4 spaces, then a dash: \`${container.listKey}\` is at 2, so its items start at 4. The dash opens ${what} ${container.number}. \`${key}\` lands in column 7, and every other key of this ${what} must line up with it at 6 spaces. ${note}`;
      }
      const placement = isModule
        ? `6 spaces: it lines up with the first key of the ${what}, so it belongs to this ${what}.`
        : `6 spaces: \`${key}\` modifies the whole ${what}, not the module, so it lines up with the module name instead of sitting under it at 8.`;
      return `${placement} ${note}`;
    }
    if (container.kind === 'args') {
      return `8 spaces: one step in from \`${container.label}\` at 6, so this is an argument to that module and to nothing else.${opener ? below : ''}`;
    }
    if (container.kind === 'vars') {
      return `4 spaces: \`vars\` is at 2 and this variable belongs to it, so it steps in by 2.${opener ? below : ' The value is on the same line, so nothing below belongs to it.'}`;
    }
    const owner = container.label ? `\`${container.label}\`` : 'the line that opened this level';
    if (parsed.dash) {
      return `${spaces(indent)}, then a dash: this opens a new item in the list under ${owner}. Its other keys line up with \`${key}\` at ${indent + 2} spaces.`;
    }
    return `${spaces(indent)}: this key belongs to ${owner}, one level out, so it sits 2 spaces deeper than it.${opener ? below : ''}`;
  }

  function entry(container, parsed, index) {
    const { key } = parsed;
    const keyIndent = container.indent;

    if (container.keys.has(key)) {
      set(index, 'bad', `\`${key}\` already appears at this level. A key can appear only once in a dictionary; if it is repeated, the last one silently wins. If this line is meant to belong to the line above it, indent it 2 more spaces.`);
      return;
    }
    if (container.kind === 'play') {
      if (key.includes('.') || TASK_ONLY.has(key)) {
        set(index, 'bad', `\`${key}\` belongs inside a task, not directly on the play. At ${spaces(keyIndent)} it is read as a play key, and a play only accepts play keywords such as hosts, become, vars and tasks.`);
        return;
      }
      if (!PLAY_KEYS.has(key)) {
        set(index, 'bad', `\`${key}\` is not a play keyword, so Ansible rejects the play. Check the spelling. If it is a variable, it belongs under vars at 4 spaces.`);
        return;
      }
    }
    if (container.kind === 'task') {
      if (PLAY_ONLY.has(key)) {
        set(index, 'bad', `\`${key}\` is a play key. At 6 spaces it is read as part of this task. Play keys sit at 2 spaces, level with the play's first key.`);
        return;
      }
      if (!TASK_KEYS.has(key)) {
        if (container.module) {
          set(index, 'bad', `A task runs exactly one module, and this task already has \`${container.module}\`. At 6 spaces \`${key}\` is read as a second module. If it is an argument to \`${container.module}\`, indent it to 8 spaces.`);
          return;
        }
        container.module = key;
      }
    }
    if (container.kind === 'args' && (TASK_ONLY.has(key) || PLAY_ONLY.has(key))) {
      const home = TASK_ONLY.has(key) ? 'It modifies the whole task, so it sits at 6 spaces, level with the module' : 'It is a play key, so it sits at 2 spaces';
      set(index, 'bad', `At 8 spaces \`${key}\` becomes an argument to \`${container.label}\`, which does not accept it. ${home}.`);
      return;
    }
    container.keys.add(key);

    const path = container.path.concat(key);
    if (parsed.value === '') {
      let kind = 'generic';
      if (container.kind === 'play' && key === 'vars') kind = 'vars';
      else if (container.kind === 'play' && TASK_LISTS.has(key)) kind = 'tasklist';
      else if (container.kind === 'task' && !TASK_KEYS.has(key)) kind = 'args';
      const verdict = judge(path, key, { container: true });
      const why = explain(container, parsed, true);
      set(index, verdict.status, verdict.status === 'ok' ? why : `${why} ${verdict.note}`);
      stack.push({ indent: keyIndent + 2, kind, path, label: key, keys: new Set(), count: 0, shape: null });
      return;
    }
    const header = parsed.value.replace(/\s+#.*$/, '');
    if (BLOCK_HEADER.test(header)) {
      block = {
        path, key, header, opener: index, lines: [], members: [],
        minIndent: keyIndent + 1,
        why: `${explain(container, parsed, false)} The pipe means the lines below are text to keep exactly as typed.`,
      };
      return;
    }
    const scalar = readScalar(parsed.value);
    if (scalar.error) {
      set(index, 'bad', scalar.error);
      return;
    }
    const verdict = judge(path, key, { value: scalar.value });
    const why = explain(container, parsed, false);
    set(index, verdict.status, verdict.status === 'ok' ? why : `${why} ${verdict.note}`);
  }

  rawLines.forEach((raw, index) => {
    const parsed = parseLine(raw);

    if (block) {
      const indent = raw.match(/^ */)[0].length;
      if (parsed.kind === 'blank' || (!/^\s*\t/.test(raw) && indent >= block.minIndent)) {
        block.lines.push(raw);
        if (parsed.kind !== 'blank') block.members.push(index);
        return;
      }
      closeBlock();
    }

    if (parsed.kind === 'blank') {
      set(index, 'none', 'An empty line. YAML ignores it, so use blank lines to separate tasks and make the file easier to read.');
      return;
    }
    if (parsed.kind === 'comment') {
      set(index, 'none', 'A comment. Everything after # is ignored by YAML and by Ansible.');
      return;
    }
    if (parsed.kind === 'error') {
      set(index, 'bad', parsed.why);
      contentStarted = true;
      return;
    }
    if (parsed.kind === 'doc') {
      if (parsed.indent === 0 && !contentStarted) {
        docSeen = true;
        set(index, 'ok', 'Column 1, before anything else: three dashes mark the start of a YAML document. The marker belongs to nothing, so it has no indentation. Ansible does not require it, but it is the convention and linters expect it.');
      } else {
        set(index, 'bad', 'The --- marker starts a document, so it goes once, in column 1, above everything else in the file.');
      }
      contentStarted = true;
      return;
    }
    contentStarted = true;

    while (parsed.indent < top().indent) stack.pop();
    const container = top();

    if (parsed.indent > container.indent) {
      set(index, 'bad', `This line is at ${spaces(parsed.indent)}, but the deepest open level is at ${spaces(container.indent)}. A line may only step in, by exactly 2, straight after a key that ends in a colon with no value.${intent(parsed.key)}`);
      return;
    }

    const hasDash = parsed.kind === 'item' || parsed.dash;

    if (container.kind === 'top' || container.kind === 'tasklist') {
      const isTop = container.kind === 'top';
      if (parsed.kind !== 'entry' || !parsed.dash) {
        const why = isTop
          ? `A playbook is a list of plays, and a play starts with a dash in column 1. With no indentation and no dash, this line belongs to no play.${parsed.kind === 'entry' ? ' If it is a play key, indent it 2 spaces.' : ''}`
          : `\`${container.label}\` holds a list, so every line at 4 spaces must open a new item with "- " followed by a key. If this line belongs to the item above, indent it to 6 spaces; if it is a play key, move it out to 2.`;
        set(index, 'bad', why);
        return;
      }
      container.count += 1;
      const child = {
        indent: container.indent + 2,
        kind: isTop ? 'play' : 'task',
        path: container.path.concat(container.count - 1),
        number: container.count,
        listKey: container.label,
        handler: container.label === 'handlers',
        keys: new Set(),
        count: 0,
      };
      stack.push(child);
      entry(child, parsed, index);
      return;
    }

    if (container.kind === 'generic') {
      const shape = hasDash ? 'list' : 'dict';
      if (container.shape && container.shape !== shape) {
        set(index, 'bad', `The lines under \`${container.label}\` mix list items (with a dash) and keys (without). One level holds either a list or a dictionary, never both.`);
        return;
      }
      container.shape = shape;
      if (parsed.kind === 'item') {
        const path = container.path.concat(container.count);
        container.count += 1;
        const scalar = readScalar(parsed.value);
        if (scalar.error) {
          set(index, 'bad', scalar.error);
          return;
        }
        const verdict = judge(path, container.label, { value: scalar.value });
        const why = `${spaces(parsed.indent)}, then a dash: one step in from \`${container.label}\` at ${spaces(parsed.indent - 2)}, so this is an item in its list. Items of the same list share a column, and their order is kept.`;
        set(index, verdict.status, verdict.status === 'ok' ? why : `${why} ${verdict.note}`);
        return;
      }
      if (parsed.dash) {
        const child = {
          indent: container.indent + 2, kind: 'generic', shape: 'dict', label: container.label,
          path: container.path.concat(container.count), keys: new Set(), count: 0,
        };
        container.count += 1;
        stack.push(child);
        entry(child, parsed, index);
        return;
      }
      entry(container, parsed, index);
      return;
    }

    // play, task, args and vars are dictionaries: keys only, no dash.
    if (hasDash) {
      const names = { play: 'this play', task: 'this task', args: `\`${container.label}\``, vars: '`vars`' };
      const extra = container.kind === 'vars'
        ? ' Each variable is written as "name: value". A dash appears one level deeper, when a variable holds a list.'
        : container.kind === 'play'
          ? ' A dash at column 1 opens a new play; a dash at 4 spaces, under tasks, opens a task.'
          : '';
      set(index, 'bad', `A dash opens a new list item, but the keys of ${names[container.kind]} are entries in one dictionary. Remove the dash and keep the key at ${spaces(container.indent)}.${extra}`);
      return;
    }
    entry(container, parsed, index);
  });

  closeBlock();

  const missing = leaves(expected, [], []).filter((path) => !seen.has(JSON.stringify(path)));
  const bad = lines.filter((line) => line.status === 'bad').length;
  const warn = lines.filter((line) => line.status === 'warn').length;
  const ok = lines.filter((line) => line.status === 'ok').length;

  let parseError = '';
  let parsedEqual = false;
  try {
    parsedEqual = deepEqual(load(text), expected);
  } catch (error) {
    parseError = error.reason || 'YAML syntax error';
  }

  const passed = bad === 0 && warn === 0 && missing.length === 0 && docSeen && parsedEqual;
  return { lines, missing, seen, openBlocks, docSeen, bad, warn, ok, parseError, passed };
}
