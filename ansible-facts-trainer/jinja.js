// A Jinja2 expression evaluator for the subset Ansible playbooks use with facts:
// lookups, comparisons, and/or/not, in, is-tests, arithmetic, a conditional expression,
// and the common filters. It follows Python's rules for truthiness, equality, and text
// output, and Ansible's rule that a missing value stays "undefined" until it is used.
//
// Pure functions. No eval, no Function: expressions are tokenized, parsed into a tree,
// and walked. tests/jinja-differential.test.mjs compares it with the real Ansible engine.

export class JinjaError extends Error {
  /** kind: 'syntax' | 'undefined' | 'type' | 'unsupported'. ansible: Jinja2's own wording, when known. */
  constructor(kind, message, ansible) {
    super(message);
    this.kind = kind;
    this.ansible = ansible ?? message;
  }
}

/** A missing variable, key, or index. Ansible lets it flow through lookups until it is used. */
export class Undefined {
  constructor(hint) { this.hint = hint; }
}

/** A Python float. JavaScript cannot tell 4 from 4.0; Python prints them differently. */
export class Float {
  constructor(value) { this.value = value; }
}

const MAX_SOURCE = 2000;
const MAX_REGEX = 200;
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else']);
const CONSTANTS = { true: true, True: true, false: false, False: false, none: null, None: null };

// ---- Python-flavored helpers ---------------------------------------------------------

const isFloat = (v) => v instanceof Float || (typeof v === 'number' && !Number.isInteger(v));
const isNumber = (v) => typeof v === 'number' || v instanceof Float || typeof v === 'boolean';
const num = (v) => (v instanceof Float ? v.value : Number(v));
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Float) && !(v instanceof Undefined);

export function typeName(v) {
  if (v === null) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (isFloat(v)) return 'float';
  if (typeof v === 'number') return 'int';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  return 'dict';
}

function use(value) {
  if (value instanceof Undefined) throw new JinjaError('undefined', value.hint, value.hint);
  return value;
}

export function truthy(value) {
  const v = use(value);
  if (v === null || v === false) return false;
  if (v instanceof Float) return v.value !== 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
  if (isMap(v)) return Object.keys(v).length > 0;
  return true;
}

export function pyEquals(a, b) {
  if (isNumber(a) && isNumber(b)) return num(a) === num(b);
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => pyEquals(item, b[i]));
  if (isMap(a) && isMap(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && pyEquals(a[k], b[k]));
  }
  return false;
}

function pyCompare(a, b, symbol) {
  if (isNumber(a) && isNumber(b)) return num(a) - num(b);
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (!pyEquals(a[i], b[i])) return pyCompare(a[i], b[i], symbol);
    }
    return a.length - b.length;
  }
  throw new JinjaError('type', `'${symbol}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}

function floatText(n) {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : n > 0 ? 'inf' : '-inf';
  if (Object.is(n, -0)) return '-0.0';
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** Python's repr(): how a value prints inside a list or dict. */
export function pyRepr(v) {
  if (typeof v === 'string') {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
    return quote + (quote === "'" ? body.replace(/'/g, "\\'") : body) + quote;
  }
  if (v === null) return 'None';
  return pyStr(v);
}

/** Python's str(): how a value prints when it is the whole value. */
export function pyStr(v) {
  if (typeof v === 'string') return v;
  if (v === null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof Float) return floatText(v.value);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatText(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(v).map(([k, item]) => `${pyRepr(k)}: ${pyRepr(item)}`).join(', ')}}`;
}

