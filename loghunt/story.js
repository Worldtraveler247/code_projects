// The single source of truth for the campaign. The generator plants these facts into every log source;
// tests/story.test.mjs checks they are present and consistent. All addresses are RFC 5737 documentation
// ranges, all names are invented, all domains are example.com.

const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

export const SEED = 0xb7_2026;

// "Now" inside the VM: the moment the on-call analyst logs in.
export const NOW = utc(2026, 3, 14, 2, 40, 0);

export const HOST = 'bastion-7';
export const HOST_IP = '198.51.100.10';

export const ATTACKER = {
  ip: '203.0.113.66',
  // The scanner's user agent: what makes the recon burst stand out in access logs.
  userAgent: 'Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:Port Check)',
  // Guessed during the brute force; none exist on the host except the victim.
  guessedUsers: ['admin', 'oracle', 'test', 'ubuntu', 'deploy', 'git', 'postgres', 'jenkins', 'ftpuser', 'guest'],
  victim: 'svc_backup',
  victimUid: 1003,
  dropper: '/tmp/.x/kworkerd',
  exfilPort: 4444,
};

// The campaign, in order. Every source the learner correlates for the boss is listed against a stage.
export const TIMELINE = {
  // One quiet probe two days earlier, only in the compressed rotation: the true first sighting.
  firstProbe: utc(2026, 3, 12, 19, 47, 21),
  reconStart: utc(2026, 3, 13, 22, 14, 3),
  reconEnd: utc(2026, 3, 13, 22, 16, 40),
  bruteStart: utc(2026, 3, 13, 23, 2, 11),
  bruteEnd: utc(2026, 3, 13, 23, 9, 55),
  login: utc(2026, 3, 13, 23, 11, 37),
  sudo: utc(2026, 3, 13, 23, 14, 2),
  execute: utc(2026, 3, 13, 23, 19, 45),
  exfilStart: utc(2026, 3, 13, 23, 20, 10),
  exfilEnd: utc(2026, 3, 14, 1, 42, 30),
};

// Ordinary users and clients, so the attacker has a crowd to hide in.
export const STAFF = [
  { user: 'ops_alice', uid: 1001, ip: '198.51.100.21' },
  { user: 'ops_bob', uid: 1002, ip: '198.51.100.22' },
  { user: 'dev_carol', uid: 1004, ip: '198.51.100.23' },
];

export const WEB_CLIENTS = [
  '192.0.2.14', '192.0.2.27', '192.0.2.33', '192.0.2.48', '192.0.2.51', '192.0.2.77', '192.0.2.90',
  '192.0.2.102', '192.0.2.118', '192.0.2.140', '192.0.2.161', '192.0.2.199', '198.51.100.40', '198.51.100.41',
];

export const METRIC_HOSTS = ['bastion-7', 'web-01', 'web-02', 'db-01'];
