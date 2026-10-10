// Decide which parts of Ansible's output are colored, the way a real terminal shows them:
// green for ok, red for failures and load errors, purple for warnings, cyan for skips.
// Pure and lossless: joining the segments of every line reproduces the input text.

const COUNT_RE = /(\b[a-z]+=\d+)/;
const COUNT_CLASS = { ok: 'ok', changed: 'changed', unreachable: 'fatal', failed: 'fatal', skipped: 'skip', rescued: 'warn', ignored: 'warn' };

function recapLine(line) {
  const match = /^(\S+)(\s+: )(.*)$/.exec(line);
  if (!match || !/\bok=\d+/.test(match[3])) return null;
  const count = (name) => Number(new RegExp(`\\b${name}=(\\d+)`).exec(match[3])?.[1] ?? 0);
  const hostClass = count('failed') > 0 || count('unreachable') > 0 ? 'fatal' : count('changed') > 0 ? 'changed' : 'ok';
  const segments = [{ cls: hostClass, text: match[1] }, { cls: '', text: match[2] }];
  for (const piece of match[3].split(COUNT_RE)) {
    if (piece === '') continue;
    const [name, value] = piece.split('=');
    const colored = COUNT_RE.test(piece) && Number(value) > 0;
    segments.push({ cls: colored ? COUNT_CLASS[name] ?? '' : '', text: piece });
  }
  return segments;
}

/** Split terminal text into lines of { cls, text } segments. cls is '' for uncolored text. */
export function colorize(text) {
  let block = null; // 'ok' inside a multi-line result; 'fatal' or 'changed' to the end of the output
  return String(text).split('\n').map((line) => {
    const whole = (cls) => [{ cls, text: line }];
    if (block === 'fatal' || block === 'changed') return whole(block);
    if (block === 'ok') {
      if (line === '}') block = null;
      return whole('ok');
    }
    if (line.startsWith('ERROR!')) {
      // A load error and everything it prints after it, to the end of the output.
      block = 'fatal';
      return whole('fatal');
    }
    if (/^ok: \[/.test(line) || /^\S+ \| SUCCESS => /.test(line)) {
      if (line.endsWith('{')) block = 'ok';
      return whole('ok');
    }
    // An ad-hoc command prints its header, then the command's own output, all in one color.
    const adhoc = /^\S+ \| (CHANGED|FAILED|UNREACHABLE!?) \| /.exec(line);
    if (adhoc) {
      block = adhoc[1] === 'CHANGED' ? 'changed' : 'fatal';
      return whole(block);
    }
    if (line.startsWith('fatal:')) return whole('fatal');
    if (/^changed: \[/.test(line)) return whole('changed');
    if (line.startsWith('[WARNING]')) return whole('warn');
    if (line.startsWith('skipping:')) return whole('skip');
    return recapLine(line) ?? whole('');
  });
}
