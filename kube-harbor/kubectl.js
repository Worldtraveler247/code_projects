// Kube Harbor — kubectl + a thin shell. Pure module (no DOM).
import { Cluster, KINDS, kindOf, age, clone, parseCpu, parseMem, b64, unb64, TICK } from './cluster.js';
import { dump, load, loadAll } from './yaml.js';
import { stdinFilter } from '../cold-case/shell.js';

const EPOCH = Date.UTC(2026, 10, 18, 9, 0, 0);
const iso = (t) => new Date(EPOCH + t * 1000).toISOString().replace('.000', '');
const rfc = (t) => new Date(EPOCH + t * 1000).toUTCString().replace('GMT', '+0000');

// ------------------------------------------------------------------ session
export function createSession(m) {
  const cluster = new Cluster({ seed: m.seed ?? 7, nodes: m.nodes || NODES, namespaces: ['harbor'], user: m.admin ? ADMIN : STUDENT, schedulerUp: m.schedulerUp, images: m.images, startAt: 0 });
  const files = new Map(Object.entries(m.files || {}).map(([k, v]) => [`/home/student/harbor/${k}`, v]));
  const sess = { m, cluster, files, cwd: '/home/student/harbor', history: [], cmds: 0, hints: 0, solved: false, flags: {}, editor: null, wrong: 0 };
  m.setup?.(cluster, sess);
  cluster.tick(m.warm ?? 0);
  if (m.after) m.after(cluster, sess);
  return sess;
}
export const NODES = [
  { name: 'control-plane', idx: 0, ip: '192.168.56.10', cpu: '2', memory: '3936Mi', role: 'control-plane' },
  { name: 'worker-1', idx: 1, ip: '192.168.56.11', cpu: '2', memory: '3936Mi' },
  { name: 'worker-2', idx: 2, ip: '192.168.56.12', cpu: '2', memory: '3936Mi' },
];
const STUDENT = { name: 'system:serviceaccount:harbor:student', ns: 'harbor', admin: false, groups: ['system:serviceaccounts', 'system:serviceaccounts:harbor', 'system:authenticated'] };
const ADMIN = { name: 'kubernetes-admin', ns: 'harbor', admin: true, groups: ['kubeadm:cluster-admins', 'system:authenticated'] };

