// Boots the committed snapshot in Node, seeds the generated arena exactly as the page does, and checks the
// result inside the guest with the real GNU tools. Slower than the other tests (a few seconds).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { restoreGuest } from '../tools/guest-node.mjs';
import { generateArena } from '../generator.js';
import { seedGuest } from '../seed.js';
import { NOW } from '../story.js';
import { startLiveFeed, LIVE_PATH } from '../live.js';

let guest;
const seed = () => seedGuest(guest.emulator, guest.control, generateArena());


// Run as the learner would: user analyst, in ~/arena, with the learner's environment.
async function run(command, { asAnalyst = false } = {}) {
  const wrapped = asAnalyst ? `su analyst -c ${JSON.stringify(`export LC_ALL=C TZ=UTC; cd ~/arena && ${command}`)}` : command;
  const { status, output } = await guest.control.run(wrapped, { timeoutMs: 60_000 });
  return { status, out: new TextDecoder().decode(output).trim() };
}

before(async () => {
  guest = await restoreGuest();
  await guest.control.run('stty -echo -onlcr', { timeoutMs: 15_000 });
});
after(async () => {
  await guest?.emulator.destroy();
});

test('seeding succeeds and sets the guest clock to the story time', async () => {
  assert.equal(await seed(), 'LOGHUNT-SEED-OK');
  const date = Number((await run('date +%s')).out);
  assert.ok(date >= NOW && date < NOW + 60, `guest clock ${date}`);
});

test('the rotated log is a real gzip file and zcat reads it', async () => {
  const { out } = await run('file -b var/log/httpd/access_log.2.gz; zcat var/log/httpd/access_log.2.gz | wc -l', { asAnalyst: true });
  assert.match(out, /^gzip compressed data/);
  assert.match(out, /\n4696$/);
});

test('misleading names: old_access.txt is gzip, debug.log.gz is text', async () => {
  const { out } = await run('file -b var/log/httpd/old_access.txt opt/app/logs/debug.log.gz', { asAnalyst: true });
  const [a, b] = out.split('\n');
  assert.match(a, /^gzip compressed data/);
  assert.match(b, /^ASCII text/);
});

test('gzip output is byte-identical across reseeds', async () => {
  const first = (await run('cksum var/log/httpd/access_log.2.gz', { asAnalyst: true })).out;
  await seed();
  const second = (await run('cksum var/log/httpd/access_log.2.gz', { asAnalyst: true })).out;
  assert.equal(first, second);
});

test('modification times survive, including the rotated and renamed files', async () => {
  const { out } = await run('TZ=UTC find var/log/httpd -type f -printf "%TY-%Tm-%TdT%TH:%TM %p\\n" | sort -k2', { asAnalyst: true });
  assert.match(out, /2026-03-12T23:59 var\/log\/httpd\/access_log\.2\.gz/);
  assert.match(out, /2026-03-12T23:59 var\/log\/httpd\/old_access\.txt/);
});

test('traps behave as intended in the guest', async () => {
  const { out } = await run([
    'find . -type f -empty | sort | tr "\\n" " "; echo',
    'file -b "opt/app/logs/app old.log"',
    // `file` 5.46 calls this "CSV ASCII text" without mentioning CRLF; cat -A shows the ^M every time.
    'cat -A metrics/hosts.csv | head -1',
    'file -b tmp/.x/kworkerd',
    'find . -path "*/.*" -type f | sort | tr "\\n" " "',
  ].join('; '), { asAnalyst: true });
  const [empty, spaced, crlf, elf, hidden] = out.split('\n');
  assert.equal(empty.trim(), './training/drill/empty.log ./var/log/maillog ./var/log/spooler');
  assert.match(spaced, /text/);
  assert.match(crlf, /\^M\$$/);
  assert.match(elf, /^ELF/);
  assert.equal(hidden.trim(), './opt/app/.cache/session.tmp ./tmp/.x/kworkerd ./training/drill/.hidden/todo.txt');
});

test('the arena belongs to analyst and analyst cannot write outside home', async () => {
  const { out } = await run('find . ! -user analyst | wc -l; touch /etc/x 2>&1 | head -1', { asAnalyst: true });
  const [notOwned, denied] = out.split('\n');
  assert.equal(notOwned, '0');
  assert.match(denied, /Permission denied/);
});

test('the live feed writes as analyst, grows, and a reseed stops it', async () => {
  await startLiveFeed(guest.emulator, guest.control);
  const first = Number((await run(`wc -l < ${LIVE_PATH}`, { asAnalyst: true })).out);
  const owner = (await run(`stat -c %U /home/analyst/arena/${LIVE_PATH}`)).out;
  await run('sleep 4');
  const later = Number((await run(`wc -l < ${LIVE_PATH}`, { asAnalyst: true })).out);
  assert.equal(owner, 'analyst');
  assert.ok(later > first, `feed did not grow: ${first} -> ${later}`);
  assert.equal((await run('pgrep -u analyst -f loghunt-appender | wc -l')).out, '1');
  await seed();
  assert.equal((await run('pgrep -u analyst -f loghunt-appender | wc -l')).out, '0');
});
