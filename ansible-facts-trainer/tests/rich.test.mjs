import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCode } from '../rich.js';
import { CHALLENGES } from '../challenges.js';

test('text between backticks is code, and the rest is prose', () => {
  assert.deepEqual(splitCode('convert it with `| int` first'), [
    { text: 'convert it with ', code: false }, { text: '| int', code: true }, { text: ' first', code: false },
  ]);
  assert.deepEqual(splitCode('`when:` then `>= 9`'), [
    { text: 'when:', code: true }, { text: ' then ', code: false }, { text: '>= 9', code: true },
  ]);
  assert.deepEqual(splitCode('no code here'), [{ text: 'no code here', code: false }]);
});

test('a backtick with no partner stays an ordinary character', () => {
  assert.deepEqual(splitCode('a `b` c `d'), [{ text: 'a ', code: false }, { text: 'b', code: true }, { text: ' c `d', code: false }]);
  assert.deepEqual(splitCode('`'), [{ text: '`', code: false }]);
});

test('every hint pairs its backticks, and no command or filter is left in the prose font', () => {
  for (const c of CHALLENGES) {
    assert.equal((c.hint.match(/`/g) ?? []).length % 2, 0, `${c.id}: unpaired backtick`);
    const prose = splitCode(c.hint).filter((run) => !run.code).map((run) => run.text).join(' ');
    assert.doesNotMatch(prose, /ansible servera|ansible_facts\[|\| ?(int|default|grep)|[<>=!]=|\{\{/, c.id);
  }
});
