// Cold Case Server — simulated shell engine.
// Every view of the machine (ss, netstat, lsof, /proc/net/tcp, ps, /proc/PID/*) is rendered
// from ONE world model per case, so two tools can never disagree about the same socket.
// Pure module: no DOM. Runs in the browser and under `node --test`.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PORT_NAMES = { 22: 'ssh', 25: 'smtp', 80: 'http', 111: 'sunrpc', 443: 'https', 5432: 'postgresql', 8000: 'irdmi', 8080: 'http-alt', 9000: 'cslistener' };

// Commands that cost nothing: game meta-commands and pure calculators.
const FREE = new Set(['help', 'clear', 'history', 'clues', 'man', 'echo', 'printf', 'pwd', 'cd', 'exit', 'logout', 'budget']);

const DESTRUCTIVE = [
  [/^(kill|pkill|killall|skill)\b/, 'You killed a process on a server you were only asked to characterize.'],
  [/^systemctl\s+(.*\s)?(stop|restart|kill|disable|mask|reload|start|try-restart|daemon-reload|isolate|reboot|poweroff)\b/, 'You changed a service state with no ticket and no rollback plan.'],
  [/^(docker|podman)\s+(stop|kill|rm|rmi|restart|pause|unpause|start|update|system\s+prune|container\s+(stop|rm|kill|restart))\b/, 'You changed a running container during a read-only review.'],
  [/^(reboot|shutdown|poweroff|halt|init\s+[06])\b/, 'You rebooted an undocumented production box.'],
  [/^(rm|mv|cp|truncate|dd|mkfs\S*|shred|chmod|chown|chattr|ln|touch|mkdir|rmdir|tee|sed\s+-i|install)\b/, 'You modified the filesystem during a read-only review.'],
  [/^setenforce\b/, 'You switched SELinux mode. On a real system that is a security-control change needing approval.'],
  [/^(iptables|ip6tables|nft)\s+(-F|-X|-D|-A|-I|flush|add|delete|insert)/, 'You edited firewall rules with no change ticket.'],
  [/^(ufw\s+(disable|enable|allow|deny|delete|reset)|firewall-cmd\s+.*--(add|remove|set|reload|panic))/, 'You changed the host firewall during a read-only review.'],
  [/^(apt|apt-get|dnf|yum|rpm|dpkg|pip3?|snap)\s+(install|remove|purge|upgrade|update|erase|-i|-e|--install|-U)\b/, 'You installed or changed packages during a change freeze.'],
  [/^(setsebool|semanage|restorecon|chcon|usermod|useradd|userdel|passwd|visudo|crontab\s+-[er])\b/, 'You changed system configuration without a ticket.'],
];

