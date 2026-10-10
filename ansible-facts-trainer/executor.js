// Runs a play's tasks against a small model of a managed host, so a playbook can be judged
// the way the exam judges it: by the state it leaves behind. Pure functions; no screen access.
// Nothing real is executed. Each supported module updates the model and reports ok or changed.

import { evaluate, Float, JinjaError, pyRepr, pyStr, render, toJson, truthy, Undefined } from './jinja.js';

// Packages the simulated repositories offer, and the ones already on the host.
const REPOSITORY = ['httpd', 'mod_ssl', 'php', 'mariadb-server', 'nginx', 'vsftpd', 'chrony', 'firewalld', 'cronie',
  'git', 'tmux', 'vim-enhanced', 'tree', 'nfs-utils', 'samba', 'podman', 'lvm2', 'policycoreutils-python-utils'];
const PREINSTALLED = ['chrony', 'firewalld', 'cronie', 'openssh-server', 'lvm2'];
const SERVICE_PACKAGE = { httpd: 'httpd', nginx: 'nginx', mariadb: 'mariadb-server', vsftpd: 'vsftpd', chronyd: 'chrony',
  firewalld: 'firewalld', crond: 'cronie', sshd: 'openssh-server', smb: 'samba', 'nfs-server': 'nfs-utils' };

const MODULES = {
  debug: ['msg', 'var', 'verbosity'],
  set_fact: null, // any key is a fact name
  copy: ['content', 'dest', 'owner', 'group', 'mode', 'force', 'backup', 'setype'],
  dnf: ['name', 'state', 'update_cache', 'enablerepo', 'disablerepo'],
  service: ['name', 'state', 'enabled'],
};
const ALIASES = { yum: 'dnf', package: 'dnf', systemd: 'service', systemd_service: 'service' };
// Real modules a candidate may reach for that this trainer does not model.
const KNOWN_UNSUPPORTED = ['template', 'lineinfile', 'blockinfile', 'file', 'command', 'shell', 'raw', 'script', 'user', 'group',
  'firewalld', 'get_url', 'uri', 'stat', 'setup', 'assert', 'fail', 'pause', 'wait_for', 'cron', 'mount', 'lvol', 'lvg',
  'filesystem', 'parted', 'sysctl', 'seboolean', 'sefcontext', 'replace', 'unarchive', 'git', 'include_tasks', 'import_tasks',
  'include_role', 'import_role', 'include_vars', 'meta', 'add_host', 'group_by', 'timezone', 'hostname', 'reboot'];
const IGNORED_KEYWORDS = ['become', 'become_user', 'become_method', 'tags', 'check_mode', 'diff'];
const SUPPORTED_KEYWORDS = ['name', 'when', 'loop', 'with_items', 'register', 'ignore_errors', ...IGNORED_KEYWORDS];
const UNSUPPORTED_KEYWORDS = ['loop_control', 'until', 'retries', 'delay', 'vars', 'block', 'rescue', 'always', 'action',
  'local_action', 'args', 'async', 'poll', 'delegate_to', 'delegate_facts', 'run_once', 'no_log', 'notify', 'failed_when',
  'changed_when', 'environment', 'module_defaults', 'collections', 'connection', 'remote_user', 'port', 'any_errors_fatal',
  'debugger', 'throttle', 'timeout', 'ignore_unreachable', 'become_flags', 'become_exe'];

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Float);
const shortName = (key) => key.replace(/^ansible\.(builtin|legacy)\./, '');
const stop = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export function newHost() {
  return { packages: new Set(PREINSTALLED), files: new Map(), services: new Map([['sshd', { active: true, enabled: true }], ['chronyd', { active: true, enabled: true }]]) };
}

/**
 * Check every task before anything runs, as ansible-playbook does when it loads a file.
 * Returns { ok: true, tasks } or a failure with `load`, the line ansible-playbook would print.
 */
