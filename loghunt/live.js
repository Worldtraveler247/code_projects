// Side-quest setups: background writers inside the guest. A level names one by key ("setup": "live-feed");
// the shell that runs is fixed here, never taken from level JSON. Shared by the page and the selftest.
//
// The writer runs as analyst and is named loghunt-appender, so tools/image/loghunt-seed stops it on every
// reset. Its lines are generated from the seed, so the answer is the same however long the learner waits.

import { SEED, NOW, HOST, ATTACKER, STAFF } from './story.js';
import { rng, syslogTime } from './gen-util.js';

const encoder = new TextEncoder();
export const LIVE_PATH = 'live/secure';
// Lines written at once, then one every few seconds; the attacker's first new attempt comes after the burst.
export const BURST = 6;
const PAUSE_SECONDS = 3;

export function liveFeedLines(seed = SEED) {
  const r = rng((seed ^ 0x11fe) >>> 0);
  const lines = [];
  let t = NOW + 5;
  const add = (proc, msg) => { lines.push(`${syslogTime(t)} ${HOST} ${proc}: ${msg}`); t += r.int(2, 9); };
  const pid = () => r.int(30000, 32000);
  const noise = (count) => {
    for (let i = 0; i < count; i++) {
      const s = r.pick(STAFF);
      const kind = r.weighted([['key', 3], ['close', 2], ['sudo', 2]]);
      if (kind === 'key') add(`sshd[${pid()}]`, `Accepted publickey for ${s.user} from ${s.ip} port ${r.int(49152, 65000)} ssh2: ED25519 SHA256:${s.user.slice(4, 7)}Fq0example`);
      else if (kind === 'close') add(`sshd[${pid()}]`, `pam_unix(sshd:session): session closed for user ${s.user}`);
      else add(`sudo[${pid()}]`, `${s.user} : TTY=pts/${r.int(0, 3)} ; PWD=/home/${s.user} ; USER=root ; COMMAND=/usr/bin/tail -n 50 /var/log/secure`);
    }
  };
  noise(14);
  // The attacker comes back for the account that worked last time. The password has been rotated.
  const port = r.int(50000, 60000);
  const p = pid();
  add(`sshd[${p}]`, `Failed password for ${ATTACKER.victim} from ${ATTACKER.ip} port ${port} ssh2`);
  add(`sshd[${p}]`, `Failed password for ${ATTACKER.victim} from ${ATTACKER.ip} port ${port} ssh2`);
  add(`sshd[${p}]`, `Connection closed by authenticating user ${ATTACKER.victim} ${ATTACKER.ip} port ${port} [preauth]`);
  noise(4);
  return lines;
}

const RUNNER = `#!/bin/bash
# loghunt-appender: write the live feed into ~/arena, a few lines at once, then one every few seconds.
out=/home/analyst/arena/${LIVE_PATH}
mkdir -p "\${out%/*}"
: > "$out"
n=0
while IFS= read -r line; do
    printf '%s\\n' "$line" >> "$out"
    n=$((n + 1))
    [ "$n" -ge ${BURST} ] && sleep ${PAUSE_SECONDS}
done < /var/lib/loghunt/live-feed.txt
`;

// Start (or restart) the writer. Waits until the file exists, so a learner's `tail -f` never races it.
export async function startLiveFeed(emulator, control, seed = SEED) {
  await emulator.create_file('/var/lib/loghunt/live-feed.txt', encoder.encode(`${liveFeedLines(seed).join('\n')}\n`));
  await emulator.create_file('/var/lib/loghunt/loghunt-appender', encoder.encode(RUNNER));
  const cmd = [
    'pkill -u analyst -f loghunt-appender 2>/dev/null',
    "su -s /bin/bash analyst -c 'setsid bash /var/lib/loghunt/loghunt-appender </dev/null >/dev/null 2>&1 &'",
    `for i in $(seq 50); do [ -e /home/analyst/arena/${LIVE_PATH} ] && break; sleep 0.1; done`,
    `[ -e /home/analyst/arena/${LIVE_PATH} ]`,
  ].join('; ');
  const { status } = await control.run(cmd, { timeoutMs: 20_000 });
  if (status !== 0) throw new Error('the live feed did not start');
}

export const SETUPS = { 'live-feed': startLiveFeed };