// ---------------------------------------------------------------- time helpers
function parseTs(s) {
  const [d, t = '00:00:00'] = s.split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m, sec = 0] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, m, sec);
}
const p2 = (n) => String(n).padStart(2, '0');
const hms = (d) => `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
const shortTs = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${hms(d)}`; };
const longTs = (ms) => { const d = new Date(ms); return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${hms(d)} ${d.getUTCFullYear()}`; };
const isoish = (ms) => { const d = new Date(ms); return `${DOW[d.getUTCDay()]} ${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${hms(d)} UTC`; };
function ago(sec) {
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}
function etime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (d) return `${d}-${p2(h)}:${p2(m)}:${p2(s)}`;
  if (h) return `${p2(h)}:${p2(m)}:${p2(s)}`;
  return `${p2(m)}:${p2(s)}`;
}

// ---------------------------------------------------------------- text helpers
const lines = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
const join = (ls) => (ls.length ? ls.join('\n') + '\n' : '');
function table(rows, rightAlign = new Set()) {
  const w = [];
  rows.forEach((r) => r.forEach((c, i) => { if (i < r.length - 1) w[i] = Math.max(w[i] || 0, String(c).length); }));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? String(c) : rightAlign.has(i) ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join(' ').trimEnd());
}
function ipToHex(ip) {
  return ip.split('.').map(Number).reverse().map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// ---------------------------------------------------------------- OS profiles
const OS = {
  debian12: {
    release: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION="12 (bookworm)"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL="https://www.debian.org/"\n',
    kernel: '6.1.0-27-cloud-amd64', syslog: '/var/log/syslog', authlog: '/var/log/auth.log', dmesgRestrict: true, family: 'debian',
  },
  ubuntu22: {
    release: 'PRETTY_NAME="Ubuntu 22.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04.5 LTS (Jammy Jellyfish)"\nVERSION_CODENAME=jammy\nID=ubuntu\nID_LIKE=debian\n',
    kernel: '6.8.0-1018-aws', syslog: '/var/log/syslog', authlog: '/var/log/auth.log', dmesgRestrict: true, family: 'debian',
  },
  rhel9: {
    release: 'NAME="Red Hat Enterprise Linux"\nVERSION="9.4 (Plow)"\nID="rhel"\nID_LIKE="fedora"\nVERSION_ID="9.4"\nPLATFORM_ID="platform:el9"\nPRETTY_NAME="Red Hat Enterprise Linux 9.4 (Plow)"\nANSI_COLOR="0;31"\n',
    kernel: '5.14.0-427.42.1.el9_4.x86_64', syslog: '/var/log/messages', authlog: '/var/log/secure', dmesgRestrict: false, family: 'rhel',
  },
};

// ---------------------------------------------------------------- world build
export function buildWorld(c) {
  const os = OS[c.os];
  const now = parseTs(c.now);
  const boot = now - c.host.uptimeSec * 1000;
  const procs = c.processes.map((p) => ({
    tty: '?', stat: 'S', time: '0:00', cpu: 0, mem: 0, rss: 0, vsz: 0, ...p,
    startMs: p.started ? parseTs(p.started) : boot,
    comm: p.comm || p.cmd.split(' ')[0].split('/').pop().replace(/:$/, ''),
  }));
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // fds: 0-2 are /dev/null, sockets from 3 upward in declaration order
  const fdCount = new Map();
  let nextInode = 18230;
  const sockets = c.sockets.map((s) => {
    const sock = { raddr: s.proto === 'tcp6' ? '::' : '0.0.0.0', rport: 0, ...s, inode: s.inode || nextInode++ };
    if (sock.pid) {
      const n = (fdCount.get(sock.pid) || 3);
      sock.fd = sock.fd || n;
      fdCount.set(sock.pid, Math.max(n, sock.fd) + 1);
      const p = byPid.get(sock.pid);
      if (!p) throw new Error(`${c.id}: socket references missing pid ${sock.pid}`);
      sock.prog = p.comm;
      sock.uid = p.uid ?? 0;
    }
    return sock;
  });
  const services = (c.services || []).map((s) => ({
    load: 'loaded', active: 'active', sub: 'running', enabled: 'enabled', nrestarts: 0, ...s,
    unit: s.unit.includes('.') ? s.unit : `${s.unit}.service`,
  }));
  const w = { c, os, now, boot, procs, byPid, sockets, services, user: c.user, home: c.home, host: c.host };
  w.vfs = buildVfs(w);
  return w;
}

function fileNode(v, defOwner) {
  const n = typeof v === 'string' ? { content: v } : { ...v };
  return { type: 'file', owner: defOwner, group: defOwner, mode: '-rw-r--r--', mtime: 'Nov 14 08:02', ...n };
}

function buildVfs(w) {
  const { c, os } = w;
  const fs = new Map();
  const put = (path, node) => fs.set(path, node);
  for (const [path, v] of Object.entries(c.files || {})) put(path, fileNode(v, path.startsWith(w.home) ? w.user : 'root'));
  put('/etc/os-release', fileNode(os.release, 'root'));
  put('/etc/hostname', fileNode(c.host.hostname + '\n', 'root'));
  put('/proc/loadavg', fileNode(`${c.host.load.map((x) => x.toFixed(2)).join(' ')} ${w.procs.filter((p) => p.stat[0] === 'R').length}/${w.procs.length} ${w.procs.at(-1).pid + 3}\n`, 'root'));
  put('/proc/uptime', fileNode(`${c.host.uptimeSec}.42 ${(c.host.uptimeSec * c.host.cpus * 0.3).toFixed(2)}\n`, 'root'));
  const m = c.host.mem;
  put('/proc/meminfo', fileNode([
    ['MemTotal', m.total * 1024], ['MemFree', m.free * 1024], ['MemAvailable', m.available * 1024],
    ['Buffers', Math.round(m.buffcache * 0.08) * 1024], ['Cached', Math.round(m.buffcache * 0.85) * 1024],
    ['SwapTotal', (m.swapTotal || 0) * 1024], ['SwapFree', ((m.swapTotal || 0) - (m.swapUsed || 0)) * 1024],
    ['Shmem', (m.shared || 0) * 1024],
  ].map(([k, v]) => `${(k + ':').padEnd(16)}${String(v).padStart(8)} kB`).join('\n') + '\n', 'root'));
  put('/proc/cpuinfo', fileNode(Array.from({ length: c.host.cpus }, (_, i) => `processor\t: ${i}\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz\ncpu MHz\t\t: 2499.998\n`).join('\n'), 'root'));
  put('/proc/net/tcp', fileNode(procNet(w, 'tcp'), 'root'));
  put('/proc/net/tcp6', fileNode(procNet(w, 'tcp6'), 'root'));
  put('/proc/net/udp', fileNode(procNet(w, 'udp'), 'root'));
  // journal-backed syslog file
  const sys = w.c.journal.filter((e) => !e.journalOnly).map((e) => `${syslogStamp(parseTs(e.ts))} ${c.host.hostname} ${e.ident}${e.pid ? `[${e.pid}]` : ''}: ${e.msg}`);
  if (!fs.has(os.syslog)) put(os.syslog, fileNode({ content: join(sys), owner: 'root', group: os.family === 'debian' ? 'adm' : 'root', mode: '-rw-r-----', root: true, mtime: shortTs(w.now).slice(0, 12) }, 'root'));
  // /proc/PID
  const sockByPid = new Map();
  for (const s of w.sockets) if (s.pid) (sockByPid.get(s.pid) || sockByPid.set(s.pid, []).get(s.pid)).push(s);
  const pstamp = shortTs(w.now).slice(0, 12);
  for (const p of w.procs) {
    const base = `/proc/${p.pid}`;
    const priv = { owner: p.user, group: p.user, ownerPid: p.pid, procPriv: true };
    put(base, { type: 'dir', owner: p.user, group: p.user, mode: 'dr-xr-xr-x', mtime: pstamp });
    put(`${base}/cmdline`, fileNode({ content: p.cmd.split(' ').join('\0') + '\0', owner: p.user, group: p.user, mode: '-r--r--r--', mtime: pstamp }, p.user));
    put(`${base}/comm`, fileNode({ content: p.comm.slice(0, 15) + '\n', owner: p.user, group: p.user, mtime: pstamp }, p.user));
    put(`${base}/status`, fileNode({ content: `Name:\t${p.comm.slice(0, 15)}\nState:\t${p.stat[0]} (${p.stat[0] === 'R' ? 'running' : 'sleeping'})\nPid:\t${p.pid}\nPPid:\t${p.ppid}\nUid:\t${p.uid ?? 0}\t${p.uid ?? 0}\t${p.uid ?? 0}\t${p.uid ?? 0}\nVmRSS:\t${String(p.rss).padStart(8)} kB\nThreads:\t${p.threads || 1}\n`, owner: p.user, group: p.user, mtime: pstamp }, p.user));
    put(`${base}/environ`, fileNode({ content: (p.env || ['LANG=C.UTF-8', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin']).join('\0') + '\0', owner: p.user, group: p.user, mode: '-r--------', mtime: pstamp, ...priv }, p.user));
    put(`${base}/cwd`, { type: 'link', target: p.cwd || '/', mode: 'lrwxrwxrwx', mtime: pstamp, ...priv });
    put(`${base}/exe`, { type: 'link', target: p.exe || (p.cmd.startsWith('/') ? p.cmd.split(' ')[0] : `/usr/bin/${p.comm}`), mode: 'lrwxrwxrwx', mtime: pstamp, ...priv });
    put(`${base}/fd`, { type: 'dir', mode: 'dr-x------', mtime: pstamp, ...priv });
    for (let i = 0; i < 3; i++) put(`${base}/fd/${i}`, { type: 'link', target: '/dev/null', mode: i ? 'l-wx------' : 'lr-x------', mtime: pstamp, ...priv });
    for (const s of sockByPid.get(p.pid) || []) put(`${base}/fd/${s.fd}`, { type: 'link', target: `socket:[${s.inode}]`, mode: 'lrwx------', mtime: pstamp, ...priv });
  }
  // implied parent dirs
  for (const path of [...fs.keys()]) {
    let d = path;
    while ((d = d.slice(0, d.lastIndexOf('/'))) && !fs.has(d)) fs.set(d, { type: 'dir', owner: d.startsWith(w.home) ? w.user : 'root', group: d.startsWith(w.home) ? w.user : 'root', mode: 'drwxr-xr-x', mtime: 'Nov 14 08:02' });
  }
  for (const [path, meta] of Object.entries(c.dirs || {})) fs.set(path, { type: 'dir', mode: 'drwxr-xr-x', mtime: 'Nov 14 08:02', owner: 'root', group: 'root', ...(fs.get(path) || {}), ...meta, type: 'dir' });
  fs.set('/', { type: 'dir', owner: 'root', group: 'root', mode: 'drwxr-xr-x', mtime: 'Nov 14 08:02' });
  return fs;
}
const syslogStamp = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${hms(d)}`; };

const TCP_STATE = { ESTAB: '01', LISTEN: '0A', TIME_WAIT: '06', UNCONN: '07' };
function procNet(w, proto) {
  const head = proto === 'tcp6'
    ? '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
    : '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
  const rows = w.sockets.filter((s) => s.proto === proto).map((s, i) => {
    const addr = (a) => (proto === 'tcp6' ? (a === '::' ? '0'.repeat(32) : '0000000000000000FFFF0000' + ipToHex(a)) : ipToHex(a));
    const st = proto === 'udp' ? '07' : TCP_STATE[s.state];
    return `${String(i).padStart(4)}: ${addr(s.laddr)}:${hex4(s.lport)} ${addr(s.raddr)}:${hex4(s.rport)} ${st} 00000000:00000000 00:00000000 00000000 ${String(s.uid ?? 0).padStart(5)}        0 ${s.inode} 1 0000000000000000 100 0 0 10 0`;
  });
  return join([head, ...rows]);
}

// ---------------------------------------------------------------- session
export function createSession(c) {
  const world = buildWorld(c);
  return {
    c, world, cwd: world.home, used: 0, history: [], found: new Set(), violations: [], secretShown: false,
    get limit() { return c.budget.limit; },
    get locked() { return c.budget.mode === 'strict' && this.used >= c.budget.limit; },
  };
}

// ---------------------------------------------------------------- tokenizer
// Returns words [{v, q}] where q = word contained quoting (so it is never a redirect/glob).
function tokenize(seg, sess) {
  const out = []; let cur = ''; let q = false; let has = false; let i = 0;
  const flush = () => { if (has) out.push({ v: cur, q }); cur = ''; q = false; has = false; };
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === "'") { const j = seg.indexOf("'", i + 1); if (j < 0) throw new Error('unexpected EOF while looking for matching `\''); cur += seg.slice(i + 1, j); q = has = true; i = j + 1; continue; }
    if (ch === '"') {
      i++; q = has = true;
      while (i < seg.length && seg[i] !== '"') {
        if (seg[i] === '\\' && '"\\$`'.includes(seg[i + 1])) { cur += seg[i + 1]; i += 2; continue; }
        if (seg.startsWith('$((', i) || seg.startsWith('$(', i)) { const r = expandDollar(seg, i, sess); cur += r.text; i = r.end; continue; }
        cur += seg[i++];
      }
      if (seg[i] !== '"') throw new Error('unexpected EOF while looking for matching `"\'');
      i++; continue;
    }
    if (ch === '\\') { cur += seg[i + 1] ?? ''; q = has = true; i += 2; continue; }
    if (ch === ' ' || ch === '\t') { flush(); i++; continue; }
    if (seg.startsWith('$(', i)) { const r = expandDollar(seg, i, sess); cur += r.text; has = true; i = r.end; continue; }
    cur += ch; has = true; i++;
  }
  flush();
  return out;
}
function matchParen(s, start) { // s[start] === '(' ; returns index of matching ')'
  let depth = 0, quote = null;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  throw new Error('unexpected EOF while looking for matching `)\'');
}
function expandDollar(s, i, sess) {
  if (s.startsWith('$((', i)) {
    const end = matchParen(s, i + 1);
    return { text: String(arith(s.slice(i + 3, end - 1))), end: end + 1 };
  }
  const end = matchParen(s, i + 1);
  const inner = s.slice(i + 2, end);
  const r = sess ? runPipeline(sess, inner, { nested: true }) : { out: '' };
  return { text: r.out.replace(/\n+$/, ''), end: end + 1 };
}
export function arith(expr) {
  const toks = expr.match(/\d+#[0-9a-zA-Z]+|0[xX][0-9a-fA-F]+|\d+|[-+*/%()]/g) || [];
  let k = 0;
  const num = (t) => {
    if (/^\d+#/.test(t)) { const [b, d] = t.split('#'); const v = parseInt(d, Number(b)); if (Number.isNaN(v)) throw new Error(`${t}: value too great for base`); return v; }
    return t.startsWith('0x') || t.startsWith('0X') ? parseInt(t, 16) : parseInt(t, 10);
  };
  const atom = () => { const t = toks[k++]; if (t === '(') { const v = add(); k++; return v; } if (t === '-') return -atom(); if (t === undefined) throw new Error('syntax error: operand expected'); return num(t); };
  const mul = () => { let v = atom(); while (['*', '/', '%'].includes(toks[k])) { const o = toks[k++]; const r = atom(); v = o === '*' ? v * r : o === '/' ? Math.trunc(v / r) : v % r; } return v; };
  const add = () => { let v = mul(); while (['+', '-'].includes(toks[k])) { const o = toks[k++]; const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  return add();
}
function splitTop(line, seps) { // split on separators outside quotes/parens
  const parts = []; let cur = ''; let quote = null; let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    const sep = depth === 0 && seps.find((s) => line.startsWith(s, i) && !(s === '|' && line[i + 1] === '|'));
    if (sep) { parts.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

// ---------------------------------------------------------------- path helpers
function resolve(sess, p) {
  if (p === '~' || p.startsWith('~/')) p = sess.world.home + p.slice(1);
  if (!p.startsWith('/')) p = `${sess.cwd}/${p}`;
  const parts = [];
  for (const seg of p.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
  return '/' + parts.join('/');
}
function canRead(sess, node, priv) {
  if (priv) return true;
  if (node.root) return false;
  if (node.procPriv) return node.owner === sess.world.user;
  return true;
}
function globToRe(g, slashSafe) {
  let o = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '\\') { o += (g[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i++; continue; }
    if (ch === '*') { o += slashSafe ? '[^/]*' : '.*'; continue; }
    if (ch === '?') { o += slashSafe ? '[^/]' : '.'; continue; }
    if (ch === '[') { const j = g.indexOf(']', i + 2); if (j > 0) { o += '[' + g.slice(i + 1, j).replace(/^!/, '^') + ']'; i = j; continue; } }
    o += ch.replace(/[.+^${}()|[\]\/]/g, '\\$&');
  }
  return o;
}
function globExpand(sess, word) {
  if (!/[*?[]/.test(word)) return [word];
  const abs = resolve(sess, word);
  let re;
  try { re = new RegExp('^' + globToRe(abs, true) + '$'); } catch { return [word]; }
  const hits = [...sess.world.vfs.keys()].filter((k) => re.test(k)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!hits.length) return [word];
  return word.startsWith('/') ? hits : hits.map((h) => (h.startsWith(sess.cwd + '/') ? h.slice(sess.cwd.length + 1) : h));
}
function readFile(sess, path, priv, cmd) {
  const abs = resolve(sess, path);
  let node = sess.world.vfs.get(abs);
  if (node?.type === 'link' && node.target.startsWith('/')) node = sess.world.vfs.get(node.target) || node;
  if (!node) return { err: `${cmd}: ${path}: No such file or directory` };
  if (node.type === 'dir') return { err: `${cmd}: ${path}: Is a directory` };
  if (!canRead(sess, node, priv)) return { err: `${cmd}: ${path}: Permission denied` };
  if (node.secret) sess.secretShown = true;
  return { text: node.content ?? '', abs };
}

// ---------------------------------------------------------------- regex (grep / awk)
function toRegex(p, { ere = false, fixed = false, icase = false, word = false, whole = false, global = false } = {}) {
  let src;
  if (fixed) src = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  else {
    src = p.replace(/\[:space:\]/g, '\\s').replace(/\[:digit:\]/g, '\\d').replace(/\[:alpha:\]/g, 'a-zA-Z').replace(/\[:alnum:\]/g, 'a-zA-Z0-9').replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z');
    let o = '';
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\\') {
        const nx = src[i + 1];
        if (nx === '<' || nx === '>') { o += '\\b'; i++; continue; }
        if (!ere && '|(){}+?'.includes(nx)) { o += nx; i++; continue; }
        o += ch + (nx ?? ''); i++; continue;
      }
      if (!ere && '|(){}+?'.includes(ch)) { o += '\\' + ch; continue; }
      o += ch;
    }
    src = o;
  }
  if (word) src = `\\b(?:${src})\\b`;
  if (whole) src = `^(?:${src})$`;
  return new RegExp(src, (icase ? 'i' : '') + (global ? 'g' : ''));
}

// ---------------------------------------------------------------- filters (stdin -> stdout)
function grep(sess, args, input, priv) {
  const o = { ere: false, fixed: false, icase: false, invert: false, count: false, num: false, only: false, word: false, whole: false, quiet: false, files: false, noname: false, A: 0, B: 0 };
  let pat = null; const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { files.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--color') || a === '--line-buffered') continue;
    if (a === '-e' || a === '--regexp') { pat = args[++i]; continue; }
    if (/^-[ABC]\d*$/.test(a)) { const n = Number(a.slice(2) || args[++i]); if (a[1] !== 'B') o.A = n; if (a[1] !== 'A') o.B = n; continue; }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (const f of a.slice(1)) {
        const map = { E: 'ere', F: 'fixed', i: 'icase', v: 'invert', c: 'count', n: 'num', o: 'only', w: 'word', x: 'whole', q: 'quiet', l: 'files', h: 'noname', s: null, a: null, H: null, P: 'ere', I: null };
        if (!(f in map)) return { err: `grep: invalid option -- '${f}'`, code: 2 };
        if (map[f]) o[map[f]] = true;
      }
      continue;
    }
    if (pat === null) pat = a; else files.push(...globExpand(sess, a));
  }
  if (pat === null) return { err: 'Usage: grep [OPTION]... PATTERNS [FILE]...', code: 2 };
  let re;
  try { re = toRegex(pat, { ...o, global: o.only }); } catch { return { err: `grep: Unmatched ( or \\(`, code: 2 }; }
  const sources = files.length ? files.map((f) => ({ name: f, ...readFile(sess, f, priv, 'grep') })) : [{ name: '(standard input)', text: input ?? '' }];
  const out = []; const errs = []; let any = false;
  for (const s of sources) {
    if (s.err) { errs.push(s.err); continue; }
    const ls = lines(s.text); const prefix = files.length > 1 && !o.noname ? `${s.name}:` : '';
    let count = 0; const keep = new Set();
    ls.forEach((l, idx) => {
      re.lastIndex = 0;
      if (re.test(l) !== o.invert) { count++; for (let j = Math.max(0, idx - o.B); j <= Math.min(ls.length - 1, idx + o.A); j++) keep.add(j); keep.add(`m${idx}`); }
    });
    if (count) any = true;
    if (o.files) { if (count) out.push(s.name); continue; }
    if (o.count) { out.push(prefix + count); continue; }
    let last = -2;
    [...keep].filter((k) => typeof k === 'number').sort((a, b) => a - b).forEach((idx) => {
      if ((o.A || o.B) && last >= 0 && idx > last + 1) out.push('--');
      last = idx;
      const l = ls[idx];
      const n = o.num ? `${idx + 1}${keep.has(`m${idx}`) ? ':' : '-'}` : '';
      if (o.only && !o.invert) { re.lastIndex = 0; for (const m of l.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) if (m[0]) out.push(prefix + n + m[0]); }
      else out.push(prefix + n + l);
    });
  }
  return { out: o.quiet ? '' : join(out), err: errs.join('\n'), code: any ? 0 : 1 };
}
function headTail(which, args, input, sess, priv) {
  let n = 10; let fromStart = false; const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '-F' || a === '--follow') return { err: `${which}: follow mode can't run in a recorded investigation — use -n N, or journalctl -n N`, code: 1 };
    if (a === '-n' || a === '--lines') { const v = args[++i]; fromStart = v.startsWith('+'); n = Math.abs(parseInt(v, 10)); continue; }
    if (/^-n[+-]?\d+$/.test(a)) { fromStart = a[2] === '+'; n = Math.abs(parseInt(a.slice(2), 10)); continue; }
    if (/^-\d+$/.test(a)) { n = Number(a.slice(1)); continue; }
    if (a.startsWith('--lines=')) { n = Number(a.slice(8)); continue; }
    if (a.startsWith('-') && a !== '-') return { err: `${which}: invalid option -- '${a.slice(1)}'`, code: 1 };
    files.push(...globExpand(sess, a));
  }
  const srcs = files.length ? files.map((f) => ({ name: f, ...readFile(sess, f, priv, which) })) : [{ text: input ?? '' }];
  const out = []; const errs = [];
  srcs.forEach((s, i) => {
    if (s.err) { errs.push(s.err); return; }
    const ls = lines(s.text);
    if (files.length > 1) out.push(`${i ? '\n' : ''}==> ${s.name} <==`);
    out.push(...(which === 'head' ? ls.slice(0, n) : fromStart ? ls.slice(n - 1) : ls.slice(Math.max(0, ls.length - n))));
  });
  return { out: join(out), err: errs.join('\n'), code: errs.length ? 1 : 0 };
}
function sortCmd(args, input) {
  let rev = false, num = false, human = false, uniq = false, key = null, sep = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-k' || a.startsWith('-k')) { key = a === '-k' ? args[++i] : a.slice(2); continue; }
    if (a === '-t' || (a.startsWith('-t') && a.length > 2)) { sep = a === '-t' ? args[++i] : a.slice(2); continue; }
    if (a.startsWith('--')) { if (a === '--reverse') rev = true; else if (a === '--numeric-sort') num = true; continue; }
    if (a.startsWith('-')) { for (const f of a.slice(1)) { if (f === 'r') rev = true; else if (f === 'n' || f === 'g') num = true; else if (f === 'h') human = true; else if (f === 'u') uniq = true; else if (!'bfV'.includes(f)) return { err: `sort: invalid option -- '${f}'`, code: 2 }; } }
  }
  let kStart = 0, kEnd = null; let kNum = false, kRev = false;
  if (key) {
    const m = key.match(/^(\d+)([a-z]*)(?:,(\d+)([a-z]*))?$/);
    if (!m) return { err: `sort: invalid number at field start: invalid count at start of '${key}'`, code: 2 };
    kStart = Number(m[1]) - 1; kEnd = m[3] ? Number(m[3]) - 1 : null;
    const fl = (m[2] || '') + (m[4] || ''); kNum = /[ng]/.test(fl) || /h/.test(fl); kRev = fl.includes('r'); if (fl.includes('h')) human = true;
  }
  const field = (l) => {
    if (!key) return l;
    const f = sep ? l.split(sep) : l.trim().split(/\s+/);
    return f.slice(kStart, kEnd === null ? undefined : kEnd + 1).join(sep || ' ');
  };
  const hv = (s) => { const m = String(s).trim().match(/^(-?[\d.]+)\s*([KMGT]i?)?/i); if (!m) return 0; const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[(m[2] || '')[0]?.toUpperCase()] || 1; return parseFloat(m[1]) * mult; };
  const nv = (s) => { const m = String(s).trim().match(/^-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };
  const isNum = num || kNum || human;
  let ls = lines(input ?? '').map((l, i) => ({ l, i }));
  ls.sort((a, b) => {
    const fa = field(a.l), fb = field(b.l);
    let r = isNum ? (human ? hv(fa) - hv(fb) : nv(fa) - nv(fb)) : 0;
    if (r === 0) r = fa < fb ? -1 : fa > fb ? 1 : 0;
    if (r === 0 && key) r = a.l < b.l ? -1 : a.l > b.l ? 1 : 0;
    return (rev !== kRev) ? -r : r;
  });
  let out = ls.map((x) => x.l);
  if (uniq) out = out.filter((l, i) => i === 0 || field(l) !== field(out[i - 1]));
  return { out: join(out) };
}
function uniqCmd(args, input) {
  const c = args.some((a) => /^-\w*c/.test(a)); const d = args.some((a) => /^-\w*d/.test(a)); const u = args.some((a) => /^-\w*u$/.test(a));
  const out = []; let prev = null; let n = 0;
  const emit = () => { if (prev === null) return; if (d && n < 2) return; if (u && n > 1) return; out.push(c ? `${String(n).padStart(7)} ${prev}` : prev); };
  for (const l of lines(input ?? '')) { if (l === prev) n++; else { emit(); prev = l; n = 1; } }
  emit();
  return { out: join(out) };
}
function wcCmd(sess, args, input, priv) {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const files = args.filter((a) => !a.startsWith('-'));
  const calc = (t) => { const r = []; if (!flags || flags.includes('l')) r.push((t.match(/\n/g) || []).length); if (!flags || flags.includes('w')) r.push(t.split(/\s+/).filter(Boolean).length); if (!flags || /[cm]/.test(flags)) r.push(t.length); return r; };
  if (!files.length) { const r = calc(input ?? ''); return { out: (r.length === 1 ? String(r[0]) : r.map((x) => String(x).padStart(7)).join(' ')) + '\n' }; }
  const out = []; const errs = [];
  for (const f of files) { const s = readFile(sess, f, priv, 'wc'); if (s.err) { errs.push(s.err); continue; } out.push(`${calc(s.text).join(' ')} ${f}`); }
  return { out: join(out), err: errs.join('\n') };
}
function cutCmd(args, input) {
  let d = '\t', f = null, ch = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-d') d = args[++i]; else if (a.startsWith('-d')) d = a.slice(2);
    else if (a === '-f') f = args[++i]; else if (a.startsWith('-f')) f = a.slice(2);
    else if (a === '-c') ch = args[++i]; else if (a.startsWith('-c')) ch = a.slice(2);
  }
  const spec = f ?? ch;
  if (!spec) return { err: 'cut: you must specify a list of bytes, characters, or fields', code: 1 };
  const want = (n, max) => spec.split(',').some((r) => { const [a, b] = r.split('-'); const lo = a === '' ? 1 : Number(a); const hi = r.includes('-') ? (b === '' ? max : Number(b)) : lo; return n >= lo && n <= hi; });
  const out = lines(input ?? '').map((l) => {
    if (ch) return [...l].filter((_, i) => want(i + 1, l.length)).join('');
    if (!l.includes(d)) return l;
    const parts = l.split(d); return parts.filter((_, i) => want(i + 1, parts.length)).join(d);
  });
  return { out: join(out) };
}
function trSet(s) {
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\0|\\000/g, '\0').replace(/\\\\/g, '\\').replace(/\[:space:\]/g, ' \t\n').replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:digit:\]/g, '0-9');
  let o = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i + 1] === '-' && s[i + 2] !== undefined) { for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) o += String.fromCharCode(c); i += 2; } else o += s[i];
  }
  return o;
}
function trCmd(args, input) {
  const del = args.includes('-d'); const sq = args.includes('-s');
  const sets = args.filter((a) => !/^-[ds]+$/.test(a)).map(trSet);
  let t = input ?? '';
  if (del) t = [...t].filter((c) => !sets[0].includes(c)).join('');
  else if (sets.length === 2) { const [a, b] = sets; t = [...t].map((c) => { const k = a.indexOf(c); return k < 0 ? c : b[Math.min(k, b.length - 1)]; }).join(''); }
  if (sq) { const set = sets.at(-1) || ''; t = [...t].filter((c, i, arr) => !(i && c === arr[i - 1] && set.includes(c))).join(''); }
  return { out: t };
}
function columnCmd(args, input) {
  if (!args.includes('-t')) return { out: input };
  return { out: join(table(lines(input ?? '').map((l) => l.trim().split(/\s+/)).map((r) => [...r, '']))) };
}
function awkCmd(sess, args, input, priv) {
  let fs = null; const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-F') fs = args[++i]; else if (args[i].startsWith('-F')) fs = args[i].slice(2); else rest.push(args[i]);
  }
  const [prog, ...files] = rest;
  if (!prog) return { err: 'usage: awk [-F fs] \'program\' [file ...]', code: 2 };
  let text = input ?? '';
  if (files.length) { const r = readFile(sess, files[0], priv, 'awk'); if (r.err) return { err: r.err.replace(/^awk: /, 'awk: cannot open "') , code: 2 }; text = r.text; }
  const split = (l) => (fs === null ? l.trim().split(/\s+/).filter(Boolean) : l.split(fs.length === 1 || fs === '\\t' ? fs.replace('\\t', '\t') : new RegExp(fs)));
  const sum = prog.match(/^\s*\{\s*(\w+)\s*\+=\s*\$(\d+)\s*\}\s*END\s*\{\s*print\s+\1\s*\}\s*$/);
  if (sum) { let s = 0; for (const l of lines(text)) s += parseFloat(split(l)[Number(sum[2]) - 1]) || 0; return { out: `${s}\n` }; }
  const m = prog.trim().match(/^([^{]*?)\s*(\{\s*(.*?)\s*\})?\s*$/s);
  if (!m) return { err: 'awk: this simulator supports  [pattern] { print $N, ... }', code: 2 };
  const cond = m[1].trim(); const action = m[3] ?? 'print';
  const val = (tok, f, nr) => {
    tok = tok.trim();
    if (tok === '$0') return f._line;
    if (tok === '$NF') return f[f.length - 1] ?? '';
    if (/^\$\(NF-\d+\)$/.test(tok)) return f[f.length - 1 - Number(tok.match(/\d+/)[0])] ?? '';
    if (/^\$\d+$/.test(tok)) return f[Number(tok.slice(1)) - 1] ?? '';
    if (tok === 'NR') return String(nr); if (tok === 'NF') return String(f.length);
    if (/^".*"$/.test(tok)) return tok.slice(1, -1).replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    return tok;
  };
  const test = (f, nr) => {
    if (!cond) return true;
    return cond.split('&&').every((atom) => {
      atom = atom.trim();
      let mm;
      if ((mm = atom.match(/^(!?)\/(.*)\/$/))) return toRegex(mm[2], { ere: true }).test(f._line) !== !!mm[1];
      if ((mm = atom.match(/^(\$\w+|\$\(NF-\d+\)|NR|NF)(\+0)?\s*(==|!=|>=|<=|>|<|~|!~)\s*(.+)$/))) {
        const left = val(mm[1], f, nr); const op = mm[3]; let right = mm[4].trim();
        if (op === '~' || op === '!~') return toRegex(right.replace(/^\/|\/$/g, ''), { ere: true }).test(left) === (op === '~');
        right = val(right, f, nr);
        const ln = parseFloat(left), rn = parseFloat(right);
        const [a, b] = !Number.isNaN(ln) && !Number.isNaN(rn) && (mm[2] || /^-?[\d.]+$/.test(right)) ? [ln, rn] : [left, right];
        return { '==': a == b, '!=': a != b, '>=': a >= b, '<=': a <= b, '>': a > b, '<': a < b }[op]; // eslint-disable-line eqeqeq
      }
      throw new Error('unsupported');
    });
  };
  const out = [];
  try {
    lines(text).forEach((l, i) => {
      const f = split(l); f._line = l;
      if (!test(f, i + 1)) return;
      const am = action.match(/^print\s*(.*)$/);
      if (!am) throw new Error('unsupported');
      if (!am[1].trim()) { out.push(l); return; }
      out.push(am[1].split(',').map((part) => (part.match(/"[^"]*"|\$\(NF-\d+\)|\S+/g) || []).map((t) => val(t, f, i + 1)).join('')).join(' '));
    });
  } catch { return { err: 'awk: this simulator supports  /re/, $N op value, NR op N  patterns and  { print $N, "text", NF }  actions', code: 2 }; }
  return { out: join(out) };
}

// ---------------------------------------------------------------- producers
function hostCmds(sess, name, args, priv) {
  const w = sess.world; const h = w.host;
  switch (name) {
    case 'hostname': return { out: (args.includes('-I') ? (h.ifaces || []).filter((i) => i.name !== 'lo').map((i) => i.addr.split('/')[0]).join(' ') + ' ' : h.hostname) + '\n' };
    case 'whoami': return { out: (priv ? 'root' : w.user) + '\n' };
    case 'id': return { out: priv ? 'uid=0(root) gid=0(root) groups=0(root)\n' : `${w.c.idLine}\n` };
    case 'uname': {
      const a = args.join('');
      if (a.includes('a')) return { out: `Linux ${h.hostname} ${w.os.kernel} #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\n` };
      if (a.includes('r')) return { out: w.os.kernel + '\n' };
      if (a.includes('n')) return { out: h.hostname + '\n' };
      return { out: 'Linux\n' };
    }
    case 'nproc': return { out: `${h.cpus}\n` };
    case 'uptime': return { out: uptimeLine(w) + '\n' };
    case 'date': return { out: `${longTs(w.now).replace(/ (\d{4})$/, ' UTC $1')}\n` };
    case 'w': {
      const s = h.sessions || [];
      return { out: join([uptimeLine(w), ...table([['USER', 'TTY', 'FROM', 'LOGIN@', 'IDLE', 'JCPU', 'PCPU', 'WHAT'], ...s.map((x) => [x.user, x.tty, x.from, x.login, '0.00s', '0.04s', '0.00s', x.what || '-bash'])])]) };
    }
    case 'free': return { out: freeCmd(w, args) };
    case 'vmstat': return { out: vmstatCmd(w, args) };
    case 'df': return dfCmd(w, args);
    case 'iostat': return { out: iostatCmd(w) };
    case 'ip': return ipCmd(w, args);
    case 'lscpu': return { out: `Architecture:            x86_64\nCPU(s):                  ${h.cpus}\nModel name:              Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz\nThread(s) per core:      2\n` };
  }
  return null;
}
function uptimeLine(w) {
  const s = w.host.uptimeSec; const d = Math.floor(s / 86400); const hh = Math.floor(s % 86400 / 3600); const mm = Math.floor(s % 3600 / 60);
  const up = d ? `${d} day${d > 1 ? 's' : ''}, ${String(hh).padStart(2)}:${p2(mm)}` : hh ? `${String(hh).padStart(2)}:${p2(mm)}` : `${mm} min`;
  const n = (w.host.sessions || []).length || 1;
  return ` ${hms(new Date(w.now))} up ${up},  ${n} user${n > 1 ? 's' : ''},  load average: ${w.host.load.map((x) => x.toFixed(2)).join(', ')}`;
}
function freeCmd(w, args) {
  const m = w.host.mem; const a = args.join(' ');
  const human = a.includes('-h'); const unit = human ? 'h' : a.includes('-g') ? 'g' : a.includes('-m') ? 'm' : 'k';
  const fmt = (mb) => {
    if (unit === 'h') return mb === 0 ? '0B' : mb >= 1024 ? `${(mb / 1024).toFixed(1)}Gi` : `${Math.round(mb)}Mi`;
    if (unit === 'g') return String(Math.round(mb / 1024));
    if (unit === 'm') return String(mb);
    return String(mb * 1024);
  };
  const st = m.swapTotal || 0, su = m.swapUsed || 0;
  const row = (label, vals) => label.padEnd(8) + vals.map((v) => v.padStart(12)).join('');
  return join([
    row('', ['total', 'used', 'free', 'shared', 'buff/cache', 'available']).replace(/^ {8}/, '       '),
    row('Mem:', [m.total, m.used, m.free, m.shared || 0, m.buffcache, m.available].map(fmt)),
    row('Swap:', [st, su, st - su].map(fmt)),
  ].map((l) => l.trimEnd()));
}
function seeded(id) { let s = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32); }
function vmstatCmd(w, args) {
  const nums = args.filter((x) => /^\d+$/.test(x)).map(Number);
  const count = nums.length >= 2 ? Math.min(nums[1], 10) : 1;
  const m = w.host.mem; const cpu = w.host.cpu; const rnd = seeded(w.c.id + 'vm');
  const rows = [];
  for (let i = 0; i < count; i++) {
    const j = (base, spread) => Math.max(0, Math.round(base + (rnd() - 0.5) * spread));
    const us = i ? j(cpu.us, 6) : Math.round(cpu.us * 0.8); const sy = i ? j(cpu.sy, 4) : Math.round(cpu.sy * 0.8);
    const wa = i ? j(cpu.wa, 1) : cpu.wa; const id = Math.max(0, 100 - us - sy - wa - (cpu.st || 0));
    rows.push([j(w.host.load[0], 1.5), 0, (m.swapUsed || 0) * 1024, j(m.free * 1024, 3000), Math.round(m.buffcache * 0.08) * 1024, Math.round(m.buffcache * 0.85) * 1024, 0, 0, j(cpu.bi ?? 3, 4), j(cpu.bo ?? 40, 30), j(cpu.in ?? 900, 300), j(cpu.cs ?? 1800, 600), us, sy, id, wa, cpu.st || 0]);
  }
  const head = ['r', 'b', 'swpd', 'free', 'buff', 'cache', 'si', 'so', 'bi', 'bo', 'in', 'cs', 'us', 'sy', 'id', 'wa', 'st'];
  const widths = [2, 2, 6, 7, 6, 7, 4, 4, 5, 5, 5, 5, 2, 2, 2, 2, 2];
  const fmt = (r) => r.map((v, i) => String(v).padStart(widths[i])).join(' ');
  return join(['procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----', fmt(head), ...rows.map(fmt)]);
}
function dfCmd(w, args) {
  const human = args.some((a) => /^-\w*h/.test(a)); const typ = args.some((a) => /^-\w*T/.test(a)); const inodes = args.some((a) => /^-\w*i/.test(a));
  const paths = args.filter((a) => !a.startsWith('-'));
  let ds = w.host.disks;
  if (paths.length) ds = paths.map((p) => [...ds].filter((d) => p.startsWith(d.mount)).sort((a, b) => b.mount.length - a.mount.length)[0]).filter(Boolean);
  const hs = (g) => (g === 0 ? '0' : g < 1 ? `${Math.round(g * 1024)}M` : g < 10 ? `${g.toFixed(1)}G` : `${Math.round(g)}G`);
  const rows = ds.map((d) => {
    const avail = Math.max(0, d.size - d.used); const pct = `${Math.ceil(d.used / d.size * 100)}%`;
    if (inodes) { const it = Math.round(d.size * 65536); const iu = Math.round(it * (d.inodePct ?? 6) / 100); return [d.fs, ...(typ ? [d.type] : []), it, iu, it - iu, `${d.inodePct ?? 6}%`, d.mount]; }
    const k = (g) => Math.round(g * 1048576);
    return [d.fs, ...(typ ? [d.type] : []), human ? hs(d.size) : k(d.size), human ? hs(d.used) : k(d.used), human ? hs(avail) : k(avail), pct, d.mount];
  });
  const head = inodes ? ['Filesystem', ...(typ ? ['Type'] : []), 'Inodes', 'IUsed', 'IFree', 'IUse%', 'Mounted on'] : ['Filesystem', ...(typ ? ['Type'] : []), human ? 'Size' : '1K-blocks', 'Used', human ? 'Avail' : 'Available', 'Use%', 'Mounted on'];
  const right = new Set([1, 2, 3, 4, 5].map((i) => i + (typ ? 1 : 0)).filter((i) => i < head.length - 1));
  return { out: join(table([head, ...rows], right)) };
}
function iostatCmd(w) {
  const io = w.host.io || [];
  const c = w.host.cpu;
  return join([
    `Linux ${w.os.kernel} (${w.host.hostname}) \t${new Date(w.now).toISOString().slice(0, 10)} \t_x86_64_\t(${w.host.cpus} CPU)`, '',
    'avg-cpu:  %user   %nice %system %iowait  %steal   %idle',
    `         ${[c.us, 0, c.sy, c.wa, c.st || 0, Math.max(0, 100 - c.us - c.sy - c.wa)].map((x) => x.toFixed(2).padStart(7)).join(' ')}`, '',
    ...table([['Device', 'r/s', 'w/s', 'rkB/s', 'wkB/s', 'r_await', 'w_await', 'aqu-sz', '%util'], ...io.map((d) => [d.dev, d.rs, d.ws, d.rkb, d.wkb, d.rawait, d.wawait, d.aqu, d.util])].map((r) => [...r.map(String), '']), new Set([1, 2, 3, 4, 5, 6, 7, 8])),
  ]);
}
function ipCmd(w, args) {
  const ifs = w.host.ifaces || [];
  const sub = args.find((a) => !a.startsWith('-')) || 'help';
  if (/^r(oute)?$/.test(sub)) return { out: join([`default via ${w.host.gateway} dev ${ifs[1]?.name || 'eth0'} proto dhcp src ${ifs[1]?.addr.split('/')[0]} metric 100`]) };
  if (/^a(ddr|ddress)?$/.test(sub)) {
    if (args.includes('-br') || args.includes('-brief')) return { out: join(table(ifs.map((i) => [i.name, i.name === 'lo' ? 'UNKNOWN' : 'UP', i.addr, '']))) };
    return { out: join(ifs.flatMap((i, k) => [`${k + 1}: ${i.name}: <${i.name === 'lo' ? 'LOOPBACK' : 'BROADCAST,MULTICAST'},UP,LOWER_UP> mtu ${i.name === 'lo' ? 65536 : 9001} state ${i.name === 'lo' ? 'UNKNOWN' : 'UP'}`, `    inet ${i.addr} scope ${i.name === 'lo' ? 'host' : 'global'} ${i.name}`])) };
  }
  return { err: 'ip: this simulator supports  ip -br a  and  ip route', code: 1 };
}

// ----- processes
const psUser = (u) => (u.length > 8 ? u.slice(0, 7) + '+' : u);
function startCol(w, p) { const d = new Date(p.startMs); return w.now - p.startMs < 86400000 ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : `${MON[d.getUTCMonth()]}${p2(d.getUTCDate())}`; }
function forestOrder(procs) {
  const kids = new Map(); procs.forEach((p) => { (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p); });
  const pids = new Set(procs.map((p) => p.pid)); const out = [];
  const walk = (p, d) => { out.push({ p, d }); (kids.get(p.pid) || []).sort((a, b) => a.pid - b.pid).forEach((k) => walk(k, d + 1)); };
  const roots = procs.filter((p) => !pids.has(p.ppid) || p.ppid === 1).sort((a, b) => a.pid - b.pid);
  const seen = new Set();
  const walk1 = (p, d) => { if (seen.has(p.pid)) return; seen.add(p.pid); out.push({ p, d }); (kids.get(p.pid) || []).filter((k) => p.pid !== 1).sort((a, b) => a.pid - b.pid).forEach((k) => walk1(k, d + 1)); };
  roots.forEach((p) => walk1(p, 0));
  return out;
}
const PS_FIELDS = {
  pid: ['PID', (p) => p.pid, 1], ppid: ['PPID', (p) => p.ppid, 1], user: ['USER', (p) => psUser(p.user)], uid: ['UID', (p) => p.uid ?? 0, 1],
  '%cpu': ['%CPU', (p) => p.cpu.toFixed(1), 1], pcpu: ['%CPU', (p) => p.cpu.toFixed(1), 1], '%mem': ['%MEM', (p) => p.mem.toFixed(1), 1], pmem: ['%MEM', (p) => p.mem.toFixed(1), 1],
  rss: ['RSS', (p) => p.rss, 1], vsz: ['VSZ', (p) => p.vsz, 1], stat: ['STAT', (p) => p.stat], tty: ['TT', (p) => p.tty], time: ['TIME', (p) => p.time, 1],
  comm: ['COMMAND', (p) => p.comm], cmd: ['CMD', (p) => p.cmd], args: ['COMMAND', (p) => p.cmd], command: ['COMMAND', (p) => p.cmd],
  etime: ['ELAPSED', (p, w) => etime(Math.round((w.now - p.startMs) / 1000)), 1], lstart: ['STARTED', (p) => longTs(p.startMs)], start: ['STARTED', (p, w) => startCol(w, p)],
  label: ['LABEL', (p) => p.ctx || 'unconfined'], nlwp: ['NLWP', (p) => p.threads || 1, 1],
};
function psCmd(sess, args, extra) {
  const w = sess.world; let procs = [...w.procs, ...extra];
  let style = 'default'; let forest = false; let ctx = false; let fields = null; let noHeader = false; let sortKey = null; let sel = 'all'; let pidSel = null; let userSel = null; let cmdSel = null;
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a.startsWith('--sort')) { sortKey = a.includes('=') ? a.split('=')[1] : args[++i]; continue; }
    if (a === '--forest') { forest = true; continue; }
    if (a === '--no-headers') { noHeader = true; continue; }
    if (a === '--ppid') { const v = Number(args[++i]); procs = procs.filter((p) => p.ppid === v); continue; }
    if (!a.startsWith('-')) {
      if (/^[auxfZjwe]+$/.test(a)) { if (a.includes('u')) style = 'u'; if (a.includes('f')) forest = true; if (a.includes('Z')) ctx = true; if (a.includes('x') || a.includes('a')) sel = 'all'; if (a.includes('j')) style = 'j'; continue; }
      if (/^\d+$/.test(a)) { pidSel = [Number(a)]; continue; }
      return { err: `error: unsupported option (BSD syntax)\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'`, code: 1 };
    }
    a = a.slice(1);
    for (let k = 0; k < a.length; k++) {
      const f = a[k];
      const takeArg = () => { const v = a.slice(k + 1) || args[++i]; k = a.length; return v; };
      if (f === 'e' || f === 'A') sel = 'all';
      else if (f === 'f') style = 'f';
      else if (f === 'F') style = 'f';
      else if (f === 'l') style = 'f';
      else if (f === 'H') forest = true;
      else if (f === 'Z' || f === 'M') ctx = true;
      else if (f === 'o') fields = takeArg();
      else if (f === 'p' || f === 'q') pidSel = takeArg().split(',').map(Number);
      else if (f === 'u' || f === 'U') userSel = takeArg().split(',');
      else if (f === 'C') cmdSel = takeArg().split(',');
      else if (f === 'y' || f === 'w') { /* ignore */ }
      else return { err: `error: unsupported SysV option\n\nUsage:\n ps [options]`, code: 1 };
    }
  }
  if (pidSel) procs = procs.filter((p) => pidSel.includes(p.pid));
  if (userSel) procs = procs.filter((p) => userSel.includes(p.user));
  if (cmdSel) procs = procs.filter((p) => cmdSel.includes(p.comm));
  if (sel !== 'all' && !pidSel && !userSel && !cmdSel) procs = procs.filter((p) => p.tty !== '?' && p.user === w.user);
  if (sortKey) {
    const keys = sortKey.split(',');
    procs.sort((a, b) => {
      for (const k of keys) {
        const desc = k.startsWith('-'); const name = k.replace(/^[-+]/, '');
        const getter = { '%cpu': (p) => p.cpu, pcpu: (p) => p.cpu, '%mem': (p) => p.mem, pmem: (p) => p.mem, rss: (p) => p.rss, vsz: (p) => p.vsz, pid: (p) => p.pid, start_time: (p) => p.startMs, etime: (p) => -p.startMs }[name];
        if (!getter) continue;
        const d = getter(a) - getter(b); if (d) return desc ? -d : d;
      }
      return 0;
    });
  }
  let rows = forest ? forestOrder(procs) : procs.map((p) => ({ p, d: 0 }));
  if (sortKey && forest) rows = procs.map((p) => ({ p, d: 0 }));
  const tree = (r, cmd) => (r.d ? '    '.repeat(r.d - 1) + ' \\_ ' : '') + cmd;
  let spec;
  if (fields) spec = fields.split(/[,\s]+/).filter(Boolean).map((f) => { const [k, lbl] = f.split('='); const def = PS_FIELDS[k]; if (!def) throw new Error(`error: unknown user-defined format specifier "${k}"`); return { key: k, label: lbl !== undefined ? lbl : def[0], get: def[1], right: def[2] }; });
  else if (style === 'u') spec = ['user', 'pid', '%cpu', '%mem', 'vsz', 'rss', 'tty', 'stat', 'start', 'time', 'command'].map((k) => ({ key: k, label: k === 'start' ? 'START' : k === 'tty' ? 'TTY' : PS_FIELDS[k][0], get: PS_FIELDS[k][1], right: PS_FIELDS[k][2] }));
  else if (style === 'f') spec = [['uid', 'UID', (p) => p.user], ['pid', 'PID', (p) => p.pid, 1], ['ppid', 'PPID', (p) => p.ppid, 1], ['c', 'C', (p) => Math.round(p.cpu), 1], ['start', 'STIME', (p) => startCol(w, p)], ['tty', 'TTY', (p) => p.tty], ['time', 'TIME', (p) => { const [mm, ss] = p.time.split(':').map(Number); return `${p2(Math.floor(mm / 60))}:${p2(mm % 60)}:${p2(ss)}`; }], ['cmd', 'CMD', (p) => p.cmd]].map(([key, label, get, right]) => ({ key, label, get, right }));
  else spec = ['pid', 'tty', 'time', 'cmd'].map((k) => ({ key: k, label: PS_FIELDS[k][0], get: PS_FIELDS[k][1], right: PS_FIELDS[k][2] }));
  if (ctx && !fields) spec.unshift({ key: 'label', label: 'LABEL', get: PS_FIELDS.label[1] });
  const lastCmd = ['cmd', 'args', 'command', 'comm'].includes(spec.at(-1).key);
  const body = rows.map((r) => spec.map((s, i) => { const v = String(s.get(r.p, w)); return i === spec.length - 1 && lastCmd ? tree(r, v) : v; }));
  const hasHeader = !noHeader && spec.some((s) => s.label !== '');
  const all = hasHeader ? [spec.map((s) => s.label), ...body] : body;
  const right = new Set(spec.map((s, i) => (s.right ? i : -1)).filter((i) => i >= 0));
  return { out: join(table(all.map((r) => [...r, '']).map((r) => r.slice(0, -1)).map((r) => (lastCmd ? r : [...r, ''])), right)) };
}
function topCmd(sess, args) {
  const w = sess.world;
  if (!args.includes('-b') && !args.some((a) => /^-\w*b/.test(a))) return { err: 'top: interactive mode is not available here — run it in batch mode:  top -b -n1 | head -20', code: 1, free: true };
  const h = w.host; const m = h.mem; const c = h.cpu;
  const running = w.procs.filter((p) => p.stat[0] === 'R').length;
  const total = h.tasks || w.procs.length;
  const head = [
    `top - ${uptimeLine(w).trim().replace(/^(\S+) up/, '$1 up')}`,
    `Tasks: ${String(total).padStart(3)} total, ${String(running).padStart(3)} running, ${String(total - running).padStart(3)} sleeping,   0 stopped,   0 zombie`,
    `%Cpu(s): ${c.us.toFixed(1).padStart(4)} us, ${c.sy.toFixed(1).padStart(4)} sy,  0.0 ni, ${Math.max(0, 100 - c.us - c.sy - c.wa).toFixed(1).padStart(4)} id, ${c.wa.toFixed(1).padStart(4)} wa,  0.0 hi,  0.3 si, ${(c.st || 0).toFixed(1).padStart(4)} st`,
    `MiB Mem : ${m.total.toFixed(1).padStart(8)} total, ${m.free.toFixed(1).padStart(8)} free, ${m.used.toFixed(1).padStart(8)} used, ${m.buffcache.toFixed(1).padStart(8)} buff/cache`,
    `MiB Swap: ${(m.swapTotal || 0).toFixed(1).padStart(8)} total, ${((m.swapTotal || 0) - (m.swapUsed || 0)).toFixed(1).padStart(8)} free, ${(m.swapUsed || 0).toFixed(1).padStart(8)} used. ${m.available.toFixed(1).padStart(8)} avail Mem`,
    '',
  ];
  const sortMem = args.join(' ').includes('%MEM');
  const procs = [...w.procs].sort((a, b) => (sortMem ? b.mem - a.mem : b.cpu - a.cpu) || a.pid - b.pid);
  const rows = procs.map((p) => [p.pid, psUser(p.user), 20, 0, p.vsz, p.rss, Math.round(p.rss / 5), p.stat[0], p.cpu.toFixed(1), p.mem.toFixed(1), `${p.time}.${p2(p.pid % 100)}`, p.comm]);
  return { out: join([...head, ...table([['PID', 'USER', 'PR', 'NI', 'VIRT', 'RES', 'SHR', 'S', '%CPU', '%MEM', 'TIME+', 'COMMAND'], ...rows].map((r) => r.map(String)), new Set([0, 2, 3, 4, 5, 6, 8, 9, 10])).map((l) => '  ' + l)]) };
}