/** JSON as Python's json.dumps(indent=4) writes it, keeping 4.0 as 4.0. */
export function toJson(v, depth = 0) {
  const pad = '    '.repeat(depth + 1);
  const end = '    '.repeat(depth);
  if (v instanceof Float) return floatText(v.value);
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((item) => pad + toJson(item, depth + 1)).join(',\n')}\n${end}]` : '[]';
  const entries = Object.entries(v);
  return entries.length ? `{\n${entries.map(([k, item]) => `${pad}${JSON.stringify(k)}: ${toJson(item, depth + 1)}`).join(',\n')}\n${end}}` : '{}';
}

function compileRegex(pattern, anchored) {
  if (typeof pattern !== 'string') throw new JinjaError('type', 'a regular expression must be a string');
  if (pattern.length > MAX_REGEX) throw new JinjaError('unsupported', `The pattern is too long (limit ${MAX_REGEX} characters).`);
  try {
    return new RegExp(anchored ? `^(?:${pattern})` : pattern);
  } catch {
    throw new JinjaError('syntax', `"${pattern}" is not a valid regular expression.`);
  }
}

// ---- Tokenizer -------------------------------------------------------------------------

const TOKEN_RE = /\s*(?:(\d+(?:\.\d+)?[eE][-+]?\d+|\d+\.\d+)|(\d+)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|\/\/|\*\*|[-+*/%~|()[\]{},.:<>=]))/y;

function tokenize(source) {
  if (source.length > MAX_SOURCE) throw new JinjaError('unsupported', 'The expression is too long.');
  if (/[‘’“”]/.test(source)) {
    throw new JinjaError('syntax', "This contains curly quotes (‘ ’ or “ ”). Retype them as straight quotes: ' or \".");
  }
  const tokens = [];
  let position = 0;
  while (position < source.length) {
    if (/^\s*$/.test(source.slice(position))) break;
    TOKEN_RE.lastIndex = position;
    const match = TOKEN_RE.exec(source);
    if (!match) throw new JinjaError('syntax', `unexpected char ${JSON.stringify(source.slice(position).trim()[0])} at ${position}`);
    position = TOKEN_RE.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'float', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'int', value: Number(match[2]) });
    // Ansible keeps backslashes in a string literal exactly as written, so a regular
    // expression such as '192\.168' reaches the regex engine intact. Nothing is unescaped.
    else if (match[3] !== undefined || match[4] !== undefined) tokens.push({ type: 'string', value: match[3] ?? match[4] });
    else if (match[5] !== undefined) tokens.push({ type: KEYWORDS.has(match[5]) ? 'keyword' : 'name', value: match[5] });
    else tokens.push({ type: 'op', value: match[6] });
  }
  return tokens;
}

// ---- Parser: the same precedence ladder Jinja2 uses ---------------------------------

class Parser {
  constructor(tokens) { this.tokens = tokens; this.at = 0; }

  peek(offset = 0) { return this.tokens[this.at + offset]; }

  is(type, value) {
    const token = this.peek();
    return token !== undefined && token.type === type && (value === undefined || token.value === value);
  }

  take(type, value) {
    if (!this.is(type, value)) {
      const found = this.peek();
      throw new JinjaError('syntax', found ? `unexpected '${found.value}'${value ? `, expected '${value}'` : ''}` : `unexpected end of template${value ? `, expected '${value}'` : ''}`);
    }
    return this.tokens[this.at++];
  }

  accept(type, value) { return this.is(type, value) ? this.tokens[this.at++] : null; }

  parseAll() {
    if (this.tokens.length === 0) throw new JinjaError('syntax', 'Expected an expression, got end of template');
    const node = this.conditional();
    if (this.at < this.tokens.length) throw new JinjaError('syntax', `unexpected '${this.peek().value}'`);
    return node;
  }

  conditional() {
    const value = this.or();
    if (!this.accept('keyword', 'if')) return value;
    const test = this.or();
    const otherwise = this.accept('keyword', 'else') ? this.conditional() : null;
    return { type: 'if', test, value, otherwise };
  }

  or() {
    let left = this.and();
    while (this.accept('keyword', 'or')) left = { type: 'or', left, right: this.and() };
    return left;
  }

  and() {
    let left = this.not();
    while (this.accept('keyword', 'and')) left = { type: 'and', left, right: this.not() };
    return left;
  }

  not() {
    return this.accept('keyword', 'not') ? { type: 'not', operand: this.not() } : this.compare();
  }

  // "a < b < c" means "a < b and b < c", as in Python. in and not in chain the same way.
  compare() {
    const first = this.math1();
    const rest = [];
    for (;;) {
      const op = ['==', '!=', '<', '<=', '>', '>='].find((symbol) => this.is('op', symbol));
      if (op) {
        this.at++;
        rest.push({ op, operand: this.math1() });
      } else if (this.accept('keyword', 'in')) {
        rest.push({ op: 'in', operand: this.math1() });
      } else if (this.is('keyword', 'not') && this.peek(1)?.value === 'in') {
        this.at += 2;
        rest.push({ op: 'not in', operand: this.math1() });
      } else {
        return rest.length ? { type: 'compare', first, rest } : first;
      }
    }
  }

  math1() {
    let left = this.concat();
    while (this.is('op', '+') || this.is('op', '-')) left = { type: 'math', op: this.tokens[this.at++].value, left, right: this.concat() };
    return left;
  }

  concat() {
    let left = this.math2();
    while (this.accept('op', '~')) left = { type: 'concat', left, right: this.math2() };
    return left;
  }

  math2() {
    let left = this.power();
    while (['*', '/', '//', '%'].some((symbol) => this.is('op', symbol))) left = { type: 'math', op: this.tokens[this.at++].value, left, right: this.power() };
    return left;
  }

  power() {
    let left = this.unary();
    while (this.accept('op', '**')) left = { type: 'math', op: '**', left, right: this.unary() };
    return left;
  }

  unary(withFilters = true) {
    let node;
    if (this.accept('op', '-')) node = { type: 'negate', operand: this.unary(false) };
    else if (this.accept('op', '+')) node = this.unary(false);
    else node = this.postfix(this.primary());
    return withFilters ? this.filters(node) : node;
  }

  primary() {
    const token = this.peek();
    if (!token) throw new JinjaError('syntax', 'unexpected end of template');
    this.at++;
    if (token.type === 'int') return { type: 'literal', value: token.value };
    if (token.type === 'float') return { type: 'literal', value: new Float(token.value) };
    if (token.type === 'string') return { type: 'literal', value: token.value };
    if (token.type === 'name') {
      return Object.hasOwn(CONSTANTS, token.value) ? { type: 'literal', value: CONSTANTS[token.value] } : { type: 'name', name: token.value };
    }
    if (token.type === 'op' && token.value === '(') {
      const inner = this.conditional();
      this.take('op', ')');
      return inner;
    }
    if (token.type === 'op' && token.value === '[') {
      const items = [];
      while (!this.is('op', ']')) {
        items.push(this.conditional());
        if (!this.accept('op', ',')) break;
      }
      this.take('op', ']');
      return { type: 'list', items };
    }
    if (token.type === 'op' && token.value === '{') {
      const entries = [];
      while (!this.is('op', '}')) {
        const key = this.conditional();
        this.take('op', ':');
        entries.push([key, this.conditional()]);
        if (!this.accept('op', ',')) break;
      }
      this.take('op', '}');
      return { type: 'dict', entries };
    }
    throw new JinjaError('syntax', `unexpected '${token.value}'`);
  }

  postfix(start) {
    let node = start;
    for (;;) {
      if (this.accept('op', '.')) {
        const token = this.peek();
        if (!token || !['name', 'int', 'keyword'].includes(token.type)) throw new JinjaError('syntax', 'expected name or number');
        this.at++;
        node = { type: 'attr', target: node, name: token.value };
      } else if (this.accept('op', '[')) {
        if (this.accept('op', ':')) {
          const stop = this.is('op', ']') ? null : this.conditional();
          node = { type: 'slice', target: node, start: null, stop };
        } else {
          const index = this.conditional();
          if (this.accept('op', ':')) {
            const stop = this.is('op', ']') ? null : this.conditional();
            node = { type: 'slice', target: node, start: index, stop };
          } else {
            node = { type: 'item', target: node, index };
          }
        }
        this.take('op', ']');
      } else if (this.is('op', '(')) {
        node = { type: 'call', target: node, ...this.args() };
      } else {
        return node;
      }
    }
  }

  // "(a, b, key=value)"
  args() {
    this.take('op', '(');
    const args = [];
    const kwargs = {};
    while (!this.is('op', ')')) {
      if (this.is('name') && this.peek(1)?.value === '=') {
        const key = this.tokens[this.at].value;
        this.at += 2;
        kwargs[key] = this.conditional();
      } else {
        args.push(this.conditional());
      }
      if (!this.accept('op', ',')) break;
    }
    this.take('op', ')');
    return { args, kwargs };
  }

  // Filters and tests bind tighter than arithmetic, and chain left to right.
  filters(start) {
    let node = start;
    for (;;) {
      if (this.accept('op', '|')) {
        let name = this.take('name').value;
        while (this.accept('op', '.')) name += `.${this.take('name').value}`;
        const call = this.is('op', '(') ? this.args() : { args: [], kwargs: {} };
        node = { type: 'filter', target: node, name, ...call };
      } else if (this.accept('keyword', 'is')) {
        const negate = Boolean(this.accept('keyword', 'not'));
        const token = this.peek();
        if (!token || !['name', 'keyword'].includes(token.type)) throw new JinjaError('syntax', 'expected a test name after "is"');
        this.at++;
        let args = [];
        if (this.is('op', '(')) args = this.args().args;
        else if (this.peek() && (['int', 'float', 'string', 'name'].includes(this.peek().type) || this.is('op', '[') || this.is('op', '{'))) args = [this.postfix(this.primary())];
        node = { type: 'test', target: node, name: token.value, args, negate };
      } else {
        return node;
      }
    }
  }
}

// ---- Lookups -----------------------------------------------------------------------------

function getAttr(target, name) {
  if (target instanceof Undefined) return target;
  if (isMap(target)) {
    return Object.hasOwn(target, name) ? target[name] : new Undefined(`'dict object' has no attribute '${name}'`);
  }
  if (Array.isArray(target) && typeof name === 'number') return getItem(target, name);
  return new Undefined(`'${typeName(target)} object' has no attribute '${name}'`);
}

function getItem(target, index) {
  if (target instanceof Undefined) return target;
  const key = use(index);
  if (isMap(target)) {
    const text = typeof key === 'string' ? key : pyStr(key);
    return Object.hasOwn(target, text) ? target[text] : new Undefined(`'dict object' has no attribute ${pyRepr(key)}`);
  }
  if (Array.isArray(target) || typeof target === 'string') {
    if (typeof key !== 'number' || !Number.isInteger(key)) {
      return new Undefined(`'${typeName(target)} object' has no attribute ${pyRepr(key)}`);
    }
    const at = key < 0 ? target.length + key : key;
    if (at < 0 || at >= target.length) return new Undefined(`${typeName(target)} object has no element ${key}`);
    return target[at];
  }
  return new Undefined(`'${typeName(target)} object' has no attribute ${pyRepr(key)}`);
}

const METHODS = {
  str: {
    upper: (s) => s.toUpperCase(),
    lower: (s) => s.toLowerCase(),
    strip: (s) => s.trim(),
    startswith: (s, prefix) => s.startsWith(String(prefix)),
    endswith: (s, suffix) => s.endsWith(String(suffix)),
    split: (s, sep) => (sep === undefined ? s.trim().split(/\s+/).filter(Boolean) : s.split(String(sep))),
    replace: (s, from, to) => s.split(String(from)).join(String(to)),
  },
  dict: {
    keys: (d) => Object.keys(d),
    values: (d) => Object.values(d),
    items: (d) => Object.entries(d),
    get: (d, key, fallback = null) => (Object.hasOwn(d, String(key)) ? d[String(key)] : fallback),
  },
};

// ---- Tests and filters -----------------------------------------------------------------

const TESTS = {
  defined: (v) => !(v instanceof Undefined),
  undefined: (v) => v instanceof Undefined,
  none: (v) => use(v) === null,
  string: (v) => typeof use(v) === 'string',
  number: (v) => isNumber(use(v)),
  integer: (v) => typeof use(v) === 'number' && Number.isInteger(v),
  float: (v) => isFloat(use(v)),
  boolean: (v) => typeof use(v) === 'boolean',
  mapping: (v) => isMap(use(v)),
  sequence: (v) => { const u = use(v); return Array.isArray(u) || typeof u === 'string' || isMap(u); },
  iterable: (v) => { const u = use(v); return Array.isArray(u) || typeof u === 'string' || isMap(u); },
  true: (v) => use(v) === true,
  false: (v) => use(v) === false,
  truthy: (v) => truthy(v),
  falsy: (v) => !truthy(v),
  even: (v) => num(use(v)) % 2 === 0,
  odd: (v) => num(use(v)) % 2 !== 0,
  in: (v, seq) => contains(use(seq), use(v)),
  match: (v, pattern) => compileRegex(use(pattern), true).test(pyStr(use(v))),
  search: (v, pattern) => compileRegex(use(pattern), false).test(pyStr(use(v))),
  equalto: (v, other) => pyEquals(use(v), use(other)),
};
// Ansible's tests on a registered task result.
const resultFlag = (name) => (v) => { const u = use(v); return isMap(u) && u[name] === true; };
TESTS.skipped = resultFlag('skipped');
TESTS.skip = TESTS.skipped;
TESTS.changed = resultFlag('changed');
TESTS.change = TESTS.changed;
TESTS.failed = resultFlag('failed');
TESTS.succeeded = (v) => !resultFlag('failed')(v);
TESTS.success = TESTS.succeeded;
TESTS.eq = TESTS.equalto;
TESTS['=='] = TESTS.equalto;

function runTest(name, value, args) {
  if (!Object.hasOwn(TESTS, name)) {
    throw new JinjaError('unsupported', `The "${name}" test is valid Jinja2 or Ansible, but it is outside this trainer's scope.`);
  }
  return Boolean(TESTS[name](value, ...args));
}

