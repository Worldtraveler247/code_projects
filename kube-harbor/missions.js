// Kube Harbor — missions. The arc follows the workshop's sessions (2: meet the cluster,
// 3: the whole app, 4: operate it) plus an Expert tier. The app ("Harbor Watch": web, api,
// worker, postgres) is this game's own; nothing is copied from course material.
import { dump } from './yaml.js';

// ------------------------------------------------------------------ manifest builders
const NS = 'harbor';
const probe = (path, port) => ({ httpGet: { path, port }, periodSeconds: 10, failureThreshold: 3 });
function deployment(name, { image, replicas = 1, port, env, envFrom, resources, readiness, liveness, volumes, mounts, strategy, labels } = {}) {
  const lb = labels || { app: name };
  const c = { name, image, ...(port ? { ports: [{ containerPort: port }] } : {}), ...(envFrom ? { envFrom } : {}), ...(env ? { env } : {}), ...(resources ? { resources } : {}), ...(readiness ? { readinessProbe: readiness } : {}), ...(liveness ? { livenessProbe: liveness } : {}), ...(mounts ? { volumeMounts: mounts } : {}) };
  return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: NS, labels: { app: name } }, spec: { replicas, ...(strategy ? { strategy } : {}), selector: { matchLabels: { ...lb } }, template: { metadata: { labels: { ...lb } }, spec: { containers: [c], ...(volumes ? { volumes } : {}) } } } };
}
function service(name, port, { selector, type, targetPort } = {}) {
  return { apiVersion: 'v1', kind: 'Service', metadata: { name, namespace: NS }, spec: { ...(type ? { type } : {}), selector: selector || { app: name }, ports: [{ port, targetPort: targetPort ?? port }] } };
}
const config = (extra = {}) => ({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'harbor-config', namespace: NS }, data: { DB_HOST: 'postgres', API_URL: 'http://api:8080', LOG_LEVEL: 'info', ...extra } });
const secret = () => ({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'harbor-db', namespace: NS }, type: 'Opaque', stringData: { DB_PASSWORD: 'tide-7Kq2-harbor' } });
const pvc = () => ({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'harbor-db-data', namespace: NS }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'local-path', resources: { requests: { storage: '1Gi' } } } });

const API_RES = { requests: { cpu: '100m', memory: '64Mi' }, limits: { memory: '128Mi' } };
const api = (o = {}) => deployment('api', { image: 'harbor/api:1.4.0', replicas: 2, port: 8080, envFrom: [{ configMapRef: { name: 'harbor-config' } }], resources: API_RES, readiness: probe('/ready', 8080), liveness: probe('/healthz', 8080), ...o });
const web = (o = {}) => deployment('web', { image: 'harbor/web:1.4.0', replicas: 2, port: 80, resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '128Mi' } }, readiness: probe('/health', 80), liveness: probe('/health', 80), ...o });
const worker = (o = {}) => deployment('worker', { image: 'harbor/worker:1.4.0', env: [{ name: 'DB_HOST', valueFrom: { configMapKeyRef: { name: 'harbor-config', key: 'DB_HOST' } } }, { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'harbor-db', key: 'DB_PASSWORD' } } }], resources: { requests: { cpu: '100m', memory: '32Mi' }, limits: { memory: '96Mi' } }, ...o });
const postgres = (o = {}) => deployment('postgres', { image: 'postgres:16.4', port: 5432, strategy: { type: 'Recreate' }, env: [{ name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name: 'harbor-db', key: 'DB_PASSWORD' } } }], resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { memory: '512Mi' } }, volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'harbor-db-data' } }], mounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }], ...o });

const yaml = (...objs) => objs.map((o) => dump(o)).join('\n---\n') + '\n';
function fullStack(over = {}) {
  return {
    'config.yaml': yaml(config(), over.secret || secret()),
    'db.yaml': yaml(pvc(), over.postgres || postgres(), service('postgres', 5432)),
    'api.yaml': yaml(over.api || api(), over.apiSvc || service('api', 8080)),
    'web.yaml': yaml(over.web || web(), service('web', 80)),
    'worker.yaml': yaml(over.worker || worker()),
  };
}
function applyFiles(c, files, names) { for (const n of names) for (const doc of files[n].split('\n---\n')) { const o = loadDoc(doc); c.applyObject(o); } }
import { load } from './yaml.js';
const loadDoc = (d) => load(d);
const stackSetup = (names = ['config.yaml', 'db.yaml', 'api.yaml', 'web.yaml', 'worker.yaml']) => (c, s) => applyFiles(c, Object.fromEntries([...s.files].map(([k, v]) => [k.split('/').pop(), v])), names);

// goal helpers
const dep = (c, n) => c.get('Deployment', NS, n);
const healthy = (c, n, want) => { const d = dep(c, n); return !!d && d.status.readyReplicas === (want ?? d.spec.replicas) && d.status.updatedReplicas === d.spec.replicas && (d.status.replicas ?? 0) === d.spec.replicas; };
const pods = (c, app) => c.list('Pod', NS).filter((p) => p.metadata.labels?.app === app && !p.metadata.deletionTimestamp);
const eps = (c, svc) => c.get('Endpoints', NS, svc)?.subsets?.[0]?.addresses?.length || 0;