// ----- sockets
function sockShow(s, numeric, which = 'l') {
  const host = (a, six) => (a === '0.0.0.0' ? '0.0.0.0' : a === '::' ? '[::]' : !numeric && a === '127.0.0.1' ? 'localhost' : six ? `[${a}]` : a);
  const port = (p) => (p === 0 ? '*' : !numeric && PORT_NAMES[p] ? PORT_NAMES[p] : String(p));
  if (which === 'l') return `${host(s.laddr, s.proto === 'tcp6')}:${port(s.lport)}`;
  return `${host(s.raddr, s.proto === 'tcp6')}:${port(s.rport)}`;
}
function ssCmd(sess, args, priv) {
  const w = sess.world; let f = '';
  for (const a of args) { if (a.startsWith('--')) { f += { '--tcp': 't', '--udp': 'u', '--listening': 'l', '--numeric': 'n', '--processes': 'p', '--all': 'a' }[a] || ''; } else if (a.startsWith('-')) f += a.slice(1); else return { err: `ss: filters are not supported in this simulator — pipe to grep instead (e.g.  ss -tlpn | grep 8000)`, code: 1 };
  }
  for (const ch of f) if (!'tulnpa46erH'.includes(ch)) return { err: `ss: invalid option -- '${ch}'`, code: 1 };
  const tcp = f.includes('t') || !f.includes('u'); const udp = f.includes('u');
  let socks = w.sockets.filter((s) => (tcp && s.proto.startsWith('tcp')) || (udp && s.proto === 'udp'));
  if (f.includes('4')) socks = socks.filter((s) => s.proto !== 'tcp6');
  if (f.includes('l')) socks = socks.filter((s) => s.state === 'LISTEN' || s.proto === 'udp');
  else if (!f.includes('a')) socks = socks.filter((s) => s.state === 'ESTAB');
  const numeric = f.includes('n'); const procs = f.includes('p');
  const showNet = tcp && udp;
  const head = [...(showNet ? ['Netid'] : []), 'State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', ...(procs ? ['Process'] : [])];
  const rows = socks.map((s) => [
    ...(showNet ? [s.proto === 'udp' ? 'udp' : 'tcp'] : []),
    s.proto === 'udp' ? 'UNCONN' : s.state, s.recvq ?? 0, s.state === 'LISTEN' ? (s.backlog ?? 128) : (s.sendq ?? 0),
    sockShow(s, numeric, 'l'), s.state === 'LISTEN' || s.proto === 'udp' ? (s.proto === 'tcp6' ? '[::]:*' : '0.0.0.0:*') : sockShow(s, numeric, 'r'),
    ...(procs ? [s.pid && (priv || w.byPid.get(s.pid).user === w.user) ? `users:(("${s.prog}",pid=${s.pid},fd=${s.fd}))` : ''] : []),
  ]);
  const off = showNet ? 1 : 0;
  return { out: join(table([head, ...rows].map((r) => [...r.map(String), '']), new Set([1 + off, 2 + off, 3 + off]))) };
}
function netstatCmd(sess, args, priv) {
  const w = sess.world; const f = args.filter((a) => a.startsWith('-')).map((a) => a.slice(1)).join('');
  let socks = w.sockets.filter((s) => (f.includes('u') && s.proto === 'udp') || ((f.includes('t') || !f.includes('u')) && s.proto.startsWith('tcp')));
  if (f.includes('l')) socks = socks.filter((s) => s.state === 'LISTEN' || s.proto === 'udp'); else if (!f.includes('a')) socks = socks.filter((s) => s.state === 'ESTAB');
  const numeric = f.includes('n');
  const rows = socks.map((s) => [s.proto, 0, 0, sockShow(s, numeric, 'l').replace(/^\[::\]/, ':::'), s.state === 'LISTEN' ? (s.proto === 'tcp6' ? ':::*' : '0.0.0.0:*') : sockShow(s, numeric, 'r'), s.state === 'ESTAB' ? 'ESTABLISHED' : s.state, ...(f.includes('p') ? [s.pid && (priv || w.byPid.get(s.pid).user === w.user) ? `${s.pid}/${s.prog}` : '-'] : [])]);
  const head = ['Proto', 'Recv-Q', 'Send-Q', 'Local Address', 'Foreign Address', 'State', ...(f.includes('p') ? ['PID/Program name'] : [])];
  return { out: join([`Active Internet connections (${f.includes('l') ? 'only servers' : 'w/o servers'})`, ...table([head, ...rows].map((r) => [...r.map(String), '']), new Set([1, 2]))]) };
}
function lsofCmd(sess, args, priv) {
  const w = sess.world;
  if (!args.some((a) => a.startsWith('-i'))) return { err: 'lsof: this simulator supports network listings only:  lsof -i -P -n', code: 1 };
  const numPorts = args.includes('-P') || args.some((a) => /^-\w*P/.test(a)); const numHosts = args.includes('-n') || args.some((a) => /^-\w*n/.test(a));
  const filt = args.find((a) => /^(-i)?(tcp)?:\d+$/i.test(a)) || args[args.indexOf('-i') + 1];
  const port = filt && /:(\d+)$/.test(filt) ? Number(filt.match(/:(\d+)$/)[1]) : null;
  let socks = w.sockets.filter((s) => s.pid && (priv || w.byPid.get(s.pid).user === w.user));
  if (port) socks = socks.filter((s) => s.lport === port || s.rport === port);
  if (!socks.length) return { out: '', code: 1 };
  const name = (s) => {
    const h = (a) => (a === '0.0.0.0' || a === '::' ? '*' : !numHosts && a === '127.0.0.1' ? 'localhost' : a);
    const pt = (p) => (!numPorts && PORT_NAMES[p] ? PORT_NAMES[p] : String(p));
    const l = `${h(s.laddr)}:${pt(s.lport)}`;
    return `${s.proto === 'udp' ? 'UDP' : 'TCP'} ${s.state === 'LISTEN' ? `${l} (LISTEN)` : s.proto === 'udp' ? l : `${l}->${h(s.raddr)}:${pt(s.rport)} (ESTABLISHED)`}`;
  };
  const rows = socks.map((s) => { const p = w.byPid.get(s.pid); return [p.comm.slice(0, 9), s.pid, psUser(p.user), `${s.fd}u`, s.proto === 'tcp6' ? 'IPv6' : 'IPv4', s.inode, '0t0', name(s)]; });
  return { out: join(table([['COMMAND', 'PID', 'USER', 'FD', 'TYPE', 'DEVICE', 'SIZE/OFF', 'NODE NAME'], ...rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]])].map((r) => r.map(String)))) };
}

