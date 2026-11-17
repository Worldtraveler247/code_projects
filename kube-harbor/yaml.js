// Minimal YAML subset for Kubernetes manifests: block maps, block lists (incl. "- key: v"
// list-of-maps), scalars, quoted strings, literal blocks (|), flow {} [] and simple [a, b].
// Enough for `kubectl edit` / `-o yaml`; not a general YAML implementation.

const NUM = /^-?\d+(\.\d+)?$/;

export function dump(v, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return v.map((it) => {
      if (isObj(it) && Object.keys(it).length) {
        const body = dump(it, indent + 2).replace(/^\s+/, '');
        return `${pad}- ${body}`;
      }
      if (Array.isArray(it) && it.length) return `${pad}-\n${dump(it, indent + 2)}`;
      return `${pad}- ${scalar(it)}`;
    }).join('\n');
  }
  if (isObj(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return '{}';
    return keys.map((k) => {
      const x = v[k];
      if ((isObj(x) && Object.keys(x).length) || (Array.isArray(x) && x.length)) {
        return Array.isArray(x) ? `${pad}${key(k)}:\n${dump(x, indent)}` : `${pad}${key(k)}:\n${dump(x, indent + 2)}`;
      }
      if (typeof x === 'string' && x.includes('\n')) return `${pad}${key(k)}: |\n${x.replace(/\n$/, '').split('\n').map((l) => ' '.repeat(indent + 2) + l).join('\n')}`;
      return `${pad}${key(k)}: ${isObj(x) ? '{}' : Array.isArray(x) ? '[]' : scalar(x)}`;
    }).join('\n');
  }
  return pad + scalar(v);
}
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const key = (k) => (/^[\w./-]+$/.test(k) ? k : JSON.stringify(k));
function scalar(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  const s = String(x);
  if (s === '' || NUM.test(s) || /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: |\s#|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

export function load(text) {
  const raw = text.replace(/\t/g, '  ').split('\n');
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (/^\s*(#.*)?$/.test(l) || /^---\s*$/.test(l)) continue;
    lines.push({ ind: l.match(/^ */)[0].length, text: stripComment(l.trim()), n: i + 1, raw: l });
  }
  if (!lines.length) return null;
  const st = { lines, i: 0, raw };
  const v = block(st, lines[0].ind);
  if (st.i < lines.length) fail(lines[st.i], 'unexpected indentation');
  return v;
}
function stripComment(t) {
  let q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || t[i - 1] === ' ')) return t.slice(0, i).trimEnd();
  }
  return t;
}
function fail(line, msg) { throw new Error(`error converting YAML to JSON: yaml: line ${line.n}: ${msg}`); }
function block(st, ind) {
  const first = st.lines[st.i];
  if (!first) return null;
  return first.text.startsWith('- ') || first.text === '-' ? list(st, ind) : map(st, ind);
}
function splitKV(line) {
  let q = null;
  const t = line.text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === ':' && (i === t.length - 1 || t[i + 1] === ' ')) {
      let k = t.slice(0, i).trim();
      if (/^".*"$|^'.*'$/.test(k)) k = k.slice(1, -1);
      return [k, t.slice(i + 1).trim()];
    }
  }
  return null;
}
function map(st, ind) {
  const out = {};
  while (st.i < st.lines.length) {
    const line = st.lines[st.i];
    if (line.ind < ind) break;
    if (line.ind > ind) fail(line, 'mapping values are not allowed in this context');
    if (line.text.startsWith('- ')) break;
    const kv = splitKV(line);
    if (!kv) fail(line, `could not find expected ':'`);
    const [k, rest] = kv;
    st.i++;
    out[k] = value(st, rest, ind, line);
  }
  return out;
}
function value(st, rest, ind, line) {
  if (rest === '|' || rest === '|-' || rest === '>') {
    const parts = []; let base = null;
    while (st.i < st.lines.length && st.lines[st.i].ind > ind) { const l = st.lines[st.i++]; base ??= l.ind; parts.push(l.raw.slice(base)); }
    return parts.join(rest === '>' ? ' ' : '\n') + (rest === '|' ? '\n' : '');
  }
  if (rest !== '') return parseScalar(rest, line);
  const nx = st.lines[st.i];
  if (!nx || nx.ind < ind || (nx.ind === ind && !nx.text.startsWith('- '))) return null;
  if (nx.ind === ind && nx.text.startsWith('- ')) return list(st, ind);
  return block(st, nx.ind);
}
function list(st, ind) {
  const out = [];
  while (st.i < st.lines.length) {
    const line = st.lines[st.i];
    if (line.ind !== ind || !(line.text.startsWith('- ') || line.text === '-')) { if (line.ind > ind) fail(line, 'bad indentation of a sequence entry'); break; }
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    if (rest === '') { st.i++; out.push(block(st, st.lines[st.i]?.ind ?? ind + 2)); continue; }
    const kv = /^[\w"'./-][^:]*:( |$)/.test(rest) && !/^["'].*["']$/.test(rest) ? splitKV({ ...line, text: rest }) : null;
    if (kv) {
      // "- key: v" opens a map whose further keys sit at ind+2
      const sub = { ...line, ind: ind + 2, text: rest };
      st.lines[st.i] = sub;
      out.push(map(st, ind + 2));
    } else { st.i++; out.push(parseScalar(rest, line)); }
  }
  return out;
}
function parseScalar(s, line) {
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseScalar(x, line));
  if (s.startsWith('{') && s.endsWith('}')) {
    try { return JSON.parse(s.replace(/([{,]\s*)([\w./-]+)\s*:/g, '$1"$2":').replace(/:\s*([^",{}[\]\s][^,}]*)/g, (m, v) => `: ${NUM.test(v.trim()) || /^(true|false|null)$/.test(v.trim()) ? v.trim() : JSON.stringify(v.trim())}`)); } catch { fail(line, 'did not find expected node content'); }
  }
  if (s.startsWith('"')) { try { return JSON.parse(s); } catch { fail(line, 'found unknown escape character'); } }
  if (s.startsWith("'")) { if (!s.endsWith("'")) fail(line, 'found unexpected end of stream'); return s.slice(1, -1).replace(/''/g, "'"); }
  if (NUM.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  return s;
}

export function loadAll(text) {
  return text.split(/^---\s*$/m).map((d) => d.trim()).filter((d) => d && !/^(#.*\n?)*$/.test(d)).map(load);
}
