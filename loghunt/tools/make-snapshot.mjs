#!/usr/bin/env node
// Boot the guest from build/ once, check it, and save the booted machine as image/state.bin.zst.
// Then publish image/fs.json + image/flat/ (the build minus /boot, which a restored snapshot never reads).
// Usage: node tools/make-snapshot.mjs        (after tools/build-image.sh)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { V86 } from '../vendor/v86/libv86.mjs';
import { SerialChannel } from '../serial-channel.js';
import { guestOptions } from '../guest-options.js';
import { writeStateMeta } from './state-meta.mjs';
import { seedGuest } from '../seed.js';
import { generateArena } from '../generator.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const image = path.join(root, 'image');

const started = Date.now();
const emulator = new V86({
  ...guestOptions,
  wasm_path: path.join(root, 'vendor/v86/v86.wasm'),
  bios: { url: path.join(root, 'vendor/v86/seabios.bin') },
  vga_bios: { url: path.join(root, 'vendor/v86/vgabios.bin') },
  bzimage_initrd_from_filesystem: true,
  cmdline: 'rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci tsc=reliable init_on_free=on',
  filesystem: { baseurl: path.join(build, 'flat'), basefs: path.join(build, 'fs.json') },
  autostart: true,
});

const control = new SerialChannel(emulator, 1);
const learner = new SerialChannel(emulator, 0);

console.log('booting…');
const dumpOnFail = (channel, name) => (err) => {
  console.error(`--- ${name} received:\n${JSON.stringify(channel.snapshotText().slice(-800))}`);
  throw err;
};
await control.waitFor((t) => t.endsWith('# '), 600_000).catch(dumpOnFail(control, 'ttyS1'));
await learner.waitFor((t) => t.includes('analyst@bastion-7'), 120_000).catch(dumpOnFail(learner, 'ttyS0'));
console.log(`booted in ${((Date.now() - started) / 1000).toFixed(1)} s (emulated, Node)`);

control.send('stty -echo -onlcr\n');
await control.waitFor((t) => t.endsWith('# '), 10_000);

const checks = {
  kernel: 'uname -r',
  awk: 'awk --version | head -1',
  sort: 'sort --version | head -1',
  grep: 'grep --version | head -1',
  sed: 'sed --version | head -1',
  find: 'find --version | head -1',
  column: 'column --version',
  file: 'file --version | head -1',
  locale: 'su - analyst -c "locale 2>/dev/null | head -1; echo \\$LC_ALL \\$TZ"',
  interfaces: 'ls /sys/class/net',
  arenafs: "awk '$2 == \"/home/analyst/arena\" {print $3}' /proc/mounts",
  proclimit: 'awk \'/Max processes/ {print $3}\' /proc/$(pgrep -u analyst -x bash | head -1)/limits',
  escalation: 'su analyst -c "su -c id </dev/null" 2>&1; echo "exit $?"',
  network: 'wget -q -T 3 -O /dev/null http://192.0.2.1/ && echo REACHABLE || echo "unreachable (exit $?)"',
};
const report = {};
for (const [name, command] of Object.entries(checks)) {
  const { output } = await control.run(command, { timeoutMs: 30_000 });
  report[name] = new TextDecoder().decode(output).trim();
  console.log(`${name.padEnd(10)} ${report[name].replace(/\n/g, ' | ')}`);
}
if (!report.awk.startsWith('GNU Awk')) throw new Error('awk is not GNU Awk');
if (report.interfaces.split(/\s+/).some((i) => i !== 'lo')) throw new Error(`unexpected interfaces: ${report.interfaces}`);
if (report.arenafs !== 'tmpfs') throw new Error(`~/arena is on "${report.arenafs}", expected tmpfs`);
if (report.proclimit !== '128') throw new Error(`analyst process limit is ${report.proclimit}, expected 128`);
if (report.escalation.includes('uid=0')) throw new Error('analyst can become root');
if (report.network.includes('REACHABLE')) throw new Error('guest reached the network');

// The kernel and initramfs are in RAM now; deleting them keeps 12 MB of boot files out of the published image.
// podman export leaves the container's own /etc/hostname behind, so set the name here, before saving.
await control.run('echo bastion-7 > /etc/hostname; hostname bastion-7');
await control.run('rm -f /boot/vmlinuz-* /boot/initramfs-*; sync');

