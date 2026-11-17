// Kube Harbor — DOM layer. All cluster logic lives in cluster.js / kubectl.js (tested in Node).
import { MISSIONS, SESSIONS } from './missions.js?v=1';
import { createSession, runLine, saveEditor } from './kubectl.js?v=1';

const $ = (id) => document.getElementById(id);
const KEY = 'kubeharbor:v1';
const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)) || { stars: {}, last: null }; } catch { return { stars: {}, last: null }; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: progress isn't saved */ } },
};

let sess = null; let mission = null; let hIdx = 0; let showedSolution = false;

// ------------------------------------------------------------------ sidebar
function renderList() {
  const stars = store.read().stars;
  const nav = $('mission-list');
  nav.replaceChildren(...SESSIONS.map((s) => {
    const box = document.createElement('div'); box.className = 'session';
    const h = document.createElement('h3'); h.textContent = s.title;
    const p = document.createElement('p'); p.textContent = s.blurb;
    box.append(h, p);
    for (const m of MISSIONS.filter((x) => x.session === s.id)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn';
      if (m === mission) b.setAttribute('aria-current', 'true');
      const t = document.createElement('span'); t.textContent = m.title;
      const st = document.createElement('span'); st.className = 'st'; st.textContent = stars[m.id] ? '★'.repeat(stars[m.id]) + '☆'.repeat(3 - stars[m.id]) : '';
      b.append(t, st);
      b.addEventListener('click', () => { start(m); if (window.matchMedia('(max-width: 860px)').matches) toggleList(false); });
      box.append(b);
    }
    return box;
  }));
  const done = Object.keys(stars).length; const total = Object.values(stars).reduce((a, b) => a + b, 0);
  $('progress').textContent = `${done}/${MISSIONS.length} missions · ★ ${total}/${MISSIONS.length * 3}`;
}
function toggleList(open) {
  const nav = $('mission-list'); const btn = $('btn-toggle-list');
  const isOpen = open ?? nav.classList.contains('collapsed');
  nav.classList.toggle('collapsed', !isOpen);
  btn.setAttribute('aria-expanded', String(isOpen)); btn.textContent = isOpen ? 'Hide list' : 'Show list';
}

// ------------------------------------------------------------------ mission
function start(m) {
  mission = m; sess = createSession(m); hIdx = 0; showedSolution = false;
  const data = store.read(); data.last = m.id; store.write(data);
  const sessLabel = m.session === 'X' ? 'EXPERT' : `SESSION ${m.session}`;
  $('m-kicker').textContent = `${sessLabel} · ${m.type === 'answer' ? 'DIAGNOSE & ANSWER' : 'FIX THE CLUSTER'}${m.admin ? ' · ADMIN KUBECONFIG' : ''}`;
  $('m-title').textContent = m.title;
  $('m-concept').innerHTML = m.concept.map((c) => `<li>${c}</li>`).join(''); // authored HTML in missions.js, never user input
  $('m-brief').innerHTML = m.brief;
  $('m-objective').textContent = m.objective;
  $('hint-list').replaceChildren();
  $('solution').hidden = true; $('solution').textContent = '';
  $('debrief').hidden = true;
  $('term-out').replaceChildren();
  $('cmd').value = '';
  sys(`Kube Harbor · ${m.admin ? 'context kubernetes-admin@harbor (cluster-admin)' : 'context student@harbor (namespace: harbor)'}\nType  help  for commands, ${m.type === 'answer' ? 'answer YOUR ANSWER  when you know,' : ''} objective  to re-read the goal. Manifests: ls\n`);
  renderStat(); renderMap(); renderList();
  $('cmd').focus({ preventScroll: true });
}
function renderStat() { $('m-stat').textContent = `kubectl commands: ${sess.cmds} · par ${mission.par}${sess.hints ? ` · hints ${sess.hints}` : ''}`; }

function line(cls, text) { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; $('term-out').append(d); return d; }
const sys = (t) => line('sys', t);