// ----- files
function catCmd(sess, args, input, priv, name) {
  const files = args.filter((a) => a === '-' || !a.startsWith('-')).flatMap((a) => globExpand(sess, a));
  const flagA = args.some((a) => /^-\w*A/.test(a)); const flagN = args.some((a) => /^-\w*n/.test(a));
  if (!files.length) return { out: input ?? '' };
  const out = []; const errs = [];
  for (const f of files) { const r = readFile(sess, f, priv, name); if (r.err) errs.push(r.err); else out.push(r.text); }
  let text = out.join('');
  if (flagA) text = text.replace(/\0/g, '^@').replace(/\t/g, '^I').replace(/\n/g, '$\n');
  if (flagN) text = join(lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
  return { out: text, err: errs.join('\n'), code: errs.length ? 1 : 0 };
}
function lsCmd(sess, args, priv) {
  const w = sess.world; let long = false, all = false, dirOnly = false, human = false;
  const targets = [];
  for (const a of args) {
    if (a.startsWith('-') && a.length > 1) { for (const f of a.slice(1)) { if (f === 'l') long = true; else if (f === 'a' || f === 'A') all = true; else if (f === 'd') dirOnly = true; else if (f === 'h') human = true; else if (!'tr1FSZ'.includes(f)) return { err: `ls: invalid option -- '${f}'`, code: 2 }; } }
    else targets.push(...globExpand(sess, a));
  }
  if (!targets.length) targets.push('.');
  const vfs = w.vfs; const out = []; const errs = [];
  const sizeOf = (n) => (n.type === 'dir' ? 4096 : n.type === 'link' ? 64 : n.size ?? (n.content ?? '').length);
  const hs = (b) => (!human ? String(b) : b < 1024 ? String(b) : b < 1048576 ? `${(b / 1024).toFixed(1).replace(/\.0$/, '')}K` : `${(b / 1048576).toFixed(1)}M`);
  const fmt = (n, name, path) => {
    if (!long) return name;
    const mode = n.mode || (n.type === 'dir' ? 'drwxr-xr-x' : n.type === 'link' ? 'lrwxrwxrwx' : '-rw-r--r--');
    const own = n.ownerPid ? w.byPid.get(n.ownerPid).user : n.owner || 'root';
    const grp = n.ownerPid ? own : n.group || own;
    const tgt = n.type === 'link' ? ` -> ${n.target}` : '';
    return [mode, n.type === 'dir' ? 2 : 1, own, grp, hs(sizeOf(n)), n.mtime || 'Nov 14 08:02', name + tgt];
  };
  const files = []; const dirs = [];
  for (const t of targets) {
    const abs = resolve(sess, t); const n = vfs.get(abs);
    if (!n) { errs.push(`ls: cannot access '${t}': No such file or directory`); continue; }
    if (n.type === 'link' && n.procPriv && !priv && n.owner !== w.user) { errs.push(`ls: cannot read symbolic link '${t}': Permission denied`); if (long) files.push([n.mode, 1, w.byPid.get(n.ownerPid).user, w.byPid.get(n.ownerPid).user, 0, n.mtime, t]); continue; }
    if (n.type === 'dir' && !dirOnly) dirs.push({ t, abs, n }); else files.push(fmt(n, t, abs));
  }
  const emit = (rows) => { if (!rows.length) return; out.push(...(long ? table(rows.map((r) => [...r.map(String)]), new Set([1, 4])) : [rows.join('  ')])); };
  emit(files);
  dirs.forEach(({ t, abs, n }, k) => {
    if (targets.length > 1 || files.length) out.push(`${files.length || k ? '\n' : ''}${t}:`);
    if (!canRead(sess, n, priv) || (n.mode && n.mode.startsWith('drwx------') && n.owner !== w.user && !priv) || (n.mode === 'drwxr-x---' && n.owner !== w.user && !priv)) { errs.push(`ls: cannot open directory '${t}': Permission denied`); return; }
    const prefix = abs === '/' ? '/' : abs + '/';
    const kids = [...vfs.keys()].filter((k2) => k2.startsWith(prefix) && k2 !== abs && !k2.slice(prefix.length).includes('/')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const vis = kids.filter((k2) => all || !k2.slice(prefix.length).startsWith('.'));
    if (long) out.push(`total ${(vis.length + (all ? 2 : 0)) * 4}`);
    const rows = vis.map((k2) => fmt(vfs.get(k2), k2.slice(prefix.length), k2));
    if (all) { const up = vfs.get(abs.slice(0, abs.lastIndexOf('/')) || '/') || n; rows.unshift(fmt(n, '.', abs), fmt(up, '..', abs)); }
    emit(rows);
  });
  return { out: join(out), err: errs.join('\n'), code: errs.length ? 2 : 0 };
}
function readlinkCmd(sess, args, priv) {
  const out = []; const errs = [];
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const n = sess.world.vfs.get(resolve(sess, a));
    if (!n || n.type !== 'link') { errs.push(''); continue; }
    if (n.procPriv && !priv && n.owner !== sess.world.user) { errs.push(`readlink: ${a}: Permission denied`); continue; }
    out.push(n.target);
  }
  return { out: join(out), err: errs.filter(Boolean).join('\n'), code: errs.length ? 1 : 0 };
}
function findCmd(sess, args, priv) {
  const roots = []; let i = 0;
  while (i < args.length && !args[i].startsWith('-')) roots.push(...globExpand(sess, args[i++]));
  const tests = [];
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-lname' || a === '-name' || a === '-type' || a === '-maxdepth' || a === '-user') tests.push([a, args[++i]]);
    else if (a === '-ls' || a === '-print') continue;
    else return { err: `find: this simulator supports  -name, -lname, -type, -user, -maxdepth`, code: 1 };
  }
  const glob = (g) => new RegExp('^' + globToRe(g, false) + '$');
  const out = []; const errs = new Set();
  for (const r of roots.length ? roots : ['.']) {
    const abs = resolve(sess, r);
    for (const [path, n] of sess.world.vfs) {
      if (path !== abs && !path.startsWith(abs === '/' ? '/' : abs + '/')) continue;
      const depth = path === abs ? 0 : path.slice(abs.length).split('/').length - 1;
      if (n.procPriv && !priv && n.owner !== sess.world.user) { const d = path.replace(/\/fd\/.*/, '/fd'); if (d.endsWith('/fd')) errs.add(`find: '${d}': Permission denied`); continue; }
      const ok = tests.every(([t, v]) => {
        if (t === '-maxdepth') return depth <= Number(v);
        if (t === '-type') return (v === 'f' && n.type === 'file') || (v === 'd' && n.type === 'dir') || (v === 'l' && n.type === 'link');
        if (t === '-name') return glob(v).test(path.split('/').pop());
        if (t === '-lname') return n.type === 'link' && glob(v).test(n.target);
        if (t === '-user') return (n.ownerPid ? sess.world.byPid.get(n.ownerPid).user : n.owner) === v;
        return true;
      });
      if (ok) out.push(r.startsWith('/') ? path : r + path.slice(abs.length));
    }
  }
  return { out: join(out.sort()), err: [...errs].sort().join('\n'), code: errs.size ? 1 : 0 };
}

