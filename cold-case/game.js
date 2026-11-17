// Cold Case Server — DOM layer. All game logic lives in shell.js (pure, tested in Node).
import { CASES } from './cases.js?v=3';
import { createSession, runLine, score, budgetLine, completions } from './shell.js?v=3';

const $ = (id) => document.getElementById(id);
const STORE = 'coldcase:v1';

const store = {
  read() { try { return JSON.parse(localStorage.getItem(STORE)) || { best: {} }; } catch { return { best: {} }; } },
  write(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode: progress just isn't saved */ } },
};

let sess = null;       // current session
let order = null;      // shuffled option order per question
let hIdx = 0;          // history cursor

// ------------------------------------------------------------------ views
function show(view) {
  for (const v of ['select', 'play', 'verdict', 'debrief']) $(`view-${v}`).hidden = v !== view;
  window.scrollTo({ top: 0 });
}

function renderSelect() {
  const best = store.read().best;
  const grid = $('case-grid');
  grid.replaceChildren(...CASES.map((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'case-card';
    const strict = c.budget.mode === 'strict';
    b.innerHTML = `<span class="num">CASE ${String(c.num).padStart(2, '0')}</span><h3></h3><p></p>
      <div class="tags"><span class="tag"></span><span class="tag ${strict ? 'strict' : 'soft'}">${strict ? `strict · ${c.budget.limit} cmds` : `soft · par ${c.budget.limit}`}</span><span class="tag">${c.os === 'rhel9' ? 'RHEL 9' : c.os === 'ubuntu22' ? 'Ubuntu 22.04' : 'Debian 12'}</span></div>
      <span class="best"></span>`;
    b.querySelector('h3').textContent = c.title;
    b.querySelector('p').textContent = c.tagline;
    b.querySelector('.tag').textContent = c.difficulty;
    b.querySelector('.best').textContent = best[c.id] !== undefined ? `Best: ${best[c.id]}/100` : 'Not attempted';
    b.addEventListener('click', () => startCase(c));
    return b;
  }));
  show('select');
}

// ------------------------------------------------------------------ play
function startCase(c) {
  sess = createSession(c);
  hIdx = 0;
  order = Object.fromEntries(c.questions.map((q) => [q.id, shuffle(q.options.map((_, i) => i))]));
  $('case-kicker').textContent = `CASE ${String(c.num).padStart(2, '0')} · ${c.difficulty.toUpperCase()}`;
  $('case-title').textContent = c.title;
  $('case-brief').innerHTML = c.brief.map((p) => `<p>${p}</p>`).join(''); // brief is authored HTML in cases.js, never user input
  $('case-lens').textContent = `Lens: ${c.lens}`;
  $('q-list').replaceChildren(...c.questions.map((q) => { const li = document.createElement('li'); li.innerHTML = `<span class="lens-tag"></span>`; li.firstChild.textContent = q.lens.toUpperCase(); li.append(q.prompt); return li; }));
  $('prompt').textContent = c.prompt;
  $('term-out').replaceChildren();
  $('cmd').disabled = false; $('cmd').value = '';
  const w = sess.world;
  sys(`Connected to ${w.host.hostname} (${w.host.ifaces?.find((i) => i.name !== 'lo')?.addr.split('/')[0] || ''})\nLast login: ${new Date(w.now - 86400000 * 2).toUTCString().replace(' GMT', '')} from 10.0.0.5\nType  help  for the rules (free). Every read costs 1; a pipeline counts once.\n`);
  renderBoard([]);
  show('play');
  $('cmd').focus();
}

function line(cls, text) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  $('term-out').append(d);
  return d;
}
const sys = (t) => line('sys', t);

function renderBoard(fresh) {
  const c = sess.c;
  const used = sess.used; const limit = c.budget.limit;
  const fill = $('budget-fill');
  fill.style.width = `${Math.min(100, used / limit * 100)}%`;
  fill.classList.toggle('over', used > limit || (c.budget.mode === 'strict' && used >= limit - 2));
  $('budget-meter').setAttribute('aria-valuenow', String(used));
  $('budget-meter').setAttribute('aria-valuemax', String(limit));
  $('budget-label').textContent = budgetLine(sess);
  $('clue-count').textContent = `${sess.found.size}/${c.evidence.length}`;
  const freshIds = new Set(fresh.map((e) => e.id));
  $('clue-list').replaceChildren(...c.evidence.map((e) => {
    const li = document.createElement('li');
    if (sess.found.has(e.id)) { li.className = 'found' + (freshIds.has(e.id) ? ' fresh' : ''); li.textContent = `✔ ${e.label}`; }
    else li.textContent = '▢ undiscovered clue';
    return li;
  }));
}

