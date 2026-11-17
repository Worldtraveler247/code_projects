// Run: node --test 'cold-case/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from '../cases.js';
import { createSession, runLine, score, expertCost, arith } from '../shell.js';

// shell-style errors only ("cat: x: Permission denied"), not log text that happens to contain the words
const ERRORISH = /(^|\n)(-bash|cat|ls|grep|tail|head|find|readlink|journalctl|systemctl|ps|ss|awk|sort|curl|docker|podman|sudo|dmesg|wc|cut|tr|printf): |BLOCKED|simulator supports/;

for (const c of CASES) {
  test(`${c.id}: expert route is runnable, in budget, and reaches every clue`, () => {
    const s = createSession(c);
    for (const step of c.expert) {
      const r = runLine(s, step.cmd);
      assert.doesNotMatch(r.out, ERRORISH, `expert step "${step.cmd}" errored:\n${r.out}`);
      assert.ok(r.out.trim().length > 0, `expert step "${step.cmd}" printed nothing`);
    }
    const missing = c.evidence.filter((e) => !s.found.has(e.id)).map((e) => e.id);
    assert.deepEqual(missing, [], `clues unreachable by the expert route: ${missing}`);
    assert.ok(s.used <= c.budget.limit, `expert used ${s.used} > budget ${c.budget.limit}`);
    assert.equal(s.violations.length, 0);
    assert.equal(expertCost(c), s.used);
  });

  test(`${c.id}: verdict data is well-formed`, () => {
    const ids = new Set();
    for (const q of c.questions) {
      assert.ok(!ids.has(q.id)); ids.add(q.id);
      assert.ok(q.options.length >= 3, q.id);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, q.id);
      assert.ok(q.why.length > 20, q.id);
    }
    assert.ok(c.findings.some((f) => f.real) && c.findings.some((f) => !f.real), 'needs real findings and red herrings');
    assert.equal(new Set(c.evidence.map((e) => e.id)).size, c.evidence.length);
  });

  test(`${c.id}: /proc/net/tcp, ss and fd links agree on every socket`, () => {
    const s = createSession(c);
    const tcp = runLine(s, 'cat /proc/net/tcp').out.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/));
    const v4 = s.world.sockets.filter((x) => x.proto === 'tcp');
    assert.equal(tcp.length, v4.length);
    tcp.forEach((cols, i) => {
      const [ipHex, portHex] = cols[1].split(':');
      const ip = ipHex.match(/../g).reverse().map((h) => parseInt(h, 16)).join('.');
      assert.equal(ip, v4[i].laddr); assert.equal(parseInt(portHex, 16), v4[i].lport); assert.equal(Number(cols[9]), v4[i].inode);
    });
    const listeners = s.world.sockets.filter((x) => x.proto.startsWith('tcp') && x.state === 'LISTEN');
    if (!(c.blocked || []).includes('ss')) {
      const ss = runLine(s, 'sudo ss -tlpn').out.trim().split('\n').slice(1);
      assert.equal(ss.length, listeners.length);
      for (const l of listeners) assert.ok(ss.some((row) => row.includes(`:${l.lport} `) && row.includes(`pid=${l.pid},fd=${l.fd}`)), `ss missing ${l.lport}`);
    }
    for (const l of listeners) {
      const out = runLine(s, `sudo find /proc/[0-9]*/fd -lname 'socket:\\[${l.inode}\\]'`).out.trim();
      assert.equal(out, `/proc/${l.pid}/fd/${l.fd}`);
    }
  });

  test(`${c.id}: a perfect run grades Senior; guessing with no evidence does not`, () => {
    const s = createSession(c);
    for (const step of c.expert) runLine(s, step.cmd);
    const perfect = { q: Object.fromEntries(c.questions.map((q) => [q.id, q.answer])), f: c.findings.map((f) => f.real) };
    const r = score(s, perfect);
    assert.equal(r.total, 100);
    assert.equal(r.grade, 'Senior');
    const lucky = score(createSession(c), perfect);
    assert.ok(lucky.total <= 60, `pure guessing scored ${lucky.total}`);
  });
}

test('read-only rule: destructive commands are blocked, free, and logged', () => {
  const s = createSession(CASES[0]);
  for (const cmd of ['sudo systemctl restart webapp', 'kill 1311', 'sudo docker stop haproxy', 'echo hi > /tmp/x', 'sudo rm -rf /tmp/x', 'sudo apt install sysstat', 'ps aux | tee /tmp/ps.txt']) {
    const r = runLine(s, cmd);
    assert.match(r.out, /BLOCKED/, cmd);
    assert.equal(r.cost, 0, cmd);
  }
  assert.equal(s.violations.length, 7);
  assert.equal(s.used, 0);
  assert.equal(runLine(s, 'systemctl status webapp').violations.length, 0);
  assert.equal(runLine(s, 'echo hi > /dev/null').violations.length, 0);
});

