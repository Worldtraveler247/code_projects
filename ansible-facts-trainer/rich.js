// Hints mix prose with things the learner must type. Text between backticks is code, and the
// page shows it in the editor's font so that a pipe or a quote cannot be mistaken for a letter.

/** Split text into runs: [{ text, code }]. An unpaired backtick is kept as an ordinary character. */
export function splitCode(text) {
  const parts = String(text).split('`');
  // An even count of parts means one backtick has no partner: join it back onto the run before it.
  if (parts.length % 2 === 0) {
    const tail = parts.pop();
    parts[parts.length - 1] += `\`${tail}`;
  }
  return parts.map((part, i) => ({ text: part, code: i % 2 === 1 })).filter((run) => run.text !== '');
}
