// Turns an exercise's data into the things shown to the learner: the work order (brief),
// the model answer, and the next hint. Deriving all three from the same data keeps them
// from drifting apart.

import { load } from './vendor/js-yaml.mjs';
import { TASK_KEYS } from './checker.js';

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function plainSafe(text) {
  if (text === '' || /^[-?:,[\]{}#&*!|>'"%@`\s]/.test(text) || /\s$/.test(text)) return false;
  if (text.includes(': ') || text.includes(' #')) return false;
  try {
    return load(text) === text;
  } catch {
    return false;
  }
}

export function scalar(value) {
  if (typeof value !== 'string') return String(value);
  if (plainSafe(value)) return value;
  // Jinja2 values are double-quoted by convention; other text gets single quotes.
  if (value.includes('{{')) return JSON.stringify(value);
  return `'${value.replace(/'/g, "''")}'`;
}

// Returns [{ text, path }]. path is null for lines that carry no requirement of their own.
export function renderModel(plays, { reverse = false } = {}) {
  const out = [{ text: '---', path: null, doc: true }];
  const keysOf = (object) => (reverse ? Object.keys(object).reverse() : Object.keys(object));

  function emitDict(object, indent, path, dash) {
    keysOf(object).forEach((key, n) => {
      const lead = n === 0 && dash ? `${' '.repeat(indent - 2)}- ` : ' '.repeat(indent);
      emitValue(`${lead}${key}:`, object[key], indent, path.concat(key));
    });
  }

  function emitValue(prefix, value, indent, path) {
    if (Array.isArray(value)) {
      out.push({ text: prefix, path });
      value.forEach((item, i) => {
        if (isObject(item)) {
          if (i > 0) out.push({ text: '', path: null });
          emitDict(item, indent + 4, path.concat(i), true);
        } else {
          out.push({ text: `${' '.repeat(indent + 2)}- ${scalar(item)}`, path: path.concat(i) });
        }
      });
    } else if (isObject(value)) {
      out.push({ text: prefix, path });
      emitDict(value, indent + 2, path, false);
    } else if (typeof value === 'string' && value.includes('\n')) {
      out.push({ text: `${prefix} |`, path });
      value.replace(/\n$/, '').split('\n').forEach((line) => {
        out.push({ text: `${' '.repeat(indent + 2)}${line}`, path: null, block: true });
      });
    } else {
      out.push({ text: `${prefix} ${scalar(value)}`, path });
    }
  }

  plays.forEach((play, i) => {
    if (i > 0) out.push({ text: '', path: null });
    emitDict(play, 2, [i], true);
  });
  return out;
}

export function modelText(plays, options) {
  return renderModel(plays, options).map((line) => line.text).join('\n');
}

function valueText(value) {
  if (typeof value === 'string') {
    // Flag text that YAML would otherwise read as a number or a boolean.
    return typeof safeLoad(value) === 'string' || value.includes('{{') ? value : `${value} (as text, not a ${typeof safeLoad(value)})`;
  }
  return String(value);
}

function safeLoad(text) {
  try {
    return load(text);
  } catch {
    return text;
  }
}

// The work order: [{ depth, label, value?, lines? }], written in plain words, not YAML.
export function describe(plays) {
  const out = [];

  function field(depth, key, value) {
    if (Array.isArray(value)) {
      if (value.every((item) => !isObject(item))) {
        out.push({ depth, label: `${key} is a list, in this order`, value: value.map(valueText).join(', ') });
      } else {
        out.push({ depth, label: `${key} is a list of items` });
        value.forEach((item, i) => {
          out.push({ depth: depth + 1, label: `item ${i + 1}` });
          Object.keys(item).forEach((inner) => field(depth + 2, inner, item[inner]));
        });
      }
    } else if (isObject(value)) {
      out.push({ depth, label: `${key} holds these keys` });
      Object.keys(value).forEach((inner) => field(depth + 1, inner, value[inner]));
    } else if (typeof value === 'string' && value.includes('\n')) {
      out.push({ depth, label: `${key} is these exact lines of text`, lines: value.replace(/\n$/, '').split('\n') });
    } else {
      out.push({ depth, label: key, value: valueText(value) });
    }
  }

  function taskList(depth, word, tasks) {
    tasks.forEach((task, i) => {
      out.push({ depth, label: `${word} ${i + 1}`, heading: true });
      Object.keys(task).forEach((key) => {
        if (TASK_KEYS.has(key)) {
          field(depth + 1, key, task[key]);
        } else if (isObject(task[key])) {
          out.push({ depth: depth + 1, label: 'module', value: key });
          out.push({ depth: depth + 1, label: 'module arguments' });
          Object.keys(task[key]).forEach((arg) => field(depth + 2, arg, task[key][arg]));
        } else {
          out.push({ depth: depth + 1, label: 'module', value: `${key}, with the value ${valueText(task[key])}` });
        }
      });
    });
  }

  plays.forEach((play, i) => {
    out.push({ depth: 0, label: plays.length > 1 ? `Play ${i + 1}` : 'The play', heading: true });
    Object.keys(play).forEach((key) => {
      if (key === 'vars') {
        out.push({ depth: 1, label: 'variables (vars)' });
        Object.keys(play.vars).forEach((name) => field(2, name, play.vars[name]));
      } else if (key === 'tasks') {
        taskList(1, 'Task', play.tasks);
      } else if (key === 'handlers') {
        taskList(1, 'Handler', play.handlers);
      } else {
        field(1, key, play[key]);
      }
    });
  });
  return out;
}

// Names the first line of the model answer that the buffer does not yet satisfy.
export function nextHint(result, plays) {
  if (!result.docSeen) {
    return 'Start with the document marker: three dashes, alone on line 1, in column 1.';
  }
  const model = renderModel(plays);
  const line = model.find((entry) => entry.path && !result.seen.has(JSON.stringify(entry.path)));
  if (!line) {
    if (result.bad > 0) return 'Nothing is missing. Fix the lines marked in red: move the cursor to one to see why.';
    if (result.warn > 0) return 'Nothing is missing. Check the lines marked in amber: each is in a valid place but does not match the brief.';
    return 'Nothing is missing. Type :w and press Enter to check the playbook.';
  }
  const indent = line.text.match(/^ */)[0].length;
  const body = line.text.trim();
  if (result.openBlocks.has(JSON.stringify(line.path))) {
    const key = line.path[line.path.length - 1];
    const wanted = model.slice(model.indexOf(line) + 1);
    const text = wanted.slice(0, wanted.findIndex((entry) => !entry.block)).map((entry) => entry.text.trim());
    return `The text under ${key} does not match the brief yet. It needs exactly these lines, at ${indent + 2} spaces: ${text.join(' / ')}`;
  }
  const dash = body.startsWith('- ');
  const where = indent === 0 ? 'in column 1, with no indentation' : `at ${indent} spaces`;
  return `Still needed: ${body}  (${where}${dash ? ', starting with a dash' : ''})`;
}