function contains(container, item) {
  if (typeof container === 'string') {
    if (typeof item !== 'string') throw new JinjaError('type', `'in <string>' requires string as left operand, not ${typeName(item)}`);
    return container.includes(item);
  }
  if (Array.isArray(container)) return container.some((entry) => pyEquals(entry, item));
  if (isMap(container)) return Object.hasOwn(container, typeof item === 'string' ? item : pyStr(item));
  throw new JinjaError('type', `argument of type '${typeName(container)}' is not iterable`);
}

function asList(value, filter) {
  const v = use(value);
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (isMap(v)) return Object.keys(v);
  throw new JinjaError('type', `'${typeName(v)}' object is not iterable (in the ${filter} filter)`);
}

function toInt(value, fallback = 0) {
  const v = use(value);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isNumber(v)) return Math.trunc(num(v));
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return Number(v);
  if (typeof v === 'string' && /^\s*[-+]?\d*\.\d+\s*$/.test(v)) return Math.trunc(Number(v));
  return fallback;
}

// Python's round(): correctly rounded from the number's exact binary value, with a tie
// going to the even digit. So round(2.5) is 2.0, and round(2.675, 2) is 2.67 because the
// stored value is slightly below 2.675. toFixed(100) yields the exact decimal expansion.
function pyRound(value, places) {
  if (!Number.isFinite(value) || !Number.isInteger(places) || places < 0 || places > 15) return value;
  const [whole, fraction] = Math.abs(value).toFixed(100).split('.');
  const kept = fraction.slice(0, places);
  const rest = fraction.slice(places);
  const tie = /^50*$/.test(rest);
  const lastDigit = Number((whole + kept).at(-1));
  const up = tie ? lastDigit % 2 === 1 : rest[0] >= '5';
  const digits = (BigInt(whole + kept) + (up ? 1n : 0n)).toString().padStart(places + 1, '0');
  const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return (value < 0 ? -1 : 1) * Number(text);
}