test('ps | grep self-match and the [b]racket trick', () => {
  const s = createSession(CASES[0]);
  assert.match(runLine(s, 'ps aux | grep webapp').out, /grep --color=auto webapp/);
  const trick = runLine(s, 'ps aux | grep [w]ebapp').out;
  assert.match(trick, /webapp\.py/);
  assert.doesNotMatch(trick, /grep/);
});

test('pipelines cost one command; calculators are free', () => {
  const s = createSession(CASES[1]);
  assert.equal(runLine(s, "printf '%d\\n' 0x1F40").out, '8000\n');
  assert.equal(runLine(s, "printf '%d.%d.%d.%d\\n' 0xC6 0x33 0x64 0x17").out, '198.51.100.23\n');
  assert.equal(runLine(s, 'echo $((16#1F40))').out, '8000\n');
  assert.equal(s.used, 0);
  runLine(s, "journalctl --no-pager | grep -i sshd | sort | uniq -c | sort -rn | head -3");
  assert.equal(s.used, 1);
  assert.equal(arith('16#C958'), 51544);
});

test('blocked tools say command not found and cost nothing', () => {
  const s = createSession(CASES[1]);
  for (const t of ['ss -tlpn', 'netstat -tlpn', 'lsof -i']) assert.match(runLine(s, t).out, /command not found/);
  assert.equal(s.used, 0);
});

test('privilege is modeled: ss -p hides other users\' processes without sudo', () => {
  const s = createSession(CASES[0]);
  const plain = runLine(s, 'ss -tlpn').out; const root = runLine(s, 'sudo ss -tlpn').out;
  assert.doesNotMatch(plain, /haproxy/); assert.match(root, /"haproxy",pid=961/);
  assert.match(plain, /"python3",pid=23514/); // admin owns the web app
  assert.match(runLine(s, 'dmesg').out, /Operation not permitted/);
  assert.match(runLine(s, 'docker ps').out, /permission denied/);
});

test('strict budget locks the shell', () => {
  const c = CASES.find((x) => x.budget.mode === 'strict');
  const s = createSession(c);
  for (let i = 0; i < c.budget.limit; i++) runLine(s, 'uptime');
  assert.ok(s.locked);
  const r = runLine(s, 'free -m');
  assert.match(r.out, /locked/);
  assert.equal(s.used, c.budget.limit);
});

test('secrets on screen are flagged', () => {
  const s = createSession(CASES[0]);
  runLine(s, 'cat /home/admin/.env');
  assert.ok(s.secretShown);
});

test('Debian habits fail on RHEL', () => {
  const s = createSession(CASES.find((x) => x.os === 'rhel9'));
  assert.match(runLine(s, 'sudo cat /var/log/syslog').out, /No such file/);
  assert.match(runLine(s, 'sudo ufw status').out, /command not found/);
  assert.match(runLine(s, 'sudo tail -1 /var/log/messages').out, /setroubleshoot|sshd/);
  assert.match(runLine(s, 'sudo setenforce 0').out, /BLOCKED/);
});

test('common survey commands render without errors on every case', () => {
  const cmds = ['uptime', 'nproc', 'free -h', 'free -m', 'df -h', 'vmstat 1 3', 'ps auxf', 'ps -ef', 'top -b -n1 | head -12', 'systemctl list-units --type=service --state=running', 'journalctl -p err -b --no-pager', 'ip -br a', 'cat /etc/os-release', 'cat /proc/loadavg', 'ls -la ~', 'sudo journalctl -p err -b -o cat --no-pager | sort | uniq -c | sort -rn | head', 'w', 'id', 'uname -a', "df -h | awk '$5+0 >= 80'", "ps -eo pid,user,%cpu,%mem,cmd --sort=-%cpu | head -5", 'sudo ls -l /proc/1/fd'];
  for (const c of CASES) {
    const s = createSession(c);
    for (const cmd of cmds) {
      const r = runLine(s, cmd);
      assert.doesNotMatch(r.out, /unsupported|invalid option|not supported|TypeError|undefined|NaN/, `${c.id}: ${cmd}\n${r.out}`);
    }
  }
});
