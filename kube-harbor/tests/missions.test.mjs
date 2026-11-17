// Run: node --test 'kube-harbor/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS } from '../missions.js';
import { createSession, runLine, saveEditor, checkGoal, jsonpath } from '../kubectl.js';
import { load, dump } from '../yaml.js';

const SHELL_ERR = /command not found|unknown command|this simulator supports|TypeError|undefined is not|Cannot read prop|is not a function|NaN/;

export function play(sess, step) {
  const m = step.match(/^EDIT (\S+) (.+)=>(.+)$/);
  if (m) { runLine(sess, `nano ${m[1]}`); return saveEditor(sess, sess.editor.text.replaceAll(m[2], m[3])); }
  return runLine(sess, step);
}

for (const m of MISSIONS) {
  test(`${m.id}: not solved at start, solved by its solution`, () => {
    const s = createSession(m);
    assert.equal(checkGoal(s), false, 'goal already true before the player acts');
    const outs = [];
    for (const step of m.solution) {
      const r = play(s, step);
      outs.push(`$ ${step}\n${r.out}`);
      assert.doesNotMatch(r.out, SHELL_ERR, `step "${step}":\n${r.out}`);
    }
    for (let i = 0; i < 20 && !s.solved; i++) { runLine(s, 'sleep 10'); }
    assert.ok(s.solved, `not solved after solution + 200s.\n${outs.join('\n').slice(-3000)}`);
  });

  test(`${m.id}: mission data is complete`, () => {
    for (const k of ['id', 'title', 'concept', 'brief', 'objective', 'hints', 'solution', 'debrief', 'lab']) assert.ok(m[k], `${m.id} missing ${k}`);
    assert.ok(m.hints.length >= 2);
    if (m.type === 'answer') assert.ok(m.answer); else assert.equal(typeof m.goal, 'function');
  });
}

test('wrong answers are rejected', () => {
  const s = createSession(MISSIONS[0]);
  assert.match(runLine(s, 'answer admin').out, /Not that/);
  assert.equal(s.solved, false);
});

test('RBAC: student cannot list nodes or other namespaces, can read own', () => {
  const s = createSession(MISSIONS[0]);
  assert.match(runLine(s, 'kubectl get nodes').out, /Forbidden.*cannot list resource "nodes".*cluster scope/);
  assert.match(runLine(s, 'kubectl get pods -n kube-system').out, /Forbidden.*namespace "kube-system"/);
  assert.match(runLine(s, 'kubectl get pods').out, /No resources found in harbor namespace/);
  assert.equal(runLine(s, 'kubectl auth can-i create rolebindings').out, 'no\n');
  assert.equal(runLine(s, 'kubectl auth can-i delete pods').out, 'yes\n');
});

test('relabeling a pod releases it from its ReplicaSet (the durable-fix trap)', () => {
  const m = MISSIONS.find((x) => x.id === 's3-endpoints');
  const s = createSession(m);
  const pod = s.cluster.list('Pod', 'harbor').find((p) => p.metadata.labels.app === 'api');
  runLine(s, `kubectl label pod ${pod.metadata.name} app=harbor-api --overwrite`);
  runLine(s, 'sleep 30');
  const apiPods = s.cluster.list('Pod', 'harbor').filter((p) => p.metadata.labels.app === 'api');
  assert.equal(apiPods.length, 2, 'ReplicaSet should replace the released pod');
  assert.equal(s.solved, false, 'labeling pods is not a durable fix');
});

test('kubectl edit round-trips through YAML and applies', () => {
  const m = MISSIONS.find((x) => x.id === 's3-readiness');
  const s = createSession(m);
  const r = runLine(s, 'kubectl edit deployment web');
  assert.ok(r.editor && /readinessProbe/.test(r.editor.text));
  const out = saveEditor(s, r.editor.text.replace('path: /healthz', 'path: /health'));
  assert.match(out.out, /deployment\.apps\/web edited/);
  for (let i = 0; i < 20 && !s.solved; i++) runLine(s, 'sleep 10');
  assert.ok(s.solved);
});

