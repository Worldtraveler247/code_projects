import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../modules.js';
import { PAGES } from '../docpages.js';
import { compactLines, optionBlock, pageMap, requiredDrift, requiredLines, shortLines } from '../docguide.js';
import { optionBlock as cutBlock, parsePage, shortenHeader } from '../tools/build-docpages.mjs';

test('every module has its -s output and a map of its full page', () => {
  for (const mod of MODULES) {
    const page = PAGES[mod.fqcn];
    assert.ok(page, mod.fqcn);
    assert.match(page.short, /^- name: /, `${mod.fqcn}: -s starts with the task line`);
    assert.ok(page.sections.some((section) => section.text.startsWith('OPTIONS (= is mandatory)')), mod.fqcn);
    assert.ok(page.sections.some((section) => section.text.startsWith('EXAMPLES')), mod.fqcn);
    assert.ok(page.options.length > 0, mod.fqcn);
  }
});

test('no local path leaks into the generated pages', () => {
  for (const mod of MODULES) {
    assert.match(PAGES[mod.fqcn].header, /^> [A-Z_.]+ +\(…\/ansible(_collections)?\//, mod.fqcn);
    assert.equal(/\/Users\/|\/private\/|\/home\//.test(JSON.stringify(PAGES[mod.fqcn])), false, mod.fqcn);
  }
});

test('-s and the full page agree on which options exist and which are required', () => {
  for (const mod of MODULES) {
    const lines = shortLines(mod.fqcn);
    const keys = lines.filter((line) => line.kind === 'req' || line.kind === 'opt').map((line) => line.text.trim().split(':')[0]);
    assert.deepEqual(keys.sort(), PAGES[mod.fqcn].options.map((option) => option.name).sort(), mod.fqcn);
    const required = lines.filter((line) => line.kind === 'req').map((line) => line.text.trim().split(':')[0]);
    assert.deepEqual(required.sort(), PAGES[mod.fqcn].options.filter((option) => option.required).map((option) => option.name).sort(), mod.fqcn);
    assert.equal(requiredLines(mod.fqcn).filter((line) => line.includes('# (required)')).length, required.length, mod.fqcn);
  }
});

test('stripping the description lines leaves the task line, the module line and one line per option', () => {
  for (const mod of MODULES) {
    assert.equal(compactLines(mod.fqcn).length, 2 + PAGES[mod.fqcn].options.length, mod.fqcn);
  }
});

test('the page map points at the lines it names, in order', () => {
  for (const mod of MODULES) {
    const map = pageMap(mod.fqcn);
    assert.equal(map.rows[0].line, 1);
    for (const row of map.rows) assert.ok(row.line >= 1 && row.line <= map.total, `${mod.fqcn}: ${row.want}`);
    const examples = map.rows.find((row) => row.jump === '/EXAMPLES');
    const options = map.rows.find((row) => row.jump === '/OPTIONS');
    assert.ok(options.line < examples.line, mod.fqcn);
  }
});

test('the focus option block ends on the fields -s leaves out', () => {
  for (const mod of MODULES) {
    const focus = PAGES[mod.fqcn].focus;
    assert.ok(focus, mod.fqcn);
    const block = optionBlock(mod.fqcn, focus);
    assert.match(block[0].text, new RegExp(`^[=-] ${focus}$`), mod.fqcn);
    assert.ok(block.some((line) => line.kind === 'field' && /type:/.test(line.text)), `${mod.fqcn}: ${focus} has no type line`);
  }
});

test('copy reads as it does on a RHEL 9 control node', () => {
  assert.deepEqual(requiredLines('ansible.builtin.copy').map((line) => line.trim().split(':')[0]), ['dest']);
  const block = optionBlock('ansible.builtin.file', 'state').map((line) => line.text.trim());
  assert.ok(block.includes('choices: [absent, directory, file, hard, link, touch]'));
  assert.equal(PAGES['ansible.builtin.copy'].header, '> ANSIBLE.BUILTIN.COPY    (…/ansible/modules/copy.py)');
});

test('the one required option that changed between 2.14 and the newer specs is reported', () => {
  assert.deepEqual(requiredDrift('ansible.builtin.dnf'), { onlyOld: ['name'], onlyNew: [] });
  for (const mod of MODULES.filter((item) => item.fqcn !== 'ansible.builtin.dnf')) {
    assert.deepEqual(requiredDrift(mod.fqcn), { onlyOld: [], onlyNew: [] }, mod.fqcn);
  }
});

test('the page parser finds sections and options, and cuts one option block', () => {
  const page = parsePage('> X    (/a/b/site-packages/ansible/modules/x.py)\n\nOPTIONS (= is mandatory):\n\n= dest\n        Where.\n        type: path\n\n- mode\n        How.\n\nEXAMPLES:\n');
  assert.deepEqual(page.sections.map((section) => section.line), [3, 12]);
  assert.deepEqual(page.options, [{ line: 5, required: true, name: 'dest' }, { line: 9, required: false, name: 'mode' }]);
  assert.equal(cutBlock(page.lines, 5), '= dest\n        Where.\n        type: path');
  assert.equal(shortenHeader(page.lines[0]), '> X    (…/ansible/modules/x.py)');
});