// ----- systemd
function unitOf(w, name) { const u = name.includes('.') ? name : `${name}.service`; return w.services.find((s) => s.unit === u); }
function systemctlCmd(sess, args) {
  const w = sess.world; const pos = args.filter((a) => !a.startsWith('-'));
  const sub = pos[0] || 'list-units';
  const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
  if (sub === 'list-units' || (sub === 'list-units' && !pos.length)) {
    let us = w.services;
    const type = opt('type'); if (type && type !== 'service') us = [];
    const state = opt('state'); if (state) us = us.filter((u) => [u.active, u.sub, u.load].includes(state));
    if (args.includes('--failed')) us = us.filter((u) => u.active === 'failed');
    const rows = us.map((u) => [u.active === 'failed' ? '●' : ' ', u.unit, u.load, u.active, u.sub, u.desc]);
    return { out: join([...table([[' ', 'UNIT', 'LOAD', 'ACTIVE', 'SUB', 'DESCRIPTION'], ...rows]), '', `${us.length} loaded units listed.`]) };
  }
  if (sub === 'list-unit-files') {
    let us = w.services; const state = opt('state'); if (state) us = us.filter((u) => u.enabled === state);
    return { out: join([...table([['UNIT FILE', 'STATE', 'PRESET'], ...us.map((u) => [u.unit, u.enabled, 'enabled'])].map((r) => [...r, ''])), '', `${us.length} unit files listed.`]) };
  }
  const name = pos[1];
  if (['status', 'is-active', 'is-enabled', 'cat', 'show', 'is-failed'].includes(sub) && !name) return { err: `Too few arguments.`, code: 1 };
  const u = name && unitOf(w, name);
  if (sub === 'is-active') return { out: (u ? u.active : 'inactive') + '\n', code: u?.active === 'active' ? 0 : 3 };
  if (sub === 'is-failed') return { out: (u?.active === 'failed' ? 'failed' : u ? u.active : 'inactive') + '\n' };
  if (sub === 'is-enabled') return u ? { out: u.enabled + '\n' } : { err: `Failed to get unit file state for ${name}: No such file or directory`, code: 1 };
  if (!u) return { err: `Unit ${name.includes('.') ? name : name + '.service'} could not be found.`, code: 4 };
  if (sub === 'cat') {
    const file = w.vfs.get(u.path);
    return { out: `# ${u.path}\n${file ? file.content : `[Unit]\nDescription=${u.desc}\n\n[Service]\nExecStart=${w.byPid.get(u.pid)?.cmd || '/usr/bin/true'}\n\n[Install]\nWantedBy=multi-user.target\n`}` };
  }
  if (sub === 'show') {
    const props = { NRestarts: u.nrestarts, MainPID: u.pid || 0, ActiveState: u.active, SubState: u.sub, Restart: u.restart || 'no', MemoryMax: u.memoryMax || 'infinity', UnitFileState: u.enabled, ExecMainStartTimestamp: u.since ? isoish(parseTs(u.since)) : '', FragmentPath: u.path || `/lib/systemd/system/${u.unit}` };
    const want = (args.find((a) => a.startsWith('--property=')) || '').split('=')[1] || (args.includes('-p') ? args[args.indexOf('-p') + 1] : null);
    const keys = want ? want.split(',') : Object.keys(props);
    return { out: join(keys.map((k) => `${k}=${props[k] ?? ''}`)) };
  }
  if (sub === 'status') {
    const p = w.byPid.get(u.pid); const since = u.since ? parseTs(u.since) : w.boot;
    const recent = w.c.journal.filter((e) => e.unit === u.unit).slice(-(u.statusLines ?? 5)).map((e) => `${shortTs(parseTs(e.ts))} ${w.host.hostname} ${e.ident}[${e.pid ?? 1}]: ${e.msg}`);
    const dot = u.active === 'active' ? '●' : u.active === 'failed' ? '×' : '○';
    const kids = p ? forestOrder(w.procs.filter((x) => x.pid === p.pid || x.ppid === p.pid)).map((r) => `             ${r.d ? '  └─' : '└─'}${r.p.pid} ${r.p.cmd}`) : [];
    return {
      out: join([
        `${dot} ${u.unit} - ${u.desc}`,
        `     Loaded: ${u.load} (${u.path || `/lib/systemd/system/${u.unit}`}; ${u.enabled}; preset: enabled)`,
        `     Active: ${u.active} (${u.sub}) since ${isoish(since)}; ${ago(Math.round((w.now - since) / 1000))}`,
        ...(p ? [`   Main PID: ${p.pid} (${p.comm})`, `      Tasks: ${p.threads || 1} (limit: 4645)`, `     Memory: ${(p.rss / 1024).toFixed(1)}M`, `        CPU: ${p.time}`, `     CGroup: /system.slice/${u.unit}`, ...kids.slice(0, 6)] : []),
        ...(recent.length ? ['', ...recent] : []),
      ]),
      code: u.active === 'active' ? 0 : 3,
    };
  }
  return { err: `systemctl: this simulator supports status, is-active, is-enabled, cat, show -p, list-units, list-unit-files`, code: 1 };
}
const PRIO = { emerg: 0, alert: 1, crit: 2, err: 3, error: 3, warning: 4, warn: 4, notice: 5, info: 6, debug: 7 };
function sinceMs(w, v) {
  if (!v) return null;
  let m;
  if ((m = v.match(/^-?(\d+)\s*(h|hour|hours|min|minute|minutes|m|d|day|days|s|sec|seconds)\s*(ago)?$/i))) { const n = Number(m[1]); const u = m[2][0].toLowerCase(); return w.now - n * ({ h: 3600, m: 60, d: 86400, s: 1 }[u]) * 1000; }
  if (v === 'today') return parseTs(new Date(w.now).toISOString().slice(0, 10));
  if (v === 'yesterday') return parseTs(new Date(w.now - 86400000).toISOString().slice(0, 10));
  if (v === 'now') return w.now;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return parseTs(v.length === 10 ? v : v.length === 16 ? v + ':00' : v);
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return parseTs(`${new Date(w.now).toISOString().slice(0, 10)} ${v.length === 5 ? v + ':00' : v}`);
  throw new Error(`Failed to parse timestamp: ${v}`);
}
function journalctlCmd(sess, args) {
  const w = sess.world;
  let es = w.c.journal.map((e) => ({ ...e, ms: parseTs(e.ts) }));
  let n = null; let rev = false; let out = 'short'; const units = []; let prio = null; let kernel = false; let since = null; let until = null; let gre = null;
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const val = () => (a.includes('=') ? a.split('=').slice(1).join('=') : args[++i]);
      if (a === '-f' || a === '--follow') return { err: 'journalctl: follow mode can\'t run here — use  -n 50  or  --since', code: 1 };
      if (a === '-u' || a.startsWith('--unit')) units.push(val());
      else if (/^-u\S+/.test(a)) units.push(a.slice(2));
      else if (a === '-p' || a.startsWith('--priority')) { const v = val(); const top = v.split('..').pop(); prio = PRIO[top] ?? Number(top); if (Number.isNaN(prio)) return { err: `Failed to parse priority value: ${v}`, code: 1 }; }
      else if (a === '-k' || a === '--dmesg') kernel = true;
      else if (a === '-b' || a === '--boot') { if (/^-?\d+$/.test(args[i + 1] || '')) { const b = args[++i]; if (b !== '0') return { err: `Data from the specified boot (${b}) is not available: No such boot ID in journal`, code: 1 }; } }
      else if (a === '-n' || a.startsWith('--lines')) n = Number(val());
      else if (/^-n\d+$/.test(a)) n = Number(a.slice(2));
      else if (a === '-r' || a === '--reverse') rev = true;
      else if (a === '-o' || a.startsWith('--output')) out = val();
      else if (a === '-S' || a.startsWith('--since')) since = sinceMs(w, val());
      else if (a === '-U' || a.startsWith('--until')) until = sinceMs(w, val());
      else if (a === '-g' || a.startsWith('--grep')) gre = toRegex(val(), { ere: true, icase: true });
      else if (a === '--list-boots') return { out: ` 0 3f9a2c1e8d7b4a60b1c2d3e4f5a6b7c8 ${isoish(w.boot)} ${isoish(w.now)}\n` };
      else if (a === '-e' || a === '--pager-end') { if (n === null) n = 1000; }
      else if (['--no-pager', '-x', '--catalog', '-q', '--quiet', '-a', '--all', '-l', '--full', '--no-hostname', '--utc'].includes(a)) { /* no-op */ }
      else return { err: `journalctl: unrecognized option '${a}'`, code: 1 };
    }
  } catch (e) { return { err: e.message, code: 1 }; }
  if (units.length) { const want = units.map((u) => (u.includes('.') ? u : `${u}.service`)); es = es.filter((e) => want.includes(e.unit)); }
  if (kernel) es = es.filter((e) => e.ident === 'kernel');
  if (prio !== null) es = es.filter((e) => (e.prio ?? 6) <= prio);
  if (since !== null) es = es.filter((e) => e.ms >= since);
  if (until !== null) es = es.filter((e) => e.ms <= until);
  if (gre) es = es.filter((e) => gre.test(e.msg));
  if (n !== null) es = es.slice(-n);
  if (rev) es.reverse();
  if (!es.length) return { out: '-- No entries --\n' };
  const render = (e) => (out === 'cat' ? e.msg : out === 'short-iso' ? `${new Date(e.ms).toISOString().replace('.000Z', '+0000')} ${w.host.hostname} ${e.ident}${e.pid ? `[${e.pid}]` : ''}: ${e.msg}` : `${shortTs(e.ms)} ${w.host.hostname} ${e.ident}${e.pid ? `[${e.pid}]` : ''}: ${e.msg}`);
  return { out: join(es.map(render)) };
}
function dmesgCmd(sess, args, priv) {
  const w = sess.world;
  if (w.os.dmesgRestrict && !priv) return { err: 'dmesg: read kernel buffer failed: Operation not permitted', code: 1 };
  const human = args.some((a) => a === '-T' || a === '--ctime' || /^-\w*T/.test(a));
  let es = w.c.journal.filter((e) => e.ident === 'kernel');
  const lvl = args.find((a) => a.startsWith('--level=')) || (args.includes('-l') ? `--level=${args[args.indexOf('-l') + 1]}` : null);
  if (lvl) { const want = lvl.split('=')[1].split(',').map((x) => PRIO[x]); es = es.filter((e) => want.includes(e.prio ?? 6)); }
  return { out: join(es.map((e) => { const ms = parseTs(e.ts); return human ? `[${longTs(ms)}] ${e.msg}` : `[${((ms - w.boot) / 1000).toFixed(6).padStart(12)}] ${e.msg}`; })) };
}

