// Decides whether a typed answer matches a card. No DOM access, so the tests import it directly.
//
// Three kinds of answer:
//   command  one shell line; ansible and ansible-inventory are compared by meaning, others token by token
//   ini      an ansible.cfg or inventory file; sections and lines may come in any order
//   hosts    a list of host names; order and duplicates do not matter

export function typographyProblem(text) {
  if (/[‘’“”]/.test(text)) {
    return 'Curly quotes (“ ” ‘ ’) are not shell quotes. Type straight quotes: " and \'. Notes apps and word processors swap them in silently.';
  }
  if (/[–—]/.test(text)) {
    return 'That is an en or em dash (– —), not two hyphens. The shell passes it as a literal character, so "–version" is not an option.';
  }
  return null;
}

// Shell-style split: whitespace separates words, quotes group them, and the quotes are dropped.
// A backslash escapes the next character as bash does; inside single quotes it is literal.
export function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let inWord = false;
  let escaped = false;
  for (const ch of line.trim()) {
    if (escaped) {
      // Inside double quotes bash keeps the backslash unless it precedes " \ $ or `.
      if (quote === '"' && !'"\\$`'.includes(ch)) current += '\\';
      current += ch;
      escaped = false;
      inWord = true;
    } else if (ch === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) tokens.push(current);
      current = '';
      inWord = false;
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote) throw new Error(`unclosed ${quote} quote`);
  if (inWord) tokens.push(current);
  return tokens;
}

const BOOL = new Map([['yes', 'true'], ['true', 'true'], ['on', 'true'], ['1', 'true'], ['no', 'false'], ['false', 'false'], ['off', 'false'], ['0', 'false']]);

function normValue(value) {
  return BOOL.get(value.toLowerCase()) ?? value;
}

const FREE_FORM = new Set(['command', 'shell', 'raw', 'script']);

function moduleName(name) {
  return name.replace(/^ansible\.builtin\./, '').replace(/^ansible\.legacy\./, '');
}

// key=value pairs in any order; a free-form module keeps its string, whitespace collapsed.
function normArgs(module, args) {
  if (FREE_FORM.has(module)) return args.trim().replace(/\s+/g, ' ');
  return tokenize(args)
    .map((pair) => {
      const at = pair.indexOf('=');
      return at < 0 ? pair : `${pair.slice(0, at)}=${normValue(pair.slice(at + 1))}`;
    })
    .sort()
    .join(' ');
}

const ALIASES = {
  '--module-name': '-m', '--args': '-a', '--inventory': '-i', '--inventory-file': '-i',
  '--become': '-b', '--user': '-u', '--forks': '-f', '--limit': '-l',
};
const TAKES_VALUE = new Set(['-m', '-a', '-i', '-u', '-f', '-l', '-e', '--extra-vars', '--become-user', '--host', '-t', '--tree']);

// ansible <pattern> [options] > file  →  a canonical string where option order does not matter.
function canonAnsible(tokens) {
  const [program, ...rest] = tokens;
  const options = new Map();
  const positionals = [];
  const redirect = [];
  for (let i = 0; i < rest.length; i++) {
    let token = rest[i];
    if (token.startsWith('>')) {
      const op = token.startsWith('>>') ? '>>' : '>';
      const target = token.slice(op.length);
      redirect.push(op, ...(target ? [target] : []), ...rest.slice(i + 1));
      break;
    }
    if (token.startsWith('--') && token.includes('=')) {
      const at = token.indexOf('=');
      rest.splice(i + 1, 0, token.slice(at + 1));
      token = token.slice(0, at);
    }
    if (token.startsWith('-')) {
      const flag = ALIASES[token] ?? token;
      options.set(flag, TAKES_VALUE.has(flag) ? (rest[++i] ?? '') : true);
    } else {
      positionals.push(token);
    }
  }
  if (options.has('-m')) options.set('-m', moduleName(options.get('-m')));
  const module = options.get('-m') ?? 'command';
  if (options.has('-a')) options.set('-a', normArgs(module, options.get('-a')));
  // With no -m, ansible runs the command module; spelling it out means the same thing.
  if (program === 'ansible' && options.get('-m') === 'command') options.delete('-m');
  const flags = [...options.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (v === true ? k : `${k}=${v}`));
  return [program, ...positionals, ...flags, ...redirect].join('\u0000');
}

export function canonCommand(line) {
  const tokens = tokenize(line);
  if (tokens.length === 0) return '';
  if (tokens[0] === 'ansible' || tokens[0] === 'ansible-inventory') return canonAnsible(tokens);
  return tokens.join('\u0000');
}

// INI as a set of "section|line" entries; key = value spacing ignored, comments and blanks dropped.
export function canonIni(text) {
  const entries = new Set();
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s[#;].*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (header) {
      section = header[1];
      entries.add(`${section}|`);
      continue;
    }
    const kv = line.match(/^([^=\s]+)\s*=\s*(.*)$/);
    entries.add(`${section}|${kv ? `${kv[1]}=${normValue(kv[2])}` : line.replace(/\s+/g, ' ')}`);
  }
  return [...entries].sort().join('\n');
}

export function canonHosts(text) {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))].sort().join(' ');
}

const CANON = { command: canonCommand, ini: canonIni, hosts: canonHosts };

// Returns { ok, reason }. reason explains a near miss when we can name it.
export function check(card, typed) {
  const kind = card.kind ?? 'command';
  if (!typed.trim()) return { ok: false, reason: 'Nothing typed.' };
  const typo = typographyProblem(typed);
  if (typo) return { ok: false, reason: typo };
  let mine;
  try {
    mine = CANON[kind](typed);
  } catch (error) {
    return { ok: false, reason: `The shell would reject this: ${error.message}.` };
  }
  let want = CANON[kind](card.answer);
  // A card that asks for one setting has no section header; accept the line with or without one.
  if (kind === 'ini' && !/^\s*\[/m.test(card.answer)) {
    const lines = (canon) => canon.split('\n').filter((entry) => !entry.endsWith('|')).map((entry) => entry.slice(entry.indexOf('|') + 1)).join('\n');
    mine = lines(mine);
    want = lines(want);
  }
  if (mine === want) return { ok: true, reason: null };
  if (kind === 'command') {
    const a = tokenize(typed)[0];
    const b = tokenize(card.answer)[0];
    if (a && b && a !== b && a.toLowerCase() === b.toLowerCase()) {
      return { ok: false, reason: `Linux commands are case-sensitive: "${a}" is not "${b}".` };
    }
  }
  return { ok: false, reason: null };
}
