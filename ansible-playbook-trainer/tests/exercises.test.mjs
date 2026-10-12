import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../vendor/js-yaml.mjs';
import { EXERCISES, LEVELS } from '../exercises.js';
import { check } from '../checker.js';
import { renderModel, modelText, describe, nextHint } from '../model.js';

test('there are 20 exercises, five per level, with unique ids', () => {
  assert.equal(EXERCISES.length, 20);
  assert.equal(new Set(EXERCISES.map((exercise) => exercise.id)).size, 20);
  for (const level of [1, 2, 3, 4]) {
    assert.equal(EXERCISES.filter((exercise) => exercise.level === level).length, 5);
    assert.ok(LEVELS[level]);
  }
  const levels = EXERCISES.map((exercise) => exercise.level);
  assert.deepEqual(levels, levels.slice().sort(), 'levels only go up');
});

test('every play is a full skeleton from exercise 1, and its tasks use a variable', () => {
  for (const exercise of EXERCISES) {
    for (const play of exercise.plays) {
      for (const key of ['name', 'hosts', 'become', 'gather_facts', 'tasks']) {
        assert.ok(key in play, `${exercise.id} lacks ${key}`);
      }
      assert.ok('vars' in play || 'vars_files' in play, `${exercise.id} defines no variables`);
      assert.ok(play.tasks.length >= 1);
      assert.match(JSON.stringify(play.tasks), /\{\{ \w+/, `${exercise.id} never uses a variable`);
    }
  }
});

test('the exercises grow: the last of each level is longer than the first exercise', () => {
  const size = (exercise) => renderModel(exercise.plays).length;
  assert.ok(size(EXERCISES[19]) > size(EXERCISES[10]));
  assert.ok(size(EXERCISES[10]) > size(EXERCISES[0]));
});

for (const exercise of EXERCISES) {
  test(`${exercise.id}: the model answer is real YAML for the same data`, () => {
    assert.deepEqual(load(modelText(exercise.plays)), exercise.plays);
  });

  test(`${exercise.id}: the model answer passes with every line green`, () => {
    const model = renderModel(exercise.plays);
    const result = check(modelText(exercise.plays), exercise);
    assert.equal(result.passed, true, JSON.stringify(result.lines.filter((line) => line.status !== 'ok'), null, 1));
    model.forEach((line, i) => {
      if (line.text !== '') assert.equal(result.lines[i].status, 'ok', `line ${i + 1}: ${line.text}`);
      if (line.text !== '') assert.ok(result.lines[i].why.length > 20, `line ${i + 1} has a reason`);
    });
  });

  test(`${exercise.id}: keys in reverse order still pass`, () => {
    const text = modelText(exercise.plays, { reverse: true });
    assert.deepEqual(load(text), exercise.plays);
    const result = check(text, exercise);
    assert.equal(result.passed, true, text);
  });

  test(`${exercise.id}: moving any one line by one level fails`, () => {
    const model = renderModel(exercise.plays);
    model.forEach((line, i) => {
      if (line.text === '' || line.doc || line.block) return;
      for (const shift of [2, -2]) {
        const indent = line.text.match(/^ */)[0].length;
        if (indent + shift < 0) continue;
        const moved = ' '.repeat(indent + shift) + line.text.trimStart();
        const text = model.map((other, j) => (j === i ? moved : other.text)).join('\n');
        assert.equal(check(text, exercise).passed, false, `line ${i + 1} shifted by ${shift}:\n${text}`);
      }
    });
  });

  test(`${exercise.id}: an unfinished buffer does not pass, and the hint walks to the end`, () => {
    const model = renderModel(exercise.plays);
    assert.equal(check('', exercise).passed, false);
    assert.match(nextHint(check('', exercise), exercise.plays), /document marker/);
    // Reveal the model one line at a time; the hint must always name a line not yet typed.
    for (let count = 1; count < model.length; count += 1) {
      const text = model.slice(0, count).map((line) => line.text).join('\n');
      const result = check(text, exercise);
      const remaining = model.slice(count).filter((line) => line.path);
      if (remaining.length === 0) continue;
      assert.equal(result.passed, false, `passed after only ${count} lines`);
      assert.equal(result.bad, 0, `partial buffer shows an error after ${count} lines:\n${text}`);
      const hint = nextHint(result, exercise.plays);
      if (model[count].block) assert.match(hint, /^The text under content/);
      else assert.ok(hint.includes(remaining[0].text.trim()), `after ${count} lines the hint was: ${hint}`);
    }
  });

  test(`${exercise.id}: the brief mentions every scalar value`, () => {
    const brief = describe(exercise.plays).map((row) => `${row.label} ${row.value || ''} ${(row.lines || []).join(' ')}`).join('\n');
    const visit = (value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(visit);
      else String(value).split('\n').filter(Boolean).forEach((part) => assert.ok(brief.includes(part), `brief lacks ${part}`));
    };
    visit(exercise.plays);
  });

  test(`${exercise.id}: each brief row sits at its line's column in the model answer`, () => {
    const lines = renderModel(exercise.plays).map((line) => line.text);
    const keyLines = lines.map((text) => text.replace(/^( *)- /, '$1  '));
    for (const row of describe(exercise.plays)) {
      const lead = ' '.repeat(row.indent);
      if (row.dash) assert.ok(lines.some((text) => text.startsWith(`${lead}- `)), `no dash at column ${row.indent} for ${row.label}`);
      if (!row.key && !row.module) continue;
      const key = row.module ? row.value.split(',')[0] : row.label;
      assert.ok(keyLines.some((text) => text.startsWith(`${lead}${key}:`)), `${key} is not at column ${row.indent}`);
    }
  });
}