export function prepareTasks(tasks) {
  const prepared = [];
  for (const [index, task] of tasks.entries()) {
    if (!isMap(task)) {
      return stop('MISSING_MODULE', 'A task is a set of keys: a name, then a module.', { task: index, load: 'ERROR! no module/action detected in task.' });
    }
    const keys = Object.keys(task);
    const blocked = keys.find((key) => UNSUPPORTED_KEYWORDS.includes(key) || (key.startsWith('with_') && key !== 'with_items'));
    if (blocked) {
      return stop('UNSUPPORTED_KEYWORD', `"${blocked}" is valid Ansible, but it is outside this trainer's scope.`, { task: index });
    }
    const candidates = keys.filter((key) => !SUPPORTED_KEYWORDS.includes(key));
    if (candidates.length === 0) {
      return stop('MISSING_MODULE', 'This task has no module. After the name, add a module such as ansible.builtin.debug.', { task: index, load: 'ERROR! no module/action detected in task.' });
    }
    if (candidates.length > 1) {
      const stray = candidates.find((key) => ['msg', 'var', 'content', 'dest', 'state'].includes(key)) ?? candidates[1];
      return stop('BAD_TASK_KEY', `"${stray}" sits at the task level. Module arguments belong one indent level deeper, under the module name.`, {
        task: index, load: `ERROR! conflicting action statements: ${candidates.join(', ')}`,
      });
    }
    const key = candidates[0];
    const bare = shortName(key);
    const module = ALIASES[bare] ?? bare;
    if (!Object.hasOwn(MODULES, module)) {
      if (KNOWN_UNSUPPORTED.includes(bare)) {
        return stop('UNSUPPORTED_MODULE', `${key} is a real Ansible module, but this trainer does not model it. Supported here: debug, set_fact, copy (with content), dnf or package, and service.`, { task: index });
      }
      return stop('UNKNOWN_MODULE', `"${key}" is not a module. Check the spelling.`, {
        task: index, detail: key, load: `ERROR! couldn't resolve module/action '${key}'. This often indicates a misspelling, missing collection, or incorrect module path.`,
      });
    }
    let args = task[key];
    if (typeof args === 'string') {
      return stop('UNSUPPORTED_SYNTAX', 'The inline key=value form is valid Ansible, but it is outside this trainer\'s scope. Write the arguments as nested keys.', { task: index });
    }
    if (args == null) args = {};
    if (!isMap(args)) return stop('MISSING_MSG', `${key} needs its arguments as nested keys.`, { task: index });
    const label = typeof task.name === 'string' && task.name.trim() !== '' ? task.name : key;
    prepared.push({ index, label, module, moduleKey: key, args, task });
  }
  return { ok: true, tasks: prepared };
}

// ---- Module failures look like Ansible's ------------------------------------------------

class TaskFailure extends Error {
  constructor(result) { super(result.msg); this.result = result; }
}

const fail = (msg, extra = {}) => { throw new TaskFailure({ changed: false, ...extra, msg }); };

function checkParams(prepared, required = []) {
  const allowed = MODULES[prepared.module];
  const unknown = Object.keys(prepared.args).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    fail(`Unsupported parameters for (${prepared.moduleKey}) module: ${unknown.join(', ')}. Supported parameters include: ${allowed.join(', ')}.`);
  }
  const missing = required.filter((key) => !Object.hasOwn(prepared.args, key));
  if (missing.length) fail(`missing required arguments: ${missing.join(', ')}`);
}

// Render every string inside a value. A missing variable becomes Ansible's own message.
function renderDeep(value, context) {
  if (typeof value === 'string') return render(value, context);
  if (Array.isArray(value)) return value.map((item) => renderDeep(item, context));
  if (isMap(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderDeep(item, context)]));
  return value;
}

const asBool = (value) => (typeof value === 'boolean' ? value : ['yes', 'true', 'on', '1'].includes(String(value).toLowerCase()));