// "value.removable" walks two levels, as Jinja2's attribute filters allow.
function attrPath(item, attribute) {
  return pyStr(use(attribute)).split('.').reduce((current, part) => getAttr(current, /^\d+$/.test(part) ? Number(part) : part), item);
}

const FILTERS = {
  default: (v, fallback = '', boolean = false) => ((v instanceof Undefined) || (truthyOrFalse(boolean) && !truthy(v)) ? fallback : v),
  int: (v, fallback = 0) => toInt(v, fallback),
  float: (v, fallback = new Float(0)) => {
    const u = use(v);
    if (isNumber(u)) return new Float(num(u));
    return typeof u === 'string' && u.trim() !== '' && Number.isFinite(Number(u)) ? new Float(Number(u)) : fallback;
  },
  string: (v) => pyStr(use(v)),
  bool: (v) => {
    const u = use(v);
    if (typeof u === 'boolean') return u;
    if (typeof u === 'string') return ['1', 'on', 'true', 'yes', 't', 'y'].includes(u.toLowerCase());
    return isNumber(u) ? num(u) === 1 : false;
  },
  upper: (v) => pyStr(use(v)).toUpperCase(),
  lower: (v) => pyStr(use(v)).toLowerCase(),
  capitalize: (v) => { const s = pyStr(use(v)); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); },
  trim: (v) => pyStr(use(v)).trim(),
  length: (v) => {
    const u = use(v);
    if (typeof u === 'string' || Array.isArray(u)) return u.length;
    if (isMap(u)) return Object.keys(u).length;
    throw new JinjaError('type', `object of type '${typeName(u)}' has no len()`);
  },
  first: (v) => { const list = asList(v, 'first'); return list.length ? list[0] : new Undefined('No first item, sequence was empty.'); },
  last: (v) => { const list = asList(v, 'last'); return list.length ? list.at(-1) : new Undefined('No last item, sequence was empty.'); },
  list: (v) => [...asList(v, 'list')],
  join: (v, separator = '') => asList(v, 'join').map((item) => pyStr(use(item))).join(pyStr(separator)),
  unique: (v) => asList(v, 'unique').filter((item, i, all) => all.findIndex((other) => pyEquals(other, item)) === i),
  sort: (v) => [...asList(v, 'sort')].sort((a, b) => pyCompare(a, b, '<')),
  min: (v) => asList(v, 'min').reduce((a, b) => (pyCompare(b, a, '<') < 0 ? b : a)),
  max: (v) => asList(v, 'max').reduce((a, b) => (pyCompare(b, a, '>') > 0 ? b : a)),
  sum: (v) => asList(v, 'sum').reduce((a, b) => arithmetic('+', a, b), 0),
  abs: (v) => { const u = use(v); return isFloat(u) ? new Float(Math.abs(num(u))) : Math.abs(num(u)); },
  // Python's round() keeps an int an int: round(10, 2) is 10, not 10.0.
  round: (v, precision = 0) => { const u = use(v); return isFloat(u) ? new Float(pyRound(num(u), num(use(precision)))) : num(u); },
  replace: (v, from, to) => pyStr(use(v)).split(pyStr(use(from))).join(pyStr(use(to))),
  split: (v, separator) => METHODS.str.split(pyStr(use(v)), separator),
  dict2items: (v) => {
    const u = use(v);
    if (!isMap(u)) throw new JinjaError('type', `dict2items requires a dictionary, got ${typeName(u)} instead.`);
    return Object.entries(u).map(([key, value]) => ({ key, value }));
  },
  select: (v, test, ...args) => asList(v, 'select').filter((item) => (test === undefined ? truthy(item) : runTest(use(test), item, args))),
  reject: (v, test, ...args) => asList(v, 'reject').filter((item) => !(test === undefined ? truthy(item) : runTest(use(test), item, args))),
  selectattr: (v, attribute, test, ...args) => asList(v, 'selectattr').filter((item) => {
    const value = attrPath(item, attribute);
    return test === undefined ? truthy(value) : runTest(use(test), value, args);
  }),
  rejectattr: (v, attribute, test, ...args) => asList(v, 'rejectattr').filter((item) => {
    const value = attrPath(item, attribute);
    return !(test === undefined ? truthy(value) : runTest(use(test), value, args));
  }),
};
FILTERS.d = FILTERS.default;
FILTERS.count = FILTERS.length;