function exec(raw) {
  const out = $('term-out');
  const cmdLine = document.createElement('div'); cmdLine.className = 'cmdline';
  const p = document.createElement('span'); p.className = 'p'; p.textContent = sess.c.prompt + ' ';
  cmdLine.append(p, raw);
  out.append(cmdLine);
  const r = runLine(sess, raw);
  if (r.clear) out.replaceChildren();
  // NUL bytes (e.g. /proc/PID/cmdline) are invisible on a real terminal too
  const text = r.out.replace(/\0/g, '');
  if (text) {
    for (const chunk of text.replace(/\n$/, '').split(/(?=⛔ BLOCKED)|(?=\n\[budget spent)|(?=\n\[that was your last)/)) {
      const cls = chunk.startsWith('⛔') ? 'viol' : /^\n\[(budget spent|that was)/.test(chunk) ? 'lock' : '';
      line(cls, chunk);
    }
  }
  for (const ev of r.newClues) line('clue', `🔎 clue: ${ev.label}`);
  if (r.cost && sess.c.budget.mode === 'strict') line('cost', `[−${r.cost} · ${sess.c.budget.limit - sess.used} left]`);
  renderBoard(r.newClues);
  if (sess.locked) { $('cmd').disabled = true; $('btn-verdict').focus(); }
  out.scrollTop = out.scrollHeight;
}

function onKey(e) {
  const input = $('cmd');
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = input.value; input.value = '';
    if (!v.trim()) { line('cmdline', sess.c.prompt + ' '); return; }
    exec(v); hIdx = sess.history.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); if (hIdx > 0) { hIdx--; input.value = sess.history[hIdx] ?? ''; }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault(); if (hIdx < sess.history.length) { hIdx++; input.value = sess.history[hIdx] ?? ''; }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const v = input.value; const words = v.split(/\s+/); const last = words.at(-1);
    const first = words.length === 1 || /[|;]\s*$/.test(words.slice(0, -1).join(' '));
    const opts = completions(sess, last, first);
    if (opts.length === 1) { words[words.length - 1] = opts[0] + (opts[0].endsWith('/') ? '' : ' '); input.value = words.join(' '); }
    else if (opts.length > 1) {
      const common = opts.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
      if (common.length > last.length) { words[words.length - 1] = common; input.value = words.join(' '); }
      else { line('sys', opts.slice(0, 40).join('   ')); $('term-out').scrollTop = 1e9; }
    }
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault(); $('term-out').replaceChildren();
  } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
    e.preventDefault(); line('cmdline', `${sess.c.prompt} ${input.value}^C`); input.value = '';
  }
}

// ------------------------------------------------------------------ verdict
function renderVerdict() {
  const c = sess.c;
  $('verdict-sub').textContent = `${sess.found.size}/${c.evidence.length} clues on the board · ${budgetLine(sess)}. Answer from your evidence, not your gut.`;
  const qs = c.questions.map((q) => {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.innerHTML = '<span class="lens-tag"></span>'; lg.firstChild.textContent = q.lens.toUpperCase(); lg.append(q.prompt);
    fs.append(lg);
    for (const i of order[q.id]) {
      const lab = document.createElement('label'); lab.className = 'opt';
      const inp = document.createElement('input'); inp.type = 'radio'; inp.name = `q-${q.id}`; inp.value = String(i); inp.required = true;
      lab.append(inp, document.createTextNode(q.options[i]));
      fs.append(lab);
    }
    return fs;
  });
  $('verdict-questions').replaceChildren(...qs);
  $('verdict-findings').replaceChildren(...c.findings.map((f, i) => {
    const lab = document.createElement('label'); lab.className = 'opt';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.name = `f-${i}`;
    lab.append(inp, document.createTextNode(f.text));
    return lab;
  }));
  show('verdict');
}