// ------------------------------------------------------------------ missions
export const MISSIONS = [
  // ======================= SESSION 2 — Meet the cluster
  {
    id: 's2-whoami', session: 2, title: 'Who Am I?', type: 'answer', par: 2,
    concept: [
      '<b>kubectl</b> is a client. It reads <code>~/.kube/config</code> (cluster address + credentials) and talks to the <b>API server</b>. Every <code>kubectl</code> command is an authenticated HTTPS request.',
      '<b>Namespaces</b> partition one cluster into rooms. Your context defaults to the <code>harbor</code> namespace.',
      '<b>RBAC</b> decides what you may do. You are not a person to the cluster. You are a <em>ServiceAccount</em>, and you were granted the built-in <code>edit</code> role in your namespace only.',
    ],
    brief: 'First day on the Harbor cluster. Before you touch anything, find out <b>who the cluster thinks you are</b>, and prove the edge of your access by trying to list the nodes.',
    objective: 'Answer with your full Kubernetes username:  answer system:...',
    hints: ['kubectl can tell you who you are: look under  kubectl auth ...', 'kubectl auth whoami', 'Then try  kubectl get nodes  and read the Forbidden error: it names you too.'],
    solution: ['kubectl auth whoami', 'kubectl get nodes', 'answer system:serviceaccount:harbor:student'],
    answer: /^\s*system:serviceaccount:harbor:student\s*$/i,
    wrongHint: 'The username is the long system:... string, exactly as kubectl prints it.',
    debrief: 'Nodes are <b>cluster-scoped</b> (they belong to no namespace), and your RoleBinding only grants rights <em>inside</em> <code>harbor</code>. So <code>get nodes</code> is Forbidden while <code>get pods</code> works. Every Forbidden error names the user, the verb, the resource and the scope. Read it like an audit record.',
    lab: 'kubectl auth whoami && kubectl auth can-i --list',
  },
  {
    id: 's2-selfheal', session: 2, title: 'Delete It, Watch It Return', par: 4,
    concept: [
      'A <b>Pod</b> is one or more containers scheduled together on a node. On its own, a Pod is mortal.',
      'A <b>Deployment</b> declares <em>"I want N copies of this Pod template."</em> It creates a <b>ReplicaSet</b>, and the ReplicaSet creates Pods.',
      'Controllers run a loop: <em>observe → compare to desired → act</em>. Delete a Pod and the ReplicaSet notices it has 0 of 1 and creates a new one.',
    ],
    brief: 'Deploy the API on its own (<code>~/harbor/api.yaml</code>). Then delete its Pod and watch the cluster put one back with a <b>new name</b>.',
    objective: 'Apply api.yaml, get the api Pod Running, delete it, and get the replacement to 1/1 Ready.',
    files: { 'api.yaml': yaml(deployment('api', { image: 'harbor/api:1.4.0', port: 8080, env: [{ name: 'DB_HOST', value: 'postgres' }], readiness: probe('/ready', 8080) })) },
    hints: ['kubectl apply -f api.yaml', 'kubectl get pods   (wait until Running), then  kubectl delete pod NAME  or  kubectl delete pod -l app=api', 'kubectl get pods -w  shows the replacement arriving'],
    solution: ['kubectl apply -f api.yaml', 'kubectl get pods', 'kubectl delete pod -l app=api', 'kubectl get pods -w'],
    goal: (c) => c.deletedPods >= 1 && healthy(c, 'api', 1),
    debrief: 'The new Pod has a different name and IP. Pods are <b>cattle, not pets</b>: never hard-code a Pod name or IP. The Deployment name is the stable handle. In <code>kubectl get rs</code> the ReplicaSet\'s name never changed; only its Pod did.',
    lab: 'kubectl create deployment demo --image=nginx && kubectl delete pod -l app=demo && kubectl get pods -w',
  },
  {
    id: 's2-imagepull', session: 2, title: 'ImagePullBackOff', par: 4,
    concept: [
      'Before a container runs, the node\'s <b>kubelet</b> must pull its image from a registry.',
      'If the tag does not exist you get <code>ErrImagePull</code>, then <code>ImagePullBackOff</code>: the kubelet retries with growing delays.',
      'The truth is in the Pod\'s <b>Events</b> (<code>kubectl describe pod</code>), not in <code>logs</code>. The container never started, so there are no logs.',
    ],
    brief: 'A teammate deployed the API, but it never comes up. Find out <b>why</b>, and fix it without editing the YAML file.',
    objective: 'Get deployment/api to 1/1 Ready.',
    files: { 'api.yaml': yaml(deployment('api', { image: 'harbor/api:1.4', port: 8080, env: [{ name: 'DB_HOST', value: 'postgres' }], readiness: probe('/ready', 8080) })) },
    setup: (c, s) => stackSetup(['api.yaml'])(c, s), warm: 5,
    hints: ['kubectl describe pods  and read the Events at the bottom', 'The tag "1.4" does not exist. Which tags do? Try  crane ls harbor/api', 'kubectl set image deployment/api api=harbor/api:1.4.0'],
    solution: ['kubectl get pods', 'kubectl describe pods', 'crane ls harbor/api', 'kubectl set image deployment/api api=harbor/api:1.4.0', 'kubectl rollout status deployment/api'],
    goal: (c) => healthy(c, 'api', 1) && dep(c, 'api').spec.template.spec.containers[0].image === 'harbor/api:1.4.0',
    debrief: '<code>set image</code> changed the Pod <em>template</em>, so the Deployment rolled out a new ReplicaSet. Pin exact tags (<code>1.4.0</code>, or better, a digest). <code>latest</code> and partial tags are how two nodes end up running different code.',
    lab: 'kubectl run bad --image=nginx:does-not-exist && kubectl describe pod bad | tail -8',
  },
  {
    id: 's2-crashloop', session: 2, title: 'CrashLoopBackOff', par: 4,
    concept: [
      '<code>CrashLoopBackOff</code> means the image pulled and the container <em>started</em>, then exited. The kubelet restarts it with exponential back-off (10s, 20s, 40s … 5m).',
      'This time the app <em>did</em> run, so <b>logs</b> are the first place to look. <code>kubectl logs --previous</code> shows the last crashed instance.',
      'The fix belongs in the Pod template (here, an environment variable), never in the running container.',
    ],
    brief: 'The API image is right now, but the Pod keeps restarting. Read what the application says before it dies, and give it what it needs.',
    objective: 'Get deployment/api to 1/1 Ready.',
    files: { 'api.yaml': yaml(deployment('api', { image: 'harbor/api:1.4.0', port: 8080, readiness: probe('/ready', 8080) })) },
    setup: (c, s) => stackSetup(['api.yaml'])(c, s), warm: 9,
    hints: ['kubectl get pods  shows RESTARTS climbing. Now read the app\'s last words: kubectl logs deploy/api', 'It needs DB_HOST. The database Service will be called postgres.', 'kubectl set env deployment/api DB_HOST=postgres'],
    solution: ['kubectl get pods', 'kubectl logs deploy/api', 'kubectl set env deployment/api DB_HOST=postgres', 'kubectl rollout status deployment/api'],
    goal: (c) => healthy(c, 'api', 1),
    debrief: 'Two failure classes, two first moves: <b>ImagePullBackOff → describe</b> (Events), <b>CrashLoopBackOff → logs</b> (the app ran). The RESTARTS column with "(Xs ago)" is the tell. In the next session this setting moves out of the Pod spec and into a ConfigMap.',
    lab: 'kubectl logs POD --previous   # the crashed instance, not the current one',
  },
  // ======================= SESSION 3 — The whole app
  {
    id: 's3-config', session: 3, title: 'A Failure You Didn\'t Cause', par: 4,
    concept: [
      'Configuration lives outside the image: a <b>ConfigMap</b> for plain settings, a <b>Secret</b> for credentials.',
      'Pods reference keys: <code>secretKeyRef: {name, key}</code>. If the Secret or the <em>key</em> is missing, the kubelet refuses to start the container: <code>CreateContainerConfigError</code>.',
      'No logs exist (nothing ran), so the reason is in Events.',
    ],
    brief: 'The whole Harbor stack is applied: postgres, api, web, worker. Everything is green except the <b>worker</b>. Someone else wrote it; you have to diagnose it.',
    objective: 'Get deployment/worker to 1/1 Ready without editing the Secret.',
    files: fullStack({ worker: worker({ env: [{ name: 'DB_HOST', valueFrom: { configMapKeyRef: { name: 'harbor-config', key: 'DB_HOST' } } }, { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'harbor-db', key: 'db-password' } } }] }) }),
    setup: (c, s) => stackSetup()(c, s), warm: 6,
    hints: ['kubectl describe pod -l app=worker  →  Events: "couldn\'t find key ..."', 'Compare with the keys the Secret really has: kubectl describe secret harbor-db', 'kubectl set env deployment/worker --from=secret/harbor-db --keys=DB_PASSWORD   (or  kubectl edit deployment worker)'],
    solution: ['kubectl get pods', 'kubectl describe pod -l app=worker', 'kubectl describe secret harbor-db', 'kubectl set env deployment/worker --from=secret/harbor-db --keys=DB_PASSWORD', 'kubectl get pods -l app=worker'],
    goal: (c) => healthy(c, 'worker', 1),
    debrief: 'Key names are case-sensitive contracts between two objects written by two people. <code>describe secret</code> shows key names and sizes but never values: a cheap way to check the contract without exposing the credential.',
    lab: 'kubectl create secret generic s --from-literal=A=1 && kubectl run t --image=busybox --env=X=1 --overrides=... # or write a pod with a wrong secretKeyRef.key and describe it',
  },
  {
    id: 's3-endpoints', session: 3, title: 'The Service With No Endpoints', par: 4,
    concept: [
      'A <b>Service</b> gives a stable virtual IP and DNS name in front of changing Pods. It picks its Pods by <b>label selector</b>, not by name.',
      'The <b>Endpoints</b> object is the live list of <em>Ready</em> Pod IPs that match the selector. <code>&lt;none&gt;</code> means nothing matches, or nothing is Ready.',
      'Labels on a Pod come from the Deployment\'s <em>template</em>. Relabeling a running Pod by hand doesn\'t last.',
    ],
    brief: 'Every Pod is Running and Ready, yet the dashboard says <b>"API unreachable"</b>. Nothing is crashing. Find the broken link.',
    objective: 'Make Service api route to the api Pods, durably (the fix must survive Pod replacement). Confirm with kubectl get endpoints api.',
    files: fullStack({ apiSvc: service('api', 8080, { selector: { app: 'harbor-api' } }) }),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl get endpoints  →  api has <none>', 'Compare  kubectl get svc api -o wide  (SELECTOR) with  kubectl get pods --show-labels', 'Fix the Service, not the Pods: kubectl patch service api -p \'{"spec":{"selector":{"app":"api"}}}\''],
    solution: ['kubectl get endpoints', 'kubectl get svc api -o wide', 'kubectl get pods --show-labels', 'kubectl patch service api -p \'{"spec":{"selector":{"app":"api"}}}\'', 'kubectl get endpoints api'],
    goal: (c) => { const s = c.get('Service', NS, 'api'); const d = dep(c, 'api'); return eps(c, 'api') >= 2 && Object.entries(s.spec.selector || {}).every(([k, v]) => d.spec.template.metadata.labels[k] === v); },
    debrief: 'If you relabeled the Pods instead, the ReplicaSet saw they no longer matched its selector, <b>released</b> them, and created replacements with the old labels. That is a trap that looks fixed for a minute. <code>kubectl get endpoints</code> is the fastest test of "is my Service wired?"',
    lab: 'kubectl get endpointslices -l kubernetes.io/service-name=api   # the modern view of the same data',
  },
  {
    id: 's3-dns', session: 3, title: 'Find It by Name', type: 'answer', par: 2,
    concept: [
      'Inside the cluster, CoreDNS resolves <code>&lt;service&gt;.&lt;namespace&gt;.svc.cluster.local</code> to the Service\'s <b>ClusterIP</b>.',
      'Pods in the same namespace can use the short name (<code>api</code>) thanks to the <code>search</code> line in their <code>/etc/resolv.conf</code>.',
      'ClusterIPs are virtual: they exist only inside the cluster network. Your laptop cannot reach them.',
    ],
    brief: 'The web Pods call <code>http://api:8080</code>. Prove what that name means <b>from inside a web Pod</b>.',
    objective: 'Answer with the IP address that the name "api" resolves to inside the cluster.',
    files: fullStack(),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl exec runs one command inside a Pod: kubectl exec deploy/web -- nslookup api', 'Compare with  kubectl get svc api', 'Try  curl http://api:8080  from your laptop too, and see why it fails.'],
    solution: ['kubectl exec deploy/web -- nslookup api', 'kubectl get svc api', 'answer $(kubectl get svc api -o jsonpath=\'{.spec.clusterIP}\')'],
    answer: (c) => new RegExp(`^\\s*${c.get('Service', NS, 'api').spec.clusterIP.replace(/\./g, '\\.')}\\s*$`),
    wrongHint: 'Use the Address line nslookup prints, the Service\'s ClusterIP, not a Pod IP.',
    debrief: 'DNS gives you the <b>Service</b> IP, never a Pod IP. kube-proxy then load-balances to whichever endpoints are Ready. That indirection is why Pods can die and come back with new IPs without anyone reconfiguring web.',
    lab: 'kubectl run -it --rm dns --image=busybox:1.36 --restart=Never -- nslookup kubernetes.default',
  },
  {
    id: 's3-nodeport', session: 3, title: 'Reach the Dashboard', par: 4,
    concept: [
      'Service types climb outward. <b>ClusterIP</b> is inside the cluster only. <b>NodePort</b> also opens a port (30000–32767) on <em>every</em> node\'s IP. <b>LoadBalancer</b> asks a cloud for an external IP.',
      '<code>kubectl expose</code> creates a Service from a Deployment\'s selector and port.',
    ],
    brief: 'The dashboard works inside the cluster, but your laptop can\'t see it. Open it to your browser through a <b>NodePort</b>, without touching the existing web Service.',
    objective: 'Create a NodePort Service for web and load the page from your laptop with curl http://NODE-IP:NODEPORT',
    files: fullStack(),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl expose deployment web --type=NodePort --port=80 --name=web-nodeport', 'kubectl get svc web-nodeport  → PORT(S) shows 80:3xxxx/TCP. Node IPs: 192.168.56.11 or .12', 'curl http://192.168.56.11:3xxxx'],
    solution: ['kubectl expose deployment web --type=NodePort --port=80 --name=web-nodeport', 'kubectl get svc web-nodeport', 'curl http://192.168.56.11:$(kubectl get svc web-nodeport -o jsonpath=\'{.spec.ports[0].nodePort}\')'],
    goal: (c, s) => !!s.flags.curledNodePort,
    debrief: 'A NodePort listens on <b>every</b> node, even nodes with no web Pod; kube-proxy forwards across the cluster. That is convenient for a lab and a big attack surface in production, where you would put an Ingress or a load balancer in front instead.',
    lab: 'kubectl expose deployment demo --type=NodePort --port=80 && curl http://$(kubectl get nodes -o jsonpath=\'{.items[0].status.addresses[0].address}\'):NODEPORT',
  },
  {
    id: 's3-readiness', session: 3, title: 'Running but Not Ready', par: 4,
    concept: [
      '<b>Liveness</b> answers "is it stuck?" If it fails, the kubelet <em>restarts</em> the container.',
      '<b>Readiness</b> answers "may it take traffic?" If it fails, the Pod stays Running but is <em>removed from Service endpoints</em>. No restart.',
      'Running 0/1 with zero restarts is the classic readiness signature.',
    ],
    brief: 'After a "harmless" probe refactor, the web Pods are Running, but the READY column says <b>0/1</b> and the dashboard is gone again.',
    objective: 'Get deployment/web to 2/2 Ready with endpoints.',
    files: fullStack({ web: web({ readiness: probe('/healthz', 80) }) }),
    setup: (c, s) => stackSetup()(c, s), warm: 6,
    hints: ['Zero restarts means liveness is fine. Look at readiness: kubectl describe pod -l app=web', '"Readiness probe failed: HTTP probe failed with statuscode: 404". Which path does liveness use successfully?', 'kubectl patch deployment web -p \'{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/health","port":80}}}]}}}}\''],
    solution: ['kubectl get pods -l app=web', 'kubectl describe pod -l app=web', 'kubectl patch deployment web -p \'{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/health","port":80}}}]}}}}\'', 'kubectl rollout status deployment/web'],
    goal: (c) => healthy(c, 'web', 2) && eps(c, 'web') === 2,
    debrief: 'The patch merged into the container <em>by name</em> (a strategic merge patch), so you didn\'t have to resend the whole container. A wrong readiness probe fails <b>safe</b>: no traffic. A wrong liveness probe fails <b>loud</b>: a restart loop. Never point liveness at a dependency (like the database); one DB blip would restart every Pod.',
    lab: 'kubectl get pods -w   while you break and fix a readinessProbe path',
  },
  {
    id: 's3-strand', session: 3, title: 'Strand the Database', type: 'answer', par: 3,
    concept: [
      'A <b>PersistentVolumeClaim</b> asks for storage. With the <code>local-path</code> StorageClass, the volume is a directory on <em>one node\'s disk</em>.',
      'Once bound, the PersistentVolume carries <b>node affinity</b>: any Pod using it can only ever run on that node.',
      'If that node dies, the scheduler refuses to move the Pod: <em>"volume node affinity conflict"</em>.',
    ],
    brief: 'One of the worker nodes just dropped off the network. postgres was evicted, and its replacement is stuck <b>Pending</b>. You can\'t list nodes or PersistentVolumes (you\'re a student), so the evidence has to come from what you <em>can</em> see.',
    objective: 'Answer with the name of the node that holds the database\'s data.',
    files: fullStack(),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    after: (c) => {
      const pg = c.list('Pod', NS).find((p) => p.metadata.labels.app === 'postgres');
      const node = c.get('Node', undefined, pg.spec.nodeName);
      node.status.ready = false;
      c.deleteObject('Pod', NS, pg.metadata.name); c.deletedPods--;
      c.tick(3);
    },
    hints: ['kubectl describe pod -l app=postgres  → "volume node affinity conflict"', 'The claim remembers where it was provisioned: kubectl describe pvc harbor-db-data (Annotations)', 'Or read history: kubectl get events | grep postgres'],
    solution: ['kubectl get pods', 'kubectl describe pod -l app=postgres', 'kubectl describe pvc harbor-db-data', 'answer $(kubectl get pvc harbor-db-data -o jsonpath=\'{.metadata.annotations.volume\\.kubernetes\\.io/selected-node}\')'],
    answer: (c) => new RegExp(`^\\s*${c.list('PersistentVolume')[0]._node}\\s*$`, 'i'),
    wrongHint: 'Not the node the new Pod is waiting for: the node the volume is pinned to.',
    debrief: 'Node-local storage trades availability for simplicity. In production, the database gets network storage (a CSI driver with a cloud disk or Ceph) or a replicated database operator. Then a node failure moves the Pod instead of stranding it. Put this on your "what I would not run in production" list.',
    lab: 'kubectl get pv -o jsonpath=\'{.items[*].spec.nodeAffinity}\'   # needs cluster-scoped read',
  },
  // ======================= SESSION 4 — Operate it
  {
    id: 's4-oom', session: 4, title: 'Watch a Limit Kill Web', par: 4,
    concept: [
      '<b>requests</b> are what the scheduler reserves on a node. <b>limits</b> are the ceiling the kernel enforces at runtime.',
      'Exceed the <em>memory</em> limit and the kernel\'s OOM killer ends the container: <code>OOMKilled</code>, exit code 137.',
      'CPU over its limit is only throttled. Memory over its limit is killed.',
    ],
    brief: 'Someone "tightened" web\'s memory limit to save space. Now the dashboard flaps. Find the evidence and give web a limit it can live in.',
    objective: 'Get deployment/web to 2/2 Ready and keep it there.',
    files: fullStack({ web: web({ resources: { requests: { cpu: '50m', memory: '32Mi' }, limits: { memory: '64Mi' } } }) }),
    setup: (c, s) => stackSetup()(c, s), warm: 8,
    hints: ['kubectl describe pod -l app=web  → Last State: Terminated, Reason: OOMKilled, Exit Code: 137', 'How much does web really use? kubectl top pods (when one is up), or trust the app: about 90Mi', 'kubectl set resources deployment web --limits=memory=128Mi'],
    solution: ['kubectl get pods -l app=web', 'kubectl describe pod -l app=web', 'kubectl set resources deployment web --limits=memory=128Mi', 'kubectl rollout status deployment/web'],
    goal: (c) => healthy(c, 'web', 2) && pods(c, 'web').every((p) => (p._rt?.restarts || 0) === 0),
    debrief: 'Exit code 137 = 128 + signal 9 (SIGKILL). Same mechanism as a host OOM kill, but scoped to a cgroup, so the node is healthy and only the container dies. Size limits from measurement (<code>kubectl top</code>, metrics history), not guesses.',
    lab: 'kubectl run hog --image=polinux/stress --limits=memory=50Mi -- stress --vm 1 --vm-bytes 100M',
  },
  {
    id: 's4-pending', session: 4, title: 'Ask for More Than Any Node Has', par: 4,
    concept: [
      'The <b>scheduler</b> only places a Pod on a node with enough <em>unrequested</em> capacity for the Pod\'s <code>requests</code>.',
      'If no node fits, the Pod stays <code>Pending</code> forever, with a <code>FailedScheduling</code> event that counts the reasons node by node.',
      'The control-plane node carries a taint, so ordinary Pods never land there.',
    ],
    brief: 'The worker was "given more CPU so it runs faster". Now it never starts at all.',
    objective: 'Get deployment/worker to 1/1 Ready.',
    files: fullStack({ worker: worker({ resources: { requests: { cpu: '4', memory: '32Mi' }, limits: { memory: '96Mi' } } }) }),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl describe pod -l app=worker  → FailedScheduling', '"2 Insufficient cpu": each worker node has 2 CPUs total. The request is 4.', 'kubectl set resources deployment worker --requests=cpu=100m'],
    solution: ['kubectl get pods', 'kubectl describe pod -l app=worker', 'kubectl set resources deployment worker --requests=cpu=100m', 'kubectl rollout status deployment/worker'],
    goal: (c) => healthy(c, 'worker', 1),
    debrief: 'Read FailedScheduling like a census: "0/3 nodes are available: 1 untolerated taint (control-plane), 2 Insufficient cpu". A request is a reservation, not a speed dial. Over-requesting wastes the cluster even when the Pod fits.',
    lab: 'kubectl describe nodes | grep -A6 "Allocated resources"   # admin',
  },
  {
    id: 's4-rollout', session: 4, title: 'Roll Out v2.0.0 While It Serves', par: 4,
    concept: [
      'Changing the Pod template starts a <b>rolling update</b>: a new ReplicaSet scales up while the old one scales down.',
      '<code>maxSurge</code> (extra Pods allowed) and <code>maxUnavailable</code> (Pods allowed missing) set the pace. Readiness gates every step.',
      '<code>kubectl rollout status</code> blocks until the rollout finishes or fails.',
    ],
    brief: 'Release day. Scale the API to <b>3 replicas</b> for headroom, then ship <code>harbor/api:2.0.0</code> without dropping traffic.',
    objective: 'Finish with deployment/api at 3/3 Ready, all on harbor/api:2.0.0, and the old ReplicaSet scaled to 0.',
    files: fullStack(),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl scale deployment api --replicas=3', 'kubectl set image deployment/api api=harbor/api:2.0.0', 'kubectl rollout status deployment/api, then  kubectl get rs'],
    solution: ['kubectl scale deployment api --replicas=3', 'kubectl set image deployment/api api=harbor/api:2.0.0', 'kubectl rollout status deployment/api', 'kubectl get rs'],
    goal: (c) => healthy(c, 'api', 3) && pods(c, 'api').every((p) => p.spec.containers[0].image === 'harbor/api:2.0.0') && c.rsOf(dep(c, 'api')).filter((r) => r.spec.replicas > 0).length === 1,
    debrief: 'The old ReplicaSet is kept at 0 replicas. That is your rollback point (<code>revisionHistoryLimit</code> keeps 10). Scaling does not create a revision; only template changes do.',
    lab: 'kubectl set image deployment/demo nginx=nginx:1.27 && kubectl rollout status deployment/demo && kubectl get rs',
  },
  {
    id: 's4-rollback', session: 4, title: 'Roll It Back', par: 4,
    concept: [
      'A bad rollout stalls: new Pods crash, readiness never passes, and the old ReplicaSet <em>keeps serving</em> because maxUnavailable protects it.',
      '<code>kubectl rollout history</code> lists revisions. <code>kubectl rollout undo</code> re-applies the previous template as a <em>new</em> revision.',
    ],
    brief: '<code>harbor/api:2.1.0</code> went out ten minutes ago. One new Pod is crash-looping, and the old ones are still answering. Stop the bleeding.',
    objective: 'Get every api Pod back to a working version, 2/2 Ready, with no 2.1.0 Pods left.',
    files: fullStack({ api: api({ image: 'harbor/api:2.0.0' }) }),
    setup: (c, s) => { stackSetup()(c, s); c.tick(4); const d = c.get('Deployment', NS, 'api'); d.metadata.annotations = { 'kubernetes.io/change-cause': 'release 2.0.0' }; const n = JSON.parse(JSON.stringify(d)); n.spec.template.spec.containers[0].image = 'harbor/api:2.1.0'; n.metadata.annotations['kubernetes.io/change-cause'] = 'release 2.1.0'; c.applyObject({ ...n, status: undefined }); c.tick(1); c.rsOf(c.get('Deployment', NS, 'api')).forEach((r) => { r.metadata.annotations['kubernetes.io/change-cause'] = r.spec.template.spec.containers[0].image.endsWith('2.1.0') ? 'release 2.1.0' : 'release 2.0.0'; }); },
    warm: 8,
    hints: ['kubectl get pods -l app=api  and  kubectl logs  the crashing one (panic: migration ...)', 'kubectl rollout history deployment/api', 'kubectl rollout undo deployment/api'],
    solution: ['kubectl get pods -l app=api', 'kubectl rollout history deployment/api', 'kubectl rollout undo deployment/api', 'kubectl rollout status deployment/api'],
    goal: (c) => healthy(c, 'api', 2) && pods(c, 'api').every((p) => p.spec.containers[0].image === 'harbor/api:2.0.0'),
    debrief: 'Undo is a <b>new revision</b> that reuses the old ReplicaSet, which is why <code>rollout history</code> renumbers. Rollback fixes the symptom; the migration bug still needs a ticket. In a GitOps world, you revert the commit instead, so the cluster and the repo don\'t drift apart.',
    lab: 'kubectl rollout undo deployment/demo --to-revision=1',
  },
  {
    id: 's4-ingress', session: 4, title: 'Route by Path', par: 3,
    concept: [
      'An <b>Ingress</b> is HTTP routing rules (host + path → Service). An <b>Ingress controller</b> (here, Traefik) implements them.',
      'Rules point at <em>Services</em> by name. A typo means Traefik silently drops the route: <code>404 page not found</code>.',
    ],
    brief: '<code>http://harbor.local/</code> shows the dashboard, but <code>http://harbor.local/api/ships</code> returns <b>404</b>. The Ingress manifest is in <code>~/harbor/ingress.yaml</code>.',
    objective: 'Make curl http://harbor.local/api/ships return the ship list.',
    files: { ...fullStack(), 'ingress.yaml': yaml({ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: 'harbor', namespace: NS }, spec: { ingressClassName: 'traefik', rules: [{ host: 'harbor.local', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } }, { path: '/api', pathType: 'Prefix', backend: { service: { name: 'api-svc', port: { number: 8080 } } } }] } }] } }) },
    setup: (c, s) => stackSetup(['config.yaml', 'db.yaml', 'api.yaml', 'web.yaml', 'worker.yaml', 'ingress.yaml'])(c, s), warm: 4,
    hints: ['kubectl describe ingress harbor  → look at the Backends column', 'Service "api-svc" does not exist. kubectl get svc', 'Edit ~/harbor/ingress.yaml (nano ingress.yaml), change api-svc to api, then  kubectl apply -f ingress.yaml'],
    solution: ['curl http://harbor.local/api/ships', 'kubectl describe ingress harbor', 'EDIT ingress.yaml api-svc=>api', 'kubectl apply -f ingress.yaml', 'curl http://harbor.local/api/ships'],
    goal: (c, s) => !!s.flags.curledIngressApi,
    debrief: 'Fixing the <b>file</b> and re-applying keeps your manifest the source of truth. A <code>kubectl edit</code> would work too, but it creates drift: the next <code>apply</code> of the old file breaks it again. That is the core argument for GitOps.',
    lab: 'kubectl describe ingress NAME   # the Backends column shows <error: ...> for a missing Service',
  },
  {
    id: 's4-lb', session: 4, title: 'The LoadBalancer That Never Arrives', type: 'answer', par: 2,
    concept: [
      '<code>type: LoadBalancer</code> asks the cluster for an external IP. Kubernetes itself has no load balancer. It asks a <b>cloud controller</b> (AWS, Azure, GCP) or an add-on such as <b>MetalLB</b> to provision one.',
      'With nothing listening, the Service works as a NodePort, and EXTERNAL-IP shows <code>&lt;pending&gt;</code> forever.',
    ],
    brief: 'A teammate created <code>web-public</code> as a LoadBalancer Service on this bare-metal lab cluster. It\'s been <code>&lt;pending&gt;</code> for ten minutes. They want to know what\'s broken.',
    objective: 'Answer: which missing component would assign the external IP? (one or two words)',
    files: fullStack(),
    setup: (c, s) => { stackSetup()(c, s); c.applyObject(service('web-public', 80, { selector: { app: 'web' }, type: 'LoadBalancer' })); }, warm: 4,
    hints: ['kubectl get svc web-public  → EXTERNAL-IP <pending>', 'kubectl describe svc web-public  → no events at all. Nobody is even trying.', 'On AWS this is the cloud controller manager; on bare metal it\'s an add-on like MetalLB.'],
    solution: ['kubectl get svc web-public', 'kubectl describe svc web-public', 'answer cloud controller manager'],
    answer: /cloud[\s-]*controller|\bccm\b|cloud[\s-]*provider|metal\s*lb|load[\s-]*balancer[\s-]*(controller|implementation|provider)/i,
    wrongHint: 'Nothing is broken in the Service itself. Something outside Kubernetes core is missing.',
    debrief: 'This is how cloud integration works in Kubernetes: core defines the <em>API</em>; a controller you install (cloud-controller-manager, MetalLB, kube-vip) makes it real. On EKS the AWS Load Balancer Controller watches these Services and creates an NLB. No controller means no load balancer, and no error message either.',
    lab: 'kubectl get svc -w   # on kind, install MetalLB and watch EXTERNAL-IP appear',
  },
  // ======================= EXPERT
  {
    id: 'x-secrets', session: 'X', title: 'Secrets Are Not Secret', type: 'answer', par: 2,
    concept: [
      'Secret values are <b>base64-encoded</b>, not encrypted. Anyone who can <code>get secrets</code>, or exec into a Pod that mounts them, can read them.',
      'Protection comes from RBAC (who can read), etcd encryption at rest, and external secret stores. Never from base64.',
    ],
    brief: 'Security review question: <em>"Can a namespace editor read the production database password?"</em> Prove it, as the student account.',
    objective: 'Answer with the database password stored in Secret harbor-db.',
    files: fullStack(),
    setup: (c, s) => stackSetup()(c, s), warm: 4,
    hints: ['kubectl get secret harbor-db -o yaml', 'kubectl get secret harbor-db -o jsonpath=\'{.data.DB_PASSWORD}\' | base64 -d', 'Or: kubectl exec deploy/worker -- env'],
    solution: ['kubectl get secret harbor-db -o yaml', 'answer $(kubectl get secret harbor-db -o jsonpath=\'{.data.DB_PASSWORD}\' | base64 -d)'],
    answer: /^\s*tide-7Kq2-harbor\s*$/,
    wrongHint: 'Decode it: base64 is an encoding, not encryption.',
    debrief: 'The built-in <code>edit</code> role includes reading Secrets. In an RMF/ISSO review that is an <b>AC-6</b> (least privilege) finding if editors shouldn\'t see credentials, and <b>SC-28</b> asks whether etcd encrypts them at rest. Mitigations: narrower Roles, an EncryptionConfiguration, and an external secrets operator.',
    lab: 'kubectl create secret generic demo --from-literal=pw=hunter2 && kubectl get secret demo -o jsonpath=\'{.data.pw}\' | base64 -d',
  },
  {
    id: 'x-drain', session: 'X', title: 'Drain Blocked by a Budget', admin: true, par: 4,
    concept: [
      '<code>kubectl drain</code> cordons a node (no new Pods), then <b>evicts</b> its Pods so their controllers recreate them elsewhere.',
      'A <b>PodDisruptionBudget</b> says "never voluntarily drop below N healthy Pods". Drain respects it and retries forever if an eviction would break it.',
    ],
    brief: 'You have the admin kubeconfig now. <b>worker-2</b> needs a kernel patch. The API has 2 replicas and a PDB of <code>minAvailable: 2</code>.',
    objective: 'Drain worker-2 completely (no harbor Pods left on it) while api keeps at least 2 Ready Pods.',
    files: { 'api.yaml': yaml(api({ envFrom: undefined, env: [{ name: 'DB_HOST', value: 'postgres' }] }), service('api', 8080), { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'api', namespace: NS }, spec: { minAvailable: 2, selector: { matchLabels: { app: 'api' } } } }), 'web.yaml': yaml(web(), service('web', 80)) },
    setup: (c, s) => stackSetup(['api.yaml', 'web.yaml'])(c, s), warm: 4,
    hints: ['kubectl drain worker-2 --ignore-daemonsets  → "Cannot evict pod as it would violate the pod\'s disruption budget"', 'kubectl get pdb  → ALLOWED DISRUPTIONS 0. Give it headroom instead of deleting the budget.', 'kubectl scale deployment api --replicas=3, wait for 3/3, then drain again'],
    solution: ['kubectl drain worker-2 --ignore-daemonsets', 'kubectl get pdb', 'kubectl scale deployment api --replicas=3', 'kubectl rollout status deployment/api', 'kubectl drain worker-2 --ignore-daemonsets'],
    goal: (c) => { const n = c.get('Node', undefined, 'worker-2'); return n.spec.unschedulable && !c.list('Pod', NS).some((p) => p.spec.nodeName === 'worker-2' && !p.metadata.deletionTimestamp) && (dep(c, 'api').status.readyReplicas || 0) >= 2; },
    debrief: 'A PDB equal to the replica count makes voluntary disruption impossible, which is a common foot-gun. Healthy patterns are <code>maxUnavailable: 1</code>, or <code>minAvailable</code> below the replicas. Remember <code>kubectl uncordon worker-2</code> after patching, or the node stays empty forever.',
    lab: 'kubectl drain NODE --ignore-daemonsets --delete-emptydir-data && kubectl uncordon NODE',
  },
  {
    id: 'x-scheduler', session: 'X', title: 'Nobody Is Scheduling', type: 'answer', admin: true, schedulerUp: false, par: 3,
    concept: [
      'The control plane is a set of programs: <b>kube-apiserver</b>, <b>etcd</b>, <b>kube-controller-manager</b>, <b>kube-scheduler</b>. On kubeadm clusters each one is a <em>static Pod</em> in <code>kube-system</code>.',
      'Controllers create Pods; only the <b>scheduler</b> assigns them to nodes. Without it, new Pods stay Pending, and since nothing evaluates them, there are no FailedScheduling events either.',
    ],
    brief: 'Nothing new will start on the cluster. Fresh Pods sit at <b>Pending with no events at all</b>, which is stranger than a FailedScheduling. You have admin.',
    objective: 'Answer with the name of the failed control-plane component.',
    files: { 'web.yaml': yaml(web(), service('web', 80)) },
    images: { 'registry.k8s.io/kube-scheduler:v1.33.4': { port: 10259, mem: 30, cpu: 10, requires: [], paths: {}, crash: ['I1118 08:52:01.412093       1 serving.go:386] Generated self-signed cert in-memory', 'E1118 08:52:01.412671       1 run.go:72] "command failed" err="unknown flag: --leader-elect-lease-duraton"'] }, 'registry.k8s.io/etcd:3.5.21-0': { port: 2379, mem: 60, cpu: 20, requires: [], paths: {} }, 'registry.k8s.io/kube-apiserver:v1.33.4': { port: 6443, mem: 250, cpu: 60, requires: [], paths: {} }, 'registry.k8s.io/kube-controller-manager:v1.33.4': { port: 10257, mem: 50, cpu: 20, requires: [], paths: {} }, 'registry.k8s.io/coredns/coredns:v1.12.0': { port: 53, mem: 20, cpu: 5, requires: [], paths: {} } },
    setup: (c, s) => {
      const sp = (name, image) => c.applyObject({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: 'kube-system', labels: { component: name.replace(/-control-plane$/, ''), tier: 'control-plane' } }, spec: { nodeName: 'control-plane', containers: [{ name: name.replace(/-control-plane$/, ''), image }] }, status: { phase: 'Pending', conditions: [] } });
      for (const [n, i] of [['etcd-control-plane', 'registry.k8s.io/etcd:3.5.21-0'], ['kube-apiserver-control-plane', 'registry.k8s.io/kube-apiserver:v1.33.4'], ['kube-controller-manager-control-plane', 'registry.k8s.io/kube-controller-manager:v1.33.4'], ['kube-scheduler-control-plane', 'registry.k8s.io/kube-scheduler:v1.33.4']]) sp(n, i);
      for (const [n, node] of [['coredns-674b8bbfcf-6xk2p', 'worker-1'], ['coredns-674b8bbfcf-tq9vz', 'worker-2']]) c.applyObject({ apiVersion: 'v1', kind: 'Pod', metadata: { name: n, namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } }, spec: { nodeName: node, containers: [{ name: 'coredns', image: 'registry.k8s.io/coredns/coredns:v1.12.0' }] }, status: { phase: 'Pending', conditions: [] } });
      stackSetup(['web.yaml'])(c, s);
    },
    warm: 12,
    hints: ['kubectl describe pod -l app=web  → Events: <none>. No scheduler has looked at it.', 'kubectl get pods -n kube-system', 'kubectl logs -n kube-system kube-scheduler-control-plane'],
    solution: ['kubectl get pods', 'kubectl describe pod -l app=web', 'kubectl get pods -n kube-system', 'kubectl logs -n kube-system kube-scheduler-control-plane', 'answer kube-scheduler'],
    answer: /^\s*(kube-)?scheduler(-control-plane)?\s*$/i,
    wrongHint: 'Which control-plane Pod in kube-system is not Running?',
    debrief: 'A typo in <code>/etc/kubernetes/manifests/kube-scheduler.yaml</code> (<code>--leader-elect-lease-duraton</code>) crash-loops the static Pod. The kubelet watches that directory, so the fix is editing the file on the control-plane node, not kubectl. "Pending with no events" points at the scheduler itself; "Pending with FailedScheduling" points at your Pod\'s requirements.',
    lab: 'ls /etc/kubernetes/manifests   # on a kubeadm control-plane node',
  },
];

export const SESSIONS = [
  { id: 2, title: 'Session 2 · Meet the Cluster', blurb: 'RBAC, Pods vs Deployments, the two first failures.' },
  { id: 3, title: 'Session 3 · The Whole App', blurb: 'ConfigMaps, Secrets, Services, DNS, probes, storage.' },
  { id: 4, title: 'Session 4 · Operate It', blurb: 'Limits, scheduling, rollouts, Ingress, the cloud boundary.' },
  { id: 'X', title: 'Expert · Beyond the Workshop', blurb: 'Secret exposure, drains and budgets, a broken control plane.' },
];