const truthyOrFalse = (v) => (v instanceof Undefined ? false : truthy(v));

function mapFilter(value, args, kwargs) {
  const list = asList(value, 'map');
  if (Object.hasOwn(kwargs, 'attribute')) {
    return list.map((item) => attrPath(item, kwargs.attribute));
  }
  if (args.length >= 1) return list.map((item) => applyFilter(use(args[0]), item, args.slice(1), {}));
  throw new JinjaError('syntax', 'map requires a filter name or attribute=');
}

function applyFilter(name, value, args, kwargs) {
  const short = name.replace(/^ansible\.builtin\./, '');
  if (short === 'map') return mapFilter(value, args, kwargs);
  if (!Object.hasOwn(FILTERS, short)) {
    throw new JinjaError('unsupported', `The "${name}" filter is valid Jinja2 or Ansible, but it is outside this trainer's scope.`);
  }
  if (short === 'default' || short === 'd') {
    return FILTERS.default(value, args[0] ?? kwargs.value ?? '', args[1] ?? kwargs.boolean ?? false);
  }
  return FILTERS[short](value, ...args);
}

// ---- Evaluation --------------------------------------------------------------------------

function arithmetic(op, left, right) {
  const a = use(left);
  const b = use(right);
  if (isNumber(a) && isNumber(b)) {
    const x = num(a);
    const y = num(b);
    const float = isFloat(a) || isFloat(b);
    const wrap = (n) => (float ? new Float(n) : n);
    switch (op) {
      case '+': return wrap(x + y);
      case '-': return wrap(x - y);
      case '*': return wrap(x * y);
      case '/':
        if (y === 0) throw new JinjaError('type', 'division by zero');
        return new Float(x / y);
      case '**': return float || y < 0 ? new Float(x ** y) : x ** y;
      case '//':
        if (y === 0) throw new JinjaError('type', 'integer division or modulo by zero');
        return wrap(Math.floor(x / y));
      default:
        if (y === 0) throw new JinjaError('type', 'integer division or modulo by zero');
        return wrap(x - Math.floor(x / y) * y);
    }
  }
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
  if (op === '+' && Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (op === '*' && typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
  if (op === '%' && typeof a === 'string') {
    throw new JinjaError('unsupported', "Python %-formatting is outside this trainer's scope. Join text with ~ or put the expression inside the string.");
  }
  if (op === '+' && typeof a === 'string') throw new JinjaError('type', `can only concatenate str (not "${typeName(b)}") to str`);
  throw new JinjaError('type', `unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`);
}

function evaluateNode(node, context) {
  const go = (child) => evaluateNode(child, context);
  switch (node.type) {
    case 'literal': return node.value;
    case 'list': return node.items.map((item) => use(go(item)));
    case 'dict': return Object.fromEntries(node.entries.map(([key, value]) => [pyStr(use(go(key))), use(go(value))]));
    case 'name':
      return Object.hasOwn(context, node.name) ? context[node.name] : new Undefined(`'${node.name}' is undefined`);
    case 'attr': return getAttr(go(node.target), node.name);
    case 'item': return getItem(go(node.target), go(node.index));
    case 'slice': {
      const target = use(go(node.target));
      if (!Array.isArray(target) && typeof target !== 'string') throw new JinjaError('type', `'${typeName(target)}' object is not subscriptable`);
      const bound = (child, fallback) => (child === null ? fallback : num(use(go(child))));
      return target.slice(bound(node.start, 0), bound(node.stop, target.length));
    }
    case 'call': {
      if (node.target.type !== 'attr') {
        throw new JinjaError('unsupported', "Function calls such as lookup() and range() are outside this trainer's scope.");
      }
      const owner = use(go(node.target.target));
      const kind = typeof owner === 'string' ? 'str' : isMap(owner) ? 'dict' : null;
      const method = kind && Object.hasOwn(METHODS[kind], node.target.name) ? METHODS[kind][node.target.name] : null;
      if (!method) {
        throw new JinjaError('unsupported', `The .${node.target.name}() method is outside this trainer's scope.`);
      }
      return method(owner, ...node.args.map((arg) => use(go(arg))));
    }
    case 'filter': {
      const kwargs = Object.fromEntries(Object.entries(node.kwargs).map(([key, child]) => [key, go(child)]));
      return applyFilter(node.name, go(node.target), node.args.map(go), kwargs);
    }
    case 'test': {
      const result = runTest(node.name, go(node.target), node.args.map(go));
      return node.negate ? !result : result;
    }
    case 'not': return !truthy(go(node.operand));
    case 'and': { const left = go(node.left); return truthy(left) ? go(node.right) : left; }
    case 'or': { const left = go(node.left); return truthy(left) ? left : go(node.right); }
    case 'if':
      if (truthy(go(node.test))) return go(node.value);
      if (node.otherwise) return go(node.otherwise);
      throw new JinjaError('unsupported', "An inline if without an else is outside this trainer's scope, because Ansible versions disagree on what it yields. Add an else.");
    case 'negate': { const v = use(go(node.operand)); return isFloat(v) ? new Float(-num(v)) : -num(v); }
    case 'math': return arithmetic(node.op, go(node.left), go(node.right));
    case 'concat': return pyStr(use(go(node.left))) + pyStr(use(go(node.right)));
    default: {
      let left = use(go(node.first));
      for (const { op, operand } of node.rest) {
        const right = use(go(operand));
        let holds;
        if (op === '==') holds = pyEquals(left, right);
        else if (op === '!=') holds = !pyEquals(left, right);
        else if (op === 'in') holds = contains(right, left);
        else if (op === 'not in') holds = !contains(right, left);
        else {
          const order = pyCompare(left, right, op);
          holds = op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0;
        }
        if (!holds) return false;
        left = right;
      }
      return true;
    }
  }
}

/** Evaluate one expression (no braces). May return an Undefined. Throws JinjaError. */
export function evaluate(expression, context) {
  return evaluateNode(new Parser(tokenize(String(expression))).parseAll(), context);
}

const EXPRESSION_RE = /\{\{([\s\S]*?)\}\}/g;

/**
 * Render a string that may contain {{ expressions }}, as ansible-core 2.14 does with its
 * default settings: the result is text, except that a template which is exactly one
 * expression keeps a list, dictionary, or boolean as that type. Numbers become text.
 */
export function render(template, context) {
  if (typeof template !== 'string') return template;
  if (/\{%/.test(template)) {
    throw new JinjaError('unsupported', "Jinja2 statements ({% ... %}) are outside this trainer's scope.");
  }
  if (/\{\{|\}\}/.test(template.replace(EXPRESSION_RE, ''))) {
    throw new JinjaError('syntax', "unexpected end of template: every {{ needs a matching }}");
  }
  const lone = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(template);
  if (lone && !lone[1].includes('{{')) {
    const value = use(evaluate(lone[1], context));
    if (Array.isArray(value) || isMap(value) || typeof value === 'boolean') return value;
    return value === null ? '' : pyStr(value);
  }
  return template.replace(EXPRESSION_RE, (_, expression) => {
    const value = use(evaluate(expression, context));
    return value === null ? '' : pyStr(value);
  });
}