function exec(raw) {
  const out = $('term-out');
  const cl = document.createElement('div'); cl.className = 'cmdline';
  const p = document.createElement('span'); p.className = 'p'; p.textContent = 'student@laptop:~/harbor$ ';
  cl.append(p, raw); out.append(cl);
  const r = runLine(sess, raw);
  if (r.clear) out.replaceChildren();
  if (r.out) line(/^(Error from server|error:|-bash:|curl: \(|✘)/.test(r.out) ? 'err' : '', r.out.replace(/\n$/, ''));
  if (r.editor) openEditor(r.editor);
  after(r);
  out.scrollTop = out.scrollHeight;
}
function after(r) {
  if (/💡 Hint/.test(r.out || '')) addHintToList();
  renderStat(); renderMap();
  if (r.solved) win();
}
function addHintToList() { const li = document.createElement('li'); li.textContent = mission.hints[sess.hints - 1]; $('hint-list').append(li); }

function win() {
  const stars = showedSolution ? 1 : sess.hints === 0 && sess.cmds <= mission.par * 2 ? 3 : sess.hints <= 1 ? 2 : 1;
  const data = store.read(); data.stars[mission.id] = Math.max(stars, data.stars[mission.id] || 0); store.write(data);
  line('win', `✔ MISSION COMPLETE: ${mission.title}`);
  $('d-title').textContent = `Mission complete: ${mission.title}`;
  $('d-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('d-stars').setAttribute('aria-label', `${stars} of 3 stars`);
  $('d-text').innerHTML = mission.debrief;
  $('d-lab').textContent = mission.lab;
  const idx = MISSIONS.indexOf(mission);
  $('btn-next').hidden = idx === MISSIONS.length - 1;
  $('debrief').hidden = false;
  renderList();
  $('debrief').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ------------------------------------------------------------------ cluster map
function podClass(c, p) {
  if (p.metadata.deletionTimestamp) return 'pend';
  if (!p.spec.nodeName) return 'pend';
  if (c.isReady(p)) return 'ok';
  const d = p.status._display;
  return ['CrashLoopBackOff', 'Error', 'OOMKilled', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError'].includes(d) ? 'bad' : 'warn';
}
function chip(c, p) {
  const s = document.createElement('span');
  s.className = `pod ${podClass(c, p)}`;
  const app = p.metadata.labels?.app || p.metadata.labels?.component || p.metadata.labels?.['k8s-app'] || p.metadata.name;
  s.textContent = `${app}·${p.metadata.name.slice(-5)}`;
  s.title = `${p.metadata.name}: ${p.metadata.deletionTimestamp ? 'Terminating' : p.status._display === 'Pending' && p.spec.nodeName ? 'ContainerCreating' : p.status._display || 'Pending'}`;
  return s;
}
function renderMap() {
  const c = sess.cluster;
  const pods = c.list('Pod', 'harbor');
  const box = document.createDocumentFragment();
  for (const n of c.list('Node')) {
    const d = document.createElement('div');
    d.className = `node${n.spec.unschedulable ? ' cordoned' : ''}${c.user.admin && !n.status.ready ? ' down' : ''}`;
    const h = document.createElement('div'); h.className = 'node-h';
    const b = document.createElement('b'); b.textContent = n.metadata.name;
    const tag = document.createElement('span');
    tag.textContent = [n._role === 'control-plane' ? 'control-plane' : 'worker', n.spec.unschedulable ? 'cordoned' : '', c.user.admin && !n.status.ready ? 'NotReady' : ''].filter(Boolean).join(' · ');
    h.append(b, tag); d.append(h);
    const ps = document.createElement('div'); ps.className = 'pods';
    const here = [...pods, ...(c.user.admin ? c.list('Pod', 'kube-system') : [])].filter((p) => p.spec.nodeName === n.metadata.name);
    if (here.length) here.forEach((p) => ps.append(chip(c, p))); else { const e = document.createElement('span'); e.className = 'empty'; e.textContent = n._role === 'control-plane' ? 'tainted: no workload pods' : 'no pods'; ps.append(e); }
    d.append(ps); box.append(d);
  }
  const pend = pods.filter((p) => !p.spec.nodeName);
  if (pend.length) { const d = document.createElement('div'); d.className = 'node'; const h = document.createElement('div'); h.className = 'node-h'; h.textContent = 'unscheduled (Pending)'; const ps = document.createElement('div'); ps.className = 'pods'; pend.forEach((p) => ps.append(chip(c, p))); d.append(h, ps); box.append(d); }
  const svcs = c.list('Service', 'harbor');
  if (svcs.length) {
    const ul = document.createElement('div'); ul.className = 'svc-list';
    for (const s of svcs) { const n = c.readyEndpoints(s).length; const row = document.createElement('div'); row.textContent = `svc/${s.metadata.name} → ${n ? `${n} endpoint${n > 1 ? 's' : ''}` : '<none>'}`; if (!n) row.className = 'none'; ul.append(row); }
    box.append(ul);
  }
  $('map').replaceChildren(box);
}

// ------------------------------------------------------------------ editor
function openEditor(ed) {
  $('ed-title').textContent = ed.title;
  $('ed-text').value = ed.text;
  $('editor').showModal();
  $('ed-text').focus(); $('ed-text').setSelectionRange(0, 0); $('ed-text').scrollTop = 0;
}
function closeEditor(save) {
  if (!$('editor').open) return;
  $('editor').close();
  if (save) { const r = saveEditor(sess, $('ed-text').value); if (r.out) line(/^error/.test(r.out) ? 'err' : '', r.out.replace(/\n$/, '')); else sys('[saved]'); after(r); }
  else { sess.editor = null; sys('[edit cancelled]'); }
  $('term-out').scrollTop = 1e9;
  $('cmd').focus();
}

// ------------------------------------------------------------------ wiring
$('cmd').addEventListener('keydown', (e) => {
  const input = $('cmd');
  if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; if (v.trim()) { exec(v); hIdx = sess.history.length; } else line('cmdline', 'student@laptop:~/harbor$ '); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) input.value = sess.history[--hIdx] ?? ''; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx < sess.history.length) input.value = sess.history[++hIdx] ?? ''; }
  else if (e.key === 'Tab') {
    e.preventDefault();
    const words = input.value.split(' '); const last = words.at(-1);
    const pool = [...new Set([...sess.cluster.list('Pod', 'harbor').map((p) => p.metadata.name), ...sess.cluster.list('Deployment', 'harbor').map((d) => `deployment/${d.metadata.name}`), ...[...sess.files.keys()].map((f) => f.split('/').pop()), 'kubectl', 'describe', 'get', 'logs', 'pods', 'deployment', 'service', 'endpoints', 'rollout', 'status', 'history', 'undo'])];
    const opts = pool.filter((x) => x.startsWith(last));
    if (opts.length === 1) { words[words.length - 1] = opts[0] + ' '; input.value = words.join(' '); }
    else if (opts.length > 1) { const common = opts.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); }); if (common.length > last.length) { words[words.length - 1] = common; input.value = words.join(' '); } else { sys(opts.slice(0, 30).join('   ')); $('term-out').scrollTop = 1e9; } }
  } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); $('term-out').replaceChildren(); }
});
$('term').addEventListener('click', () => { if (!window.getSelection()?.toString()) $('cmd').focus(); });
$('btn-hint').addEventListener('click', () => { exec('hint'); });
$('btn-solution').addEventListener('click', () => {
  showedSolution = true;
  $('solution').textContent = mission.solution.map((s) => { const m = s.match(/^EDIT (\S+) (.+)=>(.+)$/); return m ? `nano ${m[1]}        # change "${m[2]}" to "${m[3]}", then Save & exit` : s; }).join('\n');
  $('solution').hidden = false;
});
$('btn-reset').addEventListener('click', () => start(mission));
$('btn-next').addEventListener('click', () => start(MISSIONS[MISSIONS.indexOf(mission) + 1]));
$('btn-stay').addEventListener('click', () => { $('debrief').hidden = true; $('cmd').focus(); });
$('btn-toggle-list').addEventListener('click', () => toggleList());
$('ed-save').addEventListener('click', () => closeEditor(true));
$('ed-cancel').addEventListener('click', () => closeEditor(false));
$('editor').addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(false); });
$('ed-text').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); closeEditor(true); }
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const i = t.selectionStart; t.setRangeText('  ', i, t.selectionEnd, 'end'); }
});

if (window.matchMedia('(max-width: 860px)').matches) toggleList(false);
const last = store.read().last;
start(MISSIONS.find((m) => m.id === last) || MISSIONS[0]);