function runModule(prepared, context, state, host) {
  const args = renderDeep(prepared.args, context);
  switch (prepared.module) {
    case 'debug': {
      checkParams(prepared);
      if (Object.hasOwn(args, 'msg') && Object.hasOwn(args, 'var')) fail("'msg' and 'var' are incompatible options");
      if (Object.hasOwn(prepared.args, 'var')) {
        const source = String(prepared.args.var);
        if (source.includes('{{')) fail("'var' takes a bare expression with no braces, for example var: ansible_facts['hostname']", { trainer: true });
        const value = evaluate(source, context);
        return { changed: false, output: { [source.trim()]: value instanceof Undefined ? 'VARIABLE IS NOT DEFINED!' : value } };
      }
      return { changed: false, output: { msg: Object.hasOwn(args, 'msg') ? args.msg : 'Hello world!' } };
    }
    case 'set_fact': {
      const facts = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'cacheable'));
      if (Object.keys(facts).length === 0) fail('No key/value pairs provided, at least one is required for this action to succeed');
      Object.assign(context, facts);
      Object.assign(state.vars, facts);
      return { changed: false };
    }
    case 'copy': {
      if (Object.hasOwn(prepared.args, 'src')) fail("copy with src is outside this trainer's scope; write the text with content.", { trainer: true });
      checkParams(prepared, ['dest']);
      if (!Object.hasOwn(args, 'content')) fail('src (or content) is required');
      const dest = pyStr(args.dest);
      if (!dest.startsWith('/')) fail(`dest must be an absolute path on the managed host, got: ${dest}`, { trainer: true });
      const content = typeof args.content === 'string' ? args.content : toJson(args.content);
      const next = { content, owner: pyStr(args.owner ?? 'root'), group: pyStr(args.group ?? 'root'), mode: pyStr(args.mode ?? '0644') };
      const before = state.files.get(dest);
      const changed = !before || ['content', 'owner', 'group', 'mode'].some((key) => before[key] !== next[key]);
      state.files.set(dest, next);
      return { changed };
    }
    case 'dnf': {
      checkParams(prepared, ['name']);
      const names = (Array.isArray(args.name) ? args.name : pyStr(args.name).split(',')).map((name) => pyStr(name).trim()).filter(Boolean);
      const wanted = pyStr(args.state ?? 'present');
      if (!['present', 'installed', 'latest', 'absent', 'removed'].includes(wanted)) {
        fail(`value of state must be one of: absent, installed, latest, present, removed, got: ${wanted}`);
      }
      const install = !['absent', 'removed'].includes(wanted);
      const unknown = names.filter((name) => install && !REPOSITORY.includes(name) && !state.packages.has(name));
      if (unknown.length) {
        fail('Failed to install some of the specified packages', { failures: unknown.map((name) => `No package ${name} available.`), rc: 1, results: [] });
      }
      let changed = false;
      for (const name of names) {
        if (install !== state.packages.has(name)) changed = true;
        if (install) state.packages.add(name); else state.packages.delete(name);
      }
      return { changed };
    }
    default: {
      checkParams(prepared, ['name']);
      const name = pyStr(args.name).replace(/\.service$/, '');
      const provider = SERVICE_PACKAGE[name];
      if (!provider || !state.packages.has(provider)) fail(`Could not find the requested service ${name}: host`);
      const before = state.services.get(name) ?? { active: false, enabled: false };
      const next = { ...before };
      let changed = false;
      if (Object.hasOwn(args, 'state')) {
        const wanted = pyStr(args.state);
        if (!['started', 'stopped', 'restarted', 'reloaded'].includes(wanted)) {
          fail(`value of state must be one of: reloaded, restarted, started, stopped, got: ${wanted}`);
        }
        next.active = wanted !== 'stopped';
        changed = wanted === 'restarted' || wanted === 'reloaded' || next.active !== before.active;
      }
      if (Object.hasOwn(args, 'enabled')) {
        next.enabled = asBool(args.enabled);
        changed = changed || next.enabled !== before.enabled;
      }
      state.services.set(name, next);
      return { changed, host };
    }
  }
}

// ---- Running a play ---------------------------------------------------------------------

/** The variables a play sees: ansible_facts, each fact under its ansible_ name, and a few magic ones. */
export function buildContext(facts, host, extra = {}) {
  const context = { ansible_facts: facts, inventory_hostname: host, inventory_hostname_short: host.split('.')[0], ...extra };
  for (const [key, value] of Object.entries(facts)) context[key === 'ansible_local' ? key : `ansible_${key}`] = value;
  return context;
}

function itemLabel(item) {
  return typeof item === 'string' ? item : item === null ? 'None' : typeof item === 'object' && !(item instanceof Float) ? pyRepr(item) : pyStr(item);
}

function conditionHolds(when, context) {
  const conditions = Array.isArray(when) ? when : [when];
  for (const condition of conditions) {
    if (typeof condition === 'boolean') { if (!condition) return false; continue; }
    const source = String(condition);
    // Ansible accepts braces in a condition, with a warning; the expression inside is what counts.
    const bare = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(source);
    try {
      if (!truthy(evaluate(bare ? bare[1] : source, context))) return false;
    } catch (error) {
      if (!(error instanceof JinjaError)) throw error;
      error.condition = source;
      throw error;
    }
  }
  return true;
}

/**
 * Run prepared tasks. Returns { events, counts, state, failed }.
 * An event is { label, lines, status } where lines are the text the task prints.
 */