// Warm the guest's page cache, then save it inside the snapshot. In a browser, every file v86 has not
// fetched yet costs an HTTP request plus 9p round trips; a cold first seed took ~9 s for ~126 files.
// Run the real seed and every learner tool once, so their binaries and libraries are already in RAM.
await seedGuest(emulator, control, generateArena());
const warm = [
  'find . -type f -name "*.log" -size +1k -mtime -1 -print0 | xargs -0 wc -l', 'grep -c sshd var/log/secure',
  'zgrep -c GET var/log/httpd/access_log.2.gz', 'zcat var/log/httpd/access_log.2.gz | head -1',
  'cut -d, -f2 metrics/node_metrics.csv | tr -d "\r" | sort | uniq -c | sort -nr | head -3',
  'awk -F, \'NR>1 {s[$2]+=$3} END {for (h in s) printf "%s %.1f\\n", h, s[h]}\' metrics/node_metrics.csv',
  'sed -n "s/.*DPT=\\([0-9]*\\).*/\\1/p" var/log/firewalld/fw.log | sort -u | tail -1',
  'comm -12 training/team_a.txt training/team_b.txt', 'join training/uids.txt training/shells.txt',
  'paste -d: training/team_a.txt training/team_b.txt', 'column -t training/uids.txt', 'date -d @1773443985',
  'stat -c %s training/web.log', 'cat training/web.log | tail -2', 'less --version', 'file -b training/web.log',
];
for (const cmd of warm) await control.run(`su analyst -c ${JSON.stringify(`cd ~/arena && ${cmd}`)} > /dev/null 2>&1; true`, { timeoutMs: 60_000 });
await control.run('find /home/analyst/arena -mindepth 1 -delete; : > /home/analyst/.bash_history; chown analyst:analyst /home/analyst/.bash_history');
learner.send('clear\n');
await new Promise((r) => setTimeout(r, 2000));
// The snapshot's own `clear` would otherwise be the first entry in every learner's history panel.
await control.run(': > /home/analyst/.bash_history; chown analyst:analyst /home/analyst/.bash_history');
const cached = new TextDecoder().decode((await control.run("awk '/^Cached:/ {print $2}' /proc/meminfo")).output).trim();
// Truncating as root would leave the file root-owned, and bash (as analyst) could no longer append to it.
const histOwner = new TextDecoder().decode((await control.run('stat -c %U /home/analyst/.bash_history')).output).trim();
if (histOwner !== 'analyst') throw new Error(`~/.bash_history is owned by ${histOwner}; the history panel would stay empty`);
console.log(`page cache in snapshot: ${(Number(cached) / 1024).toFixed(1)} MB`);

const state = new Uint8Array(await emulator.save_state());
await emulator.destroy();
fs.mkdirSync(image, { recursive: true });
const raw = path.join(build, 'state.bin');
fs.writeFileSync(raw, state);
execFileSync('zstd', ['-19', '-f', '-q', raw, '-o', path.join(image, 'state.bin.zst')]);
writeStateMeta(path.join(image, 'state.bin.zst'), path.join(image, 'state-meta.js'));

// Publish the filesystem minus files only /boot referenced.
const fsJson = JSON.parse(fs.readFileSync(path.join(build, 'fs.json'), 'utf8'));
const bootOnly = new Set();
const used = new Map();
(function walk(entries, prefix) {
  for (const e of entries) {
    const full = `${prefix}/${e[0]}`;
    if (Array.isArray(e[6])) walk(e[6], full);
    else if ((e[3] & 0xf000) === 0x8000 && typeof e[6] === 'string') {
      used.set(e[6], (used.get(e[6]) ?? 0) + (full.startsWith('/boot/') ? 0 : 1));
      if (full.startsWith('/boot/')) bootOnly.add(e[6]);
    }
  }
})(fsJson.fsroot, '');
fs.rmSync(path.join(image, 'flat'), { recursive: true, force: true });
fs.mkdirSync(path.join(image, 'flat'));
for (const name of fs.readdirSync(path.join(build, 'flat'))) {
  if (bootOnly.has(name) && used.get(name) === 0) continue;
  fs.copyFileSync(path.join(build, 'flat', name), path.join(image, 'flat', name));
}
fs.copyFileSync(path.join(build, 'fs.json'), path.join(image, 'fs.json'));
fs.writeFileSync(path.join(build, 'guest-report.json'), JSON.stringify(report, null, 2));

const size = (p) => (fs.statSync(p).size / 1e6).toFixed(1);
console.log(`state.bin.zst ${size(path.join(image, 'state.bin.zst'))} MB (raw ${(state.length / 1e6).toFixed(1)} MB)`);
console.log(`flat/ ${fs.readdirSync(path.join(image, 'flat')).length} files`);
