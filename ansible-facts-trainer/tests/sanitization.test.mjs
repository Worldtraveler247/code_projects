import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, HOST } from '../facts.js';
import { SETUP_OUTPUT } from '../setup-output.js';

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); strings(v, out); }
  }
  return out;
}
const ALL = strings(FACTS);

test('top-level keys have the ansible_ prefix stripped, except ansible_local as in real Ansible', () => {
  assert.deepEqual(Object.keys(FACTS).filter((k) => k.startsWith('ansible_')), ['ansible_local']);
  assert.equal(Object.hasOwn(FACTS, 'local'), false);
  assert.equal(FACTS.hostname, HOST);
});

test('every MAC address is in the documentation range', () => {
  const macs = ALL.flatMap((s) => s.match(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi) ?? []);
  assert.ok(macs.length > 0, 'expected at least one MAC in the capture');
  for (const mac of macs) {
    assert.ok(/^00:00:5e:00:53:/i.test(mac) || mac === '00:00:00:00:00:00', `real MAC leaked: ${mac}`);
  }
});

test('no MAC-derived IPv6 interface id survives', () => {
  for (const s of ALL) {
    if (/ff:fe/i.test(s)) assert.match(s, /5eff:fe00:53/i, `EUI-64 address leaked: ${s}`);
  }
});

test('every IPv4 address is private, loopback, a netmask, or documentation range', () => {
  const allowed = (ip) => /^(10\.|127\.|192\.168\.|192\.0\.2\.|255\.)/.test(ip);
  const ips = ALL.flatMap((s) => s.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []);
  for (const ip of ips) assert.ok(allowed(ip), `public IPv4 leaked: ${ip}`);
});

test('host identity fields are placeholders', () => {
  assert.equal(FACTS.machine_id, '0123456789abcdef0123456789abcdef');
  assert.match(FACTS.hostnqn, /00000000-0000-4000-8000-000000000001$/);
  for (const [k, v] of Object.entries(FACTS)) {
    if (/^ssh_host_key_.*_public$/.test(k)) assert.match(v, /PLACEHOLDER/, `${k} is not a placeholder`);
  }
});

test('the account is the generic student user everywhere', () => {
  assert.equal(FACTS.user_id, 'student');
  assert.equal(FACTS.user_dir, '/home/student');
  assert.equal(FACTS.env.USER, 'student');
  assert.equal(FACTS.env.LOGNAME, 'student');
  assert.equal(FACTS.env.HOME, '/home/student');
  for (const s of ALL) {
    for (const m of s.match(/\/home\/[A-Za-z0-9_.-]+/g) ?? []) {
      assert.equal(m, '/home/student', `home directory leaked: ${m}`);
    }
  }
});

test('every UUID and LVM id is a placeholder', () => {
  const uuids = ALL.flatMap((s) => s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []);
  assert.ok(uuids.length > 0, 'expected at least one UUID in the capture');
  for (const uuid of uuids) assert.match(uuid, /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/, `real UUID leaked: ${uuid}`);
  for (const s of ALL) {
    if (/LVM-/.test(s)) assert.match(s, /LVM-PLACEHOLDER/, `real LVM id leaked: ${s}`);
    if (/lvm-pv-uuid-/.test(s)) assert.match(s, /lvm-pv-uuid-PLACEHOLDER/, `real LVM PV id leaked: ${s}`);
  }
});

test('every value stored under a uuid or uuids key is a placeholder', () => {
  const found = [];
  (function visit(node, key) {
    if (typeof node === 'string') { if (key === 'uuid' || key === 'uuids') found.push(node); return; }
    if (Array.isArray(node)) { for (const item of node) visit(item, key); return; }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) visit(v, key === 'uuids' ? 'uuids' : k);
    }
  })(FACTS, '');
  assert.ok(found.length > 0, 'expected uuid fields in the capture');
  for (const value of found) {
    assert.match(value, /^(N\/A|0000-00[0-9A-F]{2}|00000000-0000-4000-8000-0000000000[0-9a-f]{2})$/, `real volume id leaked: ${value}`);
  }
});

test('hardware serials, WWNs, and storage names are blank or placeholders', () => {
  const blank = (v) => v === '' || v === 'NA' || v === 'N/A' || v === null || (Array.isArray(v) && v.length === 0);
  (function visit(node, key, underIds) {
    // Numbers are skipped: python.version.serial is a release counter, not hardware.
    if (/(?:^|_)(?:serial|wwn|wwid|iqn)$|_uuid$/.test(key) && typeof node !== 'number') assert.ok(blank(node), `${key} is not blank: ${JSON.stringify(node)}`);
    if (typeof node === 'string' && underIds) {
      assert.match(node, /^(dm-name-|dm-uuid-LVM-PLACEHOLDER|lvm-pv-uuid-PLACEHOLDER|[a-z0-9]+-PLACEHOLDER)/, `device id leaked: ${node}`);
    }
    if (Array.isArray(node)) { for (const item of node) visit(item, '', underIds); return; }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) visit(v, k, underIds || k === 'ids');
    }
  })(FACTS, '', false);
});

test('no global IPv6 address is published', () => {
  for (const s of ALL) {
    for (const token of s.match(/\b[23][0-9a-f]{3}:[0-9a-f:]+/gi) ?? []) {
      assert.match(token, /^2001:db8:/i, `global IPv6 leaked: ${token}`);
    }
  }
});

test('the published setup output holds exactly the published facts, so every check above covers it', () => {
  const parsed = JSON.parse(SETUP_OUTPUT.slice(SETUP_OUTPUT.indexOf('{')));
  const stripped = Object.fromEntries(Object.entries(parsed.ansible_facts).map(([k, v]) => [k === 'ansible_local' ? k : k.replace(/^ansible_/, ''), v]));
  assert.deepEqual(stripped, FACTS);
  assert.deepEqual(Object.keys(parsed), ['ansible_facts', 'changed']);
  assert.ok(SETUP_OUTPUT.startsWith(`${HOST} | SUCCESS => {`));
});
