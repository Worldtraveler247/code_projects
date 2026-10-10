// A practice shell: just enough of bash, ansible, grep, less, and head to look up facts the
// way it is done at a real control node. Pure functions; the page supplies the data in `env`.
// Nothing here executes anything. Every command is parsed and answered from fixed text.

export const PROMPT = '[student@ansible my-project-directory]$ ';

const MAX_PATTERN = 200;
const SETUP_MODULES = ['setup', 'ansible.builtin.setup', 'ansible.legacy.setup'];
const PING_MODULES = ['ping', 'ansible.builtin.ping', 'ansible.legacy.ping'];
const ALWAYS_REPORTED = 'discovered_interpreter_python';
const COMMAND_MODULES = ['command', 'shell', 'ansible.builtin.command', 'ansible.builtin.shell', 'ansible.legacy.command', 'ansible.legacy.shell'];
const SCOPE_NOTE = 'This practice terminal supports the setup module (with an optional -a filter=PATTERN), the ping module, and the command module for checking the host (for example -a \'cat /root/hwreport.txt\').';
const HELP = [
  'Practice terminal. Supported commands:',
  '  ansible servera -m setup                  list every fact',
  '  ansible servera -m setup | less           page through them (space, b, /pattern, q)',
  '  ansible servera -m setup | grep -i ipv4   search them (-i -n -v -c -E -F -w -A -B -C)',
  "  ansible servera -m setup -a 'filter=ansible_default_ipv4'",
  '  ansible-playbook facts.yml                run the playbook in the editor',
  "  ansible servera -a 'cat /root/hwreport.txt'   check the host after a run (also: rpm -q, ls, systemctl is-active)",
  '  cat facts.yml, ls, head, clear',
].join('\n');

const text = (value) => ({ type: 'text', text: value });

// Split a command line into pipeline stages of words, honoring single and double quotes.
function parse(line) {
  const stages = [[]];
  let word = '';
  let inWord = false;
  let quote = null;
  const flush = () => { if (inWord) stages.at(-1).push(word); word = ''; inWord = false; };
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null; else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '|') {
      flush();
      stages.push([]);
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      word += ch;
      inWord = true;
    }
  }
  flush();
  return quote ? null : stages;
}

// ---- ansible ---------------------------------------------------------------

function globToRegExp(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

// Cut the setup text into its top-level fact blocks without re-serializing anything, so
// number formatting and spacing stay exactly as Ansible printed them.
function filterSetup(setupOutput, glob) {
  const lines = setupOutput.split('\n');
  const head = lines.slice(0, 2);
  const tail = lines.slice(-3);
  const blocks = [];
  for (const line of lines.slice(2, -3)) {
    const key = /^ {8}"([^"]+)":/.exec(line);
    if (key) blocks.push({ key: key[1], lines: [line] });
    else if (blocks.length) blocks.at(-1).lines.push(line);
  }
  if (glob.length > MAX_PATTERN) return null;
  const wanted = [globToRegExp(glob), globToRegExp(`ansible_${glob}`)];
  const kept = blocks.filter((block) => block.key === ALWAYS_REPORTED || wanted.some((re) => re.test(block.key)));
  const body = kept.flatMap((block, index) => {
    const copy = [...block.lines];
    copy[copy.length - 1] = copy.at(-1).replace(/,$/, '') + (index < kept.length - 1 ? ',' : '');
    return copy;
  });
  return [...head, ...body, ...tail].join('\n');
}

function ansible(args, env) {
  if (args.length === 0) {
    return 'usage: ansible [-h] [-m MODULE_NAME] [-a MODULE_ARGS] pattern\nansible: error: the following arguments are required: pattern';
  }
  let module = null;
  let moduleArgs = null;
  let pattern = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' || arg === '--module-name') module = args[++i] ?? '';
    else if (arg === '-a' || arg === '--args') moduleArgs = args[++i] ?? '';
    else if (arg === '-i' || arg === '--inventory' || arg === '-u' || arg === '--user') i++;
    else if (arg.startsWith('-')) continue;
    else if (pattern === null) pattern = arg;
  }
  if (pattern === null) return 'ansible: error: the following arguments are required: pattern';
  const targets = pattern.split(/[,:]/);
  if (!targets.some((target) => [env.host, env.fqdn, 'all', '*'].includes(target))) {
    return `[WARNING]: Could not match supplied host pattern, ignoring: ${pattern}\n[WARNING]: No hosts matched, nothing to do`;
  }
  // With no -m, ansible runs the command module, as the real tool does.
  if (module === null || COMMAND_MODULES.includes(module)) {
    if (moduleArgs === null || moduleArgs.trim() === '') return 'ERROR! No argument passed to command module';
    const result = env.hostCommand(moduleArgs.trim());
    return result.rc === 0
      ? `${env.host} | CHANGED | rc=0 >>\n${result.text}`
      : `${env.host} | FAILED | rc=${result.rc} >>\n${result.text}non-zero return code`;
  }
  if (PING_MODULES.includes(module)) return `${env.host} | SUCCESS => {\n    "changed": false,\n    "ping": "pong"\n}`;
  if (!SETUP_MODULES.includes(module)) return SCOPE_NOTE;
  if (moduleArgs === null || moduleArgs.trim() === '') return env.setupOutput;
  const filter = /^filter=(\S+)$/.exec(moduleArgs.trim());
  if (!filter) return SCOPE_NOTE;
  return filterSetup(env.setupOutput, filter[1]) ?? SCOPE_NOTE;
}