function submitVerdict(e) {
  e.preventDefault();
  const form = $('verdict-form');
  const c = sess.c;
  const answers = {
    q: Object.fromEntries(c.questions.map((q) => [q.id, Number(form.elements[`q-${q.id}`].value)])),
    f: c.findings.map((_, i) => form.elements[`f-${i}`].checked),
  };
  const r = score(sess, answers);
  const data = store.read();
  if (data.best[c.id] === undefined || r.total > data.best[c.id]) { data.best[c.id] = r.total; store.write(data); }
  renderDebrief(r);
}

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function section(title, ...kids) { const s = el('section', 'db-section'); s.append(el('h2', null, title), ...kids); return s; }

function renderDebrief(r) {
  const c = sess.c;
  const card = $('score-card');
  card.replaceChildren();
  const left = el('div');
  const big = el('div', 'score-big'); big.append(String(r.total), el('small', null, '/100'));
  left.append(big, el('div', 'grade', r.grade.toUpperCase()));
  const bd = el('div', 'breakdown');
  const cell = (label, val, neg) => { const d = el('div', neg ? 'neg' : ''); d.append(el('b', null, val), label); return d; };
  bd.append(
    cell('Verdict accuracy', `${r.verdict}/60`),
    cell(`Evidence (${sess.found.size}/${c.evidence.length} clues)`, `${r.evidence}/20`),
    cell(`Efficiency (${sess.used} cmds, par ${r.par})`, `${r.efficiency}/20`),
    ...(r.penalty ? [cell('Penalties', `−${r.penalty}`, true)] : []),
  );
  card.append(left, bd);

  const body = $('debrief-body');
  const kids = [];
  kids.push(section('Your verdict', ...r.qRes.map(({ q, picked, ok }) => {
    const d = el('div', `db-item ${ok ? 'ok' : 'bad'}`);
    d.append(el('div', 'q', `${ok ? '✔' : '✘'} ${q.prompt}`));
    if (!ok) d.append(el('div', 'a', `You said: ${q.options[picked] ?? '(no answer)'}`));
    d.append(el('div', 'a', `Answer: ${q.options[q.answer]}`), el('div', 'why', q.why));
    return d;
  })));
  kids.push(section('Findings', ...r.fRes.map(({ f, picked, ok }) => {
    const d = el('div', `db-item ${ok ? 'ok' : 'bad'}`);
    d.append(el('div', 'q', `${ok ? '✔' : '✘'} ${f.text}`), el('div', 'a', `${f.real ? 'Real finding' : 'Red herring / trap'} · you ${picked ? 'reported it' : 'left it out'}`), el('div', 'why', f.why));
    return d;
  })));
  if (sess.violations.length || sess.secretShown) {
    const items = sess.violations.map((v) => {
      const d = el('div', 'db-item bad');
      d.append(el('div', 'q', `⛔ ${v.cmd}`), el('div', 'why', `${v.why} (−25)`));
      return d;
    });
    if (sess.secretShown) {
      const d = el('div', 'db-item bad');
      d.append(el('div', 'q', '🔑 A credential file was printed to the screen'), el('div', 'why', 'Screens get recorded and shared. Confirm a secret exists with ls -l or grep -c, and never print it. (−5)'));
      items.push(d);
    }
    kids.push(section('Conduct', ...items));
  }
  if (r.missed.length) kids.push(section('Clues you missed', ...r.missed.map((e) => el('div', 'db-item bad', `▢ ${e.label}`))));
  const ol = el('ol', 'route');
  for (const s of c.expert) { const li = el('li'); li.append(el('code', null, s.cmd), el('span', 'why', s.why)); ol.append(li); }
  kids.push(section(`The expert route (${r.par} billable commands)`, ol));
  kids.push(section('Take-away', el('p', 'lesson', c.lesson)));
  body.replaceChildren(...kids);
  const idx = CASES.indexOf(c);
  $('btn-next').hidden = idx === CASES.length - 1;
  show('debrief');
}

// ------------------------------------------------------------------ util + wiring
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

$('cmd').addEventListener('keydown', onKey);
$('term').addEventListener('click', () => { if (!window.getSelection()?.toString()) $('cmd').focus(); });
$('btn-verdict').addEventListener('click', renderVerdict);
$('btn-abandon').addEventListener('click', renderSelect);
$('btn-back-investigate').addEventListener('click', () => { show('play'); $('cmd').focus(); });
$('verdict-form').addEventListener('submit', submitVerdict);
$('btn-retry').addEventListener('click', () => startCase(sess.c));
$('btn-cases').addEventListener('click', renderSelect);
$('btn-next').addEventListener('click', () => startCase(CASES[CASES.indexOf(sess.c) + 1]));
renderSelect();
