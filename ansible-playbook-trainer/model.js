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

// The work order: [{ indent, label, value?, lines?, heading?, dash?, key?, module? }], written
// in plain words, not YAML. indent is the column the line takes in the model answer, so the
// page can draw the same indentation bands as the guide's example.
export function describe(plays) {
  const out = [];

  function field(indent, key, value) {
    if (Array.isArray(value)) {
      if (value.every((item) => !isObject(item))) {
        out.push({ indent, label: `${key} is a list, in this order`, value: value.map(valueText).join(', ') });
      } else {
        out.push({ indent, label: `${key} is a list of items` });
        value.forEach((item, i) => {
          out.push({ indent: indent + 2, label: `item ${i + 1}`, dash: true });
          Object.keys(item).forEach((inner) => field(indent + 4, inner, item[inner]));
        });
      }
    } else if (isObject(value)) {
      out.push({ indent, label: `${key} holds these keys` });
      Object.keys(value).forEach((inner) => field(indent + 2, inner, value[inner]));
    } else if (typeof value === 'string' && value.includes('\n')) {
      out.push({ indent, label: `${key} is these exact lines of text`, lines: value.replace(/\n$/, '').split('\n') });
    } else {
      out.push({ indent, label: key, value: valueText(value), key: true });
    }
  }

  function taskList(indent, word, tasks) {
    tasks.forEach((task, i) => {
      out.push({ indent, label: `${word} ${i + 1}`, heading: true, dash: true });
      Object.keys(task).forEach((key) => {
        if (TASK_KEYS.has(key)) {
          field(indent + 2, key, task[key]);
        } else if (isObject(task[key])) {
          out.push({ indent: indent + 2, label: 'module', value: key, module: true });
          out.push({ indent: indent + 2, label: 'module arguments' });
          Object.keys(task[key]).forEach((arg) => field(indent + 4, arg, task[key][arg]));
        } else {
          out.push({ indent: indent + 2, label: 'module', value: `${key}, with the value ${valueText(task[key])}`, module: true });
        }
      });
    });
  }

  plays.forEach((play, i) => {
    out.push({ indent: 0, label: plays.length > 1 ? `Play ${i + 1}` : 'The play', heading: true, dash: true });
    Object.keys(play).forEach((key) => {
      if (key === 'vars') {
        out.push({ indent: 2, label: 'variables (vars)' });
        Object.keys(play.vars).forEach((name) => field(4, name, play.vars[name]));
      } else if (key === 'tasks') {
        taskList(4, 'Task', play.tasks);
      } else if (key === 'handlers') {
        taskList(4, 'Handler', play.handlers);
      } else {
        field(2, key, play[key]);
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
