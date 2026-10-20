// The campaign must be findable in every source the boss level correlates, and nowhere it shouldn't be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateArena } from '../generator.js';
import { ATTACKER, TIMELINE } from '../story.js';
import { apacheTime, syslogTime, isoTime } from '../gen-util.js';
import { hashAnswer } from '../checker.js';
import fs from 'node:fs';

const arena = generateArena();
const text = (path) => new TextDecoder().decode(arena.entries.find((e) => e.path === path).data);
const lines = (path) => text(path).split('\n').filter(Boolean);

test('the timeline runs in order', () => {
  const order = ['firstProbe', 'reconStart', 'reconEnd', 'bruteStart', 'bruteEnd', 'login', 'sudo', 'execute', 'exfilStart', 'exfilEnd'];
  for (let i = 1; i < order.length; i++) assert.ok(TIMELINE[order[i - 1]] < TIMELINE[order[i]], `${order[i - 1]} < ${order[i]}`);
});

test('the first sighting is only in the rotation the guest compresses', () => {
  const probe = `[${apacheTime(TIMELINE.firstProbe)}]`;
  const hits = ['var/log/httpd/access_log.2', 'var/log/httpd/access_log.1', 'var/log/httpd/access_log']
    .filter((p) => text(p).includes(probe) && text(p).includes(ATTACKER.ip));
  assert.deepEqual(hits, ['var/log/httpd/access_log.2']);
  // Nothing from the attacker anywhere earlier than the first probe.
  const earliest = lines('var/log/httpd/access_log.2').find((l) => l.startsWith(`${ATTACKER.ip} `));
  assert.ok(earliest.includes(probe));
});

test('recon: the scanner user agent appears only from the attacker, in a burst of 404s', () => {
  const all = ['var/log/httpd/access_log.2', 'var/log/httpd/access_log.1', 'var/log/httpd/access_log'].flatMap(lines);
  const scanner = all.filter((l) => l.includes(ATTACKER.userAgent));
  assert.ok(scanner.every((l) => l.startsWith(`${ATTACKER.ip} `)));
  const notFound = scanner.filter((l) => / 404 /.test(l)).length;
  assert.ok(notFound >= 40, `only ${notFound} 404s in the burst`);
});

test('brute force then success, in secure, with the victim account', () => {
  const secure = lines('var/log/secure');
  const failed = secure.filter((l) => l.includes(`Failed password`) && l.includes(ATTACKER.ip));
  assert.ok(failed.length >= 50);
  const accepted = secure.filter((l) => l.includes('Accepted') && l.includes(ATTACKER.ip));
  assert.deepEqual(accepted, [`${syslogTime(TIMELINE.login)} bastion-7 ${accepted[0].split(' ')[4]} Accepted password for ${ATTACKER.victim} from ${ATTACKER.ip} port 51122 ssh2`]);
  assert.ok(secure.some((l) => l.includes(`${ATTACKER.victim} : TTY=pts/1`) && l.includes('COMMAND=/bin/bash')));
});

test('the attacker is not the only source of failed passwords (a crowd to filter)', () => {
  const sources = new Set([...text('var/log/secure-20260313'), ...text('var/log/secure')].join('')
    .match(/Failed password .* from (\S+)/g).map((m) => m.split(' from ')[1]));
  assert.ok(sources.size >= 3);
});

test('auditd: the dropper runs as root under the victim login uid, with an epoch for the execute time', () => {
  const audit = text('var/log/audit/audit.log');
  const execLine = audit.split('\n').find((l) => l.startsWith('type=EXECVE') && l.includes(`a0="${ATTACKER.dropper}"`));
  assert.ok(execLine);
  assert.match(execLine, new RegExp(`msg=audit\\(${TIMELINE.execute}\\.\\d{3}:\\d+\\)`));
  assert.match(audit, new RegExp(`auid=${ATTACKER.victimUid} uid=0 .*exe="${ATTACKER.dropper}"`));
});

test('firewall: the exfil port carries attacker-bound traffic only, and only after execution', () => {
  const port = lines('var/log/firewalld/fw.log').filter((l) => l.includes(` DPT=${ATTACKER.exfilPort} `));
  assert.ok(port.length > 100);
  assert.ok(port.every((l) => l.includes(`DST=${ATTACKER.ip} `)));
  assert.equal(port[0].slice(0, 15), syslogTime(TIMELINE.exfilStart));
});

test('metrics: bastion-7 spikes in CPU and transmit during the exfil window and not before', () => {
  const rows = lines('metrics/node_metrics.csv').map((l) => l.split(',')).filter((f) => f.length === 6 && f[1] === 'bastion-7' && f[2] !== 'N/A');
  const during = rows.filter((f) => f[0] >= isoTime(TIMELINE.exfilStart) && f[0] <= isoTime(TIMELINE.exfilEnd));
  const before = rows.filter((f) => f[0] < isoTime(TIMELINE.exfilStart));
  assert.ok(during.length > 10);
  assert.ok(during.every((f) => Number(f[2]) > 85 && Number(f[5]) > 30_000_000));
  assert.ok(before.every((f) => Number(f[2]) < 15));
});

test('sar shows the spike in its last rows and uses a 12-hour clock', () => {
  const sar = lines('metrics/sar_cpu.txt');
  assert.match(sar[1], /^12:00:01 AM +CPU +%user/);
  const last = sar.at(-2);
  assert.match(last, /^11:50:01 PM +all/);
  assert.ok(Number(last.trim().split(/\s+/)[3]) > 70);
});

test('the rotation the guest compresses is shipped as plain text, not as gzip bytes', () => {
  const data = arena.entries.find((e) => e.path === 'var/log/httpd/access_log.2').data;
  assert.ok(data.length > 100_000);
  assert.notDeepEqual([...data.subarray(0, 2)], [0x1f, 0x8b]);
});

// The boss answer is assembled here from story.js, never in shipped code. The selftest proves the guest
// pipeline reaches it; this proves the stored hash still matches the story if either one is edited.
test('the boss answer hash is the story: IP, victim, first probe, exfil port', async () => {
  const boss = JSON.parse(fs.readFileSync(new URL('../levels/10-boss.json', import.meta.url), 'utf8'));
  const first = new Date(TIMELINE.firstProbe * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const answer = [ATTACKER.ip, ATTACKER.victim, first, ATTACKER.exfilPort].join('|');
  assert.equal(await hashAnswer('boss-10', answer), boss.challenge.answerHash);
});
