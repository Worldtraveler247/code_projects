// Kube Harbor — cluster model + control loops. Pure module (no DOM), tested under node:test.
// Declarative core: users change objects; controllers reconcile actual state toward them
// one tick (10 simulated seconds) at a time, exactly the loop real Kubernetes runs.

export const TICK = 10;
const HASH_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

// Container images the fake registry knows. Behaviour is what the kubelet "observes".
export const IMAGES = {
  'harbor/api:1.4.0': { port: 8080, mem: 90, cpu: 40, requires: ['DB_HOST'], paths: { '/healthz': 'ok', '/ready': 'ready', '/api/ships': '{"ships":[{"id":7,"name":"MV Kestrel","status":"berthed"},{"id":9,"name":"Ocean Lark","status":"inbound"}],"servedBy":"$POD","version":"1.4.0"}' }, logs: (e) => [`api 1.4.0 starting`, `db host: ${e.DB_HOST}`, 'listening on :8080'] },
  'harbor/api:2.0.0': { port: 8080, mem: 95, cpu: 40, requires: ['DB_HOST'], paths: { '/healthz': 'ok', '/ready': 'ready', '/api/ships': '{"ships":[{"id":7,"name":"MV Kestrel","status":"berthed","eta":null},{"id":9,"name":"Ocean Lark","status":"inbound","eta":"14:20"}],"servedBy":"$POD","version":"2.0.0"}' }, logs: (e) => ['api 2.0.0 starting', `db host: ${e.DB_HOST}`, 'feature: eta tracking enabled', 'listening on :8080'] },
  'harbor/api:2.1.0': { port: 8080, mem: 95, cpu: 40, requires: ['DB_HOST'], crash: ['api 2.1.0 starting', 'running migration 0042_add_berth_index', 'panic: migration 0042: column "berth_id" does not exist', 'goroutine 1 [running]:', 'main.main()', '\t/src/cmd/api/main.go:61 +0x1d4'], paths: {} },
  'harbor/web:1.4.0': { port: 80, mem: 90, apiCheck: true, cpu: 10, requires: [], paths: { '/': '<!doctype html><title>Harbor Watch</title><h1>Harbor Watch</h1><p>2 ships tracked</p>', '/health': 'ok' }, logs: () => ['nginx: configuration file /etc/nginx/nginx.conf test is successful', 'start worker processes'] },
  'harbor/worker:1.4.0': { port: null, mem: 60, cpu: 25, requires: ['DB_HOST', 'DB_PASSWORD'], paths: {}, logs: (e) => ['worker 1.4.0 starting', `connecting to ${e.DB_HOST}:5432 as harbor`, 'polling job queue every 5s', 'job 1182: refreshed AIS positions (2 ships)'] },
  'postgres:16.4': { port: 5432, mem: 150, cpu: 30, requires: ['POSTGRES_PASSWORD'], tcp: true, paths: {}, logs: () => ['PostgreSQL init process complete; ready for start up.', 'LOG:  database system is ready to accept connections'] },
  'busybox:1.36': { port: null, mem: 4, cpu: 1, requires: [], paths: {}, logs: () => [] },
  'registry.k8s.io/kube-scheduler:v1.33.4': { port: 10259, mem: 30, cpu: 10, requires: [], paths: {}, logs: () => [] },
};

