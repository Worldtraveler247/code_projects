import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every value below is invented. The sanitizer must cope with identifiers that sit
// inside longer strings, not only ones that fill a whole field.
const SYNTHETIC = {
  ansible_facts: {
    ansible_hostname: 'labhost',
    ansible_user_id: 'jdoe',
    ansible_user_dir: '/home/jdoe',
    ansible_machine_id: 'ffffffffffffffffffffffffffffffff',
    ansible_env: {
      USER: 'jdoe', LOGNAME: 'jdoe', HOME: '/home/jdoe',
      MAIL: '/var/spool/mail/jdoe_archive',
      SSH_CONNECTION: '8.8.8.8 50000 192.168.50.11 22',
    },
    ansible_dns: { nameservers: ['1.1.1.1', '2606:4700:4700::1111'] },
    ansible_loadavg: { '1m': 0.0, '15m': 0.25 },
    module_setup: true,
    ansible_user_gecos: 'Jane Doe',
    ansible_eth0: {
      macaddress: '52:54:00:AB:CD:EF',
      perm_macaddress: '52-54-00-ab-cd-ef',
      note: 'hw 525400abcdef id',
      ipv6: [
        { address: 'fe80::5054:ff:feab:cdef' },
        { address: 'fd00:0000:0000:0000:5054:00ff:feab:cdef' },
        { address: 'FD00::5054:FF:FEAB:CDEF' },
      ],
      scoped: 'fe80::5054:ff:feab:cdef%eth0',
      cidr: 'route fd00::5054:ff:feab:cdef/64 dev eth0 via 2606:4700::1',
    },
    ansible_local: { site: { owner: 'JDoe', path: '/srv/JDOE/data' } },
    ansible_product_serial: 'SN-0042-XYZ',
    ansible_product_uuid: 'not-a-standard-uuid-777',
    ansible_iscsi_iqn: 'iqn.1994-05.com.example:abc123',
    ansible_fibre_channel_wwn: ['21000024ff000001'],
    ansible_devices: { sda: { serial: 'VB1234-abcd', wwn: '0x5000c500a1b2c3d4', model: 'HARDDISK', links: { ids: ['ata-VBOX_HARDDISK_VB1234-abcd', 'wwn-0x5000c500a1b2c3d4'] } } },
    ansible_mounts: [{ mount: '/', uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { mount: '/boot/efi', uuid: 'AB12-CD34' }, { mount: '/proc', uuid: 'N/A' }],
    ansible_device_links: {
      ids: {
        'dm-0': ['dm-name-cs-root', 'dm-uuid-LVM-' + 'Ab3'.repeat(21) + 'X'],
        sda3: ['lvm-pv-uuid-AbCdEf-1234-5678-9abc-defg-hijk-LmNoPq'],
      },
      uuids: { 'dm-0': ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'], sda2: ['11111111-2222-4333-8444-555555555555'] },
    },
  },
};

async function sanitize() {
  const dir = mkdtempSync(join(tmpdir(), 'aft-sanitizer-'));
  const raw = join(dir, 'raw.json');
  const out = join(dir, 'facts.mjs');
  // JSON.stringify writes 0.0 as 0; a real capture has 0.0, so put the decimal point back.
  const body = JSON.stringify(SYNTHETIC).replace('"1m":0,', '"1m":0.0,');
  writeFileSync(raw, `labhost | SUCCESS => ${body}\n$ `);
  execFileSync('python3', [new URL('../tools/sanitize_facts.py', import.meta.url).pathname, raw, out, '--user', 'jdoe']);
  const setup = (await import(pathToFileURL(join(dir, 'setup-output.js')).href)).SETUP_OUTPUT;
  return { FACTS: (await import(pathToFileURL(out).href)).FACTS, SETUP: setup };
}

const { FACTS, SETUP } = await sanitize();
const TEXT = JSON.stringify(FACTS);

test('sanitizer: the username is removed even inside a longer word', () => {
  assert.equal(TEXT.includes('jdoe'), false);
  assert.equal(FACTS.env.MAIL, '/var/spool/mail/student_archive');
});

test('sanitizer: a public IPv4 address inside a longer string is replaced', () => {
  assert.equal(TEXT.includes('8.8.8.8'), false);
  assert.equal(FACTS.env.SSH_CONNECTION, '192.0.2.53 50000 192.168.50.11 22');
  assert.equal(FACTS.dns.nameservers[0], '192.0.2.53');
});

test('sanitizer: a public IPv6 address is replaced with a documentation address', () => {
  assert.match(FACTS.dns.nameservers[1], /^2001:db8:/);
});

test('sanitizer: filesystem UUIDs become placeholders, consistently across fields', () => {
  assert.equal(TEXT.includes('aaaaaaaa-bbbb'), false);
  assert.equal(TEXT.includes('11111111-2222'), false);
  assert.match(FACTS.mounts[0].uuid, /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/);
  assert.equal(FACTS.mounts[0].uuid, FACTS.device_links.uuids['dm-0'][0]);
  assert.notEqual(FACTS.device_links.uuids['dm-0'][0], FACTS.device_links.uuids.sda2[0]);
});

test('sanitizer: LVM volume and physical-volume ids become placeholders', () => {
  assert.equal(TEXT.includes('Ab3Ab3'), false);
  assert.equal(TEXT.includes('AbCdEf'), false);
  assert.match(FACTS.device_links.ids['dm-0'][1], /^dm-uuid-LVM-PLACEHOLDER/);
  assert.match(FACTS.device_links.ids.sda3[0], /^lvm-pv-uuid-PLACEHOLDER/);
  assert.equal(FACTS.device_links.ids['dm-0'][0], 'dm-name-cs-root');
});

test('sanitizer: a short FAT volume id under a uuid key becomes a placeholder', () => {
  assert.equal(TEXT.includes('AB12-CD34'), false);
  assert.match(FACTS.mounts[1].uuid, /^0000-00[0-9A-F]{2}$/);
  assert.equal(FACTS.mounts[2].uuid, 'N/A');
});

test('sanitizer: a MAC is replaced in colon, hyphen, bare-hex, and upper-case forms', () => {
  assert.equal(/52[:-]?54[:-]?00[:-]?ab[:-]?cd[:-]?ef/i.test(TEXT), false);
  assert.equal(FACTS.eth0.macaddress, '00:00:5e:00:53:01');
  assert.equal(FACTS.eth0.perm_macaddress, '00-00-5e-00-53-01');
  assert.equal(FACTS.eth0.note, 'hw 00005e005301 id');
});

test('sanitizer: a MAC-derived IPv6 address is rewritten however it is spelled', () => {
  assert.equal(/feab:cdef/i.test(TEXT), false);
  assert.equal(FACTS.eth0.ipv6[0].address, 'fe80::200:5eff:fe00:5301');
  assert.equal(FACTS.eth0.ipv6[1].address, 'fd00::200:5eff:fe00:5301');
  assert.equal(FACTS.eth0.ipv6[2].address, 'fd00::200:5eff:fe00:5301');
});

test('sanitizer: the username is removed in any letter case, and the full name is dropped', () => {
  assert.equal(/jdoe/i.test(TEXT), false);
  assert.equal(FACTS.ansible_local.site.owner, 'student');
  assert.equal(FACTS.user_gecos, '');
});

test('final review 1: ansible_local keeps its prefix; every other top-level key loses it', () => {
  assert.equal(Object.hasOwn(FACTS, 'ansible_local'), true);
  assert.equal(Object.hasOwn(FACTS, 'local'), false);
  assert.equal(FACTS.hostname, 'labhost');
});

test('security review: an IPv6 address inside a longer string is rewritten or replaced', () => {
  assert.equal(FACTS.eth0.scoped, 'fe80::200:5eff:fe00:5301%eth0');
  assert.equal(FACTS.eth0.cidr, 'route fd00::200:5eff:fe00:5301/64 dev eth0 via 2001:db8::53');
});

test('security review: hardware serials, WWNs, and storage names are blanked', () => {
  assert.equal(FACTS.product_serial, 'NA');
  assert.equal(FACTS.product_uuid, 'NA');
  assert.equal(FACTS.iscsi_iqn, 'NA');
  assert.deepEqual(FACTS.fibre_channel_wwn, []);
  assert.equal(FACTS.devices.sda.serial, 'NA');
  assert.equal(FACTS.devices.sda.wwn, 'NA');
  assert.equal(FACTS.devices.sda.model, 'HARDDISK');
  assert.deepEqual(FACTS.devices.sda.links.ids, ['ata-PLACEHOLDER', 'wwn-PLACEHOLDER']);
  assert.equal(/VB1234|5000c500|0042-XYZ|abc123|21000024/.test(TEXT), false);
});

test('setup output: the sanitizer also writes the text that `ansible HOST -m setup` prints', () => {
  const lines = SETUP.split('\n');
  assert.equal(lines[0], 'labhost | SUCCESS => {');
  assert.equal(lines[1], '    "ansible_facts": {');
  assert.deepEqual(lines.slice(-3), ['    },', '    "changed": false', '}']);
  assert.match(SETUP, /^ {8}"ansible_hostname": "labhost",$/m);
});

test('setup output: keys keep the ansible_ prefix, sorted, with Python number formatting', () => {
  const keys = [...SETUP.matchAll(/^ {8}"([^"]+)":/gm)].map((m) => m[1]);
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(keys.includes('ansible_local') && keys.includes('ansible_hostname') && keys.includes('module_setup'));
  assert.match(SETUP, /"1m": 0\.0,?$/m, 'a float keeps its decimal point, as Python prints it');
});

test('setup output: it is the same sanitized data as facts.js, so no real value can hide in it', () => {
  const parsed = JSON.parse(SETUP.slice(SETUP.indexOf('{'))).ansible_facts;
  const stripped = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k === 'ansible_local' ? k : k.replace(/^ansible_/, ''), v]));
  assert.deepEqual(stripped, FACTS);
  assert.equal(/jdoe|8\.8\.8\.8|aaaaaaaa-bbbb|VB1234/i.test(SETUP), false);
});