// ----- containers
function tmpl(t, obj) {
  t = t.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  t = t.replace(/\{\{\s*range\s+\.(\w+)\s*\}\}(.*?)\{\{\s*end\s*\}\}/gs, (_, key, body) => (obj[key] || []).map((it) => tmpl(body, it)).join(''));
  return t.replace(/\{\{\s*"([^"]*)"\s*\}\}/g, (_, s) => s.replace(/\\n/g, '\n')).replace(/\{\{\s*(json\s+)?\.([\w.]+)\s*\}\}/g, (_, json, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v === undefined) throw new Error(`template: :1:${path.length}: executing "" at <.${path}>: map has no entry for key "${path.split('.').pop()}"`);
    return json || typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
function containerCmd(sess, name, args, priv) {
  const w = sess.world; const cs = w.c.containers || [];
  if (name === 'docker' && !priv && !w.c.dockerGroup) return { err: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied', code: 1 };
  const sub = args[0];
  const fmtIdx = args.findIndex((a) => a === '--format' || a === '-f' || a.startsWith('--format='));
  const fmt = fmtIdx < 0 ? null : args[fmtIdx].includes('=') ? args[fmtIdx].split('=').slice(1).join('=') : args[fmtIdx + 1];
  const pos = args.filter((a, i) => !a.startsWith('-') && !(fmtIdx >= 0 && i === fmtIdx + 1) && !(args[i - 1] === '--tail' || args[i - 1] === '-n'));
  const view = (c) => ({
    ID: c.id, Names: c.name, Image: c.image, Command: c.command, CreatedAt: c.created, Status: c.status, Ports: c.ports || '', State: c.state || 'running',
    Name: '/' + c.name, Created: c.createdIso, Config: { Image: c.image, User: c.user || '', Env: c.env || [] }, HostConfig: { RestartPolicy: { Name: c.restart }, NetworkMode: c.network, Privileged: !!c.privileged }, Mounts: c.mounts.map((m) => ({ Type: 'bind', Source: m.src, Destination: m.dst, RW: m.rw !== false })), State: { Status: c.state || 'running', Running: true, Pid: c.pid, StartedAt: c.createdIso }, Image_: c.imageId,
  });
  if (sub === 'ps') {
    let list = cs; if (!args.includes('-a') && !args.includes('--all')) list = list.filter((c) => (c.state || 'running') === 'running');
    if (fmt) {
      try {
        const isTable = fmt.startsWith('table');
        const body = fmt.replace(/^table\s*/, '');
        const rendered = list.map((c) => tmpl(body, view(c)));
        if (!isTable) return { out: join(rendered) };
        const head = tmpl(body, { ID: 'CONTAINER ID', Names: 'NAMES', Image: 'IMAGE', Command: 'COMMAND', CreatedAt: 'CREATED AT', Status: 'STATUS', Ports: 'PORTS', State: 'STATE' });
        return { out: join(table([head, ...rendered].map((l) => [...l.split('\t'), '']))) };
      } catch (e) { return { err: e.message, code: 1 }; }
    }
    return { out: join(table([['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'], ...list.map((c) => [c.id, c.image, `"${c.command.slice(0, 20)}…"`, c.createdAgo, c.status, c.ports || '', c.name])].map((r) => r.map((x) => String(x))))) };
  }
  if (sub === 'images') return { out: join(table([['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE'], ...cs.map((c) => [...c.image.split(':'), c.imageId.slice(7, 19), c.imageAgo, c.imageSize])].map((r) => r.map(String)))) };
  const target = pos[1]; const c = cs.find((x) => x.name === target || x.id.startsWith(target || '#'));
  if (['inspect', 'logs', 'exec', 'top', 'port', 'stats'].includes(sub) && !c) return { err: `Error: No such container: ${target ?? ''}`.trim(), code: 1 };
  if (sub === 'inspect') {
    const v = view(c); v.Image = c.imageId; v.Id = c.id + 'a4c19e2f0b7d3e8a1c5f6b2d9e0a7c3f4b8d1e6a2c5f9b0d3e7a1c4f8b2d6e';
    if (fmt) { try { return { out: tmpl(fmt, v).replace(/\n?$/, '\n') }; } catch (e) { return { err: e.message, code: 1 }; } }
    const pretty = { Id: v.Id, Created: c.createdIso, Path: c.command.split(' ')[0], State: v.State, Image: c.imageId, Name: v.Name, HostConfig: v.HostConfig, Mounts: v.Mounts, Config: v.Config };
    return { out: JSON.stringify([pretty], null, 4) + '\n' };
  }
  if (sub === 'logs') {
    const tIdx = args.findIndex((a) => a === '--tail' || a === '-n'); const ls = c.logs || [];
    return { out: join(tIdx >= 0 ? ls.slice(-Number(args[tIdx + 1])) : ls) };
  }
  if (sub === 'top') { const p = w.byPid.get(c.pid); return { out: join(table([['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD'], ...(p ? [[p.user, p.pid, p.ppid, 0, startCol(w, p), '?', '00:00:12', p.cmd]] : [])].map((r) => r.map(String)))) }; }
  if (sub === 'exec') return null; // handled by case custom output
  if (sub === 'stats') return { err: `${name} stats: streaming output can't run here — use  ${name} stats --no-stream`, code: 1 };
  return { err: `${name}: this simulator supports ps, inspect, logs, images, top, exec`, code: 1 };
}

// ----- network client
function curlCmd(sess, args) {
  const w = sess.world;
  const url = args.find((a) => /^(https?:\/\/)?[\w.-]+(:\d+)?(\/\S*)?$/.test(a) && !a.startsWith('-') && (a.includes('://') || a.includes(':') || a.startsWith('localhost')));
  if (!url) return { err: 'curl: try \'curl --help\' or \'curl --manual\' for more information', code: 2 };
  const m = url.match(/^(?:(https?):\/\/)?([\w.-]+)(?::(\d+))?(\/.*)?$/);
  const scheme = m[1] || 'http'; const host = m[2]; const port = Number(m[3] || (scheme === 'https' ? 443 : 80));
  const local = ['localhost', '127.0.0.1', '0.0.0.0', w.host.hostname].includes(host) || (w.host.ifaces || []).some((i) => i.addr.startsWith(host + '/'));
  if (!local) return { err: `curl: (6) Could not resolve host: ${host}`, code: 6 };
  const listening = w.sockets.some((s) => s.state === 'LISTEN' && s.lport === port && s.proto.startsWith('tcp') && (s.laddr !== '127.0.0.1' || ['localhost', '127.0.0.1'].includes(host)));
  if (!listening) return { err: `curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  const resp = (w.c.http || {})[port];
  if (!resp) return { err: `curl: (1) Received HTTP/0.9 when not allowed`, code: 1 };
  const headOnly = args.includes('-I') || args.includes('--head'); const incl = args.includes('-i') || args.includes('-v');
  const status = resp.status || 'HTTP/1.1 200 OK';
  const headers = [status, ...(resp.headers || [])].join('\n');
  if (headOnly) return { out: headers + '\n\n' };
  return { out: (incl ? headers + '\n\n' : '') + resp.body.replace(/\n?$/, '\n') };
}

// ----- free calculators
function printfCmd(args) {
  if (!args.length) return { err: 'printf: usage: printf [-v var] format [arguments]', code: 2 };
  const [fmt, ...vals] = args;
  const toNum = (v) => { if (v === undefined) return 0; const s = String(v).trim(); if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16); if (/^\d+#\w+$/.test(s)) return arith(s); const n = Number(s); if (Number.isNaN(n)) throw new Error(`printf: ${s}: invalid number`); return n; };
  const specs = (fmt.match(/%[-0-9]*[dsxXoi%]/g) || []).filter((s) => s !== '%%').length;
  let k = 0; let out = '';
  try {
    do {
      out += fmt.replace(/%([-0-9]*)([dsxXoi%])/g, (all, w, t) => {
        if (t === '%') return '%';
        const v = vals[k++];
        let s = t === 's' ? (v ?? '') : t === 'x' ? toNum(v).toString(16) : t === 'X' ? toNum(v).toString(16).toUpperCase() : t === 'o' ? toNum(v).toString(8) : String(toNum(v));
        if (w) { const width = Math.abs(parseInt(w, 10)); s = w.startsWith('-') ? s.padEnd(width) : w.startsWith('0') ? s.padStart(width, '0') : s.padStart(width); }
        return s;
      });
    } while (specs && k < vals.length);
  } catch (e) { return { err: e.message, code: 1 }; }
  return { out: out.replace(/\\n/g, '\n').replace(/\\t/g, '\t') };
}

// ---------------------------------------------------------------- manual
const MAN = {
  ss: 'ss — socket statistics. -t tcp, -u udp, -l listening only, -p owning process (needs sudo to see other users\' processes), -n numeric ports.',
  netstat: 'netstat — legacy socket listing (net-tools). Same idea as ss: -tlpn.',
  lsof: 'lsof — list open files; -i network files, -P numeric ports, -n numeric hosts.',
  ps: 'ps — process snapshot. aux = all processes, user format; auxf = with a parent/child tree; -eo pid,user,%cpu,cmd --sort=-%cpu = choose columns and sort.',
  top: 'top — live process view. Here only batch mode works: top -b -n1 | head -20.',
  free: 'free — memory. -m MiB, -h human. Read the "available" column, not "free": Linux uses spare RAM as page cache.',
  vmstat: 'vmstat N C — C samples N seconds apart. r = run queue, si/so = swap, wa = IO wait. The first row is the average since boot.',
  df: 'df — filesystem space. -h human sizes, -T type, -i inodes.',
  journalctl: 'journalctl — systemd journal. -p err (error and worse), -b this boot, -k kernel, -u UNIT, -n N, --since "1 hour ago", -o cat (message only).',
  dmesg: 'dmesg — kernel ring buffer. -T readable timestamps. Debian/Ubuntu restrict it to root (sudo).',
  systemctl: 'systemctl — systemd control. Read-only verbs: status, is-active, is-enabled, cat, show -p NRestarts, list-units --type=service --state=running.',
  docker: 'docker — containers. ps -a, inspect NAME, inspect --format \'{{.HostConfig.RestartPolicy.Name}}\' NAME, logs --tail 20 NAME. Needs root or the docker group.',
  podman: 'podman — daemonless containers (RHEL). Same verbs as docker.',
  curl: 'curl — HTTP client. -s silent, -I headers only, -i include headers.',
  grep: 'grep — filter lines. -i ignore case, -v invert, -E extended regex (a|b), -c count, -n line numbers, -o only the match.',
  awk: 'awk — column tool. awk \'{print $1}\', awk \'$5+0 >= 80\', awk -F: \'{print $1}\'.',
  sort: 'sort — order lines. -n numeric, -r reverse, -k N by field N, -h human sizes.',
  uniq: 'uniq — collapse ADJACENT duplicates (sort first). -c prefix counts.',
  cat: 'cat — print files. cat -A shows hidden characters (^@ = NUL, $ = end of line).',
  tr: 'tr — translate characters. tr \'\\0\' \' \' turns NUL separators (as in /proc/PID/cmdline) into spaces.',
  printf: 'printf — formatted print (free here). printf \'%d\\n\' 0x1F40 converts hex to decimal.',
  echo: 'echo — print (free here). echo $((16#1F40)) does base-16 arithmetic.',
  readlink: 'readlink — print a symlink target. readlink /proc/PID/cwd shows the process\'s working directory.',
  find: 'find — walk paths. find /proc/[0-9]*/fd -lname \'socket:\\[INODE\\]\' finds which process owns a socket inode.',
  ls: 'ls — list. -l long, -a hidden files, -h human sizes. ls -l /proc/PID/fd shows a process\'s open files and sockets.',
  sudo: 'sudo — run one command as root. sudo -l lists what you are allowed to run.',
  ausearch: 'ausearch — query the audit log. ausearch -m avc -ts recent shows recent SELinux denials.',
  getenforce: 'getenforce — SELinux mode: Enforcing, Permissive, or Disabled.',
  getsebool: 'getsebool — read SELinux booleans, e.g. getsebool httpd_can_network_connect.',
  'firewall-cmd': 'firewall-cmd — firewalld client. --list-all shows the active zone\'s services and ports.',
  ufw: 'ufw — Ubuntu/Debian firewall front end. ufw status verbose.',
  sshd: 'sshd -T — print the EFFECTIVE sshd config after Include/drop-in processing. Truth beats reading sshd_config by eye.',
};

// ---------------------------------------------------------------- dispatcher
function custom(sess, segText) {
  for (const cu of sess.c.custom || []) if (cu.re.test(segText)) return cu;
  return null;
}
function produce(sess, argv, priv, segText, extraProcs) {
  const [name, ...args] = argv;
  const w = sess.world;
  if ((w.c.blocked || []).includes(name)) return { err: `-bash: ${name}: command not found`, code: 127, free: true };
  const cu = custom(sess, segText);
  if (cu) {
    if (cu.root && !priv) return { err: cu.denied || `${name}: Permission denied`, code: 1 };
    if (cu.secret) sess.secretShown = true;
    return { out: cu.out.replace(/\n?$/, '\n'), err: cu.err, code: cu.code ?? 0 };
  }
  const hc = hostCmds(sess, name, args, priv); if (hc) return hc;
  try {
    switch (name) {
      case 'ss': return ssCmd(sess, args, priv);
      case 'netstat': return netstatCmd(sess, args, priv);
      case 'lsof': return lsofCmd(sess, args, priv);
      case 'ps': return psCmd(sess, args, extraProcs);
      case 'top': return topCmd(sess, args);
      case 'cat': case 'less': case 'more': return catCmd(sess, args, null, priv, name);
      case 'head': case 'tail': return headTail(name, args, null, sess, priv);
      case 'grep': case 'egrep': case 'zgrep': return grep(sess, name === 'egrep' ? ['-E', ...args] : args, null, priv);
      case 'wc': return wcCmd(sess, args, null, priv);
      case 'awk': return awkCmd(sess, args, null, priv);
      case 'ls': return lsCmd(sess, args, priv);
      case 'readlink': return readlinkCmd(sess, args, priv);
      case 'find': return findCmd(sess, args, priv);
      case 'systemctl': return systemctlCmd(sess, args);
      case 'journalctl': return journalctlCmd(sess, args);
      case 'dmesg': return dmesgCmd(sess, args, priv);
      case 'docker': case 'podman': {
        if ((name === 'docker' && w.os.family === 'rhel' && !(w.c.containers || []).length) || (name === 'podman' && w.os.family !== 'rhel')) return { err: `-bash: ${name}: command not found`, code: 127, free: true };
        const r = containerCmd(sess, name, args, priv);
        return r || { err: `${name} exec: no output captured for that command in this case file`, code: 1 };
      }
      case 'curl': return curlCmd(sess, args);
      case 'stat': { const n = w.vfs.get(resolve(sess, args.at(-1) || '')); return n ? { out: `  File: ${args.at(-1)}\n  Size: ${n.content?.length ?? 4096}\tBlocks: 8\nAccess: (${n.mode || '-rw-r--r--'})  Uid: (${n.owner || 'root'})   Gid: (${n.group || 'root'})\nModify: 2026-11-14 08:02:11.000000000 +0000\n` } : { err: `stat: cannot statx '${args.at(-1)}': No such file or directory`, code: 1 }; }
    }
  } catch (e) { return { err: e.message, code: 1 }; }
  return { err: `-bash: ${name}: command not found`, code: 127, free: true };
}
function filter(sess, argv, input, priv) {
  const [name, ...args] = argv;
  switch (name) {
    case 'grep': case 'egrep': case 'zgrep': return grep(sess, name === 'egrep' ? ['-E', ...args] : args, input, priv);
    case 'head': case 'tail': return headTail(name, args, input, sess, priv);
    case 'sort': return sortCmd(args, input);
    case 'uniq': return uniqCmd(args, input);
    case 'wc': return wcCmd(sess, args, input, priv);
    case 'cut': return cutCmd(args, input);
    case 'tr': return trCmd(args, input);
    case 'awk': return awkCmd(sess, args, input, priv);
    case 'column': return columnCmd(args, input);
    case 'cat': case 'less': case 'more': return catCmd(sess, args, input, priv, name);
    case 'xargs': return { err: 'xargs: not supported in this simulator — run the command directly', code: 1 };
    case 'sed': return { err: 'sed: not supported in this simulator — use grep, awk or cut', code: 1 };
  }
  return { err: `-bash: ${name}: command not found`, code: 127 };
}

function checkDestructive(text) {
  const t = text.replace(/^sudo\s+(-\S+\s+)*/, '');
  for (const [re, why] of DESTRUCTIVE) if (re.test(t)) return why;
  return null;
}

// Runs one pipeline; returns {out, err, cost, violation}
export function runPipeline(sess, text, { nested = false } = {}) {
  let segs;
  try { segs = splitTop(text, ['|']); } catch (e) { return { out: '', err: `-bash: ${e.message}`, cost: 0 }; }
  if (segs.some((s) => !s)) return { out: '', err: "-bash: syntax error near unexpected token `|'", cost: 0 };
  let input = null; let errs = []; let cost = 0; let lastCode = 0;
  // the classic `ps aux | grep foo` self-match: grep shows up in the process list
  const extra = [];
  const firstWord = segs[0].replace(/^sudo\s+/, '').split(/\s+/)[0];
  if (firstWord === 'ps' && segs[1]) {
    const g = segs[1].replace(/^sudo\s+/, '');
    if (/^grep\b/.test(g)) extra.push({ pid: 31337, ppid: 3101, user: sess.world.user, uid: 1000, cpu: 0, mem: 0, rss: 2212, vsz: 6332, stat: 'S+', tty: 'pts/0', time: '0:00', cmd: g.replace(/^grep/, 'grep --color=auto').replace(/'/g, ''), comm: 'grep', startMs: sess.world.now });
  }
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const violation = checkDestructive(seg);
    if (violation) return { out: '', err: '', cost: 0, violation, blocked: seg };
    let words;
    try { words = tokenize(seg, sess); } catch (e) { return { out: '', err: `-bash: ${e.message}`, cost }; }
    // redirects
    let dropErr = false; const argv = [];
    for (let k = 0; k < words.length; k++) {
      const { v, q } = words[k];
      if (!q && /^2>(\/dev\/null)?$/.test(v)) { dropErr = true; if (v === '2>') k++; continue; }
      if (!q && (v === '2>&1' || v === '&>/dev/null')) { if (v.startsWith('&')) dropErr = true; continue; }
      if (!q && /^(\d?>>?|&>)/.test(v)) {
        const target = v.replace(/^(\d?>>?|&>)/, '') || words[k + 1]?.v;
        if (target === '/dev/null') { if (!v.replace(/^(\d?>>?|&>)/, '')) k++; continue; }
        return { out: '', err: '', cost: 0, violation: 'You redirected output into a file — that writes to the server during a read-only review.', blocked: seg };
      }
      if (!q && v.includes('*')) argv.push(...globExpand(sess, v)); else argv.push(v);
    }
    let priv = false;
    while (argv[0] === 'sudo') {
      argv.shift();
      if (argv[0] === '-l' || argv[0] === '--list') { argv.length = 0; argv.push('sudo-l'); break; }
      if (argv[0] === '-i' || argv[0] === '-s' || argv[0] === 'su' || argv[0] === 'bash' || argv[0] === 'sh') return { out: '', err: 'Stay in your own shell: one `sudo` per command keeps every privileged action attributable in the audit log.', cost };
      while (argv[0] && argv[0].startsWith('-')) argv.shift();
      priv = true;
    }
    if (!argv.length) return { out: '', err: 'usage: sudo -h | -K | -k | -V', cost };
    if (argv[0] === 'sudo-l') {
      const cu = (sess.c.custom || []).find((c) => c.re.test('sudo -l'));
      const r = cu ? { out: cu.out + '\n' } : { out: `User ${sess.world.user} may run the following commands on ${sess.world.host.hostname}:\n    (ALL) NOPASSWD: ALL\n` };
      input = r.out; cost += i === 0 && !nested ? 1 : 0; continue;
    }
    if (argv[0] === 'sh' || argv[0] === 'bash') return { out: '', err: 'Run the command directly — nested shells are not simulated.', cost };
    const segText = (priv ? 'sudo ' : '') + argv.join(' ');
    let r;
    if (i === 0) {
      if (FREE.has(argv[0])) r = metaCmd(sess, argv) || { out: '' };
      else { r = produce(sess, argv, priv, segText, extra); if (!r.free && !nested) cost += 1; }
    } else r = filter(sess, argv, input, priv);
    if (r.err && !dropErr) errs.push(r.err);
    input = r.out ?? '';
    lastCode = r.code ?? 0;
    if (r.clear) return { clear: true, cost: 0, out: '' };
  }
  return { out: input ?? '', err: errs.join('\n'), cost, code: lastCode };
}

function metaCmd(sess, argv) {
  const [name, ...args] = argv;
  switch (name) {
    case 'echo': {
      const n = args[0] === '-n'; const e = args[0] === '-e'; const rest = n || e ? args.slice(1) : args;
      let t = rest.join(' '); if (e) t = t.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      return { out: t + (n ? '' : '\n') };
    }
    case 'printf': return printfCmd(args);
    case 'pwd': return { out: sess.cwd + '\n' };
    case 'cd': {
      const target = resolve(sess, args[0] || '~'); const n = sess.world.vfs.get(target);
      if (!n) return { err: `-bash: cd: ${args[0]}: No such file or directory`, code: 1 };
      if (n.type !== 'dir') return { err: `-bash: cd: ${args[0]}: Not a directory`, code: 1 };
      sess.cwd = target; return { out: '' };
    }
    case 'clear': return { clear: true };
    case 'exit': case 'logout': return { out: 'The case stays open until you file a verdict — use the "File verdict" button.\n' };
    case 'history': return { out: join(sess.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)) };
    case 'budget': return { out: budgetLine(sess) + '\n' };
    case 'clues': {
      const ev = sess.c.evidence;
      return { out: join([`Clues on the board: ${sess.found.size}/${ev.length}`, ...ev.filter((e) => sess.found.has(e.id)).map((e) => `  ✔ ${e.label}`)]) };
    }
    case 'man': {
      const k = args[0];
      if (!k) return { out: 'What manual page do you want?\n' };
      return MAN[k] ? { out: MAN[k] + '\n' } : { err: `No manual entry for ${k} (this simulator has short pages for the commands it supports — try  help)`, code: 16 };
    }
    case 'help': return { out: HELP(sess) };
  }
  return null;
}
export function budgetLine(sess) {
  const { mode, limit } = sess.c.budget;
  return mode === 'strict' ? `Budget: ${sess.used}/${limit} commands used (strict — the shell locks at ${limit})` : `Commands used: ${sess.used} (target: ${limit} or fewer; soft budget — scored on efficiency)`;
}
const HELP = (sess) => `Cold Case Server — you are on ${sess.world.host.hostname} as ${sess.world.user}.

Every command that reads the server costs 1 from your budget. A pipeline counts as ONE
command, so  ps aux | grep x | wc -l  is one command. Survey once, then target.

Free:  help  clues  budget  history  clear  man CMD  echo  printf  cd  pwd
Read-only rule: kill, systemctl restart/stop, docker stop, rm, setenforce, package
installs and file redirects are blocked and logged as violations.

Simulated: ss netstat lsof ps top free vmstat df iostat uptime nproc uname w ip
           systemctl journalctl dmesg docker/podman curl cat head tail ls find
           readlink grep sort uniq wc cut tr awk column sudo, plus case-specific tools.
Pipes, quotes, 2>/dev/null, $(…) and $((16#FF)) work. ↑/↓ for history, Tab to complete.
`;

// ---------------------------------------------------------------- top-level
export function runLine(sess, raw) {
  const line = raw.trim();
  const res = { out: '', cost: 0, newClues: [], violations: [], clear: false };
  if (!line) return res;
  sess.history.push(line);
  let parts;
  try { parts = splitTop(line, ['&&', ';']); } catch (e) { res.out = `-bash: ${e.message}\n`; return res; }
  for (const part of parts) {
    if (!part) continue;
    if (sess.locked) { res.out += '\n[budget spent — the shell is locked. File your verdict.]\n'; res.locked = true; break; }
    const r = runPipeline(sess, part);
    if (r.clear) { res.clear = true; continue; }
    if (r.violation) {
      sess.violations.push({ cmd: r.blocked, why: r.violation });
      res.violations.push(r.violation);
      res.out += `⛔ BLOCKED — ${r.violation}\n   Logged as a change violation (−25). This objective is observe-only.\n`;
      break;
    }
    sess.used += r.cost; res.cost += r.cost;
    const shown = (r.err ? r.err.replace(/\n?$/, '\n') : '') + (r.out || '');
    res.out += shown;
    for (const ev of sess.c.evidence) {
      if (sess.found.has(ev.id)) continue;
      if (ev.markers.some((mk) => (mk instanceof RegExp ? mk.test(shown) : shown.includes(mk)))) { sess.found.add(ev.id); res.newClues.push(ev); }
    }
  }
  if (sess.locked && !res.locked && res.cost) res.out += `\n[that was your last command — file your verdict]\n`;
  return res;
}

// ---------------------------------------------------------------- scoring
export function score(sess, answers) {
  const c = sess.c;
  const qRes = c.questions.map((q) => ({ q, picked: answers.q?.[q.id], ok: answers.q?.[q.id] === q.answer }));
  const fRes = c.findings.map((f, i) => { const picked = !!answers.f?.[i]; return { f, picked, ok: picked === f.real }; });
  const judged = qRes.length + fRes.length;
  const verdict = Math.round(60 * (qRes.filter((r) => r.ok).length + fRes.filter((r) => r.ok).length) / judged);
  const evFrac = sess.found.size / c.evidence.length;
  const evidence = Math.round(20 * evFrac);
  const par = expertCost(c);
  const efficiency = sess.used ? Math.round(20 * Math.min(1, par / sess.used) * evFrac) : 0;
  const penalty = sess.violations.length * 25 + (sess.secretShown ? 5 : 0);
  const total = Math.max(0, verdict + evidence + efficiency - penalty);
  const grade = total >= 90 ? 'Senior' : total >= 75 ? 'Solid' : total >= 50 ? 'Junior' : 'Back to the runbook';
  return { total, verdict, evidence, efficiency, penalty, grade, par, qRes, fRes, missed: c.evidence.filter((e) => !sess.found.has(e.id)) };
}

// Budget the expert route actually spends (free commands like printf cost 0).
const parCache = new Map();
export function expertCost(c) {
  if (!parCache.has(c.id)) { const s = createSession(c); for (const e of c.expert) runLine(s, e.cmd); parCache.set(c.id, s.used); }
  return parCache.get(c.id);
}

// Exposed for tests / tab completion
export const _internal = { tokenize, splitTop, toRegex, resolve, MAN, PORT_NAMES, ipToHex };
export function completions(sess, word, first) {
  if (first) return [...new Set([...Object.keys(MAN), 'help', 'clues', 'budget', 'history', 'clear', 'uptime', 'nproc', 'hostname', 'whoami', 'free', 'vmstat', 'iostat', 'uname', 'journalctl', 'systemctl', 'readlink', 'column', 'head', 'tail', 'wc', 'cut'])].filter((c) => c.startsWith(word) && !(sess.c.blocked || []).includes(c)).sort();
  const dir = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : '';
  const absDir = resolve(sess, dir || '.');
  const prefix = absDir === '/' ? '/' : absDir + '/';
  return [...sess.world.vfs.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && k.slice(prefix.length).startsWith(word.slice(dir.length))).map((k) => dir + k.slice(prefix.length) + (sess.world.vfs.get(k).type === 'dir' ? '/' : '')).sort();
}
