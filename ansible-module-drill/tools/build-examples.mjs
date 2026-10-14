// Regenerates examples.js from the Ansible installed on this machine:
//   node tools/build-examples.mjs
// Keeps, per module: the one-line summary, the first sentence of each option's description,
// and the EXAMPLES block exactly as `ansible-doc` prints it, split into its separate tasks.
// Ansible's documentation is GPL-3.0-or-later; the page credits it as the source.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { SPECS } from '../specs.js';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

// Ansible marks up its docs with macros such as O(state=absent) and C(/etc/hosts). Keep the text inside.
export function plain(text) {
  return String(text)
    .replace(/\b(?:L)\(([^,()]+),[^)]*\)/g, '$1')
    .replace(/\b(?:O|V|C|I|B|M|RV|E|U|P)\(([^()]*)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(description) {
  const text = plain(Array.isArray(description) ? description[0] || '' : description || '');
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : text;
}

// The block is split on blank lines. A chunk that starts indented belongs to the one before it.
export function splitExamples(raw) {
  const chunks = [];
  for (const part of raw.replace(/\r/g, '').split(/\n\s*\n/)) {
    const code = part.replace(/^\n+|\s+$/g, '');
    if (!code) continue;
    if (chunks.length && /^\s/.test(code)) chunks[chunks.length - 1] += `\n\n${code}`;
    else chunks.push(code);
  }
  return chunks;
}

// The options an example passes to the module: the keys written under the module's name, the
// key=value pairs after it, the keys of a sibling `args:`, and the -a string of an ad hoc command.
// A module given a bare string (command: cat /etc/motd) is using its free_form option.
export function optionsUsed(code, names) {
  const lines = code.split('\n');
  const used = new Set();
  const childKeys = (i, base) => {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim() || lines[j].trim().startsWith('#')) continue;
      const indent = lines[j].match(/^ */)[0].length;
      if (indent <= base) break;
      const key = lines[j].match(/^ *(\w+):/);
      if (key && indent === base + 2) used.add(key[1]);
    }
  };
  lines.forEach((line, i) => {
    const adhoc = line.match(/^#.*-m (\S+) .*-a (['"])(.*)\2/);
    if (adhoc && names.includes(adhoc[1])) for (const pair of adhoc[3].matchAll(/(?:^|\s)(\w+)=/g)) used.add(pair[1]);
    const head = line.match(/^(\s*)(- )?([\w.]+):(.*)$/);
    if (!head || !names.includes(head[3])) return;
    const base = head[1].length + (head[2] ? 2 : 0);
    const rest = head[4].trim();
    for (const pair of rest.matchAll(/(?:^|\s)(\w+)=/g)) used.add(pair[1]);
    if (rest && !rest.startsWith('#') && !/^(\w+)=/.test(rest)) used.add('free_form');
    childKeys(i, base);
    // `args:` sits beside the module name, at the same indent.
    for (let j = i + 1; j < lines.length; j += 1) {
      const sibling = lines[j].match(/^( *)args:\s*$/);
      const indent = lines[j].match(/^ */)[0].length;
      if (lines[j].trim() && indent < base) break;
      if (sibling && sibling[1].length === base) childKeys(j, base);
    }
  });
  return [...used];
}

// Whether the example calls this module at all, or is a task that supports one that does.
export function calls(code, names) {
  return code.split('\n').some((line) => {
    const head = line.match(/^\s*(?:- )?([\w.]+):/);
    const adhoc = line.match(/^#.*-m (\S+)/);
    return (head && names.includes(head[1])) || (adhoc && names.includes(adhoc[1]));
  });
}

function title(code) {
  const name = code.match(/^- name:\s*(.+)$/m);
  if (name) return name[1].replace(/^(['"])(.*)\1$/, '$2');
  const comment = code.match(/^#\s*(.+)$/m);
  return comment ? comment[1] : 'Example';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = {};
  for (const fqcn of Object.keys(SPECS)) {
    const entry = Object.values(JSON.parse(run('ansible-doc', ['-j', fqcn])))[0];
    const options = {};
    for (const [name, option] of Object.entries(entry.doc.options || {})) options[name] = firstSentence(option.description);
    const aliases = {};
    for (const [name, option] of Object.entries(SPECS[fqcn].options)) for (const alias of option.aliases || []) aliases[alias] = name;
    // A module documented under another name (systemd → systemd_service) is shown with that name.
    const real = entry.doc.module && !fqcn.endsWith(`.${entry.doc.module}`) ? fqcn.replace(/[^.]+$/, entry.doc.module) : null;
    const names = [fqcn, fqcn.split('.').pop(), ...(real ? [real, real.split('.').pop()] : [])];
    const examples = splitExamples(entry.examples || '').map((code) => {
      const uses = optionsUsed(code, names).filter((name) => SPECS[fqcn].options[name] || aliases[name]).map((name) => aliases[name] || name);
      return { title: title(code), code, calls: calls(code, names), uses: [...new Set(uses)] };
    });
    out[fqcn] = { summary: plain(entry.doc.short_description), ...(real ? { realName: real } : {}), options, examples };
  }
  const core = run('ansible', ['--version']).match(/core ([\d.]+)/)[1];
  writeFileSync(new URL('../examples.js', import.meta.url), `// Generated by tools/build-examples.mjs. Do not edit by hand.
// Source: the EXAMPLES and option descriptions printed by ansible-doc on ansible-core ${core}.
// Ansible documentation is licensed GPL-3.0-or-later.

export const DOCS = ${JSON.stringify(out, null, 1)};
`);
  const total = Object.values(out).reduce((sum, mod) => sum + mod.examples.length, 0);
  console.log(`${Object.keys(out).length} modules, ${total} examples written`);
}