test('ImagePullBackOff shows events, not logs', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 's2-imagepull'));
  const pod = s.cluster.list('Pod', 'harbor')[0].metadata.name;
  assert.match(runLine(s, 'kubectl get pods').out, /ImagePullBackOff|ErrImagePull/);
  assert.match(runLine(s, `kubectl logs ${pod}`).out, /waiting to start: trying and failing to pull image/);
  assert.match(runLine(s, `kubectl describe pod ${pod}`).out, /Failed to pull image "harbor\/api:1.4".*not found/);
});

test('CrashLoopBackOff: restarts climb, logs and --previous explain', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 's2-crashloop'));
  const out = runLine(s, 'kubectl get pods').out;
  assert.match(out, /CrashLoopBackOff|Error/);
  assert.match(out, /\d+ \(\d+s ago\)/);
  assert.match(runLine(s, 'kubectl logs deploy/api --previous').out, /DB_HOST is not set/);
});

test('OOMKilled shows exit 137 in describe', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 's4-oom'));
  assert.match(runLine(s, 'kubectl describe pod -l app=web').out, /Reason:\s+OOMKilled[\s\S]*Exit Code:\s+137/);
});

test('Pending shows a FailedScheduling census', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 's4-pending'));
  assert.match(runLine(s, 'kubectl describe pod -l app=worker').out, /0\/3 nodes are available: 2 Insufficient cpu, 1 node\(s\) had untolerated taint \{node-role.kubernetes.io\/control-plane: \}/);
});

test('bad rollout keeps old pods serving (maxUnavailable protects)', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 's4-rollback'));
  const ready20 = s.cluster.list('Pod', 'harbor').filter((p) => p.metadata.labels.app === 'api' && p.spec.containers[0].image.endsWith('2.0.0') && s.cluster.isReady(p));
  assert.equal(ready20.length, 2);
  assert.match(runLine(s, 'kubectl rollout history deployment/api').out, /1\s+release 2\.0\.0\n2\s+release 2\.1\.0/);
});

test('no scheduler: pending pods have no events', () => {
  const s = createSession(MISSIONS.find((x) => x.id === 'x-scheduler'));
  assert.match(runLine(s, 'kubectl describe pod -l app=web').out, /Events:\s+<none>/);
  assert.match(runLine(s, 'kubectl get pods -n kube-system').out, /kube-scheduler-control-plane\s+0\/1\s+(CrashLoopBackOff|Error)/);
});

test('yaml round-trips every manifest file', () => {
  for (const m of MISSIONS) for (const [name, text] of Object.entries(m.files || {})) for (const doc of text.split('\n---\n')) {
    const o = load(doc); assert.deepEqual(load(dump(o)), o, `${m.id}/${name}`);
  }
});

test('jsonpath basics', () => {
  const o = { a: { 'x.y/z': 1, list: [{ n: 'p' }, { n: 'q' }] } };
  assert.equal(jsonpath(o, "{.a.x\\.y/z}"), '1');
  assert.equal(jsonpath(o, '{.a.list[*].n}'), 'p q');
  assert.equal(jsonpath(o, '{.a.list[0].n}'), 'p');
});

test('every mission survives a battery of read commands', () => {
  const cmds = ['kubectl get all', 'kubectl get pods -o wide', 'kubectl get deploy,svc', 'kubectl get events', 'kubectl describe pods', 'kubectl describe deployment', 'kubectl describe svc', 'kubectl get endpoints', 'kubectl get rs -o wide', 'kubectl get pods -o yaml', 'kubectl top pods', 'kubectl get cm,secret', 'kubectl get pvc', 'kubectl get ingress', 'kubectl describe ingress', 'kubectl get pods -w', 'ls', 'kubectl get pods --show-labels | grep app=', 'help'];
  for (const m of MISSIONS) {
    const s = createSession(m);
    for (const c of cmds) { const r = runLine(s, c); assert.doesNotMatch(r.out, /TypeError|undefined|NaN|\[object Object\]/, `${m.id}: ${c}\n${r.out.slice(0, 1500)}`); }
  }
});