export function executeTasks(prepared, { facts, host, state = newHost(), vars = {} }) {
  const context = buildContext(facts, host, vars);
  state.vars = { ...vars };
  const counts = { ok: 0, changed: 0, skipped: 0, failed: 0 };
  const events = [];
  const messages = [];

  for (const item of prepared) {
    const event = { index: item.index, label: item.label, lines: [], status: 'ok' };
    events.push(event);
    const { task } = item;
    try {
      let loopItems = null;
      const loopSource = task.loop ?? task.with_items;
      if (loopSource !== undefined) {
        loopItems = typeof loopSource === 'string' ? render(loopSource, context) : renderDeep(loopSource, context);
        if (!Array.isArray(loopItems)) {
          throw new TaskFailure({ msg: `Invalid data passed to 'loop', it requires a list, got this instead: ${pyStr(loopItems)}. Hint: If you passed a list/dict of just one element, try adding wantlist=True to your lookup invocation or use q/query instead of lookup.` });
        }
      }
      const rounds = loopItems === null ? [undefined] : loopItems;
      const results = [];
      let anyChanged = false;
      let anyRan = false;
      for (const loopItem of rounds) {
        const suffix = loopItems === null ? '' : ` => (item=${itemLabel(loopItem)})`;
        if (loopItems !== null) context.item = loopItem;
        if (task.when !== undefined && !conditionHolds(task.when, context)) {
          if (loopItems !== null) event.lines.push(`skipping: [${host}]${suffix} `);
          results.push({ changed: false, skipped: true });
          continue;
        }
        anyRan = true;
        const result = runModule(item, context, state, host);
        results.push({ changed: result.changed, failed: false, ...(result.output ?? {}) });
        anyChanged = anyChanged || result.changed;
        const word = result.changed ? 'changed' : 'ok';
        if (result.output) {
          event.lines.push(`${word}: [${host}]${suffix} => ${toJson(result.output)}`);
          if (Object.hasOwn(result.output, 'msg')) messages.push(...(Array.isArray(result.output.msg) ? result.output.msg : [result.output.msg]).map((m) => (typeof m === 'string' ? m : pyStr(m))));
        } else {
          event.lines.push(`${word}: [${host}]${suffix}`);
        }
      }
      delete context.item;
      if (!anyRan) {
        event.status = 'skipped';
        event.lines.push(`skipping: [${host}]`);
        counts.skipped++;
      } else {
        event.status = anyChanged ? 'changed' : 'ok';
        counts.ok++;
        if (anyChanged) counts.changed++;
      }
      if (typeof task.register === 'string') {
        context[task.register] = loopItems === null
          ? { ...results[0], skipped: !anyRan }
          : { results, changed: anyChanged, skipped: !anyRan, msg: 'All items completed' };
      }
    } catch (error) {
      if (!(error instanceof JinjaError) && !(error instanceof TaskFailure)) throw error;
      event.status = 'failed';
      event.error = error;
      if (task.ignore_errors === true && error instanceof TaskFailure) {
        event.lines.push(`fatal: [${host}]: FAILED! => ${JSON.stringify(error.result).replace(/":/g, '": ').replace(/,"/g, ', "')}`, '...ignoring');
        event.status = 'ok';
        counts.ok++;
        continue;
      }
      counts.failed++;
      return { events, counts, state, messages, failed: event };
    }
  }
  return { events, counts, state, messages, failed: null };
}

// ---- Looking at the host afterwards -------------------------------------------------------

/**
 * Answer a read-only command run on the managed host through an ad-hoc `ansible HOST -a '...'`.
 * Returns { rc, text }.
 */
export function hostCommand(state, command) {
  const words = command.trim().split(/\s+/);
  if (words[0] === 'cat' && words.length === 2) {
    const file = state.files.get(words[1]);
    return file ? { rc: 0, text: file.content.replace(/\n$/, '') } : { rc: 1, text: `cat: ${words[1]}: No such file or directory` };
  }
  if (words[0] === 'rpm' && words[1] === '-q' && words.length === 3) {
    return state.packages.has(words[2]) ? { rc: 0, text: `${words[2]}-1.0-1.el9.aarch64` } : { rc: 1, text: `package ${words[2]} is not installed` };
  }
  if (words[0] === 'systemctl' && ['is-active', 'is-enabled'].includes(words[1]) && words.length === 3) {
    const service = state.services.get(words[2].replace(/\.service$/, ''));
    if (words[1] === 'is-active') return service?.active ? { rc: 0, text: 'active' } : { rc: 3, text: 'inactive' };
    return service?.enabled ? { rc: 0, text: 'enabled' } : { rc: 1, text: 'disabled' };
  }
  if (words[0] === 'ls' && words.length === 2) {
    return state.files.has(words[1]) ? { rc: 0, text: words[1] } : { rc: 2, text: `ls: cannot access '${words[1]}': No such file or directory` };
  }
  return { rc: 127, text: 'This practice host answers: cat FILE, ls FILE, rpm -q PACKAGE, systemctl is-active UNIT, systemctl is-enabled UNIT.' };
}