// ------------------------------------------------------------------ helpers
export function parseCpu(v) { if (v === undefined || v === null || v === '') return 0; const s = String(v); return s.endsWith('m') ? parseInt(s, 10) : Math.round(parseFloat(s) * 1000); }
export function parseMem(v) {
  if (v === undefined || v === null || v === '') return 0;
  const m = String(v).match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|K|M|G)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return { Ki: n / 1024, Mi: n, Gi: n * 1024, K: n / 1048.576, M: n / 1.048576, G: n * 953.674, undefined: n / 1048576 }[m[2]];
}
export function age(sec) {
  if (sec < 120) return `${sec}s`;
  const m = Math.floor(sec / 60); const s = sec % 60;
  if (m < 10) return s ? `${m}m${s}s` : `${m}m`;
  if (m < 180) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function strHash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function hashName(str, len) { let h = strHash(str); let o = ''; for (let i = 0; i < len; i++) { o += HASH_ALPHABET[h % HASH_ALPHABET.length]; h = Math.floor(h / HASH_ALPHABET.length) || strHash(o + str); } return o; }
export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const matches = (sel, labels) => !!sel && Object.keys(sel).length > 0 && Object.entries(sel).every(([k, v]) => (labels || {})[k] === v);

export const KINDS = {
  Namespace: { plural: 'namespaces', short: ['ns', 'namespace'], cluster: true, api: 'v1' },
  Node: { plural: 'nodes', short: ['no', 'node'], cluster: true, api: 'v1' },
  Pod: { plural: 'pods', short: ['po', 'pod'], api: 'v1' },
  Deployment: { plural: 'deployments', short: ['deploy', 'deployment'], api: 'apps/v1', group: 'apps' },
  ReplicaSet: { plural: 'replicasets', short: ['rs', 'replicaset'], api: 'apps/v1', group: 'apps' },
  Service: { plural: 'services', short: ['svc', 'service'], api: 'v1' },
  Endpoints: { plural: 'endpoints', short: ['ep'], api: 'v1' },
  ConfigMap: { plural: 'configmaps', short: ['cm', 'configmap'], api: 'v1' },
  Secret: { plural: 'secrets', short: ['secret'], api: 'v1' },
  PersistentVolumeClaim: { plural: 'persistentvolumeclaims', short: ['pvc'], api: 'v1' },
  PersistentVolume: { plural: 'persistentvolumes', short: ['pv'], cluster: true, api: 'v1' },
  Ingress: { plural: 'ingresses', short: ['ing', 'ingress'], api: 'networking.k8s.io/v1', group: 'networking.k8s.io' },
  PodDisruptionBudget: { plural: 'poddisruptionbudgets', short: ['pdb'], api: 'policy/v1', group: 'policy' },
  Event: { plural: 'events', short: ['ev', 'event'], api: 'v1' },
  Role: { plural: 'roles', short: ['role'], api: 'rbac.authorization.k8s.io/v1', group: 'rbac.authorization.k8s.io' },
  RoleBinding: { plural: 'rolebindings', short: ['rolebinding'], api: 'rbac.authorization.k8s.io/v1', group: 'rbac.authorization.k8s.io' },
};
export function kindOf(word) {
  const w = word.toLowerCase();
  for (const [k, d] of Object.entries(KINDS)) if (w === k.toLowerCase() || w === d.plural || d.short.includes(w)) return k;
  return null;
}

// ------------------------------------------------------------------ cluster
export class Cluster {
  constructor(spec) {
    this.t = spec.startAt ?? 0;
    this.rand = rng(spec.seed ?? 42);
    this.store = new Map();
    this.events = [];
    this.images = { ...IMAGES, ...(spec.images || {}) };
    this.user = spec.user;
    this.schedulerUp = spec.schedulerUp !== false;
    this.ipSeq = new Map();
    this.svcSeq = 0;
    this.deletedPods = 0;
    for (const n of spec.nodes) {
      this.put({ apiVersion: 'v1', kind: 'Node', metadata: { name: n.name, labels: { 'kubernetes.io/hostname': n.name, ...(n.role === 'control-plane' ? { 'node-role.kubernetes.io/control-plane': '' } : {}) }, creationTimestamp: this.t - 86400 * 9 }, spec: { unschedulable: !!n.cordoned, taints: n.taints || (n.role === 'control-plane' ? [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] : []), podCIDR: `10.244.${n.idx}.0/24` }, status: { ready: n.ready !== false, addresses: [{ type: 'InternalIP', address: n.ip }], allocatable: { cpu: n.cpu, memory: n.memory, pods: '110' }, nodeInfo: { kubeletVersion: 'v1.33.4', osImage: 'Ubuntu 24.04.3 LTS', containerRuntimeVersion: 'containerd://2.0.5' } }, _role: n.role || 'worker', _idx: n.idx });
    }
    for (const ns of ['default', 'kube-system', ...(spec.namespaces || [])]) this.put({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns, creationTimestamp: this.t - 86400 * 9, labels: { 'kubernetes.io/metadata.name': ns } }, spec: {}, status: { phase: 'Active' } });
  }

  key(kind, ns, name) { return `${kind}/${KINDS[kind]?.cluster ? '' : ns}/${name}`; }
  get(kind, ns, name) { return this.store.get(this.key(kind, ns, name)); }
  list(kind, ns) { return [...this.store.values()].filter((o) => o.kind === kind && (ns === undefined || KINDS[kind].cluster || o.metadata.namespace === ns)); }
  put(o) { this.store.set(this.key(o.kind, o.metadata.namespace, o.metadata.name), o); return o; }
  remove(o) { this.store.delete(this.key(o.kind, o.metadata.namespace, o.metadata.name)); }
  uid() { return Array.from({ length: 4 }, () => Math.floor(this.rand() * 0xffff).toString(16).padStart(4, '0')).join('-'); }

  event(obj, type, reason, message, source = 'kubelet') {
    const k = `${obj.kind}/${obj.metadata.namespace}/${obj.metadata.name}/${reason}/${message}`;
    const ex = this.events.find((e) => e.key === k);
    if (ex) { ex.count++; ex.last = this.t; return; }
    this.events.push({ key: k, type, reason, message, kind: obj.kind, name: obj.metadata.name, ns: obj.metadata.namespace, first: this.t, last: this.t, count: 1, source });
  }
  eventsFor(obj) { return this.events.filter((e) => e.kind === obj.kind && e.name === obj.metadata.name && e.ns === obj.metadata.namespace); }

  // ---------------------------------------------------------------- writes
  applyObject(input, { mode = 'apply' } = {}) {
    const o = clone(input);
    const kind = o.kind;
    if (!KINDS[kind]) throw new Error(`error: resource mapping not found for name: "${o.metadata?.name}" namespace: "" from "manifest": no matches for kind "${kind}" in version "${o.apiVersion}"\nensure CRDs are installed first`);
    o.metadata ||= {};
    if (!o.metadata.name) throw new Error('error: error validating data: metadata.name: Required value');
    if (!KINDS[kind].cluster) o.metadata.namespace ||= this.user.ns;
    const prev = this.get(kind, o.metadata.namespace, o.metadata.name);
    if (mode === 'create' && prev) throw new Error(`Error from server (AlreadyExists): ${KINDS[kind].plural}${KINDS[kind].group ? '.' + KINDS[kind].group : ''} "${o.metadata.name}" already exists`);
    if (kind === 'Deployment') this.validateDeployment(o);
    if (prev) {
      const before = JSON.stringify({ s: prev.spec, l: prev.metadata.labels, d: prev.data, sd: prev.stringData });
      if (kind === 'Service') { o.spec.clusterIP = prev.spec.clusterIP; if (o.spec.type === 'NodePort' || o.spec.type === 'LoadBalancer') o.spec.ports?.forEach((p, i) => { p.nodePort ||= prev.spec.ports?.[i]?.nodePort; }); }
      const merged = { ...prev, metadata: { ...prev.metadata, labels: o.metadata.labels ?? prev.metadata.labels, annotations: { ...(prev.metadata.annotations || {}), ...(o.metadata.annotations || {}) } }, spec: o.spec ?? prev.spec, data: o.data ?? prev.data };
      if (kind === 'Secret' && o.stringData) merged.data = Object.fromEntries(Object.entries({ ...(o.data || {}), ...Object.fromEntries(Object.entries(o.stringData).map(([k, v]) => [k, b64(v)])) }));
      this.normalize(merged);
      const after = JSON.stringify({ s: merged.spec, l: merged.metadata.labels, d: merged.data, sd: undefined });
      if (before === after) return 'unchanged';
      if (kind === 'Deployment') merged.metadata.generation = (prev.metadata.generation || 1) + 1;
      if (kind === 'Pod' && JSON.stringify(prev.spec.containers.map((c) => ({ ...c, image: undefined }))) !== JSON.stringify(merged.spec.containers.map((c) => ({ ...c, image: undefined })))) {
        throw new Error(`The Pod "${o.metadata.name}" is invalid: spec: Forbidden: pod updates may not change fields other than \`spec.containers[*].image\`,\`spec.initContainers[*].image\`,\`spec.activeDeadlineSeconds\`,\`spec.tolerations\` (only additions to existing tolerations),\`spec.terminationGracePeriodSeconds\` (allow it to be set to 1 if it was previously negative)`);
      }
      this.put(merged);
      if (kind === 'Pod' && prev.spec.containers[0].image !== merged.spec.containers[0].image) { merged._rt = { stage: 'creating', restarts: (prev._rt?.restarts || 0) }; }
      return 'configured';
    }
    o.metadata.uid = this.uid();
    o.metadata.creationTimestamp = this.t;
    o.metadata.generation = 1;
    if (kind === 'Secret' && o.stringData) { o.data = { ...(o.data || {}), ...Object.fromEntries(Object.entries(o.stringData).map(([k, v]) => [k, b64(v)])) }; delete o.stringData; }
    this.normalize(o);
    if (kind === 'Service') this.allocService(o);
    o.status ||= {};
    this.put(o);
    return 'created';
  }
  validateDeployment(o) {
    const sel = o.spec?.selector?.matchLabels; const tl = o.spec?.template?.metadata?.labels;
    if (!sel) throw new Error(`The Deployment "${o.metadata.name}" is invalid: spec.selector: Required value`);
    if (!matches(sel, tl)) throw new Error(`The Deployment "${o.metadata.name}" is invalid: spec.template.metadata.labels: Invalid value: map[string]string{${Object.entries(tl || {}).map(([k, v]) => `"${k}":"${v}"`).join(', ')}}: \`selector\` does not match template \`labels\``);
    const prev = this.get('Deployment', o.metadata.namespace || this.user.ns, o.metadata.name);
    if (prev && JSON.stringify(prev.spec.selector) !== JSON.stringify(o.spec.selector)) throw new Error(`The Deployment "${o.metadata.name}" is invalid: spec.selector: Invalid value: v1.LabelSelector{MatchLabels:map[string]string{${Object.entries(sel).map(([k, v]) => `"${k}":"${v}"`).join(', ')}}}: field is immutable`);
  }
  normalize(o) {
    if (o.kind === 'Deployment') {
      o.spec.replicas ??= 1;
      o.spec.strategy ||= { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } };
      o.spec.revisionHistoryLimit ??= 10;
      for (const c of o.spec.template.spec.containers) c.imagePullPolicy ??= 'IfNotPresent';
    }
    if (o.kind === 'Service') { o.spec.type ||= 'ClusterIP'; for (const p of o.spec.ports || []) { p.protocol ||= 'TCP'; p.targetPort ??= p.port; } }
  }
  allocService(o) {
    if (o.spec.type === 'ExternalName') return;
    this.svcSeq++;
    o.spec.clusterIP ||= `10.96.${(strHash(o.metadata.name) % 200) + 20}.${(strHash(o.metadata.name + 'x') % 250) + 2}`;
    if (o.spec.type === 'NodePort' || o.spec.type === 'LoadBalancer') for (const p of o.spec.ports) p.nodePort ||= 30000 + (strHash(o.metadata.name + p.port) % 2767);
  }

  deleteObject(kind, ns, name, { force = false } = {}) {
    const o = this.get(kind, ns, name);
    if (!o) return false;
    if (kind === 'Pod' && !force) { o.metadata.deletionTimestamp = this.t; o._rt = { ...(o._rt || {}), terminating: 1 }; this.deletedPods++; this.event(o, 'Normal', 'Killing', `Stopping container ${o.spec.containers[0].name}`); return true; }
    this.remove(o);
    if (kind === 'Deployment') for (const rs of this.list('ReplicaSet', ns).filter((r) => r.metadata.ownerReferences?.[0]?.name === name)) { this.remove(rs); for (const p of this.podsOf(rs)) this.deleteObject('Pod', ns, p.metadata.name); }
    if (kind === 'ReplicaSet') for (const p of this.podsOf(o)) this.deleteObject('Pod', ns, p.metadata.name);
    if (kind === 'Service') this.remove({ kind: 'Endpoints', metadata: { namespace: ns, name } });
    return true;
  }

  podsOf(rs) {
    return this.list('Pod', rs.metadata.namespace).filter((p) => {
      if (p.metadata.ownerReferences?.[0]?.uid !== rs.metadata.uid) return false;
      if (!matches(rs.spec.selector.matchLabels, p.metadata.labels)) { p.metadata.ownerReferences = []; return false; } // released: labels no longer match
      return true;
    });
  }
  rsOf(d) { return this.list('ReplicaSet', d.metadata.namespace).filter((r) => r.metadata.ownerReferences?.[0]?.uid === d.metadata.uid); }
  isReady(p) { return p.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True' && !p.metadata.deletionTimestamp; }

  // ---------------------------------------------------------------- control loop
  tick(n = 1) {
    for (let i = 0; i < n; i++) {
      this.t += TICK;
      this.deploymentController();
      this.replicaSetController();
      if (this.schedulerUp) this.scheduler(); else this.pendingNoScheduler();
      this.kubelet();
      this.endpointsController();
      this.loadBalancerController();
      this.pdbController();
    }
  }

  deploymentController() {
    for (const d of this.list('Deployment')) {
      const ns = d.metadata.namespace;
      const tpl = JSON.stringify(d.spec.template);
      const hash = hashName(tpl, 10);
      const all = this.rsOf(d);
      let cur = all.find((r) => r.metadata.labels['pod-template-hash'] === hash);
      const maxRev = Math.max(0, ...all.map((r) => Number(r.metadata.annotations['deployment.kubernetes.io/revision'])));
      if (!cur) {
        const isFirst = all.length === 0;
        cur = this.put({ apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: `${d.metadata.name}-${hash}`, namespace: ns, uid: this.uid(), creationTimestamp: this.t, labels: { ...d.spec.template.metadata.labels, 'pod-template-hash': hash }, annotations: { 'deployment.kubernetes.io/revision': String(maxRev + 1), 'deployment.kubernetes.io/desired-replicas': String(d.spec.replicas) }, ownerReferences: [{ kind: 'Deployment', name: d.metadata.name, uid: d.metadata.uid }] }, spec: { replicas: isFirst ? d.spec.replicas : 0, selector: { matchLabels: { ...d.spec.selector.matchLabels, 'pod-template-hash': hash } }, template: { ...clone(d.spec.template), metadata: { ...clone(d.spec.template.metadata), labels: { ...d.spec.template.metadata.labels, 'pod-template-hash': hash } } } }, status: {} });
        this.event(d, 'Normal', 'ScalingReplicaSet', `Scaled up replica set ${cur.metadata.name} from 0 to ${cur.spec.replicas || 1}`, 'deployment-controller');
        if (!isFirst) cur.spec.replicas = 0;
      } else if (Number(cur.metadata.annotations['deployment.kubernetes.io/revision']) < maxRev && cur.spec.replicas === 0 && all.some((r) => r !== cur && r.spec.replicas > 0)) {
        cur.metadata.annotations['deployment.kubernetes.io/revision'] = String(maxRev + 1); // rollback reuses the old RS with a new revision
      }
      const old = all.filter((r) => r !== cur);
      const want = d.spec.replicas;
      const pct = (v, base, up) => (typeof v === 'string' && v.endsWith('%') ? (up ? Math.ceil : Math.floor)(base * parseInt(v, 10) / 100) : Number(v ?? 0));
      const surge = d.spec.strategy.type === 'Recreate' ? 0 : pct(d.spec.strategy.rollingUpdate?.maxSurge ?? '25%', want, true);
      let unavail = d.spec.strategy.type === 'Recreate' ? want : pct(d.spec.strategy.rollingUpdate?.maxUnavailable ?? '25%', want, false);
      if (surge === 0 && unavail === 0) unavail = 1;
      const oldTotal = old.reduce((s, r) => s + r.spec.replicas, 0);
      const readyAll = all.reduce((s, r) => s + this.podsOf(r).filter((p) => this.isReady(p)).length, 0);
      if (oldTotal === 0) {
        if (cur.spec.replicas !== want) { this.event(d, 'Normal', 'ScalingReplicaSet', `Scaled ${want > cur.spec.replicas ? 'up' : 'down'} replica set ${cur.metadata.name} from ${cur.spec.replicas} to ${want}`, 'deployment-controller'); cur.spec.replicas = want; }
      } else {
        if (cur.spec.replicas < want && cur.spec.replicas + oldTotal < want + surge) { const to = Math.min(want, want + surge - oldTotal); if (to > cur.spec.replicas) { this.event(d, 'Normal', 'ScalingReplicaSet', `Scaled up replica set ${cur.metadata.name} from ${cur.spec.replicas} to ${to}`, 'deployment-controller'); cur.spec.replicas = to; } }
        const minAvail = want - unavail;
        let canDrop = readyAll - minAvail;
        // never-ready old pods can always go
        for (const r of old) {
          const notReady = this.podsOf(r).filter((p) => !this.isReady(p)).length;
          const drop = Math.min(r.spec.replicas, Math.max(0, canDrop) + Math.min(notReady, r.spec.replicas));
          if (drop > 0) { this.event(d, 'Normal', 'ScalingReplicaSet', `Scaled down replica set ${r.metadata.name} from ${r.spec.replicas} to ${r.spec.replicas - drop}`, 'deployment-controller'); r.spec.replicas -= drop; canDrop -= drop; }
        }
      }
      for (const r of all) r.metadata.annotations['deployment.kubernetes.io/desired-replicas'] = String(want);
      const pods = all.flatMap((r) => this.podsOf(r)).filter((p) => !p.metadata.deletionTimestamp);
      const ready = pods.filter((p) => this.isReady(p)).length;
      const updated = this.podsOf(cur).filter((p) => !p.metadata.deletionTimestamp).length;
      const startedAt = d._progressStart ?? (d._progressStart = this.t);
      if (updated === want && ready >= want && old.every((r) => r.spec.replicas === 0)) d._progressStart = this.t;
      const stuck = this.t - startedAt > 600;
      d.status = { observedGeneration: d.metadata.generation, replicas: pods.length, updatedReplicas: updated, readyReplicas: ready, availableReplicas: ready, unavailableReplicas: Math.max(0, want - ready),
        conditions: [{ type: 'Available', status: ready >= want - unavail ? 'True' : 'False', reason: ready >= want - unavail ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable' }, { type: 'Progressing', status: stuck ? 'False' : 'True', reason: stuck ? 'ProgressDeadlineExceeded' : updated === want && ready >= want ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated' }] };
      // garbage-collect history beyond revisionHistoryLimit
      const hist = old.filter((r) => r.spec.replicas === 0).sort((a, b) => Number(a.metadata.annotations['deployment.kubernetes.io/revision']) - Number(b.metadata.annotations['deployment.kubernetes.io/revision']));
      while (hist.length > d.spec.revisionHistoryLimit) this.remove(hist.shift());
    }
  }

  replicaSetController() {
    for (const rs of this.list('ReplicaSet')) {
      const pods = this.podsOf(rs).filter((p) => !p.metadata.deletionTimestamp);
      if (pods.length < rs.spec.replicas) {
        for (let i = pods.length; i < rs.spec.replicas; i++) {
          const name = `${rs.metadata.name}-${Array.from({ length: 5 }, () => HASH_ALPHABET[Math.floor(this.rand() * HASH_ALPHABET.length)]).join('')}`;
          const pod = this.put({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: rs.metadata.namespace, uid: this.uid(), creationTimestamp: this.t, labels: { ...rs.spec.template.metadata.labels }, ownerReferences: [{ kind: 'ReplicaSet', name: rs.metadata.name, uid: rs.metadata.uid }] }, spec: { ...clone(rs.spec.template.spec), serviceAccountName: rs.spec.template.spec.serviceAccountName || 'default' }, status: { phase: 'Pending', conditions: [] } });
          this.event(rs, 'Normal', 'SuccessfulCreate', `Created pod: ${pod.metadata.name}`, 'replicaset-controller');
        }
      } else if (pods.length > rs.spec.replicas) {
        const victims = pods.sort((a, b) => (this.isReady(a) - this.isReady(b)) || (b.metadata.creationTimestamp - a.metadata.creationTimestamp)).slice(0, pods.length - rs.spec.replicas);
        for (const v of victims) { this.deleteObject('Pod', v.metadata.namespace, v.metadata.name); this.deletedPods--; this.event(rs, 'Normal', 'SuccessfulDelete', `Deleted pod: ${v.metadata.name}`, 'replicaset-controller'); }
      }
      rs.status = { replicas: this.podsOf(rs).length, readyReplicas: this.podsOf(rs).filter((p) => this.isReady(p)).length };
    }
  }

  requestsOn(nodeName) {
    return this.list('Pod').filter((p) => p.spec.nodeName === nodeName && !p.metadata.deletionTimestamp).reduce((a, p) => { for (const c of p.spec.containers) { a.cpu += parseCpu(c.resources?.requests?.cpu); a.mem += parseMem(c.resources?.requests?.memory); } return a; }, { cpu: 0, mem: 0 });
  }
  scheduler() {
    const nodes = this.list('Node');
    for (const p of this.list('Pod').filter((x) => !x.spec.nodeName && !x.metadata.deletionTimestamp)) {
      const req = p.spec.containers.reduce((a, c) => ({ cpu: a.cpu + parseCpu(c.resources?.requests?.cpu), mem: a.mem + parseMem(c.resources?.requests?.memory) }), { cpu: 0, mem: 0 });
      const pvNode = this.pvNodeFor(p);
      if (pvNode === 'unbound') { this.event(p, 'Warning', 'FailedScheduling', `0/${nodes.length} nodes are available: pod has unbound immediate PersistentVolumeClaims. preemption: 0/${nodes.length} nodes are available: ${nodes.length} Preemption is not helpful for scheduling.`, 'default-scheduler'); continue; }
      const reasons = {};
      const fits = [];
      for (const n of nodes) {
        const tol = p.spec.tolerations || [];
        const taints = [...(n.spec.taints || []), ...(n.status.ready ? [] : [{ key: 'node.kubernetes.io/unreachable', effect: 'NoSchedule' }]), ...(n.spec.unschedulable ? [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }] : [])];
        const bad = taints.find((t) => t.effect !== 'PreferNoSchedule' && !tol.some((x) => x.operator === 'Exists' ? (!x.key || x.key === t.key) : x.key === t.key));
        if (bad) { const r = `node(s) had untolerated taint {${bad.key}: ${bad.value ?? ''}}`; reasons[r] = (reasons[r] || 0) + 1; continue; }
        if (p.spec.nodeSelector && !matches(p.spec.nodeSelector, n.metadata.labels)) { reasons["node(s) didn't match Pod's node affinity/selector"] = (reasons["node(s) didn't match Pod's node affinity/selector"] || 0) + 1; continue; }
        if (pvNode && pvNode !== n.metadata.name) { reasons['node(s) had volume node affinity conflict'] = (reasons['node(s) had volume node affinity conflict'] || 0) + 1; continue; }
        const used = this.requestsOn(n.metadata.name);
        if (used.cpu + req.cpu > parseCpu(n.status.allocatable.cpu)) { reasons['Insufficient cpu'] = (reasons['Insufficient cpu'] || 0) + 1; continue; }
        if (used.mem + req.mem > parseMem(n.status.allocatable.memory)) { reasons['Insufficient memory'] = (reasons['Insufficient memory'] || 0) + 1; continue; }
        fits.push({ n, free: parseCpu(n.status.allocatable.cpu) - used.cpu - req.cpu });
      }
      if (!fits.length) {
        const msg = Object.entries(reasons).sort().map(([r, c]) => `${c} ${r}`).join(', ');
        const pre = Object.entries(reasons).filter(([r]) => r.startsWith('Insufficient')).reduce((s, [, c]) => s + c, 0);
        this.event(p, 'Warning', 'FailedScheduling', `0/${nodes.length} nodes are available: ${msg}. preemption: 0/${nodes.length} nodes are available: ${pre ? `${pre} No preemption victims found for incoming pod, ` : ''}${nodes.length - pre} Preemption is not helpful for scheduling.`.replace(', .', '.'), 'default-scheduler');
        p.status.conditions = [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }];
        continue;
      }
      // spread: least-loaded node first, ties by pods already there from the same owner
      fits.sort((a, b) => this.siblingsOn(p, a.n) - this.siblingsOn(p, b.n) || b.free - a.free || a.n.metadata.name.localeCompare(b.n.metadata.name));
      const node = fits[0].n;
      p.spec.nodeName = node.metadata.name;
      const seq = (this.ipSeq.get(node.metadata.name) || 4) + 1; this.ipSeq.set(node.metadata.name, seq);
      p.status.podIP = `10.244.${node._idx}.${seq}`;
      p.status.hostIP = node.status.addresses[0].address;
      p.status.conditions = [{ type: 'PodScheduled', status: 'True' }];
      this.bindPvcs(p, node);
      this.event(p, 'Normal', 'Scheduled', `Successfully assigned ${p.metadata.namespace}/${p.metadata.name} to ${node.metadata.name}`, 'default-scheduler');
    }
  }
  siblingsOn(p, n) { const app = p.metadata.labels?.app; return this.list('Pod', p.metadata.namespace).filter((x) => x !== p && x.spec.nodeName === n.metadata.name && x.metadata.labels?.app === app && !x.metadata.deletionTimestamp).length; }
  pendingNoScheduler() {
    for (const p of this.list('Pod').filter((x) => !x.spec.nodeName)) p.status.conditions = [];
  }
  pvNodeFor(p) {
    for (const v of p.spec.volumes || []) {
      if (!v.persistentVolumeClaim) continue;
      const pvc = this.get('PersistentVolumeClaim', p.metadata.namespace, v.persistentVolumeClaim.claimName);
      if (!pvc) return 'unbound';
      if (pvc.spec.volumeName) { const pv = this.get('PersistentVolume', undefined, pvc.spec.volumeName); return pv?._node || null; }
    }
    return null;
  }
  bindPvcs(p, node) {
    for (const v of p.spec.volumes || []) {
      if (!v.persistentVolumeClaim) continue;
      const pvc = this.get('PersistentVolumeClaim', p.metadata.namespace, v.persistentVolumeClaim.claimName);
      if (!pvc || pvc.spec.volumeName) continue;
      const name = `pvc-${pvc.metadata.uid}`;
      this.put({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, creationTimestamp: this.t }, spec: { capacity: { storage: pvc.spec.resources.requests.storage }, accessModes: pvc.spec.accessModes, persistentVolumeReclaimPolicy: 'Delete', storageClassName: pvc.spec.storageClassName || 'local-path', claimRef: { namespace: pvc.metadata.namespace, name: pvc.metadata.name }, hostPath: { path: `/var/lib/rancher/local-path/${name}_${pvc.metadata.namespace}_${pvc.metadata.name}` }, nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/hostname', operator: 'In', values: [node.metadata.name] }] }] } } }, status: { phase: 'Bound' }, _node: node.metadata.name });
      pvc.metadata.annotations = { ...(pvc.metadata.annotations || {}), 'volume.kubernetes.io/selected-node': node.metadata.name, 'pv.kubernetes.io/bind-completed': 'yes' };
      pvc.spec.volumeName = name; pvc.status = { phase: 'Bound', capacity: { storage: pvc.spec.resources.requests.storage } };
      this.event(pvc, 'Normal', 'ProvisioningSucceeded', `Successfully provisioned volume ${name}`, 'rancher.io/local-path');
    }
  }

  resolveEnv(p, c) {
    const env = {}; const ns = p.metadata.namespace;
    for (const ef of c.envFrom || []) {
      const ref = ef.configMapRef || ef.secretRef; const kind = ef.configMapRef ? 'ConfigMap' : 'Secret';
      const o = this.get(kind, ns, ref.name);
      if (!o) return { error: `${kind.toLowerCase().replace('configmap', 'configmap')} "${ref.name}" not found` };
      for (const [k, v] of Object.entries(o.data || {})) env[k] = kind === 'Secret' ? unb64(v) : v;
    }
    for (const e of c.env || []) {
      if ('value' in e) { env[e.name] = String(e.value); continue; }
      const r = e.valueFrom?.configMapKeyRef || e.valueFrom?.secretKeyRef; if (!r) continue;
      const kind = e.valueFrom.configMapKeyRef ? 'ConfigMap' : 'Secret';
      const o = this.get(kind, ns, r.name);
      if (!o) return { error: `${kind === 'Secret' ? 'secret' : 'configmap'} "${r.name}" not found` };
      if (!(r.key in (o.data || {}))) return { error: `couldn't find key ${r.key} in ${kind} ${ns}/${r.name}` };
      env[e.name] = kind === 'Secret' ? unb64(o.data[r.key]) : o.data[r.key];
    }
    return { env };
  }

  kubelet() {
    for (const p of this.list('Pod')) {
      const c = p.spec.containers[0];
      const rt = (p._rt ||= { stage: 'creating', restarts: 0, logs: [], prev: [] });
      if (p.metadata.deletionTimestamp) { if (this.t - p.metadata.deletionTimestamp >= TICK) this.remove(p); else this.setStatus(p, 'Terminating'); continue; }
      if (!p.spec.nodeName) { this.setStatus(p, 'Pending'); continue; }
      const node = this.get('Node', undefined, p.spec.nodeName);
      if (!node?.status.ready) { this.setStatus(p, rt.stage === 'running' ? 'Running' : 'Pending', { stale: true }); continue; }
      const img = this.images[c.image];
      if (rt.stage === 'backoff') { if (this.t >= rt.backoffUntil) rt.stage = 'creating'; else { this.setStatus(p, 'CrashLoopBackOff'); continue; } }
      if (rt.stage === 'creating' && !rt.seenOnNode) { rt.seenOnNode = true; this.setStatus(p, 'Pending'); continue; } // ContainerCreating for one tick
      if (rt.stage === 'creating' || rt.stage === 'pulling') {
        const er = this.resolveEnv(p, c);
        if (er.error) { this.event(p, 'Warning', 'Failed', `Error: ${er.error}`); this.setStatus(p, 'CreateContainerConfigError'); continue; }
        if (!img) {
          rt.pullFails = (rt.pullFails || 0) + 1;
          this.event(p, 'Normal', 'Pulling', `Pulling image "${c.image}"`);
          const ref = c.image.includes('/') && c.image.split('/')[0].includes('.') ? c.image : `docker.io/${c.image.includes('/') ? c.image : 'library/' + c.image}`;
          this.event(p, 'Warning', 'Failed', `Failed to pull image "${c.image}": rpc error: code = NotFound desc = failed to pull and unpack image "${ref}${c.image.includes(':') ? '' : ':latest'}": failed to resolve reference "${ref}${c.image.includes(':') ? '' : ':latest'}": ${ref}${c.image.includes(':') ? '' : ':latest'}: not found`);
          this.event(p, 'Warning', 'Failed', `Error: ${rt.pullFails === 1 ? 'ErrImagePull' : 'ImagePullBackOff'}`);
          if (rt.pullFails > 1) this.event(p, 'Normal', 'BackOff', `Back-off pulling image "${c.image}"`);
          this.setStatus(p, rt.pullFails === 1 ? 'ErrImagePull' : 'ImagePullBackOff');
          continue;
        }
        if (!rt.pulled) { this.event(p, 'Normal', 'Pulled', `Container image "${c.image}" already present on machine`); rt.pulled = true; }
        this.event(p, 'Normal', 'Created', `Created container: ${c.name}`);
        this.event(p, 'Normal', 'Started', `Started container ${c.name}`);
        rt.stage = 'running'; rt.env = er.env; rt.runTicks = 0; rt.liveFails = 0; rt.startedAt = this.t;
        rt.logs = img.crash ? [...img.crash] : [...(img.logs?.(er.env) || [])];
        const missing = img.requires.filter((k) => !er.env[k]);
        if (missing.length) rt.logs = [`${c.image.split(':')[0].split('/').pop()} ${c.image.split(':')[1]} starting`, `fatal: required environment variable ${missing[0]} is not set`];
      }
      if (rt.stage === 'running') {
        rt.runTicks++;
        const missing = img.requires.filter((k) => !rt.env[k]);
        if (missing.length || img.crash) { this.terminate(p, 'Error', 1); continue; }
        const lim = parseMem(c.resources?.limits?.memory);
        if (lim && img.mem > lim) { rt.logs.push(...(img.oomLogs || [])); this.terminate(p, 'OOMKilled', 137); continue; }
        const served = (probe) => !probe || (probe.tcpSocket ? Number(probe.tcpSocket.port) === img.port : (Number(probe.httpGet.port) === img.port || probe.httpGet.port === c.ports?.[0]?.name) && probe.httpGet.path in img.paths);
        if (c.livenessProbe && rt.runTicks > 1 && !served(c.livenessProbe)) {
          rt.liveFails++;
          this.event(p, 'Warning', 'Unhealthy', `Liveness probe failed: ${c.livenessProbe.httpGet ? 'HTTP probe failed with statuscode: 404' : `dial tcp ${p.status.podIP}:${c.livenessProbe.tcpSocket.port}: connect: connection refused`}`);
          if (rt.liveFails >= 3) { this.event(p, 'Normal', 'Killing', `Container ${c.name} failed liveness probe, will be restarted`); this.terminate(p, 'Error', 137); continue; }
        }
        let ready = rt.runTicks >= 1;
        if (c.readinessProbe && !served(c.readinessProbe)) { ready = false; this.event(p, 'Warning', 'Unhealthy', `Readiness probe failed: ${c.readinessProbe.httpGet ? 'HTTP probe failed with statuscode: 404' : `dial tcp ${p.status.podIP}:${c.readinessProbe.tcpSocket.port}: connect: connection refused`}`); }
        rt.ready = ready;
        this.setStatus(p, 'Running');
      }
    }
  }
  terminate(p, reason, code) {
    const rt = p._rt; const c = p.spec.containers[0];
    rt.restarts++; rt.prev = [...rt.logs];
    if (reason === 'OOMKilled') rt.prev.push('Killed');
    rt.last = { reason, exitCode: code, startedAt: rt.startedAt, finishedAt: this.t };
    rt.stage = 'backoff'; rt.ready = false; rt.lastRestartAt = this.t;
    rt.backoffUntil = this.t + Math.min(10 * 2 ** (rt.restarts - 1), 300);
    this.event(p, 'Warning', 'BackOff', `Back-off restarting failed container ${c.name} in pod ${p.metadata.name}_${p.metadata.namespace}(${p.metadata.uid})`);
    this.setStatus(p, reason === 'OOMKilled' ? 'OOMKilled' : rt.restarts > 1 ? 'CrashLoopBackOff' : 'Error');
  }
  setStatus(p, display) {
    const rt = p._rt || {};
    const running = display === 'Running';
    p.status.phase = running ? 'Running' : display === 'Pending' || display === 'Terminating' ? (p.status.phase === 'Running' ? 'Running' : 'Pending') : rt.restarts ? 'Running' : 'Pending';
    p.status._display = display;
    const ready = running && rt.ready && !p.metadata.deletionTimestamp;
    const sched = p.status.conditions?.find((x) => x.type === 'PodScheduled');
    p.status.conditions = [sched || { type: 'PodScheduled', status: p.spec.nodeName ? 'True' : 'False' }, ...(p.spec.nodeName ? [{ type: 'Initialized', status: 'True' }, { type: 'ContainersReady', status: ready ? 'True' : 'False' }, { type: 'Ready', status: ready ? 'True' : 'False' }] : [])];
    p.status.containerStatuses = p.spec.nodeName ? [{ name: p.spec.containers[0].name, image: p.spec.containers[0].image, ready, restartCount: rt.restarts || 0, started: running, state: running ? { running: { startedAt: rt.startedAt } } : { waiting: { reason: display === 'Pending' ? 'ContainerCreating' : display } }, ...(rt.last ? { lastState: { terminated: rt.last } } : {}) }] : undefined;
  }

  endpointsController() {
    for (const s of this.list('Service')) {
      if (!s.spec.selector) continue;
      const ns = s.metadata.namespace;
      const pods = this.list('Pod', ns).filter((p) => matches(s.spec.selector, p.metadata.labels));
      const ready = pods.filter((p) => this.isReady(p));
      const notReady = pods.filter((p) => !this.isReady(p) && p.status.podIP && !p.metadata.deletionTimestamp);
      const port = s.spec.ports?.[0];
      const tp = (p) => (typeof port?.targetPort === 'string' ? (p.spec.containers[0].ports || []).find((x) => x.name === port.targetPort)?.containerPort : port?.targetPort);
      const ep = this.get('Endpoints', ns, s.metadata.name) || { apiVersion: 'v1', kind: 'Endpoints', metadata: { name: s.metadata.name, namespace: ns, creationTimestamp: this.t, uid: this.uid() } };
      ep.subsets = ready.length || notReady.length ? [{ addresses: ready.map((p) => ({ ip: p.status.podIP, nodeName: p.spec.nodeName, targetRef: { kind: 'Pod', name: p.metadata.name } })), notReadyAddresses: notReady.map((p) => ({ ip: p.status.podIP, targetRef: { kind: 'Pod', name: p.metadata.name } })), ports: [{ port: tp(ready[0] || notReady[0]), protocol: 'TCP' }] }] : [];
      this.put(ep);
    }
  }
  loadBalancerController() {
    for (const s of this.list('Service').filter((x) => x.spec.type === 'LoadBalancer')) s.status = { loadBalancer: {} }; // no cloud controller in this cluster: stays <pending>
  }
  pdbController() {
    for (const b of this.list('PodDisruptionBudget')) {
      const healthy = this.list('Pod', b.metadata.namespace).filter((p) => matches(b.spec.selector?.matchLabels, p.metadata.labels) && this.isReady(p)).length;
      const minA = b.spec.minAvailable ?? 0;
      b.status = { currentHealthy: healthy, desiredHealthy: minA, disruptionsAllowed: Math.max(0, healthy - minA), expectedPods: this.list('Pod', b.metadata.namespace).filter((p) => matches(b.spec.selector?.matchLabels, p.metadata.labels)).length };
    }
  }

  readyEndpoints(svc) { const ep = this.get('Endpoints', svc.metadata.namespace, svc.metadata.name); return ep?.subsets?.[0]?.addresses || []; }
  podByIp(ip) { return this.list('Pod').find((p) => p.status.podIP === ip); }
  // An HTTP request routed to a Service: picks a ready endpoint the way kube-proxy would
  httpToService(svc, path) {
    const eps = this.readyEndpoints(svc);
    if (!eps.length) return { refused: true };
    const pod = this.podByIp(eps[Math.floor(this.rand() * eps.length)].ip);
    return this.httpToPod(pod, path);
  }
  httpToPod(pod, path) {
    const img = this.images[pod.spec.containers[0].image];
    if (!img || img.tcp) return { refused: true };
    const body = img.paths[path] ?? img.paths[Object.keys(img.paths).filter((k) => k !== '/' && path.startsWith(k)).sort((a, b) => b.length - a.length)[0]];
    if (body === undefined) return { status: 404, body: '404 page not found' };
    if (img.apiCheck && path === '/') {
      const api = this.get('Service', pod.metadata.namespace, 'api');
      if (!api || !this.readyEndpoints(api).length) return { status: 200, body: '<!doctype html><title>Harbor Watch</title><h1>Harbor Watch</h1><p class="error">API unreachable: GET http://api:8080/api/ships failed (connection refused)</p>' };
    }
    return { status: 200, body: body.replace('$POD', pod.metadata.name) };
  }

  // RBAC: student = namespaced `edit` in own namespace; admin = cluster-admin
  can(verb, kind, ns) {
    if (this.user.admin) return true;
    if (!kind) return false;
    if (KINDS[kind]?.cluster) return false;
    if (ns !== this.user.ns) return false;
    if (kind === 'Role' || kind === 'RoleBinding') return false;
    if (kind === 'Endpoints' && !['get', 'list', 'watch'].includes(verb)) return false;
    return true;
  }
  forbidden(verb, kind, ns, name) {
    const d = KINDS[kind];
    const res = d ? d.plural : kind;
    const scope = d?.cluster ? 'at the cluster scope' : `in the namespace "${ns}"`;
    return `Error from server (Forbidden): ${res}${d?.group ? '.' + d.group : ''}${name ? ` "${name}"` : ''} is forbidden: User "${this.user.name}" cannot ${verb} resource "${res}" in API group "${d?.group || ''}" ${scope}`;
  }
}

export const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s).toString('base64'));
export const unb64 = (s) => { try { return typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString(); } catch { return ''; } };