// ------------------------------------------------------------------ tokenizer
function tokenize(seg, sess) {
  const out = []; let cur = ''; let has = false; let i = 0;
  const flush = () => { if (has) out.push(cur); cur = ''; has = false; };
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === "'") { const j = seg.indexOf("'", i + 1); if (j < 0) throw new Error("unexpected EOF while looking for matching `''"); cur += seg.slice(i + 1, j); has = true; i = j + 1; continue; }
    if (ch === '"') {
      i++; has = true;
      while (i < seg.length && seg[i] !== '"') { if (seg[i] === '\\' && '"\\$'.includes(seg[i + 1])) { cur += seg[i + 1]; i += 2; continue; } if (seg.startsWith('$(', i)) { const r = subst(seg, i, sess); cur += r.text; i = r.end; continue; } cur += seg[i++]; }
      if (seg[i] !== '"') throw new Error('unexpected EOF while looking for matching `"\'');
      i++; continue;
    }
    if (ch === '\\') { cur += seg[i + 1] ?? ''; has = true; i += 2; continue; }
    if (ch === ' ' || ch === '\t') { flush(); i++; continue; }
    if (seg.startsWith('$(', i)) { const r = subst(seg, i, sess); cur += r.text; has = true; i = r.end; continue; }
    cur += ch; has = true; i++;
  }
  flush();
  return out;
}
function subst(s, i, sess) {
  let depth = 0; let q = null; let j = i + 1;
  for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = null; continue; } if (c === "'" || c === '"') q = c; else if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
  const r = pipeline(sess, s.slice(i + 2, j), true);
  return { text: (r.out || '').replace(/\n+$/, ''), end: j + 1 };
}
function splitTop(line, sep) {
  const parts = []; let cur = ''; let q = null; let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(') depth++; if (c === ')') depth--;
    const hit = depth === 0 && sep.find((s) => line.startsWith(s, i) && !(s === '|' && line[i + 1] === '|'));
    if (hit) { parts.push(cur.trim()); cur = ''; i += hit.length - 1; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

// ------------------------------------------------------------------ top level
export function runLine(sess, raw) {
  const line = raw.trim();
  const res = { out: '', solved: false };
  if (!line) return res;
  sess.history.push(line);
  for (const part of splitTop(line, ['&&', ';'])) {
    if (!part) continue;
    const r = pipeline(sess, part, false);
    if (r.clear) res.clear = true;
    if (r.editor) { res.editor = r.editor; sess.editor = r.editor; }
    res.out += (r.err ? r.err.replace(/\n?$/, '\n') : '') + (r.out || '');
    if (r.feedback) res.feedback = r.feedback;
  }
  if (!sess.solved && checkGoal(sess)) { sess.solved = true; res.solved = true; }
  return res;
}
export function checkGoal(sess) {
  if (sess.m.type === 'answer') return !!sess.flags.answered;
  try { return !!sess.m.goal(sess.cluster, sess); } catch { return false; }
}

function pipeline(sess, text, nested) {
  let segs;
  try { segs = splitTop(text, ['|']); } catch (e) { return { err: `-bash: ${e.message}` }; }
  let input = null; const errs = []; let out = null;
  for (let i = 0; i < segs.length; i++) {
    let argv;
    try { argv = tokenize(segs[i], sess); } catch (e) { return { err: `-bash: ${e.message}` }; }
    argv = argv.filter((a, k) => !(a === '2>/dev/null' || a === '2>&1'));
    const r = i === 0 ? command(sess, argv, nested) : filterCmd(argv, input);
    if (r.clear || r.editor) return r;
    if (r.err) errs.push(r.err);
    input = r.out ?? '';
    out = r;
  }
  return { out: input ?? '', err: errs.join('\n'), feedback: out?.feedback };
}
function filterCmd(argv, input) {
  if (argv[0] === 'base64') {
    if (argv.includes('-d') || argv.includes('--decode')) { const d = unb64((input || '').trim()); return d || !(input || '').trim() ? { out: d } : { err: 'base64: invalid input' }; }
    return { out: b64(input || '') + '\n' };
  }
  if (argv[0] === 'jq') return { err: 'jq: not installed here — use  -o jsonpath=\'{.path}\'  instead' };
  return stdinFilter(argv, input);
}

// ------------------------------------------------------------------ commands
function command(sess, argv, nested) {
  const [name, ...args] = argv;
  if (!name) return { out: '' };
  if (name === 'k') return command(sess, ['kubectl', ...args], nested);
  switch (name) {
    case 'kubectl': {
      if (!nested) sess.cmds++;
      const r = kubectl(sess, args);
      if (!r.noTick && !nested) sess.cluster.tick(r.ticks ?? 1);
      return r;
    }
    case 'help': return { out: HELP };
    case 'clear': return { clear: true };
    case 'history': return { out: sess.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') + '\n' };
    case 'hint': return hint(sess);
    case 'objective': case 'mission': return { out: `${sess.m.objective}\n` };
    case 'answer': return answer(sess, args.join(' '));
    case 'sleep': case 'wait': { const s = Math.min(600, parseInt(args[0], 10) || 10); sess.cluster.tick(Math.ceil(s / TICK)); return { out: '' }; }
    case 'ls': return lsCmd(sess, args);
    case 'cat': { const out = []; for (const f of args) { const p = path(sess, f); if (!sess.files.has(p)) return { err: `cat: ${f}: No such file or directory` }; out.push(sess.files.get(p)); } return { out: out.join('') }; }
    case 'nano': case 'vi': case 'vim': case 'edit': {
      const f = args[0]; if (!f) return { err: `${name}: usage: ${name} FILE` };
      const p = path(sess, f);
      return { editor: { title: `${name} ${f}`, text: sess.files.get(p) ?? '', target: { type: 'file', path: p } } };
    }
    case 'pwd': return { out: sess.cwd + '\n' };
    case 'cd': return { out: '' };
    case 'echo': return { out: args.join(' ') + '\n' };
    case 'curl': return curl(sess, args);
    case 'crane': case 'skopeo': return registryTags(sess, args);
    case 'base64': return { err: 'base64: pipe text into it:  ... | base64 -d' };
    case 'ssh': return { err: `ssh: connect to host ${args.at(-1)} port 22: Connection refused (your access is kubectl only)` };
    case 'docker': case 'podman': case 'crictl': return { err: `-bash: ${name}: command not found (this is your laptop: talk to the cluster through kubectl)` };
    case 'minikube': case 'kind': return { err: `-bash: ${name}: this is a shared cluster; there is nothing local to start` };
  }
  return { err: `-bash: ${name}: command not found` };
}
function path(sess, f) { if (f.startsWith('/')) return f; if (f.startsWith('~/')) return '/home/student/' + f.slice(2); return `${sess.cwd}/${f.replace(/^\.\//, '')}`; }
function lsCmd(sess, args) {
  const names = [...sess.files.keys()].filter((k) => k.startsWith(sess.cwd + '/')).map((k) => k.slice(sess.cwd.length + 1)).sort();
  if (args.some((a) => a.startsWith('-l'))) return { out: `total ${names.length * 4}\n` + names.map((n) => `-rw-r--r-- 1 student student ${String(sess.files.get(`${sess.cwd}/${n}`).length).padStart(5)} Nov 18 08:55 ${n}`).join('\n') + '\n' };
  return { out: names.join('  ') + (names.length ? '\n' : '') };
}
export function saveEditor(sess, text) {
  const ed = sess.editor; sess.editor = null;
  if (!ed) return { out: '' };
  let out;
  if (ed.target.type === 'file') { sess.files.set(ed.target.path, text.endsWith('\n') ? text : text + '\n'); out = ''; }
  else {
    if (text.trim() === ed.text.trim()) return { out: 'Edit cancelled, no changes made.\n' };
    let obj;
    try { obj = load(text); } catch (e) { return { out: `error: ${e.message}\nA copy of your changes has been stored to "/tmp/kubectl-edit-${ed.target.name}.yaml"\nerror: Edit cancelled, no valid changes were saved.\n` }; }
    try {
      const prev = sess.cluster.get(ed.target.kind, ed.target.ns, ed.target.name);
      if (!prev) return { out: `Error from server (NotFound): ${KINDS[ed.target.kind].plural} "${ed.target.name}" not found\n` };
      if (obj.kind !== prev.kind || obj.metadata?.name !== prev.metadata.name) return { out: 'error: At least one of apiVersion, kind and name was changed\n' };
      const r = sess.cluster.applyObject(obj);
      out = r === 'unchanged' ? 'Edit cancelled, no changes made.\n' : `${ref(prev)} edited\n`;
    } catch (e) { out = `error: ${e.message.replace(/^error: /, '')}\n`; }
    sess.cmds++;
    sess.cluster.tick(1);
  }
  const res = { out };
  if (!sess.solved && checkGoal(sess)) { sess.solved = true; res.solved = true; }
  return res;
}

function hint(sess) {
  const hs = sess.m.hints;
  if (sess.hints >= hs.length) return { out: `No more hints. The full solution is on the "Show solution" button.\n` };
  const h = hs[sess.hints++];
  return { out: `💡 Hint ${sess.hints}/${hs.length}: ${h}\n` };
}
function answer(sess, text) {
  const m = sess.m;
  if (m.type !== 'answer') return { err: 'answer: this mission is solved by changing the cluster, not by answering. Type  objective  to see the goal.' };
  if (!text) return { err: 'usage: answer YOUR ANSWER' };
  const want = typeof m.answer === 'function' ? m.answer(sess.cluster) : m.answer;
  const ok = (want instanceof RegExp ? want : new RegExp(`^\\s*${String(want).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).test(text);
  if (ok) { sess.flags.answered = true; return { out: `✔ Correct.\n` }; }
  sess.wrong++;
  return { out: `✘ Not that. ${m.wrongHint || 'Look again at what the cluster is actually telling you.'}\n` };
}
function registryTags(sess, args) {
  const repo = args.find((a) => !['ls', 'list-tags'].includes(a) && !a.startsWith('-'))?.replace(/^docker:\/\//, '');
  if (!repo) return { err: 'usage: crane ls REPOSITORY' };
  const tags = Object.keys(sess.cluster.images).filter((k) => k.split(':')[0] === repo).map((k) => k.split(':')[1]);
  if (!tags.length) return { err: `Error: reading tags for ${repo}: GET https://index.docker.io/v2/${repo}/tags/list: NAME_UNKNOWN: repository name not known to registry` };
  return { out: tags.join('\n') + '\n' };
}

// ------------------------------------------------------------------ curl (from your laptop)
function curl(sess, args) {
  const c = sess.cluster;
  const url = args.find((a) => /^https?:\/\//.test(a) || /^[\w.-]+(:\d+)?(\/|$)/.test(a) && !a.startsWith('-'));
  if (!url) return { err: "curl: try 'curl --help' for more information" };
  const m = url.match(/^(?:https?:\/\/)?([\w.-]+)(?::(\d+))?(\/.*)?$/);
  const host = m[1]; const port = Number(m[2] || 80); const p = m[3] || '/';
  const head = args.includes('-I') || args.includes('-i');
  const fmt = (r) => (r.refused ? { err: `curl: (7) Failed to connect to ${host} port ${port} after 2 ms: Couldn't connect to server` } : { out: (head ? `HTTP/1.1 ${r.status} ${r.status === 200 ? 'OK' : r.status === 404 ? 'Not Found' : 'Service Unavailable'}\n\n` : '') + r.body + '\n' });
  const node = c.list('Node').find((n) => n.status.addresses[0].address === host || n.metadata.name === host);
  if (host === 'harbor.local') return fmt(ingressRoute(c, p, sess));
  if (node) {
    if (!node.status.ready) return { err: `curl: (28) Failed to connect to ${host} port ${port} after 10001 ms: Timeout was reached` };
    if (port === 80 && c.list('Ingress').length) return fmt(ingressRoute(c, p, sess));
    const svc = c.list('Service').find((s) => s.spec.ports?.some((x) => x.nodePort === port));
    if (!svc) return { err: `curl: (7) Failed to connect to ${host} port ${port} after 1 ms: Couldn't connect to server` };
    const r = c.httpToService(svc, p);
    if (!r.refused && r.status === 200) sess.flags.curledNodePort = svc.metadata.name;
    return fmt(r);
  }
  if (/^10\.96\./.test(host) || c.list('Service').some((s) => s.metadata.name === host)) return { err: `curl: (${/^10\./.test(host) ? '28) Failed to connect to ' + host + ' port ' + port + ' after 10002 ms: Timeout was reached' : '6) Could not resolve host: ' + host}\n(hint: ClusterIPs and service names only exist inside the cluster — try  kubectl exec deploy/web -- curl ...)` };
  return { err: `curl: (6) Could not resolve host: ${host}` };
}
function ingressRoute(c, p, sess) {
  const ing = c.list('Ingress')[0];
  if (!ing) return { status: 404, body: '404 page not found' };
  const paths = (ing.spec.rules?.[0]?.http?.paths || []).filter((x) => p.startsWith(x.path)).sort((a, b) => b.path.length - a.path.length);
  const hit = paths[0];
  if (!hit) return { status: 404, body: '404 page not found' };
  const svc = c.get('Service', ing.metadata.namespace, hit.backend.service.name);
  if (!svc) return { status: 404, body: '404 page not found' }; // Traefik drops routes whose Service is missing
  const r = c.httpToService(svc, p);
  if (r.refused) return { status: 503, body: 'no available server' };
  if (r.status === 200 && p.startsWith('/api')) sess.flags.curledIngressApi = true;
  return r;
}

// ------------------------------------------------------------------ kubectl
const KUBE_HELP = `kubectl controls the Kubernetes cluster manager.

 Basic: create  expose  run  set  get  edit  delete
 Deploy: rollout  scale
 Cluster: cordon  uncordon  drain  top
 Troubleshoot: describe  logs  exec  auth  events
 Advanced: apply  patch
 Settings: label

Usage:
  kubectl [flags] [options]
`;
function parseFlags(args) {
  const pos = []; const f = {};
  const takes = new Set(['-n', '--namespace', '-o', '--output', '-l', '--selector', '-f', '--filename', '-c', '--container', '-p', '--patch', '--type', '--replicas', '--image', '--port', '--target-port', '--name', '--to-revision', '--timeout', '--tail', '--from-literal', '--limits', '--requests', '--from', '--keys', '--sort-by', '--field-selector']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { f['--'] = args.slice(i + 1); break; }
    if (a.startsWith('--') && a.includes('=')) { const [k, ...v] = a.split('='); push(f, k, v.join('=')); continue; }
    if (a === '-p' && (args[i + 1] === undefined || args[i + 1].startsWith('-') || !/^[{\[]/.test(args[i + 1]) && args[0] === 'logs')) { f['-p'] = true; continue; }
    if (takes.has(a)) { push(f, a, args[++i]); continue; }
    if (/^-[nolfcp]\S+$/.test(a) && !['-it', '-ti', '-lf'].includes(a)) { push(f, a.slice(0, 2), a.slice(2).replace(/^=/, '')); continue; }
    if (a.startsWith('-')) { f[a] = true; continue; }
    pos.push(a);
  }
  const alias = { '--namespace': '-n', '--output': '-o', '--selector': '-l', '--filename': '-f', '--container': '-c', '--patch': '-p' };
  for (const [k, v] of Object.entries(alias)) if (f[k] !== undefined) f[v] = f[k];
  return { pos, f };
}
function push(f, k, v) { if (k === '--from-literal' || k === '-f') { (f[k] ||= []).push(v); } else f[k] = v; }
const ref = (o) => `${KINDS[o.kind].short.at(-1) === 'namespace' ? 'namespace' : o.kind.toLowerCase()}${KINDS[o.kind].group ? '.' + KINDS[o.kind].group : ''}/${o.metadata.name}`;

function resolveTargets(c, words) {
  // "pods", "pod x", "pod/x", "deploy/x pod/y", "pods x y"
  if (!words.length) return { err: 'You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.' };
  if (words[0].includes('/')) return { items: words.map((w) => { const [t, n] = w.split('/'); return { kind: kindOf(t), type: t, name: n }; }) };
  const kinds = words[0].split(',').map((t) => ({ t, k: t === 'all' ? 'all' : kindOf(t) }));
  const bad = kinds.find((x) => !x.k);
  if (bad) return { err: `error: the server doesn't have a resource type "${bad.t}"` };
  return { kinds: kinds.map((x) => x.k), names: words.slice(1) };
}

function kubectl(sess, args) {
  const c = sess.cluster;
  const { pos, f } = parseFlags(args);
  const verb = pos[0];
  const ns = f['-A'] || f['--all-namespaces'] ? null : (f['-n'] || c.user.ns);
  if (!verb) return { out: KUBE_HELP, noTick: true };
  if (f['--help'] || f['-h']) return { out: `See  man kubectl-${verb}  in a real shell. Here: type  help  for what this simulator supports.\n`, noTick: true };
  try {
    switch (verb) {
      case 'get': return get(sess, pos.slice(1), f, ns);
      case 'describe': return describe(sess, pos.slice(1), f, ns);
      case 'logs': case 'log': return logs(sess, pos.slice(1), f, ns);
      case 'apply': case 'create': return applyCreate(sess, verb, pos.slice(1), f, ns);
      case 'delete': return del(sess, pos.slice(1), f, ns);
      case 'edit': return edit(sess, pos.slice(1), ns);
      case 'set': return setCmd(sess, pos.slice(1), f, ns);
      case 'scale': return scale(sess, pos.slice(1), f, ns);
      case 'rollout': return rollout(sess, pos.slice(1), f, ns);
      case 'expose': return expose(sess, pos.slice(1), f, ns);
      case 'patch': return patch(sess, pos.slice(1), f, ns);
      case 'label': return label(sess, pos.slice(1), f, ns);
      case 'exec': return exec(sess, pos.slice(1), f, ns);
      case 'auth': return auth(sess, pos.slice(1), f, ns);
      case 'top': return top(sess, pos.slice(1), ns);
      case 'cordon': case 'uncordon': return cordon(sess, verb, pos[1]);
      case 'drain': return drain(sess, pos[1], f);
      case 'events': return get(sess, ['events'], f, ns);
      case 'run': return run(sess, pos.slice(1), f, ns);
      case 'version': return { out: 'Client Version: v1.33.4\nKustomize Version: v5.6.0\nServer Version: v1.33.4\n', noTick: true };
      case 'cluster-info': return { out: 'Kubernetes control plane is running at https://192.168.56.10:6443\nCoreDNS is running at https://192.168.56.10:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n', noTick: true };
      case 'config': return { out: pos[1] === 'current-context' ? `${c.user.admin ? 'kubernetes-admin@harbor' : 'student@harbor'}\n` : pos[1] === 'view' ? `apiVersion: v1\nclusters:\n- cluster:\n    certificate-authority-data: DATA+OMITTED\n    server: https://192.168.56.10:6443\n  name: harbor\ncontexts:\n- context:\n    cluster: harbor\n    namespace: harbor\n    user: ${c.user.admin ? 'kubernetes-admin' : 'student'}\n  name: ${c.user.admin ? 'kubernetes-admin' : 'student'}@harbor\ncurrent-context: ${c.user.admin ? 'kubernetes-admin' : 'student'}@harbor\nkind: Config\nusers:\n- name: ${c.user.admin ? 'kubernetes-admin' : 'student'}\n  user:\n    token: REDACTED\n` : 'error: this simulator supports  config current-context  and  config view\n', noTick: true };
      case 'api-resources': return { out: 'NAME                     SHORTNAMES   APIVERSION                     NAMESPACED   KIND\n' + Object.entries(KINDS).map(([k, d]) => `${d.plural.padEnd(24)} ${(d.short[0] !== k.toLowerCase() ? d.short[0] : '').padEnd(12)} ${d.api.padEnd(30)} ${String(!d.cluster).padEnd(12)} ${k}`).join('\n') + '\n', noTick: true };
      case 'explain': return { out: `KIND:       ${pos[1] || '?'}\n(kubectl explain is not simulated — on a real cluster, kubectl explain deployment.spec.strategy prints the field docs)\n`, noTick: true };
      case 'port-forward': return { err: 'error: port-forward needs a real tunnel; here, use a NodePort or  kubectl exec ... -- curl' };
      default: return { err: `error: unknown command "${verb}" for "kubectl"\n\nDid you mean this?\n\t${['get', 'describe', 'logs', 'apply'].find((x) => x[0] === verb[0]) || 'get'}`, noTick: true };
    }
  } catch (e) { return { err: e.message }; }
}

// ----- get
function podStatus(c, p) {
  if (p.metadata.deletionTimestamp) return 'Terminating';
  const d = p.status._display || 'Pending';
  if (d === 'Pending' && p.spec.nodeName) return 'ContainerCreating';
  return d;
}
function restarts(c, p) {
  const rt = p._rt || {};
  if (!rt.restarts) return '0';
  return `${rt.restarts} (${age(c.t - rt.lastRestartAt)} ago)`;
}
const readyStr = (c, p) => `${c.isReady(p) ? 1 : 0}/1`;
function rows(c, kind, objs, wide, showNs) {
  const A = (o) => age(c.t - o.metadata.creationTimestamp);
  let head; let body;
  switch (kind) {
    case 'Pod': head = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', ...(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : [])]; body = objs.map((p) => [p.metadata.name, readyStr(c, p), podStatus(c, p), restarts(c, p), A(p), ...(wide ? [p.status.podIP || '<none>', p.spec.nodeName || '<none>', '<none>', '<none>'] : [])]); break;
    case 'Deployment': head = ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])]; body = objs.map((d) => [d.metadata.name, `${d.status.readyReplicas || 0}/${d.spec.replicas}`, d.status.updatedReplicas || 0, d.status.availableReplicas || 0, A(d), ...(wide ? [d.spec.template.spec.containers.map((x) => x.name).join(','), d.spec.template.spec.containers.map((x) => x.image).join(','), sel(d.spec.selector.matchLabels)] : [])]); break;
    case 'ReplicaSet': head = ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])]; body = objs.map((r) => [r.metadata.name, r.spec.replicas, r.status.replicas || 0, r.status.readyReplicas || 0, A(r), ...(wide ? [r.spec.template.spec.containers[0].name, r.spec.template.spec.containers[0].image, sel(r.spec.selector.matchLabels)] : [])]); break;
    case 'Service': head = ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])]; body = objs.map((s) => [s.metadata.name, s.spec.type, s.spec.clusterIP || 'None', s.spec.type === 'LoadBalancer' ? '<pending>' : '<none>', (s.spec.ports || []).map((p) => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol}`).join(','), A(s), ...(wide ? [s.spec.selector ? sel(s.spec.selector) : '<none>'] : [])]); break;
    case 'Endpoints': head = ['NAME', 'ENDPOINTS', 'AGE']; body = objs.map((e) => { const a = e.subsets?.[0]?.addresses || []; const port = e.subsets?.[0]?.ports?.[0]?.port; return [e.metadata.name, a.length ? a.slice(0, 3).map((x) => `${x.ip}:${port}`).join(',') + (a.length > 3 ? ` + ${a.length - 3} more...` : '') : '<none>', A(e)]; }); break;
    case 'ConfigMap': head = ['NAME', 'DATA', 'AGE']; body = objs.map((o) => [o.metadata.name, Object.keys(o.data || {}).length, A(o)]); break;
    case 'Secret': head = ['NAME', 'TYPE', 'DATA', 'AGE']; body = objs.map((o) => [o.metadata.name, o.type || 'Opaque', Object.keys(o.data || {}).length, A(o)]); break;
    case 'PersistentVolumeClaim': head = ['NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'AGE']; body = objs.map((o) => [o.metadata.name, o.status?.phase || 'Pending', o.spec.volumeName || '', o.status?.capacity?.storage || '', o.spec.volumeName ? 'RWO' : '', o.spec.storageClassName || 'local-path', '<unset>', A(o)]); break;
    case 'PersistentVolume': head = ['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'REASON', 'AGE']; body = objs.map((o) => [o.metadata.name, o.spec.capacity.storage, 'RWO', o.spec.persistentVolumeReclaimPolicy, o.status.phase, `${o.spec.claimRef.namespace}/${o.spec.claimRef.name}`, o.spec.storageClassName, '<unset>', '', A(o)]); break;
    case 'Node': head = ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'] : [])]; body = objs.map((n) => [n.metadata.name, `${n.status.ready ? 'Ready' : 'NotReady'}${n.spec.unschedulable ? ',SchedulingDisabled' : ''}`, n._role === 'control-plane' ? 'control-plane' : '<none>', A(n), n.status.nodeInfo.kubeletVersion, ...(wide ? [n.status.addresses[0].address, '<none>', n.status.nodeInfo.osImage, '6.8.0-79-generic', n.status.nodeInfo.containerRuntimeVersion] : [])]); break;
    case 'Ingress': head = ['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE']; body = objs.map((o) => [o.metadata.name, o.spec.ingressClassName || 'traefik', (o.spec.rules || []).map((r) => r.host).join(','), '192.168.56.11', '80', A(o)]); break;
    case 'Namespace': head = ['NAME', 'STATUS', 'AGE']; body = objs.map((o) => [o.metadata.name, 'Active', A(o)]); break;
    case 'PodDisruptionBudget': head = ['NAME', 'MIN AVAILABLE', 'MAX UNAVAILABLE', 'ALLOWED DISRUPTIONS', 'AGE']; body = objs.map((o) => [o.metadata.name, o.spec.minAvailable ?? 'N/A', o.spec.maxUnavailable ?? 'N/A', o.status?.disruptionsAllowed ?? 0, A(o)]); break;
    default: head = ['NAME', 'AGE']; body = objs.map((o) => [o.metadata.name, A(o)]);
  }
  if (showNs) { head = ['NAMESPACE', ...head]; body = body.map((r, i) => [objs[i].metadata.namespace, ...r]); }
  return { head, body };
}
const sel = (m) => Object.entries(m || {}).map(([k, v]) => `${k}=${v}`).join(',');
function table(head, body) {
  const all = [head, ...body].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map((r) => (r[i] || '').length)));
  return all.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(w[i] + 3))).join('').trimEnd()).join('\n') + '\n';
}
function labelSelector(s) { if (!s) return null; const m = {}; for (const part of s.split(',')) { const [k, v] = part.split('='); m[k.trim()] = (v ?? '').trim(); } return m; }
function filterObjs(objs, f) {
  const ls = labelSelector(f['-l']);
  let out = objs;
  if (ls) out = out.filter((o) => Object.entries(ls).every(([k, v]) => (o.metadata.labels || {})[k] === v));
  if (f['--field-selector']) { const [k, v] = f['--field-selector'].split('='); out = out.filter((o) => (k === 'status.phase' ? o.status?.phase : k === 'spec.nodeName' ? o.spec?.nodeName : o.metadata?.name) === v); }
  return out;
}
function listFor(c, kind, ns) {
  if (kind === 'Event') return [];
  return c.list(kind, ns === null ? undefined : ns).filter((o) => !(kind === 'Pod' && o._gone));
}
function checkRead(c, kind, ns, verb = 'list', name) {
  if (ns === null && !c.user.admin) return c.forbidden(verb, kind, undefined).replace(/in the namespace ""|at the cluster scope/, 'at the cluster scope');
  if (!c.can(verb, kind, ns)) return c.forbidden(verb, kind, ns, name);
  return null;
}
function get(sess, words, f, ns) {
  const c = sess.cluster;
  const t = resolveTargets(c, words);
  if (t.err) return { err: t.err, noTick: true };
  const wide = f['-o'] === 'wide';
  const showNs = ns === null;
  if (t.kinds?.length === 1 && t.kinds[0] === 'Event') return eventsTable(c, ns, f);
  const kinds = t.kinds?.[0] === 'all' ? ['Pod', 'Service', 'Deployment', 'ReplicaSet'] : t.kinds;
  let objs = [];
  if (t.items) {
    for (const it of t.items) {
      if (!it.kind) return { err: `error: the server doesn't have a resource type "${it.type}"` };
      const e = checkRead(c, it.kind, ns, 'get', it.name); if (e) return { err: e };
      const o = c.get(it.kind, ns, it.name);
      if (!o) return { err: `Error from server (NotFound): ${KINDS[it.kind].plural}${KINDS[it.kind].group ? '.' + KINDS[it.kind].group : ''} "${it.name}" not found` };
      objs.push(o);
    }
  } else {
    for (const k of kinds) { const e = checkRead(c, k, ns, t.names.length ? 'get' : 'list', t.names[0]); if (e) return { err: e }; }
    if (t.names.length) {
      for (const n of t.names) { const o = c.get(kinds[0], ns, n); if (!o) return { err: `Error from server (NotFound): ${KINDS[kinds[0]].plural}${KINDS[kinds[0]].group ? '.' + KINDS[kinds[0]].group : ''} "${n}" not found` }; objs.push(o); }
    } else objs = kinds.flatMap((k) => filterObjs(listFor(c, k, ns), f).sort((a, b) => (a.metadata.namespace || '').localeCompare(b.metadata.namespace || '') || a.metadata.name.localeCompare(b.metadata.name)));
  }
  const o = f['-o'];
  if (o === 'yaml' || o === 'json') { const docs = objs.map(clean); const one = docs.length === 1 && (t.items || t.names?.length); const v = one ? docs[0] : { apiVersion: 'v1', items: docs, kind: 'List' }; return { out: o === 'json' ? JSON.stringify(v, null, 4) + '\n' : dump(v) + '\n' }; }
  if (o === 'name') return { out: objs.map((x) => ref(x)).join('\n') + (objs.length ? '\n' : '') };
  if (o && o.startsWith('jsonpath')) { const expr = o.replace(/^jsonpath=?/, ''); const docs = objs.map(clean); const one = docs.length === 1 && (t.items || t.names?.length); return { out: jsonpath(one ? docs[0] : { items: docs }, expr) }; }
  if (o && !['wide'].includes(o)) return { err: `error: unable to match a printer suitable for the output format "${o}", allowed formats are: json,jsonpath,name,wide,yaml` };
  if (!objs.length) return { err: ns === null ? 'No resources found' : `No resources found in ${ns} namespace.` };
  if (f['-w'] || f['--watch']) return watch(sess, kinds?.[0] || objs[0].kind, ns, f, wide, showNs);
  let out = '';
  const byKind = [...new Set(objs.map((x) => x.kind))];
  for (const k of byKind) {
    const set = objs.filter((x) => x.kind === k);
    const { head, body } = rows(c, k, set, wide, showNs);
    if (byKind.length > 1 || t.kinds?.[0] === 'all') body.forEach((r, i) => { r[showNs ? 1 : 0] = `${ref(set[i]).replace(/\.apps\//, '.apps/')}`; });
    if (f['--show-labels']) { head.push('LABELS'); body.forEach((r, i) => r.push(sel(set[i].metadata.labels) || '<none>')); }
    out += (out ? '\n' : '') + table(head, body);
  }
  const warn = byKind.includes('Endpoints') ? 'Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice\n' : '';
  return { out: warn + out };
}
function watch(sess, kind, ns, f, wide, showNs) {
  const c = sess.cluster;
  const snap = () => new Map(filterObjs(listFor(c, kind, ns), f).map((o) => [o.metadata.name, rows(c, kind, [o], wide, showNs).body[0]]));
  let prev = snap();
  const { head, body } = rows(c, kind, filterObjs(listFor(c, kind, ns), f).sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)), wide, showNs);
  const lines = [head, ...body];
  for (let i = 0; i < 6; i++) {
    c.tick(1);
    const cur = snap();
    for (const [n, r] of cur) { const p = prev.get(n); if (!p || p.slice(1, -1).join() !== r.slice(1, -1).join()) lines.push(r); }
    prev = cur;
  }
  return { out: table(lines[0], lines.slice(1)) + '^C  (watch ended after 60 simulated seconds)\n', noTick: true };
}
function eventsTable(c, ns, f) {
  const e = checkRead(c, 'Event', ns); if (e) return { err: e };
  let evs = c.events.filter((x) => ns === null || x.ns === ns);
  if (f['--field-selector']) { const [, v] = f['--field-selector'].split('='); evs = evs.filter((x) => x.name === v || x.type === v); }
  if (!evs.length) return { err: `No resources found in ${ns} namespace.` };
  evs = [...evs].sort((a, b) => a.last - b.last);
  const body = evs.map((x) => [...(ns === null ? [x.ns] : []), age(c.t - x.last), x.type, x.reason, `${x.kind.toLowerCase()}/${x.name}`, x.message + (x.count > 1 ? ` (x${x.count})` : '')]);
  return { out: table([...(ns === null ? ['NAMESPACE'] : []), 'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], body) };
}
function clean(o) {
  const x = clone(o); delete x._rt; delete x._role; delete x._idx; delete x._node; delete x._progressStart;
  if (x.status) delete x.status._display;
  if (x.metadata) x.metadata.creationTimestamp = iso(o.metadata.creationTimestamp);
  if (x.metadata?.deletionTimestamp !== undefined) x.metadata.deletionTimestamp = iso(o.metadata.deletionTimestamp);
  if (x.kind === 'Pod' && x.status) x.status = { phase: x.status.phase, conditions: x.status.conditions, containerStatuses: x.status.containerStatuses, hostIP: x.status.hostIP, podIP: x.status.podIP };
  return { apiVersion: KINDS[x.kind].api, kind: x.kind, ...Object.fromEntries(Object.entries(x).filter(([k]) => !['apiVersion', 'kind'].includes(k))) };
}
export function jsonpath(obj, expr) {
  const parts = expr.match(/\{[^}]*\}|[^{]+/g) || [];
  return parts.map((p) => {
    if (!p.startsWith('{')) return p.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    const path = p.slice(1, -1).trim();
    if (path === '"\\n"' || path === "'\\n'") return '\n';
    const vals = walk([obj], path.replace(/^\$/, ''));
    return vals.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ');
  }).join('');
}
function walk(cur, path) {
  const toks = (path.replace(/\\\./g, '\u0000').match(/\.[^.[\]]+|\[[^\]]*\]/g) || []).map((t) => t.replace(/\u0000/g, '.'));
  for (const t of toks) {
    const next = [];
    for (const v of cur) {
      if (v === undefined || v === null) continue;
      if (t === '[*]') { if (Array.isArray(v)) next.push(...v); else if (typeof v === 'object') next.push(...Object.values(v)); continue; }
      const idx = t.match(/^\[(-?\d+)\]$/); if (idx) { next.push(v.at?.(Number(idx[1]))); continue; }
      const q = t.match(/^\[['"](.+)['"]\]$/); if (q) { next.push(v[q[1]]); continue; }
      const k = t.replace(/^\./, '');
      if (Array.isArray(v)) next.push(...v.map((x) => x?.[k])); else next.push(v[k]);
    }
    cur = next.filter((x) => x !== undefined);
  }
  return cur;
}

// ----- describe
function describe(sess, words, f, ns) {
  const c = sess.cluster;
  const t = resolveTargets(c, words);
  if (t.err) return { err: t.err, noTick: true };
  let objs = [];
  if (t.items) for (const it of t.items) { const e = checkRead(c, it.kind, ns, 'get', it.name); if (e) return { err: e }; const o = c.get(it.kind, ns, it.name); if (!o) return { err: `Error from server (NotFound): ${KINDS[it.kind].plural} "${it.name}" not found` }; objs.push(o); }
  else {
    const k = t.kinds[0]; const e = checkRead(c, k, ns, t.names.length ? 'get' : 'list', t.names[0]); if (e) return { err: e };
    if (t.names.length) { for (const n of t.names) { const o = c.get(k, ns, n) || c.list(k, ns).find((x) => x.metadata.name.startsWith(n)); if (!o) return { err: `Error from server (NotFound): ${KINDS[k].plural}${KINDS[k].group ? '.' + KINDS[k].group : ''} "${n}" not found` }; objs.push(o); } }
    else objs = filterObjs(c.list(k, ns === null ? undefined : ns), f);
  }
  if (!objs.length) return { err: `No resources found in ${ns} namespace.` };
  return { out: objs.map((o) => describeOne(c, o)).join('\n\n') + '\n' };
}
const kv = (k, v, w = 18) => `${(k + ':').padEnd(w)}${v}`;
function labelsBlock(name, m, w = 18) { const e = Object.entries(m || {}); if (!e.length) return kv(name, '<none>', w); return e.map(([k, v], i) => (i ? ' '.repeat(w) : (name + ':').padEnd(w)) + `${k}=${v}`).join('\n'); }
function eventsBlock(c, o) {
  const evs = c.eventsFor(o).sort((a, b) => a.first - b.first);
  if (!evs.length) return 'Events:            <none>';
  const ageStr = (e) => (e.count > 1 ? `${age(c.t - e.last)} (x${e.count} over ${age(c.t - e.first)})` : age(c.t - e.first));
  const rowsE = evs.map((e) => [e.type, e.reason, ageStr(e), e.source, e.message]);
  return 'Events:\n' + table(['  Type', 'Reason', 'Age', 'From', 'Message'], [['  ----', '------', '----', '----', '-------'], ...rowsE.map((r) => ['  ' + r[0], ...r.slice(1)])]).trimEnd();
}
function containerBlock(c, cs, status, p) {
  const out = [`  ${cs.name}:`];
  out.push(kv('    Image', cs.image, 20));
  if (cs.ports?.length) out.push(kv('    Port', `${cs.ports[0].containerPort}/TCP`, 20));
  if (status) {
    const st = status.state;
    if (st.running) out.push(kv('    State', 'Running', 20), kv('      Started', rfc(st.running.startedAt), 20));
    else out.push(kv('    State', 'Waiting', 20), kv('      Reason', st.waiting.reason, 20));
    if (status.lastState?.terminated) { const l = status.lastState.terminated; out.push(kv('    Last State', 'Terminated', 20), kv('      Reason', l.reason, 20), kv('      Exit Code', l.exitCode, 20), kv('      Started', rfc(l.startedAt), 20), kv('      Finished', rfc(l.finishedAt), 20)); }
    out.push(kv('    Ready', status.ready ? 'True' : 'False', 20), kv('    Restart Count', status.restartCount, 20));
  }
  const r = cs.resources || {};
  const kvBlock = (o) => { const w = Math.max(...Object.keys(o).map((k) => k.length)) + 3; return Object.entries(o).map(([k, v]) => `      ${(k + ':').padEnd(w)}${v}`); };
  if (r.limits) out.push('    Limits:', ...kvBlock(r.limits));
  if (r.requests) out.push('    Requests:', ...kvBlock(r.requests));
  const probe = (pr) => (pr.httpGet ? `http-get http://:${pr.httpGet.port}${pr.httpGet.path} delay=${pr.initialDelaySeconds || 0}s timeout=1s period=${pr.periodSeconds || 10}s #success=1 #failure=${pr.failureThreshold || 3}` : `tcp-socket :${pr.tcpSocket.port} delay=0s timeout=1s period=10s #success=1 #failure=3`);
  if (cs.livenessProbe) out.push(kv('    Liveness', probe(cs.livenessProbe), 20));
  if (cs.readinessProbe) out.push(kv('    Readiness', probe(cs.readinessProbe), 20));
  if (cs.envFrom?.length) out.push('    Environment Variables from:', ...cs.envFrom.map((e) => `      ${(e.configMapRef || e.secretRef).name}  ${e.configMapRef ? 'ConfigMap' : 'Secret'}  Optional: false`));
  const env = cs.env || [];
  out.push(env.length ? '    Environment:' : '    Environment:  <none>', ...env.map((e) => `      ${e.name}:  ${'value' in e ? e.value : e.valueFrom.secretKeyRef ? `<set to the key '${e.valueFrom.secretKeyRef.key}' in secret '${e.valueFrom.secretKeyRef.name}'>  Optional: false` : `<set to the key '${e.valueFrom.configMapKeyRef.key}' of config map '${e.valueFrom.configMapKeyRef.name}'>  Optional: false`}`));
  if (cs.volumeMounts?.length) out.push('    Mounts:', ...cs.volumeMounts.map((m) => `      ${m.mountPath} from ${m.name} (rw)`));
  return out.join('\n');
}
function qos(spec) {
  const cs = spec.containers;
  const r = cs.map((x) => x.resources || {});
  if (r.every((x) => !x.limits && !x.requests)) return 'BestEffort';
  if (r.every((x) => x.limits?.cpu && x.limits?.memory && (!x.requests || (x.requests.cpu === x.limits.cpu && x.requests.memory === x.limits.memory)))) return 'Guaranteed';
  return 'Burstable';
}
function describeOne(c, o) {
  const L = [kv('Name', o.metadata.name)];
  if (o.metadata.namespace) L.push(kv('Namespace', o.metadata.namespace));
  switch (o.kind) {
    case 'Pod': {
      const node = o.spec.nodeName ? c.get('Node', undefined, o.spec.nodeName) : null;
      L.push(kv('Priority', 0), kv('Service Account', o.spec.serviceAccountName || 'default'), kv('Node', node ? `${node.metadata.name}/${node.status.addresses[0].address}` : '<none>'));
      if (o.spec.nodeName) L.push(kv('Start Time', rfc(o.metadata.creationTimestamp)));
      L.push(labelsBlock('Labels', o.metadata.labels), kv('Annotations', '<none>'), kv('Status', o.metadata.deletionTimestamp ? 'Terminating' : o.status.phase), kv('IP', o.status.podIP || ''));
      const owner = o.metadata.ownerReferences?.[0]; L.push(kv('Controlled By', owner ? `${owner.kind}/${owner.name}` : '<none>'));
      L.push('Containers:', ...o.spec.containers.map((cs, i) => containerBlock(c, cs, o.status.containerStatuses?.[i], o)));
      L.push('Conditions:', '  Type              Status', ...(o.status.conditions || []).map((x) => `  ${x.type.padEnd(18)}${x.status}`));
      if (o.spec.volumes?.length) L.push('Volumes:', ...o.spec.volumes.map((v) => `  ${v.name}:\n    Type:       ${v.persistentVolumeClaim ? 'PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)' : 'EmptyDir (a temporary directory that shares a pod\'s lifetime)'}${v.persistentVolumeClaim ? `\n    ClaimName:  ${v.persistentVolumeClaim.claimName}\n    ReadOnly:   false` : ''}`));
      L.push(kv('QoS Class', qos(o.spec)), kv('Node-Selectors', o.spec.nodeSelector ? sel(o.spec.nodeSelector) : '<none>'), kv('Tolerations', 'node.kubernetes.io/not-ready:NoExecute op=Exists for 300s\n                  node.kubernetes.io/unreachable:NoExecute op=Exists for 300s'));
      break;
    }
    case 'Deployment': {
      const st = o.status;
      L.push(kv('CreationTimestamp', rfc(o.metadata.creationTimestamp), 23).replace(/^/, ''), labelsBlock('Labels', o.metadata.labels), kv('Annotations', `deployment.kubernetes.io/revision: ${Math.max(0, ...c.rsOf(o).map((r) => Number(r.metadata.annotations['deployment.kubernetes.io/revision'])))}`), kv('Selector', sel(o.spec.selector.matchLabels)), kv('Replicas', `${o.spec.replicas} desired | ${st.updatedReplicas || 0} updated | ${st.replicas || 0} total | ${st.availableReplicas || 0} available | ${st.unavailableReplicas || 0} unavailable`), kv('StrategyType', o.spec.strategy.type));
      if (o.spec.strategy.type === 'RollingUpdate') L.push(kv('RollingUpdateStrategy', `${o.spec.strategy.rollingUpdate?.maxUnavailable ?? '25%'} max unavailable, ${o.spec.strategy.rollingUpdate?.maxSurge ?? '25%'} max surge`));
      L.push('Pod Template:', labelsBlock('  Labels', o.spec.template.metadata.labels), '  Containers:', ...o.spec.template.spec.containers.map((cs) => containerBlock(c, cs, null).replace(/^/gm, '  ')));
      L.push('Conditions:', '  Type           Status  Reason', '  ----           ------  ------', ...(st.conditions || []).map((x) => `  ${x.type.padEnd(15)}${x.status.padEnd(8)}${x.reason}`));
      const rss = c.rsOf(o); const tplHash = rss.find((r) => r.metadata.labels['pod-template-hash'] && JSON.stringify(r.spec.template.spec) === JSON.stringify(o.spec.template.spec));
      const old = rss.filter((r) => r !== tplHash && r.spec.replicas > 0);
      L.push(kv('OldReplicaSets', old.length ? old.map((r) => `${r.metadata.name} (${r.status.replicas}/${r.spec.replicas} replicas created)`).join(', ') : '<none>'), kv('NewReplicaSet', tplHash ? `${tplHash.metadata.name} (${tplHash.status.replicas || 0}/${tplHash.spec.replicas} replicas created)` : '<none>'));
      break;
    }
    case 'Service': {
      const ep = c.get('Endpoints', o.metadata.namespace, o.metadata.name); const a = ep?.subsets?.[0]?.addresses || []; const port = ep?.subsets?.[0]?.ports?.[0]?.port;
      L.push(labelsBlock('Labels', o.metadata.labels, 24).replace(/^Labels:\s*/, 'Labels:'.padEnd(24)), kv('Selector', o.spec.selector ? sel(o.spec.selector) : '<none>', 24), kv('Type', o.spec.type, 24), kv('IP Family Policy', 'SingleStack', 24), kv('IP', o.spec.clusterIP, 24));
      if (o.spec.type === 'LoadBalancer') L.push(kv('LoadBalancer Ingress', '', 24));
      for (const p of o.spec.ports || []) { L.push(kv('Port', `${p.name || '<unset>'}  ${p.port}/${p.protocol}`, 24), kv('TargetPort', `${p.targetPort}/${p.protocol}`, 24)); if (p.nodePort) L.push(kv('NodePort', `${p.name || '<unset>'}  ${p.nodePort}/${p.protocol}`, 24)); L.push(kv('Endpoints', a.length ? a.map((x) => `${x.ip}:${port}`).join(',') : '', 24)); }
      L.push(kv('Session Affinity', 'None', 24));
      if (o.spec.type !== 'ClusterIP') L.push(kv('External Traffic Policy', 'Cluster', 24));
      break;
    }
    case 'Node': {
      const used = c.requestsOn(o.metadata.name);
      L.push(kv('Roles', o._role === 'control-plane' ? 'control-plane' : '<none>'), labelsBlock('Labels', o.metadata.labels), kv('Taints', (o.spec.taints || []).length || o.spec.unschedulable ? [...(o.spec.taints || []).map((t) => `${t.key}:${t.effect}`), ...(o.spec.unschedulable ? ['node.kubernetes.io/unschedulable:NoSchedule'] : []), ...(!o.status.ready ? ['node.kubernetes.io/unreachable:NoExecute'] : [])].join('\n                  ') : '<none>'), kv('Unschedulable', String(!!o.spec.unschedulable)),
        'Conditions:', `  Ready   ${o.status.ready ? 'True    KubeletReady              kubelet is posting ready status' : 'Unknown NodeStatusUnknown         Kubelet stopped posting node status.'}`, 'Addresses:', `  InternalIP:  ${o.status.addresses[0].address}`, `  Hostname:    ${o.metadata.name}`,
        'Allocatable:', `  cpu:     ${o.status.allocatable.cpu}`, `  memory:  ${o.status.allocatable.memory}`, `  pods:    110`,
        'Allocated resources:', '  Resource  Requests', '  --------  --------', `  cpu       ${used.cpu}m (${Math.round(used.cpu / parseCpu(o.status.allocatable.cpu) * 100)}%)`, `  memory    ${Math.round(used.mem)}Mi (${Math.round(used.mem / parseMem(o.status.allocatable.memory) * 100)}%)`);
      break;
    }
    case 'PersistentVolumeClaim':
      L.push(kv('StorageClass', o.spec.storageClassName || 'local-path'), kv('Status', o.status?.phase || 'Pending'), kv('Volume', o.spec.volumeName || ''), labelsBlock('Annotations', Object.fromEntries(Object.entries(o.metadata.annotations || {}).map(([k, v]) => [k, v]))).replace(/=/g, ': '), kv('Capacity', o.status?.capacity?.storage || ''), kv('Access Modes', o.spec.volumeName ? 'RWO' : ''), kv('VolumeMode', 'Filesystem'), kv('Used By', c.list('Pod', o.metadata.namespace).filter((p) => p.spec.volumes?.some((v) => v.persistentVolumeClaim?.claimName === o.metadata.name)).map((p) => p.metadata.name).join('\n                  ') || '<none>'));
      break;
    case 'Ingress': {
      L.push(kv('Ingress Class', o.spec.ingressClassName || 'traefik'), kv('Address', '192.168.56.11'), 'Rules:', '  Host         Path  Backends', '  ----         ----  --------');
      for (const r of o.spec.rules || []) for (const [i, p] of (r.http?.paths || []).entries()) {
        const svc = c.get('Service', o.metadata.namespace, p.backend.service.name);
        const eps = svc ? c.readyEndpoints(svc) : [];
        L.push(`  ${(i ? '' : r.host).padEnd(13)}${p.path.padEnd(6)}${p.backend.service.name}:${p.backend.service.port.number} (${svc ? (eps.length ? eps.map((e) => `${e.ip}:${c.get('Endpoints', o.metadata.namespace, svc.metadata.name).subsets[0].ports[0].port}`).join(',') : '') : `<error: services "${p.backend.service.name}" not found>`})`);
      }
      break;
    }
    case 'ReplicaSet': L.push(kv('Selector', sel(o.spec.selector.matchLabels)), labelsBlock('Labels', o.metadata.labels), kv('Controlled By', `Deployment/${o.metadata.ownerReferences[0].name}`), kv('Replicas', `${o.status.replicas || 0} current / ${o.spec.replicas} desired`), kv('Pods Status', `${o.status.readyReplicas || 0} Running / 0 Waiting / 0 Succeeded / 0 Failed`), 'Pod Template:', '  Containers:', ...o.spec.template.spec.containers.map((cs) => containerBlock(c, cs, null).replace(/^/gm, '  '))); break;
    case 'ConfigMap': L.push(labelsBlock('Labels', o.metadata.labels), '', 'Data', '====', ...Object.entries(o.data || {}).flatMap(([k, v]) => [`${k}:`, '----', String(v), ''])); break;
    case 'Secret': L.push(labelsBlock('Labels', o.metadata.labels), '', kv('Type', o.type || 'Opaque', 6), '', 'Data', '====', ...Object.entries(o.data || {}).map(([k, v]) => `${k}:  ${unb64(v).length} bytes`)); break;
    case 'PodDisruptionBudget': L.push(kv('Min available', o.spec.minAvailable ?? 'N/A'), kv('Selector', sel(o.spec.selector?.matchLabels)), 'Status:', `    Allowed disruptions:  ${o.status?.disruptionsAllowed ?? 0}`, `    Current:              ${o.status?.currentHealthy ?? 0}`, `    Desired:              ${o.status?.desiredHealthy ?? 0}`, `    Total:                ${o.status?.expectedPods ?? 0}`); break;
    default: break;
  }
  L.push(eventsBlock(c, o));
  return L.join('\n');
}

// ----- logs
const args0IsPrev = (w) => w.includes('-p');
function logs(sess, words, f, ns) {
  const c = sess.cluster;
  const target = words[0];
  if (!target) return { err: 'error: expected \'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]\'.\nPOD or TYPE/NAME is a required argument for the logs command', noTick: true };
  const e = checkRead(c, 'Pod', ns, 'get'); if (e) return { err: e.replace('cannot get resource "pods"', 'cannot get resource "pods/log"') };
  let pod;
  if (target.includes('/')) {
    const [t, n] = target.split('/'); const k = kindOf(t);
    if (k === 'Pod') pod = c.get('Pod', ns, n);
    else if (k === 'Deployment') { const d = c.get('Deployment', ns, n); if (!d) return { err: `error: error from server (NotFound): deployments.apps "${n}" not found in namespace "${ns}"` }; pod = c.list('Pod', ns).filter((p) => d && Object.entries(d.spec.selector.matchLabels).every(([k2, v]) => p.metadata.labels?.[k2] === v)).sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))[0]; if (pod && c.list('Pod', ns).filter((p) => Object.entries(d.spec.selector.matchLabels).every(([k2, v]) => p.metadata.labels?.[k2] === v)).length > 1) sess.flags.multi = true; }
    if (!pod) return { err: `error: error from server (NotFound): pods "${n}" not found` };
  } else if (f['-l']) { pod = filterObjs(c.list('Pod', ns), f)[0]; if (!pod) return { err: 'No resources found.' }; }
  else { pod = c.get('Pod', ns, target); if (!pod) return { err: `Error from server (NotFound): pods "${target}" not found` }; }
  const rt = pod._rt || {};
  const cname = pod.spec.containers[0].name;
  const st = podStatus(c, pod);
  if (f['-p'] === true || f['--previous'] || args0IsPrev(words)) {
    if (!rt.restarts) return { err: `Error from server (BadRequest): previous terminated container "${cname}" in pod "${pod.metadata.name}" not found` };
    return { out: rt.prev.join('\n') + '\n' };
  }
  if (['Pending', 'ContainerCreating', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError'].includes(st)) {
    const why = { Pending: 'ContainerCreating', ContainerCreating: 'ContainerCreating', ImagePullBackOff: 'trying and failing to pull image', ErrImagePull: 'trying and failing to pull image', CreateContainerConfigError: 'CreateContainerConfigError' }[st];
    return { err: `Error from server (BadRequest): container "${cname}" in pod "${pod.metadata.name}" is waiting to start: ${why}` };
  }
  let ls = rt.logs || [];
  if (f['--tail']) ls = ls.slice(-Number(f['--tail']));
  return { out: ls.length ? ls.join('\n') + '\n' : '' };
}

// ----- writes
function guardWrite(c, verb, kind, ns, name) { if (!c.can(verb, kind, ns)) throw new Error(c.forbidden(verb, kind, ns, name)); }
function applyCreate(sess, verb, words, f, ns) {
  const c = sess.cluster;
  if (verb === 'create' && words[0] && !f['-f']) {
    const [what, ...rest] = words;
    if (what === 'configmap' || what === 'cm' || (what === 'secret' && rest[0] === 'generic')) {
      const name = what === 'secret' ? rest[1] : rest[0];
      const lit = Object.fromEntries((f['--from-literal'] || []).map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
      const kind = what === 'secret' ? 'Secret' : 'ConfigMap';
      guardWrite(c, 'create', kind, ns, name);
      c.applyObject({ apiVersion: 'v1', kind, metadata: { name, namespace: ns }, ...(kind === 'Secret' ? { type: 'Opaque', data: Object.fromEntries(Object.entries(lit).map(([k, v]) => [k, b64(v)])) } : { data: lit }) }, { mode: 'create' });
      return { out: `${kind.toLowerCase()}/${name} created\n` };
    }
    if (what === 'deployment' || what === 'deploy') {
      const name = rest[0]; const image = f['--image'];
      if (!image) return { err: 'error: required flag(s) "image" not set' };
      guardWrite(c, 'create', 'Deployment', ns, name);
      c.applyObject({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: ns, labels: { app: name } }, spec: { replicas: Number(f['--replicas'] || 1), selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name: image.split('/').pop().split(':')[0], image }] } } } }, { mode: 'create' });
      return { out: `deployment.apps/${name} created\n` };
    }
    if (what === 'namespace' || what === 'ns') { guardWrite(c, 'create', 'Namespace', undefined, rest[0]); return { out: `namespace/${rest[0]} created\n` }; }
    return { err: `error: this simulator supports  create configmap|secret generic|deployment  and  create -f FILE` };
  }
  const files = f['-f'] || [];
  if (!files.length) return { err: 'error: must specify one of -f and -k', noTick: true };
  const out = [];
  for (const fn of files) {
    const p = path(sess, fn);
    const text = sess.files.get(p);
    if (text === undefined) return { err: `error: the path "${fn}" does not exist` };
    let docs;
    try { docs = loadAll(text); } catch (e) { return { err: `error: error parsing ${fn}: ${e.message}` }; }
    for (const d of docs) {
      if (!d?.kind) return { err: `error: error validating "${fn}": error validating data: kind not set` };
      const kind = d.kind;
      guardWrite(c, verb === 'apply' ? 'patch' : 'create', kind, d.metadata?.namespace || ns, d.metadata?.name);
      if (d.metadata) d.metadata.namespace ||= KINDS[kind]?.cluster ? undefined : ns;
      const r = c.applyObject(d, { mode: verb });
      out.push(`${ref({ kind, metadata: d.metadata })} ${r}`);
    }
  }
  return { out: out.join('\n') + '\n' };
}
function del(sess, words, f, ns) {
  const c = sess.cluster;
  const out = [];
  let targets = [];
  if (f['-f']) { for (const fn of f['-f']) { const text = sess.files.get(path(sess, fn)); if (text === undefined) return { err: `error: the path "${fn}" does not exist` }; targets.push(...loadAll(text).map((d) => ({ kind: d.kind, name: d.metadata.name }))); } }
  else {
    const t = resolveTargets(c, words);
    if (t.err) return { err: t.err.replace('to get', 'to delete') };
    if (t.items) targets = t.items.map((x) => ({ kind: x.kind, name: x.name }));
    else if (t.names.length) targets = t.names.map((n) => ({ kind: t.kinds[0], name: n }));
    else if (f['-l'] || f['--all']) targets = filterObjs(c.list(t.kinds[0], ns), f).map((o) => ({ kind: o.kind, name: o.metadata.name }));
    else return { err: 'error: resource(s) were provided, but no name was specified' };
  }
  if (!targets.length) return { err: 'No resources found' };
  for (const t of targets) {
    guardWrite(c, 'delete', t.kind, ns, t.name);
    const o = c.get(t.kind, ns, t.name);
    if (!o) { out.push(`Error from server (NotFound): ${KINDS[t.kind].plural} "${t.name}" not found`); continue; }
    if (t.kind === 'Secret' && o.type === 'kubernetes.io/service-account-token') return { err: 'refusing: that Secret holds your own kubeconfig token' };
    c.deleteObject(t.kind, ns, t.name);
    out.push(`${t.kind.toLowerCase()} "${t.name}" deleted from ${ns} namespace`);
  }
  return { out: out.join('\n') + '\n' };
}
function edit(sess, words, ns) {
  const c = sess.cluster;
  const t = resolveTargets(c, words);
  if (t.err) return { err: t.err };
  const kind = t.items ? t.items[0].kind : t.kinds[0]; const name = t.items ? t.items[0].name : t.names[0];
  if (!name) return { err: 'error: edit requires a resource name' };
  guardWrite(c, 'update', kind, ns, name);
  const o = c.get(kind, ns, name);
  if (!o) return { err: `Error from server (NotFound): ${KINDS[kind].plural} "${name}" not found` };
  const view = clean(o); delete view.status; delete view.metadata.uid; delete view.metadata.generation; delete view.metadata.creationTimestamp; delete view.metadata.ownerReferences;
  const text = `# Please edit the object below. Lines beginning with a '#' will be ignored,\n# and an empty file will abort the edit. If an error occurs while saving this file will be\n# reopened with the relevant failures.\n#\n${dump(view)}\n`;
  return { editor: { title: `kubectl edit ${kind.toLowerCase()}/${name}`, text, target: { type: 'object', kind, ns, name } }, noTick: true };
}
function deployArg(c, words, ns) {
  let [a, b] = words;
  let name;
  if (a?.includes('/')) { const [t, n] = a.split('/'); if (kindOf(t) !== 'Deployment') throw new Error(`error: this simulator supports deployments here, not "${t}"`); name = n; }
  else if (kindOf(a || '') === 'Deployment') name = b;
  else throw new Error('error: you must specify a deployment, e.g.  deployment/api');
  const d = c.get('Deployment', ns, name);
  if (!d) throw new Error(`Error from server (NotFound): deployments.apps "${name}" not found`);
  guardWrite(c, 'patch', 'Deployment', ns, name);
  return d;
}
function mutateTemplate(c, d, fn) { const next = clone(d); fn(next.spec.template.spec); c.applyObject({ ...next, status: undefined }); }
function setCmd(sess, words, f, ns) {
  const c = sess.cluster;
  const sub = words[0];
  const rest = words.slice(1);
  const d = deployArg(c, rest, ns);
  const extra = rest.filter((x) => x.includes('='));
  const tplBefore = JSON.stringify(d.spec.template);
  if (sub === 'image') {
    if (!extra.length) return { err: 'error: at least one image update is required' };
    const before = JSON.stringify(d.spec.template);
    for (const kvp of extra) {
      const [cn, img] = kvp.split('=');
      const cont = d.spec.template.spec.containers.find((x) => x.name === cn || cn === '*');
      if (!cont) return { err: `error: unable to find container named "${cn}"` };
    }
    mutateTemplate(c, d, (spec) => { for (const kvp of extra) { const [cn, img] = kvp.split('='); for (const x of spec.containers) if (x.name === cn || cn === '*') x.image = img; } });
    if (JSON.stringify(c.get('Deployment', ns, d.metadata.name).spec.template) !== before) annotateCause(c, ns, d.metadata.name, `kubectl set image deployment/${d.metadata.name} ${extra.join(' ')}`);
  } else if (sub === 'env') {
    if (f['--from']) {
      const [k, n] = f['--from'].split('/'); const kind = kindOf(k); const src = c.get(kind, ns, n);
      if (!src) return { err: `error: failed to get ${kind === 'Secret' ? 'secret' : 'configmap'} "${n}"` };
      const keys = f['--keys'] ? f['--keys'].split(',') : Object.keys(src.data || {});
      mutateTemplate(c, d, (spec) => { const ct = spec.containers[0]; ct.env ||= []; for (const key of keys) { ct.env = ct.env.filter((e) => e.name !== key); ct.env.push({ name: key, valueFrom: { [kind === 'Secret' ? 'secretKeyRef' : 'configMapKeyRef']: { name: n, key } } }); } });
    } else {
      if (!extra.length && !rest.some((x) => x.endsWith('-'))) return { err: 'error: at least one environment variable must be provided' };
      mutateTemplate(c, d, (spec) => { const ct = spec.containers[0]; ct.env ||= []; for (const kvp of rest.slice(1)) { if (kvp.endsWith('-') && !kvp.includes('=')) { ct.env = ct.env.filter((e) => e.name !== kvp.slice(0, -1)); continue; } if (!kvp.includes('=')) continue; const i = kvp.indexOf('='); const k = kvp.slice(0, i); ct.env = ct.env.filter((e) => e.name !== k); ct.env.push({ name: k, value: kvp.slice(i + 1) }); } });
    }
  } else if (sub === 'resources') {
    const parse = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map((x) => x.split('=')));
    const lim = parse(f['--limits']); const req = parse(f['--requests']);
    for (const v of [...Object.values(lim), ...Object.values(req)]) if (Number.isNaN(parseMem(v)) && !/^\d+m?$/.test(v)) return { err: `error: quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$'` };
    mutateTemplate(c, d, (spec) => { const ct = f['-c'] ? spec.containers.find((x) => x.name === f['-c']) : spec.containers[0]; ct.resources ||= {}; if (Object.keys(lim).length) ct.resources.limits = { ...(ct.resources.limits || {}), ...lim }; if (Object.keys(req).length) ct.resources.requests = { ...(ct.resources.requests || {}), ...req }; });
  } else return { err: `error: this simulator supports  set image|env|resources` };
  const changed = JSON.stringify(c.get('Deployment', ns, d.metadata.name).spec.template) !== tplBefore;
  return { out: `deployment.apps/${d.metadata.name} ${changed ? (sub === 'image' ? 'image updated' : sub === 'env' ? 'env updated' : 'resource requirements updated') : 'unchanged'}\n`.replace('image updated', 'image updated').replace(/ (image|env|resource requirements) updated/, (m) => m) };
}
function annotateCause(c, ns, name, cause) { const d = c.get('Deployment', ns, name); d.metadata.annotations = { ...(d.metadata.annotations || {}), 'kubernetes.io/change-cause': cause }; d._cause = cause; }
function scale(sess, words, f, ns) {
  const c = sess.cluster; const n = Number(f['--replicas']);
  if (!Number.isInteger(n) || n < 0) return { err: 'error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0' };
  const d = deployArg(c, words, ns);
  d.spec.replicas = n; d.metadata.generation++;
  return { out: `deployment.apps/${d.metadata.name} scaled\n` };
}
function rollout(sess, words, f, ns) {
  const c = sess.cluster; const sub = words[0];
  const d = deployArg(c, words.slice(1), ns);
  const name = d.metadata.name;
  const rss = () => c.rsOf(d).sort((a, b) => Number(a.metadata.annotations['deployment.kubernetes.io/revision']) - Number(b.metadata.annotations['deployment.kubernetes.io/revision']));
  if (sub === 'history') {
    return { out: `deployment.apps/${name}\nREVISION  CHANGE-CAUSE\n` + rss().map((r) => `${r.metadata.annotations['deployment.kubernetes.io/revision'].padEnd(10)}${r.metadata.annotations['kubernetes.io/change-cause'] || '<none>'}`).join('\n') + '\n', noTick: true };
  }
  if (sub === 'undo') {
    const list = rss(); const curHash = c.rsOf(d).find((r) => JSON.stringify(r.spec.template.spec) === JSON.stringify(d.spec.template.spec));
    const target = f['--to-revision'] ? list.find((r) => r.metadata.annotations['deployment.kubernetes.io/revision'] === String(f['--to-revision'])) : list.filter((r) => r !== curHash).at(-1);
    if (!target) return { err: `error: ${f['--to-revision'] ? `unable to find specified revision ${f['--to-revision']} in history` : 'no rollout history found for deployment "' + name + '"'}` };
    const tpl = clone(target.spec.template); delete tpl.metadata.labels['pod-template-hash'];
    c.applyObject({ ...clone(d), spec: { ...clone(d.spec), template: tpl }, status: undefined });
    return { out: `deployment.apps/${name} rolled back\n` };
  }
  if (sub === 'restart') { mutateTemplate(c, d, () => {}); const dd = c.get('Deployment', ns, name); dd.spec.template.metadata.annotations = { 'kubectl.kubernetes.io/restartedAt': iso(c.t) }; return { out: `deployment.apps/${name} restarted\n` }; }
  if (sub === 'status') {
    const lines = []; const limit = f['--timeout'] ? Math.ceil(parseInt(f['--timeout'], 10) / TICK) : 30;
    let last = '';
    for (let i = 0; i <= limit; i++) {
      const dd = c.get('Deployment', ns, name); const s = dd.status; const want = dd.spec.replicas;
      const oldPods = c.rsOf(dd).filter((r) => JSON.stringify(r.spec.template.spec) !== JSON.stringify(dd.spec.template.spec)).reduce((a, r) => a + (r.status.replicas || 0), 0);
      let msg;
      if ((s.updatedReplicas || 0) < want) msg = `Waiting for deployment "${name}" rollout to finish: ${s.updatedReplicas || 0} out of ${want} new replicas have been updated...`;
      else if (oldPods > 0) msg = `Waiting for deployment "${name}" rollout to finish: ${oldPods} old replicas are pending termination...`;
      else if ((s.availableReplicas || 0) < want) msg = `Waiting for deployment "${name}" rollout to finish: ${s.availableReplicas || 0} of ${want} updated replicas are available...`;
      else { lines.push(`deployment "${name}" successfully rolled out`); return { out: lines.join('\n') + '\n', noTick: true }; }
      if (msg !== last) lines.push(msg); last = msg;
      if (s.conditions?.find((x) => x.type === 'Progressing')?.status === 'False') return { out: lines.join('\n') + '\n', err: `error: deployment "${name}" exceeded its progress deadline`, noTick: true };
      if (i < limit) c.tick(1);
    }
    return { out: lines.join('\n') + '\n', err: 'error: timed out waiting for the condition', noTick: true };
  }
  return { err: 'error: this simulator supports  rollout status|history|undo|restart' };
}
function expose(sess, words, f, ns) {
  const c = sess.cluster;
  const d = deployArg(c, words, ns);
  const name = f['--name'] || d.metadata.name;
  guardWrite(c, 'create', 'Service', ns, name);
  const port = Number(f['--port'] || d.spec.template.spec.containers[0].ports?.[0]?.containerPort);
  if (!port) return { err: "error: couldn't find port via --port flag or introspection" };
  c.applyObject({ apiVersion: 'v1', kind: 'Service', metadata: { name, namespace: ns, labels: { ...d.metadata.labels } }, spec: { type: f['--type'] || 'ClusterIP', selector: { ...d.spec.selector.matchLabels }, ports: [{ port, targetPort: Number(f['--target-port'] || port), protocol: 'TCP' }] } }, { mode: 'create' });
  return { out: `service/${name} exposed\n` };
}
function smerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b) && b.every((x) => x && typeof x === 'object' && 'name' in x) && a.every((x) => x && typeof x === 'object' && 'name' in x)) {
    const out = clone(a);
    for (const it of b) { const i = out.findIndex((x) => x.name === it.name); if (i >= 0) out[i] = smerge(out[i], it); else out.push(clone(it)); }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = clone(a);
    for (const [k, v] of Object.entries(b)) { if (v === null) delete out[k]; else out[k] = k in out ? smerge(out[k], v) : clone(v); }
    return out;
  }
  return clone(b);
}
function patch(sess, words, f, ns) {
  const c = sess.cluster;
  const t = resolveTargets(c, words);
  if (t.err) return { err: t.err };
  const kind = t.items ? t.items[0].kind : t.kinds[0]; const name = t.items ? t.items[0].name : t.names[0];
  guardWrite(c, 'patch', kind, ns, name);
  const o = c.get(kind, ns, name);
  if (!o) return { err: `Error from server (NotFound): ${KINDS[kind].plural} "${name}" not found` };
  if (!f['-p']) return { err: 'error: must specify -p to patch' };
  let p;
  try { p = JSON.parse(f['-p']); } catch { try { p = load(f['-p']); } catch { return { err: `error: unable to parse "${f['-p']}": yaml: did not find expected node content` }; } }
  const merged = f['--type'] === 'merge' ? (() => { const m = (a, b) => { if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) { const o2 = clone(a); for (const [k, v] of Object.entries(b)) { if (v === null) delete o2[k]; else o2[k] = m(o2[k], v); } return o2; } return clone(b); }; return m(clean(o), p); })() : smerge(clean(o), p);
  const r = c.applyObject({ ...merged, status: undefined });
  return { out: `${ref(o)} ${r === 'unchanged' ? 'patched (no change)' : 'patched'}\n` };
}
function label(sess, words, f, ns) {
  const c = sess.cluster;
  const t = resolveTargets(c, words.filter((w) => !w.includes('=') && !w.endsWith('-')));
  if (t.err) return { err: t.err };
  const kind = t.items ? t.items[0].kind : t.kinds[0]; const name = t.items ? t.items[0].name : t.names[0];
  guardWrite(c, 'patch', kind, ns, name);
  const o = c.get(kind, ns, name);
  if (!o) return { err: `Error from server (NotFound): ${KINDS[kind].plural} "${name}" not found` };
  for (const w of words.filter((x) => x.includes('=') || (x.endsWith('-') && !x.includes('/')))) {
    if (w.endsWith('-') && !w.includes('=')) { delete o.metadata.labels[w.slice(0, -1)]; continue; }
    const [k, v] = w.split('=');
    if (o.metadata.labels?.[k] !== undefined && o.metadata.labels[k] !== v && !f['--overwrite']) return { err: `error: '${k}' already has a value (${o.metadata.labels[k]}), and --overwrite is false` };
    o.metadata.labels = { ...(o.metadata.labels || {}), [k]: v };
  }
  return { out: `${ref(o)} labeled\n` };
}
function exec(sess, words, f, ns) {
  const c = sess.cluster;
  const target = words[0];
  const cmd = f['--'] || words.slice(1);
  if (!target || !cmd.length) return { err: 'error: you must specify at least one command for the container' };
  guardWrite(c, 'create', 'Pod', ns, target);
  let pod;
  if (target.includes('/')) { const [t, n] = target.split('/'); const d = kindOf(t) === 'Deployment' ? c.get('Deployment', ns, n) : null; pod = kindOf(t) === 'Pod' ? c.get('Pod', ns, n) : d ? c.list('Pod', ns).filter((p) => Object.entries(d.spec.selector.matchLabels).every(([k, v]) => p.metadata.labels?.[k] === v) && c.isReady(p))[0] : null; }
  else pod = c.get('Pod', ns, target);
  if (!pod) return { err: `Error from server (NotFound): pods "${target.split('/').pop()}" not found` };
  if (podStatus(c, pod) !== 'Running') return { err: `error: unable to upgrade connection: container not found ("${pod.spec.containers[0].name}")` };
  const [prog, ...a] = cmd;
  const env = pod._rt.env || {};
  const dnsName = (h) => { const short = h.replace(/\.(svc\.cluster\.local|harbor(\.svc)?(\.cluster\.local)?)$/, '').replace(/\.harbor$/, ''); return c.get('Service', pod.metadata.namespace, short.split('.')[0]); };
  switch (prog) {
    case 'env': case 'printenv': return { out: [`HOSTNAME=${pod.metadata.name}`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'KUBERNETES_SERVICE_HOST=10.96.0.1', 'KUBERNETES_SERVICE_PORT=443'].join('\n') + '\n' };
    case 'hostname': return { out: pod.metadata.name + '\n' };
    case 'cat': if (a[0] === '/etc/resolv.conf') return { out: `search ${pod.metadata.namespace}.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n` }; return { err: `cat: can't open '${a[0]}': No such file or directory`, };
    case 'nslookup': case 'getent': case 'dig': {
      const h = a.filter((x) => x !== 'hosts')[0] || '';
      const svc = dnsName(h);
      if (!svc) return { out: `Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\n** server can't find ${h}.${pod.metadata.namespace}.svc.cluster.local: NXDOMAIN\n`, err: 'command terminated with exit code 1' };
      return { out: `Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\nName:\t${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local\nAddress: ${svc.spec.clusterIP}\n` };
    }
    case 'curl': case 'wget': {
      const url = a.find((x) => !x.startsWith('-'));
      if (!url) return { err: `${prog}: no URL specified` };
      const m = url.match(/^(?:https?:\/\/)?([\w.-]+)(?::(\d+))?(\/.*)?$/);
      const svc = dnsName(m[1]) || c.list('Service').find((s) => s.spec.clusterIP === m[1]);
      if (!svc) return { err: `${prog}: (6) Could not resolve host: ${m[1]}\ncommand terminated with exit code 6` };
      const port = Number(m[2] || 80);
      if (!svc.spec.ports.some((p) => p.port === port)) return { err: `${prog}: (28) Failed to connect to ${m[1]} port ${port} after 10003 ms: Timeout was reached\ncommand terminated with exit code 28` };
      const r = c.httpToService(svc, m[3] || '/');
      if (r.refused) return { err: `${prog}: (7) Failed to connect to ${m[1]} port ${port} after 1 ms: Couldn't connect to server\ncommand terminated with exit code 7` };
      return { out: r.body + '\n' };
    }
    case 'ls': case 'df': case 'ps': return { out: prog === 'ps' ? 'PID   USER     TIME  COMMAND\n    1 app       0:03 /app/server\n' : '' };
    case 'sh': case 'bash': return { err: 'Interactive shells are not simulated: run one command, e.g.  kubectl exec deploy/web -- nslookup api' };
    default: return { err: `error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec "4f1c": OCI runtime exec failed: exec failed: unable to start container process: exec: "${prog}": executable file not found in $PATH: unknown` };
  }
}
function auth(sess, words, f, ns) {
  const c = sess.cluster;
  if (words[0] === 'whoami') return { out: table(['ATTRIBUTE', 'VALUE'], [['Username', c.user.name], ...(c.user.admin ? [] : [['UID', '7c3e9a51-2d4b-4f0e-9b61-3f8a2c71d0e4']]), ['Groups', `[${c.user.groups.join(' ')}]`]]), noTick: true };
  if (words[0] === 'can-i') {
    if (f['--list']) {
      if (c.user.admin) return { out: 'Resources   Non-Resource URLs   Resource Names   Verbs\n*.*         []                  []               [*]\n            [*]                 []               [*]\n', noTick: true };
      return { out: table(['Resources', 'Non-Resource URLs', 'Resource Names', 'Verbs'], [['pods.*', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['pods/exec', '[]', '[]', '[create get]'], ['pods/log', '[]', '[]', '[get list watch]'], ['configmaps', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['secrets', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['services', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['deployments.apps', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['ingresses.networking.k8s.io', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['persistentvolumeclaims', '[]', '[]', '[create delete deletecollection patch update get list watch]'], ['endpoints', '[]', '[]', '[get list watch]'], ['selfsubjectreviews.authentication.k8s.io', '[]', '[]', '[create]']]), noTick: true };
    }
    const [, verb, res] = words;
    const k = kindOf((res || '').split('/')[0]);
    const ok = c.can(verb, k, f['-A'] ? null : (f['-n'] || c.user.ns));
    return { out: ok ? 'yes\n' : 'no\n', noTick: true };
  }
  return { err: 'error: this simulator supports  auth whoami  and  auth can-i VERB RESOURCE' };
}
function top(sess, words, ns) {
  const c = sess.cluster;
  if ((words[0] || '').startsWith('no')) { if (!c.user.admin) return { err: c.forbidden('list', 'Node', undefined).replace('nodes"', 'nodes" ').replace('resource "nodes" ', 'resource "nodes" ').replace('in API group ""', 'in API group "metrics.k8s.io"') }; return { out: table(['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'], c.list('Node').map((n) => { const u = c.list('Pod').filter((p) => p.spec.nodeName === n.metadata.name && podStatus(c, p) === 'Running').reduce((a, p) => ({ cpu: a.cpu + (c.images[p.spec.containers[0].image]?.cpu || 0), mem: a.mem + (c.images[p.spec.containers[0].image]?.mem || 0) }), { cpu: 180, mem: 900 }); return [n.metadata.name, `${u.cpu}m`, `${Math.round(u.cpu / 20)}%`, `${u.mem}Mi`, `${Math.round(u.mem / 39.36)}%`]; })) }; }
  const pods = c.list('Pod', ns).filter((p) => podStatus(c, p) === 'Running');
  if (!pods.length) return { err: `No resources found in ${ns} namespace.` };
  return { out: table(['NAME', 'CPU(cores)', 'MEMORY(bytes)'], pods.map((p) => { const img = c.images[p.spec.containers[0].image] || {}; return [p.metadata.name, `${img.cpu || 1}m`, `${img.mem || 1}Mi`]; })) };
}
function cordon(sess, verb, name) {
  const c = sess.cluster;
  if (!c.can('patch', 'Node')) return { err: c.forbidden('patch', 'Node', undefined, name).replace('patch resource', 'patch resource') };
  const n = c.get('Node', undefined, name); if (!n) return { err: `Error from server (NotFound): nodes "${name}" not found` };
  const want = verb === 'cordon'; const changed = !!n.spec.unschedulable !== want; n.spec.unschedulable = want;
  return { out: `node/${name} ${changed ? (want ? 'cordoned' : 'uncordoned') : 'already ' + (want ? 'cordoned' : 'uncordoned')}\n` };
}
function drain(sess, name, f) {
  const c = sess.cluster;
  if (!c.can('patch', 'Node')) return { err: c.forbidden('get', 'Node', undefined, name) };
  const n = c.get('Node', undefined, name); if (!n) return { err: `Error from server (NotFound): nodes "${name}" not found` };
  const out = [`node/${name} ${n.spec.unschedulable ? 'already cordoned' : 'cordoned'}`]; n.spec.unschedulable = true;
  const errs = [];
  for (let round = 0; round < 6; round++) {
    const pods = c.list('Pod').filter((p) => p.spec.nodeName === name && !p.metadata.deletionTimestamp && p.metadata.namespace !== 'kube-system');
    if (!pods.length) { out.push(`node/${name} drained`); return { out: out.join('\n') + '\n', noTick: true }; }
    for (const p of pods.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))) {
      c.pdbController();
      const pdb = c.list('PodDisruptionBudget', p.metadata.namespace).find((b) => Object.entries(b.spec.selector?.matchLabels || {}).every(([k, v]) => p.metadata.labels?.[k] === v));
      if (pdb && (pdb.status?.disruptionsAllowed ?? 0) <= 0) { const m = `error when evicting pods/"${p.metadata.name}" -n "${p.metadata.namespace}" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.`; out.push(m); errs.push(p.metadata.name); continue; }
      out.push(`evicting pod ${p.metadata.namespace}/${p.metadata.name}`);
      c.deleteObject('Pod', p.metadata.namespace, p.metadata.name); c.deletedPods--;
      out.push(`pod/${p.metadata.name} evicted`);
    }
    c.tick(1);
  }
  out.push(`There are pending pods in node "${name}" when an error occurred: [error when evicting pods/"${errs[0]}" -n "harbor": Cannot evict pod as it would violate the pod's disruption budget.]`);
  return { out: out.join('\n') + '\n', err: `error: unable to drain node "${name}" due to error: (simulated --timeout=60s) giving up; the node stays cordoned. Fix the budget, then drain again.`, noTick: true };
}
function run(sess, words, f, ns) {
  const c = sess.cluster; const name = words[0]; const image = f['--image'];
  if (!name || !image) return { err: 'error: NAME and --image are required' };
  guardWrite(c, 'create', 'Pod', ns, name);
  c.applyObject({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: ns, labels: { run: name } }, spec: { containers: [{ name, image }] }, status: { phase: 'Pending', conditions: [] } }, { mode: 'create' });
  return { out: `pod/${name} created\n` };
}

const HELP = `Kube Harbor — a simulated Kubernetes cluster (v1.33). Each kubectl command lets
10 simulated seconds pass while the controllers reconcile.

Game:   objective   hint   answer TEXT   help   clear   history   sleep 30
Files:  ls   cat FILE   nano FILE   (your manifests live in ~/harbor)
Laptop: curl URL   crane ls REPO   base64 -d (in a pipe)

kubectl get|describe|logs|exec|apply|create|delete|edit|patch|label|set image|env|resources
        scale|rollout status|history|undo|restart|expose|auth can-i|whoami|top|cordon|drain
Flags:  -n NS  -A  -o wide|yaml|json|name|jsonpath='{...}'  -l app=api  -w  --show-labels
Pipes:  | grep | head | tail | sort | wc -l | awk | base64 -d     $(...) works.
`;
export { HELP };