function ansiblePlaybook(args, env) {
  const file = args.find((arg) => !arg.startsWith('-'));
  if (!file) return 'usage: ansible-playbook [-h] playbook [playbook ...]\nansible-playbook: error: the following arguments are required: playbook';
  if (file !== env.playbookFile && file !== `./${env.playbookFile}`) return `ERROR! the playbook: ${file} could not be found`;
  return env.runPlaybook();
}

// ---- grep, head --------------------------------------------------------------

function grep(args, lines) {
  const flags = { i: false, v: false, n: false, c: false, E: false, F: false, w: false };
  let before = 0;
  let after = 0;
  const patterns = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { patterns.push(...args.slice(i + 1)); break; }
    if (!arg.startsWith('-') || arg === '-') { patterns.push(arg); continue; }
    if (arg.startsWith('--color')) continue;
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if (flag in flags) { flags[flag] = true; continue; }
      if (flag === 'P') { flags.E = true; continue; }
      if ('ABCe'.includes(flag)) {
        // The value is the rest of this word, or the next word: -A2 and -A 2 both work.
        const value = arg.slice(j + 1) || args[++i];
        if (value === undefined) return `grep: option requires an argument -- '${flag}'`;
        if (flag === 'e') { patterns.push(value); break; }
        if (!/^\d+$/.test(value)) return `grep: ${value}: invalid context length argument`;
        if (flag !== 'B') after = Number(value);
        if (flag !== 'A') before = Number(value);
        break;
      }
      return `grep: invalid option -- '${flag}'\nUsage: grep [OPTION]... PATTERNS [FILE]...`;
    }
  }
  if (patterns.length === 0) return "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.";
  if (patterns.some((pattern) => pattern.length > MAX_PATTERN)) return 'grep: the pattern is too long for this practice terminal';

  const sources = patterns.map((pattern) => {
    if (flags.F) return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Basic grep treats + ? | ( ) { } as plain characters unless -E is given.
    return flags.E ? pattern : pattern.replace(/[+?|(){}]/g, '\\$&');
  });
  let matcher;
  try {
    const joined = sources.map((source) => (flags.w ? `\\b(?:${source})\\b` : `(?:${source})`)).join('|');
    matcher = new RegExp(joined, flags.i ? 'i' : '');
  } catch {
    return 'grep: Invalid regular expression';
  }

  const hits = lines.map((line) => matcher.test(line) !== flags.v);
  if (flags.c) return String(hits.filter(Boolean).length);
  const show = new Set();
  hits.forEach((hit, index) => {
    if (!hit) return;
    for (let k = Math.max(0, index - before); k <= Math.min(lines.length - 1, index + after); k++) show.add(k);
  });
  const context = before > 0 || after > 0 || args.some((arg) => /^-[ABC]/.test(arg));
  const out = [];
  let previous = -1;
  for (const index of [...show].sort((a, b) => a - b)) {
    if (context && previous !== -1 && index > previous + 1) out.push('--');
    out.push(flags.n ? `${index + 1}${hits[index] ? ':' : '-'}${lines[index]}` : lines[index]);
    previous = index;
  }
  return out;
}

function head(args, lines) {
  let count = 10;
  for (let i = 0; i < args.length; i++) {
    const value = args[i] === '-n' ? args[++i] : /^-n?(\d+)$/.exec(args[i])?.[1];
    if (value === undefined || !/^\d+$/.test(value)) return `head: invalid number of lines: '${args[i] ?? ''}'`;
    count = Number(value);
  }
  return lines.slice(0, count);
}

// ---- entry point -------------------------------------------------------------

function source(words, env) {
  const [command, ...args] = words;
  switch (command) {
    case 'ansible': return ansible(args, env);
    case 'ansible-playbook': return ansiblePlaybook(args, env);
    case 'help': return HELP;
    case 'ls': return `ansible.cfg  ${env.playbookFile}  inventory`;
    case 'pwd': return '/home/student/my-project-directory';
    case 'cat':
      if (args.length === 0) return 'cat: missing file operand';
      if (args[0] === env.playbookFile) return env.readPlaybook();
      if (args[0] === 'inventory') return env.host;
      return `cat: ${args[0]}: No such file or directory`;
    case 'vim': case 'vi': case 'nano':
      return `The editor pane beside this terminal already has ${env.playbookFile} open. Edit it there.`;
    default: return `bash: ${command}: command not found...`;
  }
}

/**
 * Run one command line.
 * Returns { type: 'text', text, colored }, { type: 'pager', lines }, { type: 'clear' }, or { type: 'empty' }.
 */
export function execute(line, env) {
  if (line.trim() === '') return { type: 'empty' };
  const stages = parse(line);
  if (stages === null) return text('bash: unexpected EOF while looking for matching quote');
  if (stages.some((words) => words.length === 0)) return text("bash: syntax error near unexpected token `|'");
  if (stages[0][0] === 'clear' && stages.length === 1) return { type: 'clear' };

  // Ansible colors its output only when writing straight to a terminal, never into a pipe.
  const colored = stages.length === 1 && (stages[0][0] === 'ansible' || stages[0][0] === 'ansible-playbook');
  let lines = source(stages[0], env).replace(/\n$/, '').split('\n');
  for (let i = 1; i < stages.length; i++) {
    const [command, ...args] = stages[i];
    if (command === 'less' || command === 'more') {
      // Only the last stage reaches the screen; mid-pipeline, less just passes text along.
      if (i === stages.length - 1) return { type: 'pager', lines };
      continue;
    }
    const result = command === 'grep' ? grep(args, lines) : command === 'head' ? head(args, lines) : `bash: ${command}: command not found...`;
    if (typeof result === 'string') return text(result);
    lines = result;
  }
  return { ...text(lines.join('\n')), colored };
}
