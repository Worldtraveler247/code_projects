// Level files: loading and schema validation. Content lives in levels/*.json so a new level needs no code.
// The validator is hand-written (no dependencies) and shared by the page, the lint step, and the tests.

import { SETUPS } from './live.js';

const HEX64 = /^[0-9a-f]{64}$/;
const BLOCK_KINDS = ['p', 'code', 'flags', 'note'];

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isTextList = (v, min = 1) => Array.isArray(v) && v.length >= min && v.every(isText);

export function validateLevel(level, file = 'level') {
  const errors = [];
  const need = (ok, msg) => { if (!ok) errors.push(`${file}: ${msg}`); };
  need(level && typeof level === 'object', 'not an object');
  if (errors.length) return errors;

  need(/^[a-z]+(?:-[a-z]+)*-\d{2}$|^side-[a-z-]+$/.test(level.id ?? ''), 'id must look like "find-01" or "side-tail-f"');
  need(Number.isInteger(level.number) || level.id?.startsWith('side-'), 'number must be an integer');
  need(isText(level.title), 'title is required');
  need(isText(level.tool), 'tool is required');
  need(isTextList(level.briefing), 'briefing must be a list of paragraphs');
  need(level.setup === undefined || Object.hasOwn(SETUPS, level.setup), `setup must be one of: ${Object.keys(SETUPS).join(', ')}`);

  need(Array.isArray(level.lesson) && level.lesson.length > 0, 'lesson must be a non-empty list of blocks');
  for (const [i, block] of (level.lesson ?? []).entries()) {
    const kinds = Object.keys(block ?? {});
    need(kinds.length === 1 && BLOCK_KINDS.includes(kinds[0]), `lesson[${i}] must have exactly one of ${BLOCK_KINDS.join(', ')}`);
    if (kinds[0] === 'flags') {
      need(Array.isArray(block.flags) && block.flags.every((row) => Array.isArray(row) && row.length === 2 && row.every(isText)), `lesson[${i}].flags must be [flag, meaning] pairs`);
    } else if (kinds.length === 1) need(isText(block[kinds[0]]), `lesson[${i}].${kinds[0]} must be text`);
  }

  need(Array.isArray(level.examples) && level.examples.length >= 3 && level.examples.length <= 5, 'examples: 3 to 5 worked examples');
  for (const [i, ex] of (level.examples ?? []).entries()) {
    need(isText(ex?.title), `examples[${i}].title is required`);
    need(isText(ex?.command), `examples[${i}].command is required`);
    need(Array.isArray(ex?.stages) && ex.stages.length > 0 && ex.stages.every((s) => isText(s?.code) && isText(s?.why)), `examples[${i}].stages must be {code, why} entries`);
    need(typeof ex?.output === 'string', `examples[${i}].output must be a string (the exact expected output)`);
    if (isText(ex?.command)) need(/(^|[\s/])training(\/|\s|$)/.test(ex.command), `examples[${i}].command must use files under training/`);
  }

  const c = level.challenge ?? {};
  need(isText(c.question), 'challenge.question is required');
  need(isText(c.format), 'challenge.format is required (what the answer looks like)');
  need(HEX64.test(c.answerHash ?? ''), 'challenge.answerHash must be 64 hex characters');

  need(isTextList(level.hints) && level.hints.length === 3, 'hints: exactly three tiers (nudge, tool/flags, skeleton)');

  const d = level.debrief ?? {};
  need(isText(d.solution), 'debrief.solution is required');
  need(isText(d.alternative), 'debrief.alternative is required');
  need(isTextList(d.why), 'debrief.why must be a list of paragraphs');
  return errors;
}

export async function loadLevels(fetchJson, base = 'levels/') {
  const index = await fetchJson(`${base}index.json`);
  const levels = [];
  for (const file of index.levels) {
    const level = await fetchJson(`${base}${file}`);
    const errors = validateLevel(level, file);
    if (errors.length) throw new Error(errors.join('\n'));
    levels.push(level);
  }
  return levels;
}
