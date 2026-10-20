// Answer checking. Stored answers are SHA-256 hashes, so the page never ships an answer in plain text.
// This only discourages casual peeking: the data generator is public. Changing the recipe below
// invalidates every answerHash in levels/*.json (rerun tools/selftest.mjs --write-hashes).

const encoder = new TextEncoder();

export function normalizeAnswer(answer) {
  return String(answer).trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function hashAnswer(levelId, answer) {
  const bytes = encoder.encode(`loghunt:v1:${levelId}:${normalizeAnswer(answer)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkAnswer(levelId, answer, storedHash) {
  if (normalizeAnswer(answer) === '') return false;
  return (await hashAnswer(levelId, answer)) === storedHash;
}
