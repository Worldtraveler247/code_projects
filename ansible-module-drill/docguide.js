// How to read ansible-doc on the exam, per module, built from the real 2.14 output in docpages.js.
// No screen access, so the Node tests can check it.

import { PAGES, DOC_CORE } from './docpages.js';
import { SPECS } from './specs.js';

export { DOC_CORE };

// The fields at the foot of an option block: the facts -s leaves out.
const FIELD = /^\s+(choices|default|type|aliases|elements|added in|version_added):/;

// Every line of `ansible-doc -s`, tagged by what it is.
export function shortLines(fqcn) {
  return PAGES[fqcn].short.split('\n').map((text, i) => {
    let kind = 'cont';
    if (i === 0) kind = 'task';
    else if (i === 1) kind = 'module';
    else if (/^ {6}\w+:/.test(text)) kind = text.includes('# (required)') ? 'req' : 'opt';
    return { text, kind };
  });
}

// What `ansible-doc -s FQCN | grep '(required)'` prints.
export const requiredLines = (fqcn) => PAGES[fqcn].short.split('\n').filter((line) => line.includes('(required)'));

// What `ansible-doc -s FQCN | grep -v '^ *#'` prints: the task line, the module line, one line per option.
export const compactLines = (fqcn) => shortLines(fqcn).filter((line) => line.kind !== 'cont');

// Where things are on the full page, and the pager search that jumps to each.
export function pageMap(fqcn) {
  const page = PAGES[fqcn];
  const at = (prefix) => page.sections.find((section) => section.text.startsWith(prefix));
  const rows = [{ want: 'The module\'s full name and the file it lives in', line: 1, jump: 'g', shows: page.header }];
  const options = at('OPTIONS');
  if (options) rows.push({ want: 'Every option: = must be set, - may be set', line: options.line, jump: '/OPTIONS', shows: options.text });
  for (const option of page.options.filter((item) => item.required)) {
    rows.push({ want: `The required option ${option.name}`, line: option.line, jump: `/^= ${option.name}`, shows: `= ${option.name}` });
  }
  if (page.focus) {
    const focus = page.options.find((item) => item.name === page.focus);
    rows.push({ want: `What ${page.focus} accepts (choices, default, type)`, line: focus.line, jump: `/^- ${page.focus}`, shows: `- ${page.focus}` });
  }
  const examples = at('EXAMPLES');
  if (examples) rows.push({ want: 'Working tasks to copy the shape of', line: examples.line, jump: '/EXAMPLES', shows: examples.text });
  const returns = at('RETURN VALUES');
  if (returns) rows.push({ want: 'What register: gets back from the task', line: returns.line, jump: '/RETURN', shows: returns.text });
  return { total: page.total, rows };
}

// One option's block from the full page, each line marked when it is one of the closing fields.
export function optionBlock(fqcn, name) {
  const text = PAGES[fqcn].blocks[name];
  if (!text) return null;
  return text.split('\n').map((line, i) => ({ text: line, kind: i === 0 ? 'head' : FIELD.test(line) ? 'field' : 'prose' }));
}

export const focusOf = (fqcn) => PAGES[fqcn].focus;

// Options the 2.14 page marks required that the newer specs.js does not, or the other way round.
export function requiredDrift(fqcn) {
  const old = PAGES[fqcn].options.filter((option) => option.required).map((option) => option.name);
  const spec = SPECS[fqcn].options;
  const now = Object.keys(spec).filter((name) => spec[name].required);
  return {
    onlyOld: old.filter((name) => !now.includes(name)),
    onlyNew: now.filter((name) => !old.includes(name)),
  };
}
