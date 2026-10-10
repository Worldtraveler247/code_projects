// A small YAML tokenizer for the editor's color overlay. It is deliberately lossless:
// joining every token's text reproduces the input exactly, so the colored layer always
// lines up with the characters in the textarea above it.

const KEY_RE = /^([A-Za-z_][\w.]*)(:)(?=\s|$)/;
const SCALAR_RE = /^(?:true|false|yes|no|null|~|-?\d+(?:\.\d+)?)$/i;
const JINJA_SPLIT_RE = /(\{\{.*?\}\})/;

function pushValue(tokens, value) {
  if (value === '') return;
  const body = value.trimStart();
  const lead = value.slice(0, value.length - body.length);
  if (lead) tokens.push({ cls: '', text: lead });
  if (body === '') return;
  if (body.startsWith('#')) {
    tokens.push({ cls: 'comment', text: body });
    return;
  }
  const trimmed = body.trimEnd();
  const tail = body.slice(trimmed.length);
  if (SCALAR_RE.test(trimmed)) {
    tokens.push({ cls: 'num', text: trimmed });
  } else {
    const cls = trimmed[0] === '"' || trimmed[0] === "'" ? 'str' : '';
    for (const piece of trimmed.split(JINJA_SPLIT_RE)) {
      if (piece === '') continue;
      tokens.push({ cls: JINJA_SPLIT_RE.test(piece) ? 'jinja' : cls, text: piece });
    }
  }
  if (tail) tokens.push({ cls: '', text: tail });
}

function tokenizeLine(line, tokens) {
  let rest = line.trimStart();
  const indent = line.slice(0, line.length - rest.length);
  if (indent) tokens.push({ cls: '', text: indent });
  if (rest === '') return;
  if (rest.startsWith('#')) {
    tokens.push({ cls: 'comment', text: rest });
    return;
  }
  if (rest.trimEnd() === '---') {
    tokens.push({ cls: 'doc', text: '---' });
    if (rest.length > 3) tokens.push({ cls: '', text: rest.slice(3) });
    return;
  }
  while (rest.startsWith('- ') || rest === '-') {
    tokens.push({ cls: 'dash', text: '-' });
    const after = rest.slice(1);
    const next = after.trimStart();
    if (after.length > next.length) tokens.push({ cls: '', text: after.slice(0, after.length - next.length) });
    rest = next;
  }
  const key = KEY_RE.exec(rest);
  if (key) {
    tokens.push({ cls: 'key', text: key[1] }, { cls: 'punct', text: key[2] });
    rest = rest.slice(key[0].length);
  }
  pushValue(tokens, rest);
}

/** Split YAML text into { cls, text } tokens. cls is '' for uncolored text. */
export function tokenizeYaml(text) {
  const tokens = [];
  // Keep each line ending as its own token so nothing is dropped.
  for (const part of String(text).split(/(\r?\n)/)) {
    if (part === '') continue;
    if (part === '\n' || part === '\r\n') tokens.push({ cls: '', text: part });
    else tokenizeLine(part, tokens);
  }
  return tokens;
}
