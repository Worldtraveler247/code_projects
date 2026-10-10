# Ansible Facts Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static, browser-only trainer to the App Hub that drills Ansible `debug` task syntax against a real, sanitized `ansible_facts` capture.

**Architecture:** A vendored YAML parser turns the answer into data; a pure `validator.js` checks the task shape, resolves each `{{ ... }}` lookup against the facts with a hand-written tokenizer, and returns a named verdict. `app.js` is screen logic only. All scripts are ES modules so the validator runs unchanged in the browser and under Node's test runner.

**Tech Stack:** HTML, CSS, vanilla JavaScript (ES modules), `js-yaml` 4.3.2 (vendored), Node 26 built-in test runner (`node --test`), Python 3.12 for the one-off sanitizer.

**Spec:** `docs/superpowers/specs/2026-10-11-ansible-facts-trainer-design.md`

## Global Constraints

- Work on branch `feat/ansible-facts-trainer`, cut from an up-to-date `main` (`git fetch && git rebase origin/main` first). **Never push** without Eddie's explicit approval.
- App directory: `ansible-facts-trainer/` at the hub root.
- Content-Security-Policy for `index.html`, verbatim: `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self';`
- No `eval()`, no `Function()`, no inline scripts. All dynamic output via `textContent`; never give `innerHTML` user input or fact values.
- The app makes no network requests of its own. Do **not** run `tools/inject_analytics.py` against this app (the beacon is blocked by the policy above and would cause a console violation).
- `js-yaml` is vendored at exactly version 4.3.2; SHA-256 of `dist/js-yaml.mjs` is `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`.
- The raw capture lives at `~/servera_setup_raw.json`, outside the repository. It never enters the repository, and no real identifier from it (username, MAC, machine id, key material, public IP) may appear in any committed file, including tests.
- Input size cap: 10240 bytes.
- Conventional commits. End every commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- All commands below run from the hub root, `~/mac-ansible/code_projects`.
- Run the whole suite with a quoted glob: `node --test 'ansible-facts-trainer/tests/*.test.mjs'`. Node 26 does not accept a bare directory.
- The code in this plan was dry-run outside the repository on 2026-10-11: all 44 tests passed against the real capture.

## Review Focus

1. **Curly quotes** (answer typed on a phone or pasted from a word processor: `ansible_facts[‘hostname’]`) → a `BAD_EXPRESSION` that says "curly quotes", not a generic parse error. Test in Task 3.
2. **Tabs for indentation** → `YAML_SYNTAX` with a "YAML forbids tabs" hint. Test in Task 4.
3. **A whole play pasted instead of one task** (`- hosts: all` / `tasks:`) → `PLAY_NOT_TASK` telling the user to submit only the task. Test in Task 4.
4. **Prototype keys** (`ansible_facts['constructor']`, `ansible_facts.__proto__`) → `UNDEFINED_FACT`, never a function value or a crash. Test in Task 3.
5. **Corrupted saved progress** (`localStorage` holds non-JSON or the wrong shape) → the app loads with zero progress and no error. Manual step in Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `ansible-facts-trainer/tools/sanitize_facts.py` | One-off: raw `setup` capture → sanitized `facts.js` |
| `ansible-facts-trainer/facts.js` | Generated. Exports `HOST` and `FACTS` |
| `ansible-facts-trainer/vendor/js-yaml.mjs` | Vendored parser |
| `ansible-facts-trainer/vendor/README.md` | Provenance and checksum |
| `ansible-facts-trainer/validator.js` | Pure: `resolveExpression`, `renderTemplate`, `checkExpression`, `checkTask` |
| `ansible-facts-trainer/challenges.js` | Exports `CHALLENGES` (15 records) |
| `ansible-facts-trainer/app.js` | Screen logic |
| `ansible-facts-trainer/index.html` | Markup and styles |
| `ansible-facts-trainer/how-it-works.html` | Build explainer |
| `ansible-facts-trainer/tests/sanitization.test.mjs` | Allowlist gate on `facts.js` |
| `ansible-facts-trainer/tests/validator.test.mjs` | Resolver and task-check tests |
| `ansible-facts-trainer/tests/challenges.test.mjs` | Every model answer and notation variant passes |
| `index.html` (hub) | 16th card; project count 15 → 16 |

---

### Task 1: Branch, sanitizer, and `facts.js`

**Files:**
- Create: `ansible-facts-trainer/tools/sanitize_facts.py`
- Create: `ansible-facts-trainer/tests/sanitization.test.mjs`
- Create (generated): `ansible-facts-trainer/facts.js`

**Interfaces:**
- Consumes: `~/servera_setup_raw.json` (either pure JSON or raw `ansible -m setup` stdout).
- Produces: `facts.js` exporting `HOST: string` (`"servera"`) and `FACTS: object`. Top-level keys have the `ansible_` prefix stripped (`FACTS.hostname`, `FACTS.default_ipv4.address`). After sanitization: `FACTS.user_id === "student"`, `FACTS.local.video.info.owner === "student"`.

- [ ] **Step 1: Create the branch**

```bash
git fetch && git rebase origin/main
git switch -c feat/ansible-facts-trainer
mkdir -p ansible-facts-trainer/tools ansible-facts-trainer/tests ansible-facts-trainer/vendor
```

- [ ] **Step 2: Write the failing sanitization test**

The test is an allowlist: it describes what sanitized data must look like. It contains no real identifier, so it is safe in a public repository.

`ansible-facts-trainer/tests/sanitization.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, HOST } from '../facts.js';

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); strings(v, out); }
  }
  return out;
}
const ALL = strings(FACTS);

test('top-level keys have the ansible_ prefix stripped', () => {
  assert.deepEqual(Object.keys(FACTS).filter((k) => k.startsWith('ansible_')), []);
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
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --test ansible-facts-trainer/tests/sanitization.test.mjs`
Expected: FAIL with `Cannot find module` for `facts.js`.

- [ ] **Step 4: Write the sanitizer**

`ansible-facts-trainer/tools/sanitize_facts.py`:

```python
#!/usr/bin/env python3
"""Sanitize an `ansible -m setup` capture and emit facts.js for the trainer.

Usage:
    python3 sanitize_facts.py RAW_CAPTURE OUT_JS --user REAL_USERNAME

RAW_CAPTURE may be pure JSON or raw ansible stdout ("host | SUCCESS => {...}").
The real username is passed at run time so it is never stored in this file.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any

MAC_RE = re.compile(r"\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b", re.IGNORECASE)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PLACEHOLDER_MACHINE_ID = "0123456789abcdef0123456789abcdef"
PLACEHOLDER_UUID = "00000000-0000-4000-8000-000000000001"
PLACEHOLDER_DNS = "192.0.2.53"
PLACEHOLDER_LINK_LOCAL = "fe80::200:5eff:fe00:53ff"
PLACEHOLDER_USER = "student"
ZERO_MAC = "00:00:00:00:00:00"


def load_capture(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    start = text.find("{")
    if start == -1:
        raise ValueError(f"{path}: no JSON object found")
    document, _ = json.JSONDecoder().raw_decode(text[start:])
    facts = document.get("ansible_facts", document)
    if not isinstance(facts, dict) or not facts:
        raise ValueError(f"{path}: no ansible_facts dictionary found")
    return facts


def eui64_tail(mac: str) -> str:
    """Return the IPv6 interface id derived from a MAC, as it prints in an address."""
    b = [int(part, 16) for part in mac.split(":")]
    b[0] ^= 0x02
    groups = (b[0] << 8 | b[1], b[2] << 8 | 0xFF, 0xFE00 | b[3], b[4] << 8 | b[5])
    return ":".join(f"{g:x}" for g in groups)


def replace_identifiers(facts: dict[str, Any], user: str) -> tuple[dict[str, Any], set[str]]:
    """Swap MACs, their EUI-64 tails, and the username across the whole document."""
    text = json.dumps(facts)
    real_macs = sorted({m.lower() for m in MAC_RE.findall(text)} - {ZERO_MAC})
    new_tails: set[str] = set()
    for index, mac in enumerate(real_macs, start=1):
        new_mac = f"00:00:5e:00:53:{index:02x}"
        new_tails.add(eui64_tail(new_mac))
        text = re.sub(re.escape(eui64_tail(mac)), eui64_tail(new_mac), text, flags=re.IGNORECASE)
        text = re.sub(re.escape(mac), new_mac, text, flags=re.IGNORECASE)
    text = re.sub(rf"\b{re.escape(user)}\b", PLACEHOLDER_USER, text)
    return json.loads(text), new_tails


def scrub_leaf(value: str, new_tails: set[str]) -> str:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return value
    if ip.version == 4 and ip.is_global:
        return PLACEHOLDER_DNS
    if ip.version == 6 and ip.is_link_local and not any(value.endswith(t) for t in new_tails):
        # fe80::1, fe80::2 and similar router addresses are not host identifiers.
        return value if len(value) <= len("fe80::ffff") else PLACEHOLDER_LINK_LOCAL
    return value


def scrub_tree(node: Any, new_tails: set[str]) -> Any:
    if isinstance(node, dict):
        return {key: scrub_tree(child, new_tails) for key, child in node.items()}
    if isinstance(node, list):
        return [scrub_tree(child, new_tails) for child in node]
    if isinstance(node, str):
        return scrub_leaf(node, new_tails)
    return node


def scrub_fields(facts: dict[str, Any]) -> None:
    if "ansible_machine_id" in facts:
        facts["ansible_machine_id"] = PLACEHOLDER_MACHINE_ID
    if isinstance(facts.get("ansible_hostnqn"), str):
        facts["ansible_hostnqn"] = UUID_RE.sub(PLACEHOLDER_UUID, facts["ansible_hostnqn"])
    for key in facts:
        if re.fullmatch(r"ansible_ssh_host_key_(\w+)_public", key):
            kind = key.removeprefix("ansible_ssh_host_key_").removesuffix("_public").upper()
            facts[key] = f"AAAA{kind}PLACEHOLDERKEYNOTREAL"


def strip_prefix(facts: dict[str, Any]) -> dict[str, Any]:
    return {key.removeprefix("ansible_"): value for key, value in facts.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("raw", type=Path, help="raw setup capture (outside the repository)")
    parser.add_argument("out", type=Path, help="path of facts.js to write")
    parser.add_argument("--user", required=True, help="real remote username to replace")
    args = parser.parse_args()

    try:
        facts = load_capture(args.raw)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    facts, new_tails = replace_identifiers(facts, args.user)
    facts = scrub_tree(facts, new_tails)
    scrub_fields(facts)
    clean = strip_prefix(facts)

    host = clean.get("hostname")
    if not isinstance(host, str) or not host:
        print("error: capture has no hostname fact", file=sys.stderr)
        return 1

    body = json.dumps(clean, indent=2, sort_keys=True)
    args.out.write_text(
        "// Generated by tools/sanitize_facts.py from a real `ansible -m setup` capture.\n"
        "// Do not edit by hand; re-run the sanitizer.\n"
        f"export const HOST = {json.dumps(host)};\n"
        f"export const FACTS = {body};\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out} ({len(clean)} top-level facts, host {host})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Generate `facts.js`**

The username is read from the capture itself, so it never appears in the command history or the plan.

```bash
REAL_USER=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/servera_setup_raw.json')))['ansible_facts']['ansible_user_id'])")
python3 ansible-facts-trainer/tools/sanitize_facts.py ~/servera_setup_raw.json ansible-facts-trainer/facts.js --user "$REAL_USER"
```

Expected: `wrote ansible-facts-trainer/facts.js (106 top-level facts, host servera)`

- [ ] **Step 6: Run the test to confirm it passes**

Run: `node --test ansible-facts-trainer/tests/sanitization.test.mjs`
Expected: 6 tests pass, 0 fail.

If a test fails, fix the sanitizer and regenerate. Never hand-edit `facts.js`, and never weaken the test.

- [ ] **Step 7: Independent leak check, then commit**

```bash
grep -c "$REAL_USER" ansible-facts-trainer/facts.js ansible-facts-trainer/tools/sanitize_facts.py ansible-facts-trainer/tests/sanitization.test.mjs
```

Expected: every file reports `0`.

```bash
git add ansible-facts-trainer/tools/sanitize_facts.py ansible-facts-trainer/tests/sanitization.test.mjs ansible-facts-trainer/facts.js
git commit -m "feat(ansible-facts-trainer): add sanitized facts capture and leak gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Vendor `js-yaml`

**Files:**
- Create: `ansible-facts-trainer/vendor/js-yaml.mjs`
- Create: `ansible-facts-trainer/vendor/README.md`

**Interfaces:**
- Produces: `import { load } from './vendor/js-yaml.mjs'`. `load(text)` returns the parsed document or throws a `YAMLException` with `.reason` (string) and `.mark` (`{ line, column }`, both zero-based).

- [ ] **Step 1: Download, verify, and copy**

```bash
TMP=$(mktemp -d)
(cd "$TMP" && npm pack js-yaml@4.3.2 --silent && tar -xzf js-yaml-4.3.2.tgz package/dist/js-yaml.mjs package/LICENSE)
shasum -a 256 "$TMP/package/dist/js-yaml.mjs"
```

Expected: `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`

If the checksum differs, stop and report it. Do not vendor a file that does not match.

```bash
cp "$TMP/package/dist/js-yaml.mjs" ansible-facts-trainer/vendor/js-yaml.mjs
cp "$TMP/package/LICENSE" ansible-facts-trainer/vendor/LICENSE-js-yaml
sed -i '' '/^\/\/# sourceMappingURL=/d' ansible-facts-trainer/vendor/js-yaml.mjs
```

The last line removes the source-map pointer, which would otherwise make the browser request a file that is not there.

- [ ] **Step 2: Write the provenance note**

`ansible-facts-trainer/vendor/README.md`:

```markdown
# Vendored dependencies

## js-yaml 4.3.2

- **File:** `js-yaml.mjs` (the package's `dist/js-yaml.mjs`, ES module build)
- **Source:** https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz
- **Licence:** MIT (see `LICENSE-js-yaml`)
- **SHA-256 of the upstream file:** `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`
- **Local change:** the trailing `//# sourceMappingURL=` comment is removed. Nothing else.

Why vendored: the hub's Content-Security-Policy is `script-src 'self'`, so nothing
may load from a content delivery network.

To upgrade: `npm pack js-yaml@<version>`, extract `package/dist/js-yaml.mjs`, record
the new checksum here, remove the source-map comment, and run
`node --test 'ansible-facts-trainer/tests/*.test.mjs'`.
```

- [ ] **Step 3: Smoke-check the import**

```bash
node -e "import('./ansible-facts-trainer/vendor/js-yaml.mjs').then(m => console.log(JSON.stringify(m.load('- name: x\n  debug:\n    msg: hi'))))"
```

Expected: `[{"name":"x","debug":{"msg":"hi"}}]`

- [ ] **Step 4: Commit**

```bash
git add ansible-facts-trainer/vendor
git commit -m "chore(ansible-facts-trainer): vendor js-yaml 4.3.2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The resolver

**Files:**
- Create: `ansible-facts-trainer/validator.js`
- Create: `ansible-facts-trainer/tests/validator.test.mjs`

**Interfaces:**
- Produces:
  - `resolveExpression(source: string, facts: object)` → `{ ok: true, value: any, path: (string|number)[] }` or `{ ok: false, code: string, message: string }`. Codes: `BAD_EXPRESSION`, `UNSUPPORTED_FILTER`, `UNDEFINED_FACT`.
  - `renderTemplate(template: string, facts: object)` → `{ ok: true, value: any, paths: (string|number)[][] }` or a failure of the same shape. `value` is the native fact value when the template is exactly one `{{ ... }}`; otherwise the rendered string.
  - `pathToExpr(path)` → `string`, for example `ansible_facts['default_ipv4']['address']`.

- [ ] **Step 1: Write the failing tests**

`ansible-facts-trainer/tests/validator.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpression, renderTemplate, pathToExpr } from '../validator.js';

export const FACTS = {
  hostname: 'servera',
  os_family: 'RedHat',
  memtotal_mb: 567,
  fips: false,
  default_ipv4: { address: '10.0.2.15', interface: 'enp0s8' },
  mounts: [{ mount: '/', device: '/dev/mapper/cs-root' }, { mount: '/boot', device: '/dev/sda2' }],
  selinux: { mode: 'enforcing' },
};

test('resolver: every correct notation reaches the same value', () => {
  for (const src of [
    "ansible_facts['hostname']",
    'ansible_facts["hostname"]',
    'ansible_facts.hostname',
    'ansible_hostname',
    "  ansible_facts[ 'hostname' ]  ",
  ]) {
    const r = resolveExpression(src, FACTS);
    assert.equal(r.ok, true, src);
    assert.equal(r.value, 'servera', src);
    assert.deepEqual(r.path, ['hostname'], src);
  }
});

test('resolver: nested keys, list indexes, and mixed notation', () => {
  assert.equal(resolveExpression("ansible_facts['default_ipv4']['address']", FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression('ansible_facts.default_ipv4.address', FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression('ansible_default_ipv4.address', FACTS).value, '10.0.2.15');
  assert.equal(resolveExpression("ansible_facts['mounts'][0]['device']", FACTS).value, '/dev/mapper/cs-root');
  assert.equal(resolveExpression('ansible_facts.mounts.1.mount', FACTS).value, '/boot');
  assert.deepEqual(resolveExpression("ansible_facts['mounts'][0]['device']", FACTS).path, ['mounts', 0, 'device']);
});

test('resolver: unknown key suggests the nearest one', () => {
  const r = resolveExpression("ansible_facts['host_name']", FACTS);
  assert.equal(r.code, 'UNDEFINED_FACT');
  assert.match(r.message, /Did you mean 'hostname'/);
});

test('resolver: the ansible_ prefix inside ansible_facts is explained', () => {
  const r = resolveExpression("ansible_facts['ansible_hostname']", FACTS);
  assert.equal(r.code, 'UNDEFINED_FACT');
  assert.match(r.message, /Did you mean 'hostname'/);
});

test('resolver: a string key on a list, an index out of range, a key on a scalar', () => {
  assert.equal(resolveExpression("ansible_facts['mounts']['device']", FACTS).code, 'UNDEFINED_FACT');
  assert.match(resolveExpression("ansible_facts['mounts']['device']", FACTS).message, /is a list/);
  assert.equal(resolveExpression("ansible_facts['mounts'][9]", FACTS).code, 'UNDEFINED_FACT');
  assert.equal(resolveExpression("ansible_facts['hostname']['x']", FACTS).code, 'UNDEFINED_FACT');
});

test('resolver: an unquoted key is a bad expression with a fix', () => {
  const r = resolveExpression('ansible_facts[hostname]', FACTS);
  assert.equal(r.code, 'BAD_EXPRESSION');
  assert.match(r.message, /\['hostname'\]/);
});

test('resolver: non-fact variables and empty input are bad expressions', () => {
  assert.equal(resolveExpression('inventory_hostname', FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression('', FACTS).code, 'BAD_EXPRESSION');
  assert.equal(resolveExpression("ansible_facts['hostname'] + 'x'", FACTS).code, 'BAD_EXPRESSION');
});

test('resolver: filters are reported as out of scope, but a pipe inside quotes is not a filter', () => {
  assert.equal(resolveExpression("ansible_facts['hostname'] | upper", FACTS).code, 'UNSUPPORTED_FILTER');
  assert.equal(resolveExpression("ansible_facts['a|b']", FACTS).code, 'UNDEFINED_FACT');
});

test('review focus: curly quotes get a specific message', () => {
  const r = resolveExpression('ansible_facts[‘hostname’]', FACTS);
  assert.equal(r.code, 'BAD_EXPRESSION');
  assert.match(r.message, /curly quotes/i);
});

test('review focus: prototype keys are undefined facts, never inherited values', () => {
  for (const src of ["ansible_facts['constructor']", 'ansible_facts.__proto__', "ansible_facts['toString']", 'ansible_facts.hostname.length']) {
    assert.equal(resolveExpression(src, FACTS).code, 'UNDEFINED_FACT', src);
  }
});

test('template: mixed text renders to a string and records each path', () => {
  const r = renderTemplate("{{ ansible_facts['hostname'] }} has {{ ansible_facts.memtotal_mb }} MB", FACTS);
  assert.equal(r.ok, true);
  assert.equal(r.value, 'servera has 567 MB');
  assert.deepEqual(r.paths, [['hostname'], ['memtotal_mb']]);
});

test('template: a lone expression keeps its native type', () => {
  assert.equal(renderTemplate('{{ ansible_facts.memtotal_mb }}', FACTS).value, 567);
  assert.deepEqual(renderTemplate("{{ ansible_facts['selinux'] }}", FACTS).value, { mode: 'enforcing' });
});

test('template: booleans print the way Ansible prints them', () => {
  assert.equal(renderTemplate('fips={{ ansible_facts.fips }}', FACTS).value, 'fips=False');
});

test('template: plain text has no paths; unbalanced braces and statements fail', () => {
  assert.deepEqual(renderTemplate('hello', FACTS).paths, []);
  assert.equal(renderTemplate("{{ ansible_facts['hostname'] }", FACTS).code, 'BAD_EXPRESSION');
  assert.equal(renderTemplate('{% if x %}y{% endif %}', FACTS).code, 'BAD_EXPRESSION');
});

test('template: a failing expression returns that failure', () => {
  assert.equal(renderTemplate("a {{ ansible_facts['nope'] }} b", FACTS).code, 'UNDEFINED_FACT');
});

test('pathToExpr formats keys and indexes', () => {
  assert.equal(pathToExpr(['mounts', 0, 'device']), "ansible_facts['mounts'][0]['device']");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test ansible-facts-trainer/tests/validator.test.mjs`
Expected: FAIL with `Cannot find module` for `validator.js`.

- [ ] **Step 3: Write the resolver**

`ansible-facts-trainer/validator.js`:

```js
import { load } from './vendor/js-yaml.mjs';

export const MAX_BYTES = 10240;

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const formatStep = (step) => (typeof step === 'number' ? `[${step}]` : `['${step}']`);

export function pathToExpr(path) {
  return `ansible_facts${path.map(formatStep).join('')}`;
}

function preview(value) {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function suggest(key, keys) {
  if (key.startsWith('ansible_') && keys.includes(key.slice(8))) return key.slice(8);
  let best = null;
  let bestDistance = 4;
  for (const candidate of keys) {
    const d = distance(key, candidate);
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}

function hasPipeOutsideQuotes(source) {
  let quote = null;
  for (const ch of source) {
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '|') return true;
  }
  return false;
}

function walk(facts, path) {
  let current = facts;
  const seen = [];
  for (const step of path) {
    const where = pathToExpr(seen);
    if (Array.isArray(current)) {
      if (typeof step !== 'number') {
        return fail('UNDEFINED_FACT', `${where} is a list. Pick an item by position, for example [0].`);
      }
      if (step >= current.length) {
        return fail('UNDEFINED_FACT', `${where} has ${current.length} item(s); index ${step} is out of range.`);
      }
      current = current[step];
    } else if (current !== null && typeof current === 'object') {
      const key = String(step);
      // Object.hasOwn keeps inherited names such as "constructor" from resolving.
      if (!Object.hasOwn(current, key)) {
        const hint = suggest(key, Object.keys(current));
        return fail('UNDEFINED_FACT', `No fact named '${key}' under ${where}.${hint ? ` Did you mean '${hint}'?` : ''}`);
      }
      current = current[key];
    } else {
      return fail('UNDEFINED_FACT', `${where} is a plain value (${preview(current)}); it has no keys beneath it.`);
    }
    seen.push(step);
  }
  return { ok: true, value: current, path };
}

const ROOT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const STEP_RE = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*\])/;
const BARE_KEY_RE = /^\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/;

export function resolveExpression(source, facts) {
  const src = String(source).trim();
  if (src === '') return fail('BAD_EXPRESSION', 'The expression is empty.');
  if (/[‘’“”]/.test(src)) {
    return fail('BAD_EXPRESSION', "This contains curly quotes (‘ ’ or “ ”). Retype them as straight quotes: ' or \".");
  }
  if (hasPipeOutsideQuotes(src)) {
    return fail('UNSUPPORTED_FILTER', "Jinja2 filters (the | character) are outside this trainer's scope. Use a plain fact lookup.");
  }
  const root = ROOT_RE.exec(src);
  if (!root) {
    return fail('BAD_EXPRESSION', `"${src}" is not a fact lookup. Start with ansible_facts, for example ansible_facts['hostname'].`);
  }
  const path = [];
  if (root[0] !== 'ansible_facts') {
    if (!root[0].startsWith('ansible_') || root[0].length === 8) {
      return fail('BAD_EXPRESSION', `"${root[0]}" is not a fact variable. Facts live under ansible_facts, for example ansible_facts['hostname'].`);
    }
    path.push(root[0].slice(8));
  }
  let position = root[0].length;
  while (position < src.length) {
    const rest = src.slice(position);
    const step = STEP_RE.exec(rest);
    if (!step) {
      const bare = BARE_KEY_RE.exec(rest);
      if (bare) {
        return fail('BAD_EXPRESSION', `[${bare[1]}] has no quotes, so Jinja2 reads ${bare[1]} as a variable name, not a key. Write ['${bare[1]}'].`);
      }
      return fail('BAD_EXPRESSION', `Could not read "${rest.trim()}". Only fact lookups are supported: .key, ['key'], or [0].`);
    }
    if (step[1] !== undefined) path.push(/^\d+$/.test(step[1]) ? Number(step[1]) : step[1]);
    else if (step[4] !== undefined) path.push(Number(step[4]));
    else path.push(step[2] ?? step[3]);
    position += step[0].length;
  }
  return walk(facts, path);
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null) return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const EXPRESSION_RE = /\{\{([\s\S]*?)\}\}/g;

export function renderTemplate(template, facts) {
  const text = String(template);
  if (/\{%/.test(text)) {
    return fail('BAD_EXPRESSION', "Jinja2 statements ({% ... %}) are outside this trainer's scope.");
  }
  if (/\{\{|\}\}/.test(text.replace(EXPRESSION_RE, ''))) {
    return fail('BAD_EXPRESSION', 'Unbalanced braces: every {{ needs a matching }}.');
  }
  const paths = [];
  const values = [];
  let failure = null;
  const rendered = text.replace(EXPRESSION_RE, (_, expression) => {
    if (failure) return '';
    const result = resolveExpression(expression, facts);
    if (!result.ok) { failure = result; return ''; }
    paths.push(result.path);
    values.push(result.value);
    return toText(result.value);
  });
  if (failure) return failure;
  const trimmed = text.trim();
  const lone = values.length === 1 && trimmed.startsWith('{{') && trimmed.endsWith('}}');
  return { ok: true, value: lone ? values[0] : rendered, paths };
}
```

The `load` import is unused until Task 4; leave it in place.

- [ ] **Step 4: Run to confirm the tests pass**

Run: `node --test ansible-facts-trainer/tests/validator.test.mjs`
Expected: 16 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add ansible-facts-trainer/validator.js ansible-facts-trainer/tests/validator.test.mjs
git commit -m "feat(ansible-facts-trainer): add fact expression resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Answer checking

**Files:**
- Modify: `ansible-facts-trainer/validator.js` (append)
- Modify: `ansible-facts-trainer/tests/validator.test.mjs` (append)

**Interfaces:**
- Consumes: `resolveExpression`, `renderTemplate`, `pathToExpr`, `fail`, `preview`, `walk`, `MAX_BYTES`, `load` from Tasks 2 and 3. A challenge is `{ id, tier, prompt, hint, requires: (string|number)[][], solution }`.
- Produces:
  - `checkExpression(text, challenge, facts)` → verdict. Used for tier 1. Passes when the expression's value deep-equals the value at `challenge.requires[0]`.
  - `checkTask(text, challenge, facts, host = 'localhost')` → verdict. Used for tiers 2 and 3. Passes when every path in `challenge.requires` was referenced.
  - A verdict is `{ ok: true, code: 'OK', message, rendered, note? }` or `{ ok: false, code, message, line?, column?, rendered? }`.
  - Failure codes: `TOO_LARGE`, `YAML_SYNTAX`, `NOT_A_LIST`, `EXTRA_TASKS`, `PLAY_NOT_TASK`, `MISSING_NAME`, `MISSING_MODULE`, `UNKNOWN_MODULE`, `UNSUPPORTED_KEYWORD`, `MISSING_MSG`, `BAD_EXPRESSION`, `UNDEFINED_FACT`, `UNSUPPORTED_FILTER`, `WRONG_FACT`.

- [ ] **Step 1: Append the failing tests**

Change the import line at the top of `ansible-facts-trainer/tests/validator.test.mjs` to:

```js
import { resolveExpression, renderTemplate, pathToExpr, checkExpression, checkTask } from '../validator.js';
```

Append to the same file:

```js
const HOSTNAME = { id: 't', tier: 2, requires: [['hostname']] };
const TWO = { id: 't3', tier: 3, requires: [['hostname'], ['default_ipv4', 'address']] };
const code = (text, challenge = HOSTNAME) => checkTask(text, challenge, FACTS, 'servera').code;

test('expression check: passes with or without braces, by value', () => {
  const c = { id: 'e', tier: 1, requires: [['hostname']] };
  assert.equal(checkExpression("ansible_facts['hostname']", c, FACTS).ok, true);
  assert.equal(checkExpression("{{ ansible_facts['hostname'] }}", c, FACTS).ok, true);
  assert.equal(checkExpression('ansible_hostname', c, FACTS).ok, true);
  assert.equal(checkExpression("ansible_facts['os_family']", c, FACTS).code, 'WRONG_FACT');
  assert.equal(checkExpression("ansible_facts['nope']", c, FACTS).code, 'UNDEFINED_FACT');
  assert.equal(checkExpression('x'.repeat(10241), c, FACTS).code, 'TOO_LARGE');
});

test('task check: the model answer passes and shows the run output', () => {
  const r = checkTask(
    "- name: Display the hostname\n  ansible.builtin.debug:\n    msg: \"The hostname is {{ ansible_facts['hostname'] }}\"\n",
    HOSTNAME, FACTS, 'servera');
  assert.equal(r.ok, true);
  assert.equal(r.rendered, 'ok: [servera] => {\n    "msg": "The hostname is servera"\n}');
  assert.equal(r.note, undefined);
});

test('task check: the short module name passes with advice', () => {
  const r = checkTask("- name: n\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", HOSTNAME, FACTS);
  assert.equal(r.ok, true);
  assert.match(r.note, /ansible\.builtin\.debug/);
});

test('task check: var is accepted and keys the output by the expression', () => {
  const r = checkTask("- name: n\n  ansible.builtin.debug:\n    var: ansible_facts['hostname']\n", HOSTNAME, FACTS, 'servera');
  assert.equal(r.ok, true);
  assert.match(r.rendered, /"ansible_facts\['hostname'\]": "servera"/);
});

test('task check: an unquoted msg and a list msg both pass', () => {
  assert.equal(checkTask('- name: n\n  debug:\n    msg: Host is {{ ansible_facts.hostname }}\n', HOSTNAME, FACTS).ok, true);
  const r = checkTask("- name: n\n  debug:\n    msg:\n      - \"{{ ansible_facts.hostname }}\"\n      - \"{{ ansible_facts.default_ipv4.address }}\"\n", TWO, FACTS);
  assert.equal(r.ok, true);
});

test('task check: harmless keywords are ignored', () => {
  assert.equal(checkTask("- name: n\n  become: true\n  tags: [facts]\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", HOSTNAME, FACTS).ok, true);
});

test('task check: a tier-3 answer missing one fact is the wrong fact', () => {
  const r = checkTask("- name: n\n  debug:\n    msg: \"{{ ansible_hostname }}\"\n", TWO, FACTS);
  assert.equal(r.code, 'WRONG_FACT');
  assert.match(r.message, /default_ipv4/);
});

test('task check: a hard-coded value does not pass', () => {
  assert.equal(code('- name: n\n  debug:\n    msg: "The hostname is servera"\n'), 'WRONG_FACT');
});

test('each structural error has its own code', () => {
  assert.equal(code(''), 'NOT_A_LIST');
  assert.equal(code('name: n\ndebug:\n  msg: "x"\n'), 'NOT_A_LIST');
  assert.equal(code('- name: a\n  debug:\n    msg: "x"\n- name: b\n  debug:\n    msg: "y"\n'), 'EXTRA_TASKS');
  assert.equal(code('- debug:\n    msg: "{{ ansible_hostname }}"\n'), 'MISSING_NAME');
  assert.equal(code('- name: n\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  msg: "{{ ansible_hostname }}"\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  debug:\n  msg: "{{ ansible_hostname }}"\n'), 'MISSING_MODULE');
  assert.equal(code('- name: n\n  debugg:\n    msg: "x"\n'), 'UNKNOWN_MODULE');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n  copy:\n    src: a\n'), 'UNKNOWN_MODULE');
  assert.equal(code('- name: n\n  debug:\n    mesg: "x"\n'), 'MISSING_MSG');
  assert.equal(code('- name: n\n  debug: msg="x"\n'), 'MISSING_MSG');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n    var: ansible_hostname\n'), 'MISSING_MSG');
  assert.equal(code('- name: n\n  debug:\n    msg: "x"\n  when: true\n'), 'UNSUPPORTED_KEYWORD');
  assert.equal(code("- name: n\n  debug:\n    var: \"{{ ansible_hostname }}\"\n"), 'BAD_EXPRESSION');
  assert.equal(code("- name: n\n  debug:\n    msg: \"{{ ansible_facts['host_name'] }}\"\n"), 'UNDEFINED_FACT');
  assert.equal(code("- name: n\n  debug:\n    msg: \"{{ ansible_hostname | upper }}\"\n"), 'UNSUPPORTED_FILTER');
  assert.equal(code(`- name: n\n  debug:\n    msg: "${'x'.repeat(10300)}"\n`), 'TOO_LARGE');
});

test('an unquoted value starting with {{ is a YAML error that says to quote it', () => {
  for (const body of ["msg: {{ ansible_facts['hostname'] }}", 'msg: {{ ansible_facts.hostname }}']) {
    const r = checkTask(`- name: n\n  debug:\n    ${body}\n`, HOSTNAME, FACTS);
    assert.equal(r.code, 'YAML_SYNTAX', body);
    assert.match(r.message, /quote/i, body);
  }
});

test('a YAML syntax error reports a one-based line number', () => {
  const r = checkTask('- name: n\n  debug:\n    msg: "unterminated\n', HOSTNAME, FACTS);
  assert.equal(r.code, 'YAML_SYNTAX');
  assert.equal(typeof r.line, 'number');
  assert.ok(r.line >= 1);
});

test('review focus: tab indentation is explained', () => {
  const r = checkTask('- name: n\n\tdebug:\n\t\tmsg: "x"\n', HOSTNAME, FACTS);
  assert.equal(r.code, 'YAML_SYNTAX');
  assert.match(r.message, /tab/i);
});

test('review focus: a whole play is redirected to a single task', () => {
  const play = "- hosts: all\n  tasks:\n    - name: n\n      debug:\n        msg: \"{{ ansible_hostname }}\"\n";
  const r = checkTask(play, HOSTNAME, FACTS);
  assert.equal(r.code, 'PLAY_NOT_TASK');
  assert.match(r.message, /only the task/i);
});

test('a task that prints every fact is truncated, not dumped', () => {
  const big = { ...FACTS, blob: 'y'.repeat(5000) };
  const r = checkTask('- name: n\n  debug:\n    var: ansible_facts\n', HOSTNAME, big);
  assert.equal(r.code, 'WRONG_FACT');
  assert.ok(r.rendered.length < 2100);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test ansible-facts-trainer/tests/validator.test.mjs`
Expected: FAIL, `checkExpression` is not exported.

- [ ] **Step 3: Append the implementation**

Append to `ansible-facts-trainer/validator.js`:

```js
const DEBUG_MODULES = ['debug', 'ansible.builtin.debug'];
const HARMLESS_KEYWORDS = ['tags', 'become', 'become_user', 'ignore_errors'];
const UNSUPPORTED_KEYWORDS = ['when', 'loop', 'with_items', 'vars', 'register', 'block'];
const MAX_RENDERED = 2000;
const SHAPE = "- name: Describe the task\n  ansible.builtin.debug:\n    msg: \"Text with {{ ansible_facts['hostname'] }}\"";
const QUOTE_HINT = ' A value that starts with {{ must be quoted, or YAML reads the braces as a mapping: msg: "{{ ... }}".';

const tooLarge = (text) => new TextEncoder().encode(String(text)).length > MAX_BYTES;
const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function checkExpression(text, challenge, facts) {
  if (tooLarge(text)) return fail('TOO_LARGE', 'The answer is too long. One expression is enough.');
  let source = String(text).trim();
  const braced = /^\{\{([\s\S]*)\}\}$/.exec(source);
  if (braced) source = braced[1].trim();
  const result = resolveExpression(source, facts);
  if (!result.ok) return result;
  const wanted = walk(facts, challenge.requires[0]);
  if (JSON.stringify(result.value) !== JSON.stringify(wanted.value)) {
    return fail('WRONG_FACT', `That is a real fact, but it holds ${preview(result.value)}, which is not what the challenge asks for.`);
  }
  return { ok: true, code: 'OK', message: 'Correct.', rendered: `${source} => ${preview(result.value)}` };
}

function parseYaml(text) {
  try {
    return { ok: true, doc: load(String(text)) };
  } catch (error) {
    const line = error.mark ? error.mark.line + 1 : undefined;
    const column = error.mark ? error.mark.column + 1 : undefined;
    let message = `YAML syntax error${line ? ` at line ${line}, column ${column}` : ''}: ${error.reason ?? error.message}.`;
    if (/\t/.test(text)) message += ' YAML forbids tab characters for indentation; use spaces.';
    if (/:\s*\{\{/.test(text)) message += QUOTE_HINT;
    return fail('YAML_SYNTAX', message, { line, column });
  }
}

function findModule(task) {
  const keys = Object.keys(task).filter((key) => key !== 'name' && !HARMLESS_KEYWORDS.includes(key));
  const blocked = keys.find((key) => UNSUPPORTED_KEYWORDS.includes(key));
  if (blocked) {
    return fail('UNSUPPORTED_KEYWORD', `"${blocked}" is outside this trainer's scope. Submit a task with only a name and the debug module.`);
  }
  if (keys.includes('msg') || keys.includes('var')) {
    return fail('MISSING_MODULE', `msg and var belong under the module, one indent level deeper. Expected:\n${SHAPE}`);
  }
  if (keys.length === 0) {
    return fail('MISSING_MODULE', `The task has a name but no module. Expected:\n${SHAPE}`);
  }
  const module = keys.find((key) => DEBUG_MODULES.includes(key));
  if (!module) {
    return fail('UNKNOWN_MODULE', `"${keys[0]}" is not the module this trainer expects. Use debug or ansible.builtin.debug.`);
  }
  if (keys.length > 1) {
    return fail('UNKNOWN_MODULE', `A task runs one module. Unexpected key: "${keys.find((key) => key !== module)}".`);
  }
  return { ok: true, module };
}

function evaluateArgs(args, module, facts) {
  if (!isMapping(args)) {
    return fail('MISSING_MSG', `${module} needs a msg or var key nested beneath it, not inline text. Expected:\n${SHAPE}`);
  }
  const hasMsg = Object.hasOwn(args, 'msg');
  const hasVar = Object.hasOwn(args, 'var');
  if (hasMsg && hasVar) return fail('MISSING_MSG', 'Use msg or var, not both. Ansible rejects a debug task that sets both.');
  if (!hasMsg && !hasVar) {
    const found = Object.keys(args).map((key) => `"${key}"`).join(', ') || 'nothing';
    return fail('MISSING_MSG', `${module} accepts msg or var. Found: ${found}.`);
  }
  if (hasVar) {
    if (typeof args.var !== 'string') return fail('BAD_EXPRESSION', 'var takes one fact expression as text.');
    if (args.var.includes('{{')) {
      return fail('BAD_EXPRESSION', "var takes a bare expression with no braces: var: ansible_facts['hostname'].");
    }
    const result = resolveExpression(args.var, facts);
    if (!result.ok) return result;
    return { ok: true, key: args.var.trim(), value: result.value, paths: [result.path] };
  }
  const parts = Array.isArray(args.msg) ? args.msg : [args.msg];
  const values = [];
  const paths = [];
  for (const part of parts) {
    if (part !== null && typeof part === 'object') {
      return fail('YAML_SYNTAX', `YAML read your msg as a mapping, not as text.${QUOTE_HINT}`);
    }
    const result = renderTemplate(part ?? '', facts);
    if (!result.ok) return result;
    values.push(result.value);
    paths.push(...result.paths);
  }
  return { ok: true, key: 'msg', value: Array.isArray(args.msg) ? values : values[0], paths };
}

export function checkTask(text, challenge, facts, host = 'localhost') {
  if (tooLarge(text)) return fail('TOO_LARGE', 'The answer is too long. One short task is enough.');
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const doc = parsed.doc;
  if (!Array.isArray(doc)) {
    return fail('NOT_A_LIST', doc == null
      ? 'The answer is empty. Write one task, starting with a dash.'
      : 'Tasks are a list. Start the task with a dash: "- name: ...".');
  }
  if (doc.length !== 1) return fail('EXTRA_TASKS', `Submit exactly one task; this answer has ${doc.length}.`);
  const task = doc[0];
  if (!isMapping(task)) return fail('MISSING_MODULE', `A task is a set of keys: a name, then a module. Expected:\n${SHAPE}`);
  if (Object.hasOwn(task, 'hosts') || Object.hasOwn(task, 'tasks')) {
    return fail('PLAY_NOT_TASK', 'This is a whole play. Submit only the task: the part that starts with "- name:" under tasks.');
  }
  if (typeof task.name !== 'string' || task.name.trim() === '') {
    return fail('MISSING_NAME', 'Every task needs a name key that describes what it does: "- name: Display the hostname".');
  }
  const found = findModule(task);
  if (!found.ok) return found;
  const evaluated = evaluateArgs(task[found.module], found.module, facts);
  if (!evaluated.ok) return evaluated;

  let rendered = `ok: [${host}] => ${JSON.stringify({ [evaluated.key]: evaluated.value }, null, 4)}`;
  if (rendered.length > MAX_RENDERED) rendered = `${rendered.slice(0, MAX_RENDERED)}\n… (truncated)`;

  const missing = challenge.requires.filter((required) => !evaluated.paths.some((path) => samePath(path, required)));
  if (missing.length > 0) {
    return fail('WRONG_FACT',
      `Your task is valid and would print the output below, but it does not read the fact this challenge asks for: ${missing.map(pathToExpr).join(', ')}.`,
      { rendered });
  }
  const verdict = { ok: true, code: 'OK', message: 'Correct.', rendered };
  if (found.module === 'debug') {
    verdict.note = 'This passes. On the exam and in production, prefer the fully qualified name ansible.builtin.debug.';
  }
  return verdict;
}
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `node --test ansible-facts-trainer/tests/validator.test.mjs`
Expected: 30 tests pass, 0 fail.

If the "unquoted value starting with {{" test fails for one of its two bodies, read which route `js-yaml` took (parse error or mapping) and make sure that route returns `YAML_SYNTAX` with the quote hint. Both routes are already handled; the fix belongs in the validator, never in the test.

- [ ] **Step 5: Commit**

```bash
git add ansible-facts-trainer/validator.js ansible-facts-trainer/tests/validator.test.mjs
git commit -m "feat(ansible-facts-trainer): add task and expression checking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The challenges

**Files:**
- Create: `ansible-facts-trainer/challenges.js`
- Create: `ansible-facts-trainer/tests/challenges.test.mjs`

**Interfaces:**
- Consumes: `checkExpression`, `checkTask` (Task 4); `FACTS`, `HOST` (Task 1).
- Produces: `CHALLENGES`, an array of 15 records `{ id: string, tier: 1|2|3, prompt: string, hint: string, requires: (string|number)[][], solution: string }`, ordered tier 1, then 2, then 3, five each.

- [ ] **Step 1: Write the failing test**

`ansible-facts-trainer/tests/challenges.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES } from '../challenges.js';
import { FACTS, HOST } from '../facts.js';
import { checkExpression, checkTask } from '../validator.js';

const check = (c, text) => (c.tier === 1 ? checkExpression(text, c, FACTS) : checkTask(text, c, FACTS, HOST));

test('there are 15 challenges, five per tier, in tier order, with unique ids', () => {
  assert.equal(CHALLENGES.length, 15);
  assert.deepEqual(CHALLENGES.map((c) => c.tier), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, 15);
});

test('every challenge has the full record', () => {
  for (const c of CHALLENGES) {
    for (const field of ['id', 'prompt', 'hint', 'solution']) {
      assert.equal(typeof c[field], 'string', `${c.id}.${field}`);
      assert.ok(c[field].length > 0, `${c.id}.${field}`);
    }
    assert.ok(Array.isArray(c.requires) && c.requires.length >= 1, `${c.id}.requires`);
    if (c.tier === 3) assert.ok(c.requires.length >= 2, `${c.id} must combine facts`);
  }
});

test('every model answer passes against the real capture', () => {
  for (const c of CHALLENGES) {
    const r = check(c, c.solution);
    assert.equal(r.ok, true, `${c.id}: ${r.code} ${r.message}`);
  }
});

test('every model task uses the fully qualified module name', () => {
  for (const c of CHALLENGES.filter((x) => x.tier > 1)) {
    assert.match(c.solution, /ansible\.builtin\.debug:/, c.id);
  }
});

test('the trap: distribution does not answer the Red Hat family question', () => {
  const trap = CHALLENGES.find((c) => c.id === 't1-os-family');
  assert.equal(checkExpression("ansible_facts['distribution']", trap, FACTS).code, 'WRONG_FACT');
});

test('notation variants of a tier-1 answer all pass', () => {
  const c = CHALLENGES.find((x) => x.id === 't1-ipv4');
  for (const text of [
    "ansible_facts['default_ipv4']['address']",
    'ansible_facts["default_ipv4"]["address"]',
    'ansible_facts.default_ipv4.address',
    "ansible_facts.default_ipv4['address']",
    'ansible_default_ipv4.address',
    "{{ ansible_facts['default_ipv4']['address'] }}",
  ]) assert.equal(check(c, text).ok, true, text);
});

test('notation variants of a tier-2 answer all pass', () => {
  const c = CHALLENGES.find((x) => x.id === 't2-hostname');
  for (const text of [
    "- name: Show it\n  ansible.builtin.debug:\n    msg: \"{{ ansible_facts['hostname'] }}\"\n",
    "- name: Show it\n  debug:\n    msg: 'Host: {{ ansible_facts.hostname }}'\n",
    '- name: Show it\n  debug:\n    msg: "{{ ansible_hostname }}"\n',
    "- name: Show it\n  ansible.builtin.debug:\n    var: ansible_facts['hostname']\n",
    '- name: Show it\n  debug:\n    var: ansible_facts.hostname\n',
    "- name: Show it\r\n  debug:\r\n    msg: \"{{ ansible_facts['hostname'] }}\"\r\n",
  ]) assert.equal(check(c, text).ok, true, text);
});

test('notation variants of a tier-3 answer all pass', () => {
  const c = CHALLENGES.find((x) => x.id === 't3-network');
  for (const text of [
    "- name: n\n  debug:\n    msg: \"{{ ansible_facts['default_ipv4']['interface'] }} has {{ ansible_facts['default_ipv4']['address'] }}\"\n",
    '- name: n\n  debug:\n    msg: "{{ ansible_default_ipv4.address }} on {{ ansible_default_ipv4.interface }}"\n',
    "- name: n\n  debug:\n    msg:\n      - \"{{ ansible_facts.default_ipv4.interface }}\"\n      - \"{{ ansible_facts.default_ipv4.address }}\"\n",
  ]) assert.equal(check(c, text).ok, true, text);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test ansible-facts-trainer/tests/challenges.test.mjs`
Expected: FAIL with `Cannot find module` for `challenges.js`.

- [ ] **Step 3: Write the challenges**

`ansible-facts-trainer/challenges.js`:

```js
const task = (name, msg) => `- name: ${name}\n  ansible.builtin.debug:\n    msg: "${msg}"\n`;

export const CHALLENGES = [
  {
    id: 't1-hostname',
    tier: 1,
    prompt: 'Which fact holds the short hostname, without the domain? Type the expression that reads it.',
    hint: "Search the reference for 'host'. One fact is the short name; fqdn and nodename include the domain.",
    requires: [['hostname']],
    solution: "ansible_facts['hostname']",
  },
  {
    id: 't1-os-family',
    tier: 1,
    prompt: 'Which fact proves this host belongs to the Red Hat family, so a task could safely use dnf? Type the expression.',
    hint: "Compare 'distribution' with 'os_family'. Only one of them says RedHat on a CentOS Stream host.",
    requires: [['os_family']],
    solution: "ansible_facts['os_family']",
  },
  {
    id: 't1-pkg-mgr',
    tier: 1,
    prompt: 'Which fact names the package manager this host uses? Type the expression.',
    hint: "Search the reference for 'pkg'.",
    requires: [['pkg_mgr']],
    solution: "ansible_facts['pkg_mgr']",
  },
  {
    id: 't1-ipv4',
    tier: 1,
    prompt: 'Type the expression for the IPv4 address on the default-route interface. This one is nested.',
    hint: "Open 'default_ipv4' in the reference. Chain one lookup per level: ansible_facts['outer']['inner'].",
    requires: [['default_ipv4', 'address']],
    solution: "ansible_facts['default_ipv4']['address']",
  },
  {
    id: 't1-first-mount-device',
    tier: 1,
    prompt: "Type the expression for the device behind the first entry in the 'mounts' list.",
    hint: "'mounts' is a list, so pick an item by position first: ['mounts'][0], then the key you want.",
    requires: [['mounts', 0, 'device']],
    solution: "ansible_facts['mounts'][0]['device']",
  },
  {
    id: 't2-hostname',
    tier: 2,
    prompt: "Write a task that prints the target host's short hostname during a playbook run.",
    hint: 'A task is a list item with a name, then the module, then msg nested under the module. Quote a msg that contains {{ }}.',
    requires: [['hostname']],
    solution: task('Display the hostname', "The hostname is {{ ansible_facts['hostname'] }}"),
  },
  {
    id: 't2-kernel',
    tier: 2,
    prompt: 'Write a task that prints the running kernel release.',
    hint: "Search the reference for 'kernel'. You want the release string, not kernel_version.",
    requires: [['kernel']],
    solution: task('Display the kernel release', "Kernel: {{ ansible_facts['kernel'] }}"),
  },
  {
    id: 't2-memory',
    tier: 2,
    prompt: 'Write a task that prints the total memory in megabytes.',
    hint: "Search the reference for 'mem'. The fact you want ends in _mb.",
    requires: [['memtotal_mb']],
    solution: task('Display total memory', "Total memory: {{ ansible_facts['memtotal_mb'] }} MB"),
  },
  {
    id: 't2-selinux',
    tier: 2,
    prompt: 'Write a task that prints the current SELinux mode (enforcing, permissive, or disabled).',
    hint: "'selinux' is a dictionary. The mode is one level down.",
    requires: [['selinux', 'mode']],
    solution: task('Display the SELinux mode', "SELinux is {{ ansible_facts['selinux']['mode'] }}"),
  },
  {
    id: 't2-fqdn',
    tier: 2,
    prompt: 'Write a task that prints the fully qualified domain name.',
    hint: 'The fact name is the common four-letter abbreviation.',
    requires: [['fqdn']],
    solution: task('Display the fully qualified domain name', "FQDN: {{ ansible_facts['fqdn'] }}"),
  },
  {
    id: 't3-os-release',
    tier: 3,
    prompt: 'Write one task that prints the distribution name and its major version in a single message, for example "CentOS 9".',
    hint: "Two facts, two sets of braces in one msg: 'distribution' and 'distribution_major_version'.",
    requires: [['distribution'], ['distribution_major_version']],
    solution: task('Display the OS release', "{{ ansible_facts['distribution'] }} {{ ansible_facts['distribution_major_version'] }}"),
  },
  {
    id: 't3-network',
    tier: 3,
    prompt: 'Write one task that prints the default-route interface name and its IPv4 address.',
    hint: "Both live under 'default_ipv4': 'interface' and 'address'.",
    requires: [['default_ipv4', 'interface'], ['default_ipv4', 'address']],
    solution: task('Display the default interface and address', "{{ ansible_facts['default_ipv4']['interface'] }} has {{ ansible_facts['default_ipv4']['address'] }}"),
  },
  {
    id: 't3-capacity',
    tier: 3,
    prompt: 'Write one task that prints the number of virtual CPUs and the total memory in megabytes.',
    hint: "Search the reference for 'vcpus' and 'memtotal'.",
    requires: [['processor_vcpus'], ['memtotal_mb']],
    solution: task('Display CPU and memory', "{{ ansible_facts['processor_vcpus'] }} vCPU, {{ ansible_facts['memtotal_mb'] }} MB"),
  },
  {
    id: 't3-identity',
    tier: 3,
    prompt: 'Write one task that prints three facts in one message: the short hostname, the OS family, and the kernel release.',
    hint: 'Three facts, three sets of braces. The wording between them is yours.',
    requires: [['hostname'], ['os_family'], ['kernel']],
    solution: task('Display host identity', "{{ ansible_facts['hostname'] }} is a {{ ansible_facts['os_family'] }} host on kernel {{ ansible_facts['kernel'] }}"),
  },
  {
    id: 't3-custom-fact',
    tier: 3,
    prompt: "This host has a custom fact, loaded from /etc/ansible/facts.d. Write one task that prints the short hostname and the 'owner' value from that custom fact.",
    hint: "Custom facts appear under 'local'. Open it in the reference and follow it down three levels to 'owner'.",
    requires: [['hostname'], ['local', 'video', 'info', 'owner']],
    solution: task('Display the custom owner fact', "{{ ansible_facts['hostname'] }} is owned by {{ ansible_facts['local']['video']['info']['owner'] }}"),
  },
];
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'ansible-facts-trainer/tests/*.test.mjs'`
Expected: all three test files pass (6 + 30 + 8 = 44 tests), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add ansible-facts-trainer/challenges.js ansible-facts-trainer/tests/challenges.test.mjs
git commit -m "feat(ansible-facts-trainer): add 15 challenges across three tiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The interface

**Files:**
- Create: `ansible-facts-trainer/index.html`
- Create: `ansible-facts-trainer/app.js`

**Interfaces:**
- Consumes: `FACTS`, `HOST`; `CHALLENGES`; `checkExpression(text, challenge, facts)`; `checkTask(text, challenge, facts, host)`. A verdict has `ok`, `code`, `message`, and optionally `rendered` and `note`.
- Produces: the playable page. No exports.

- [ ] **Step 1: Write the page**

`ansible-facts-trainer/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <meta name="description" content="Ansible Facts Trainer — find the fact, write the debug task, and see what a real playbook run would print. Built on a real ansible_facts capture.">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self';">
    <title>Ansible Facts Trainer · Eddie's Portfolio</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Inter:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <script type="module" src="app.js"></script>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg:#07010f; --cyan:#4af7ff; --purple:#7b2fff; --green:#00e676;
            --amber:#fbbf24; --red:#ff5c7c; --text:#dde0f0; --muted:#8a90aa;
            --border:rgba(74,247,255,0.16); --card:rgba(255,255,255,0.03);
            --mono:'Fira Code', ui-monospace, Menlo, monospace;
            color-scheme: dark;
        }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; min-height: 100vh; }
        .skip { position:absolute; left:-999px; top:0; background:var(--cyan); color:#000; padding:8px 14px; border-radius:0 0 8px 0; z-index:50; }
        .skip:focus { left:0; }
        .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

        .top-nav { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 24px; border-bottom:1px solid var(--border); position:sticky; top:0; background:rgba(7,1,15,0.92); backdrop-filter:blur(12px); z-index:10; }
        .nav-left { display:flex; align-items:center; gap:12px; min-width:0; }
        .back-btn, .hiw-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border:1px solid var(--border); border-radius:8px; text-decoration:none; font-size:0.78rem; font-weight:500; white-space:nowrap; }
        .back-btn { color:var(--muted); }
        .back-btn:hover { color:var(--cyan); border-color:var(--cyan); }
        .hiw-btn { color:var(--cyan); }
        .hiw-btn:hover { background:rgba(74,247,255,0.07); border-color:var(--cyan); }
        .app-title { font-family:'Orbitron', system-ui; font-size:0.85rem; color:var(--cyan); letter-spacing:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        main { max-width:1180px; margin:0 auto; padding:32px 24px 80px; }
        h1 { font-family:'Orbitron', system-ui; font-size:clamp(1.5rem,4vw,2.2rem); color:#fff; margin-bottom:6px; }
        .subtitle { color:var(--muted); font-size:0.9rem; margin-bottom:24px; line-height:1.5; }
        code, pre, textarea, .tree { font-family:var(--mono); }
        .subtitle code { color:var(--cyan); }

        .panes { display:grid; grid-template-columns:minmax(0,5fr) minmax(0,6fr); gap:20px; align-items:start; }
        .pane { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px; min-width:0; }
        .pane h2 { font-family:'Orbitron', system-ui; font-size:0.8rem; letter-spacing:2px; color:var(--cyan); text-transform:uppercase; margin-bottom:12px; }

        #search { width:100%; padding:10px 12px; background:#0c0718; color:var(--text); border:1px solid var(--border); border-radius:8px; font-size:0.9rem; margin-bottom:12px; }
        #search:focus, textarea:focus, button:focus-visible, summary:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
        .tree { max-height:66vh; overflow:auto; font-size:0.8rem; line-height:1.7; }
        .tree details { padding-left:14px; border-left:1px solid rgba(255,255,255,0.06); }
        .tree > details, .tree > .leaf { padding-left:0; border-left:0; }
        .tree summary { cursor:pointer; }
        .leaf { padding-left:14px; overflow-wrap:anywhere; }
        .tree > .leaf { padding-left:14px; }
        .key { color:var(--cyan); }
        .meta { color:var(--muted); }
        .val { color:var(--amber); }
        .empty { color:var(--muted); font-family:'Inter', system-ui, sans-serif; }

        .status { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:0.78rem; color:var(--muted); margin-bottom:12px; }
        #tier { color:var(--purple); font-weight:600; filter:brightness(1.6); }
        #prompt { font-size:1rem; line-height:1.55; margin-bottom:14px; }
        #editor-label { display:block; font-size:0.78rem; color:var(--muted); margin-bottom:6px; }
        textarea { width:100%; padding:12px; background:#0c0718; color:var(--text); border:1px solid var(--border); border-radius:8px; font-size:0.86rem; line-height:1.6; resize:vertical; tab-size:2; white-space:pre; overflow:auto; }
        .help { font-size:0.74rem; color:var(--muted); margin:6px 0 14px; }
        .buttons, .nav-buttons { display:flex; flex-wrap:wrap; gap:10px; }
        .nav-buttons { margin-top:18px; padding-top:14px; border-top:1px solid var(--border); }
        button { padding:9px 16px; border-radius:8px; border:1px solid var(--border); background:transparent; color:var(--text); font:inherit; font-size:0.84rem; font-weight:500; cursor:pointer; }
        button:hover { border-color:var(--cyan); color:var(--cyan); }
        button.primary { background:var(--cyan); color:#04121a; border-color:var(--cyan); font-weight:600; }
        button.primary:hover { color:#04121a; filter:brightness(1.1); }
        #reset { margin-left:auto; color:var(--muted); }

        .verdict { margin-top:14px; padding:12px 14px; border-radius:8px; font-size:0.82rem; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; border:1px solid transparent; }
        .verdict:empty { display:none; }
        .verdict.pass { border-color:var(--green); background:rgba(0,230,118,0.07); color:#b9f6ca; }
        .verdict.fail { border-color:var(--red); background:rgba(255,92,124,0.07); color:#ffc2cd; }
        #hint-text { margin-top:12px; padding:10px 14px; border-left:3px solid var(--amber); color:var(--text); font-size:0.86rem; line-height:1.5; }
        #answer { margin-top:12px; padding:12px 14px; border:1px dashed var(--border); border-radius:8px; font-size:0.82rem; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
        [hidden] { display:none !important; }

        @media (max-width: 860px) {
            .panes { grid-template-columns:minmax(0,1fr); }
            .pane.challenge { order:-1; }
            .tree { max-height:50vh; }
            .top-nav, main { padding-left:16px; padding-right:16px; }
        }
    </style>
</head>
<body>
    <a class="skip" href="#main">Skip to content</a>
    <nav class="top-nav">
        <div class="nav-left">
            <a class="back-btn" href="../index.html">← App Hub</a>
            <span class="app-title">ANSIBLE FACTS TRAINER</span>
        </div>
        <a class="hiw-btn" href="how-it-works.html">📖 How It's Built</a>
    </nav>

    <main id="main">
        <h1>Ansible Facts Trainer</h1>
        <p class="subtitle">Find the fact, write the task, and see what a real run would print. The reference is a real <code>ansible -m setup</code> capture from <code>servera</code>, a CentOS Stream 9 lab host, with identifying values replaced.</p>

        <div class="panes">
            <section class="pane" aria-labelledby="reference-heading">
                <h2 id="reference-heading">Facts reference</h2>
                <label class="sr-only" for="search">Search facts by key name</label>
                <input id="search" type="search" placeholder="Search keys, for example: ipv4" autocomplete="off" spellcheck="false">
                <div id="tree" class="tree"></div>
            </section>

            <section class="pane challenge" aria-labelledby="challenge-heading">
                <div class="status"><span id="tier"></span><span id="progress"></span></div>
                <h2 id="challenge-heading">Challenge</h2>
                <p id="prompt"></p>
                <label id="editor-label" for="editor"></label>
                <textarea id="editor" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"></textarea>
                <p class="help">Tab inserts two spaces. Ctrl+Enter or ⌘+Enter checks. Shift+Tab leaves the editor.</p>
                <div class="buttons">
                    <button id="check" class="primary" type="button">Check</button>
                    <button id="hint" type="button">Hint</button>
                    <button id="reveal" type="button">Show answer</button>
                </div>
                <pre id="verdict" class="verdict" role="status" aria-live="polite"></pre>
                <p id="hint-text" hidden></p>
                <pre id="answer" hidden></pre>
                <div class="nav-buttons">
                    <button id="prev" type="button">← Previous</button>
                    <button id="next" type="button">Next →</button>
                    <button id="reset" type="button">Reset progress</button>
                </div>
            </section>
        </div>
    </main>
</body>
</html>
```

- [ ] **Step 2: Write the screen logic**

`ansible-facts-trainer/app.js`:

```js
import { FACTS, HOST } from './facts.js';
import { CHALLENGES } from './challenges.js';
import { checkExpression, checkTask } from './validator.js';

const STORAGE_KEY = 'ansible-facts-trainer:solved:v1';
const TIER_NAMES = { 1: 'Locate a fact', 2: 'Write a task', 3: 'Combine facts' };
const $ = (id) => document.getElementById(id);

function loadSolved() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const known = new Set(CHALLENGES.map((c) => c.id));
    return new Set(Array.isArray(stored) ? stored.filter((id) => known.has(id)) : []);
  } catch {
    // Storage is blocked or holds something unreadable: start with no progress.
    return new Set();
  }
}

function saveSolved(solved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...solved]));
  } catch {
    // Storage is unavailable: progress lasts for this page view only.
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Returns a DOM node, or null when neither this key nor anything beneath it matches.
function renderNode(label, value, query) {
  const isBranch = value !== null && typeof value === 'object';
  const selfMatch = query === '' || (typeof label === 'string' && label.toLowerCase().includes(query));
  if (!isBranch) {
    if (!selfMatch) return null;
    const row = el('div', 'leaf');
    row.append(el('span', 'key', String(label)), el('span', 'meta', ': '), el('span', 'val', JSON.stringify(value)));
    return row;
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  const children = entries.map(([key, child]) => renderNode(key, child, selfMatch ? '' : query)).filter(Boolean);
  if (!selfMatch && children.length === 0) return null;
  const details = el('details');
  details.open = query !== '' && !selfMatch;
  const summary = el('summary');
  summary.append(el('span', 'key', String(label)), el('span', 'meta', Array.isArray(value) ? ` [${value.length}]` : ` {${entries.length}}`));
  details.append(summary, ...children);
  return details;
}

function renderTree() {
  const query = $('search').value.trim().toLowerCase();
  const nodes = Object.keys(FACTS).sort().map((key) => renderNode(key, FACTS[key], query)).filter(Boolean);
  $('tree').replaceChildren(...(nodes.length ? nodes : [el('p', 'empty', 'No fact keys match that search.')]));
}

const solved = loadSolved();
let index = Math.max(0, CHALLENGES.findIndex((c) => !solved.has(c.id)));

function renderStatus() {
  const challenge = CHALLENGES[index];
  $('tier').textContent = `Tier ${challenge.tier} · ${TIER_NAMES[challenge.tier]}`;
  $('progress').textContent = `Challenge ${index + 1} of ${CHALLENGES.length} · ${solved.size} solved${solved.has(challenge.id) ? ' · this one is solved' : ''}`;
}

function showChallenge() {
  const challenge = CHALLENGES[index];
  const isExpression = challenge.tier === 1;
  $('prompt').textContent = challenge.prompt;
  $('editor-label').textContent = isExpression ? 'Your expression' : 'Your task (YAML)';
  $('editor').value = '';
  $('editor').rows = isExpression ? 2 : 8;
  $('editor').placeholder = isExpression ? "ansible_facts['...']" : '- name: ...';
  $('verdict').textContent = '';
  $('verdict').className = 'verdict';
  $('hint-text').hidden = true;
  $('answer').hidden = true;
  $('prev').disabled = index === 0;
  $('next').disabled = index === CHALLENGES.length - 1;
  renderStatus();
}

function check() {
  const challenge = CHALLENGES[index];
  const text = $('editor').value;
  const verdict = challenge.tier === 1
    ? checkExpression(text, challenge, FACTS)
    : checkTask(text, challenge, FACTS, HOST);
  const lines = verdict.ok
    ? [`✔ ${verdict.message}`, verdict.rendered, verdict.note]
    : [`✘ ${verdict.code}`, verdict.message, verdict.rendered];
  $('verdict').className = `verdict ${verdict.ok ? 'pass' : 'fail'}`;
  $('verdict').textContent = lines.filter(Boolean).join('\n\n');
  if (verdict.ok) {
    solved.add(challenge.id);
    saveSolved(solved);
    renderStatus();
  }
}

function go(step) {
  const target = index + step;
  if (target < 0 || target >= CHALLENGES.length) return;
  index = target;
  showChallenge();
  $('editor').focus();
}

$('search').addEventListener('input', renderTree);
$('check').addEventListener('click', check);
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('hint').addEventListener('click', () => {
  $('hint-text').textContent = `Hint: ${CHALLENGES[index].hint}`;
  $('hint-text').hidden = false;
});
$('reveal').addEventListener('click', () => {
  $('answer').textContent = `One correct answer:\n\n${CHALLENGES[index].solution}`;
  $('answer').hidden = false;
});
$('reset').addEventListener('click', () => {
  if (!window.confirm('Clear all saved progress for this trainer?')) return;
  solved.clear();
  saveSolved(solved);
  index = 0;
  showChallenge();
});
$('editor').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    check();
  } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const editor = event.currentTarget;
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
  }
});

renderTree();
showChallenge();
```

- [ ] **Step 3: Confirm the code obeys the security constraints**

```bash
grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function' ansible-facts-trainer/app.js ansible-facts-trainer/validator.js ansible-facts-trainer/challenges.js
```

Expected: no output.

- [ ] **Step 4: Serve the hub and verify in a browser**

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/ansible-facts-trainer/` and confirm each item:

1. The facts tree renders with about 106 top-level keys, all collapsed.
2. Typing `ipv4` in the search box leaves only matching branches, opened to the match; clearing it restores the full tree. List items keep their original index labels.
3. Challenge 1 shows "Tier 1 · Locate a fact". `ansible_facts['hostname']` then Check gives a green verdict; the status line reads "1 solved".
4. On a tier-2 challenge, the model answer from Show answer, typed into the editor, gives a green verdict that shows `ok: [servera] => { "msg": ... }`.
5. `msg: {{ ansible_facts['hostname'] }}` without quotes gives a red `YAML_SYNTAX` verdict that says to quote the value.
6. Tab inserts two spaces; ⌘+Enter checks; Shift+Tab moves focus out of the editor.
7. Reload the page: solved challenges are still counted and the app opens on the first unsolved one.
8. **Review focus 5, corrupted progress.** In the browser console run `localStorage.setItem('ansible-facts-trainer:solved:v1', '{not json')` and reload: the page loads with "0 solved" and no error. Repeat with `'{"a":1}'` and with `'["no-such-id"]'`: both load with "0 solved".
9. The console shows **zero** Content-Security-Policy violations and zero errors. The Network tab shows no request to any host other than `127.0.0.1` and the two Google Fonts hosts.
10. Narrow the window below 860 px: the panes stack with the challenge on top, and nothing scrolls sideways.

Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add ansible-facts-trainer/index.html ansible-facts-trainer/app.js
git commit -m "feat(ansible-facts-trainer): add the trainer interface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Explainer page, hub card, and final verification

**Files:**
- Create: `ansible-facts-trainer/how-it-works.html`
- Modify: `index.html` (hub) — project count, and a new card after the Glassbox card

**Interfaces:**
- Consumes: the finished app from Tasks 1 to 6.
- Produces: the hub links to the app and to its explainer.

- [ ] **Step 1: Write the explainer**

`ansible-facts-trainer/how-it-works.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'none';">
  <title>How It's Built — Ansible Facts Trainer | Eddie's App Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Inter:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../how-it-works.css">
</head>
<body>
<a href="index.html" style="position:fixed;top:12px;left:12px;z-index:9999;background:rgba(10,10,20,0.85);backdrop-filter:blur(6px);color:#4af7ff;border:1px solid #4af7ff;border-radius:20px;padding:6px 14px;font-family:sans-serif;font-size:13px;text-decoration:none;font-weight:600;">← Back to the trainer</a>

<div class="hiw-page">

  <header class="hiw-header">
    <div class="hiw-icon">📋</div>
    <h1>Ansible Facts Trainer — How It's Built</h1>
    <p class="hiw-tagline">Find the fact, write the task, and see what a real playbook run would print.</p>
  </header>

  <section class="hiw-section">
    <h2>Overview</h2>
    <p>
      Ansible gathers facts about every host it manages: hostname, addresses, memory, operating system.
      Using them correctly takes three skills at once: finding the right fact, reaching into nested data,
      and writing valid YAML with Jinja2 braces. This trainer drills all three against a real
      <code>ansible -m setup</code> capture from a CentOS Stream 9 lab host. Nothing runs on a server;
      every answer is checked in the browser.
    </p>
  </section>

  <section class="hiw-section">
    <h2>Tech Stack</h2>
    <div class="hiw-badges">
      <span class="hiw-badge">HTML</span>
      <span class="hiw-badge">CSS</span>
      <span class="hiw-badge">JavaScript modules</span>
      <span class="hiw-badge">js-yaml</span>
      <span class="hiw-badge">Node test runner</span>
      <span class="hiw-badge">Python</span>
    </div>
    <ul class="hiw-caption-list">
      <li><strong>HTML and CSS</strong> — a two-pane layout: the facts reference beside the challenge. The panes stack on a phone.</li>
      <li><strong>JavaScript modules</strong> — the validator is a separate file with no screen access, so the same code runs in the browser and in the tests.</li>
      <li><strong>js-yaml</strong> — a YAML parser, copied into the repository at a pinned version with its checksum recorded. Nothing loads from a content delivery network.</li>
      <li><strong>Node test runner</strong> — 44 tests using Node's built-in <code>node --test</code>. No packages to install.</li>
      <li><strong>Python</strong> — a one-off script that sanitizes the raw capture before it is published.</li>
    </ul>
  </section>

  <section class="hiw-section">
    <h2>How Each Part Works</h2>

    <div class="hiw-file-block">
      <h3><code>validator.js</code> — the resolver</h3>
      <p>
        The core of the app. It reads a fact lookup one step at a time and walks the capture.
        It never calls <code>eval()</code>. Because it walks real data, every correct spelling passes:
        bracket notation, dot notation, and the legacy <code>ansible_hostname</code> form.
      </p>
      <pre class="hiw-code">// One step is .key, ['key'], "key" in brackets, or [0]
const STEP_RE = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*\])/;

// Object.hasOwn keeps inherited names such as "constructor" from resolving.
if (!Object.hasOwn(current, key)) {
  const hint = suggest(key, Object.keys(current));
  return fail('UNDEFINED_FACT', `No fact named '${key}' ... Did you mean '${hint}'?`);
}</pre>
    </div>

    <div class="hiw-file-block">
      <h3><code>validator.js</code> — the task check</h3>
      <p>
        An answer passes through a pipeline: size guard, YAML parse, shape check, fact resolution, verdict.
        Each stage fails with its own named error, so the feedback says what is wrong and how to fix it.
        A passing answer shows the line a real run would print.
      </p>
      <pre class="hiw-code">// Pass rule: every fact the challenge requires was actually read.
const missing = challenge.requires.filter(
  (required) =&gt; !evaluated.paths.some((path) =&gt; samePath(path, required)));

// The classic mistake gets its own explanation:
//   msg: {{ ansible_facts['hostname'] }}     &lt;- YAML reads the braces as a mapping
//   msg: "{{ ansible_facts['hostname'] }}"   &lt;- quoted, so it is text</pre>
    </div>

    <div class="hiw-file-block">
      <h3><code>tools/sanitize_facts.py</code> and the leak gate</h3>
      <p>
        The capture came from a real machine, so it held real identifiers. The sanitizer replaces MAC
        addresses, the IPv6 addresses derived from them, the machine ID, SSH host keys, the public
        resolver address, and the account name. A test then checks the published file against an
        allowlist. The test describes what clean data looks like, so it holds no real value itself.
      </p>
      <pre class="hiw-code">// tests/sanitization.test.mjs
test('every MAC address is in the documentation range', () =&gt; {
  for (const mac of macs) {
    assert.ok(/^00:00:5e:00:53:/i.test(mac) || mac === '00:00:00:00:00:00');
  }
});</pre>
    </div>

    <div class="hiw-file-block">
      <h3><code>app.js</code></h3>
      <p>
        Screen logic only: it draws the facts tree, filters it as you search, sends your answer to the
        validator, and saves progress in the browser. All output is written as text, never as HTML,
        so nothing typed into the editor can inject markup.
      </p>
      <pre class="hiw-code">// textContent, never innerHTML
$('verdict').textContent = lines.filter(Boolean).join('\n\n');</pre>
    </div>
  </section>

  <section class="hiw-section">
    <h2>File Map</h2>
    <pre class="hiw-file-map">ansible-facts-trainer/
├── index.html            ← markup, styles, Content-Security-Policy
├── app.js                ← screen logic: tree, search, buttons, progress
├── validator.js          ← pure functions: parse, resolve, render, judge
├── challenges.js         ← the 15 challenges as data
├── facts.js              ← the sanitized capture (generated)
├── how-it-works.html     ← this page
├── vendor/
│   ├── js-yaml.mjs       ← pinned YAML parser
│   └── README.md         ← version, source, checksum
├── tools/
│   └── sanitize_facts.py ← raw capture → facts.js
└── tests/
    ├── sanitization.test.mjs
    ├── validator.test.mjs
    └── challenges.test.mjs</pre>
  </section>

  <section class="hiw-section">
    <h2>Replicate It Yourself</h2>
    <ol class="hiw-steps">
      <li>
        <span>
          Capture the facts from a host you manage: <code>ansible servera -m ansible.builtin.setup &gt; raw.json</code>.
          Keep the raw file out of your repository. Reference:
          <a href="https://docs.ansible.com/ansible/latest/collections/ansible/builtin/setup_module.html" target="_blank" rel="noopener">the setup module</a>.
        </span>
      </li>
      <li>
        <span>
          Sanitize it before publishing. Replace hardware addresses, machine IDs, host keys, public
          addresses, and account names, then write a test that fails if any of them come back.
        </span>
      </li>
      <li>
        <span>
          Parse answers with a real YAML parser, not regular expressions, and resolve fact lookups by
          walking the data. Reference:
          <a href="https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_vars_facts.html" target="_blank" rel="noopener">Ansible facts and magic variables</a>.
        </span>
      </li>
      <li>
        <span>
          Keep the checking logic in a file with no screen access and test it with
          <code>node --test</code>. Reference:
          <a href="https://nodejs.org/api/test.html" target="_blank" rel="noopener">Node.js test runner</a>.
        </span>
      </li>
      <li>
        <span>
          Set a strict Content-Security-Policy and write output with <code>textContent</code>. Reference:
          <a href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP" target="_blank" rel="noopener">MDN Content Security Policy</a>.
        </span>
      </li>
    </ol>
  </section>

</div>
</body>
</html>
```

- [ ] **Step 2: Update the hub's project count**

In the hub `index.html`, the stat block reads:

```html
                    <span class="stat-num">15</span>
                    <span class="stat-label">Projects</span>
```

Change `15` to `16`.

- [ ] **Step 3: Add the hub card**

In the hub `index.html`, find the Glassbox card. It ends with these lines, immediately before the grid closes:

```html
                        <a href="glassbox/how-it-works.html" class="action-btn action-btn--build" target="_blank" rel="noopener noreferrer" aria-label="How this app is built" title="How It's Built">
                            📖 <span>How It's Built</span>
                        </a>
                    </div>
                </article>
            </div>

            <p id="no-results" hidden>No projects match your search.</p>
```

Insert the new card between that `</article>` and the `</div>` that follows it:

```html
                <article class="card" data-tag="Education">
                    <a href="ansible-facts-trainer/index.html" class="card-link">
                        <div class="card-visual" style="--a:#12060a;--b:#2a0d12;--c:#ff5c7c">
                            <div class="orb orb1"></div>
                            <div class="orb orb2"></div>
                            <div class="card-icon">📋</div>
                        </div>
                        <div class="card-body">
                            <div class="card-tag">Education</div>
                            <h3>Ansible Facts Trainer</h3>
                            <p>Find the fact, write the <code>debug</code> task, and see what a real run would print. Fifteen challenges checked against a real, sanitized <code>ansible_facts</code> capture.</p>
                            <span class="card-cta">Start drilling →</span>
                        </div>
                    </a>
                    <div class="card-actions">
                        <a href="https://github.com/Worldtraveler247/code_projects/tree/main/ansible-facts-trainer" class="action-btn" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" title="View source on GitHub">
                            <svg width="16" height="16" aria-hidden="true"><use href="#icon-github"/></svg>
                            <span>Source</span>
                        </a>
                        <a href="https://github1s.com/Worldtraveler247/code_projects/tree/main/ansible-facts-trainer" class="action-btn" target="_blank" rel="noopener noreferrer" aria-label="Browse code in VS Code (github1s)" title="Browse code in VS Code (github1s)">
                            <svg width="16" height="16" aria-hidden="true"><use href="#icon-code"/></svg>
                            <span>VS Code</span>
                        </a>
                        <a href="ansible-facts-trainer/how-it-works.html" class="action-btn action-btn--build" target="_blank" rel="noopener noreferrer" aria-label="How this app is built" title="How It's Built">
                            📖 <span>How It's Built</span>
                        </a>
                    </div>
                </article>
```

- [ ] **Step 4: Verify the hub**

```bash
grep -c 'class="card-body"' index.html
grep -n 'stat-num">16<' index.html
```

Expected: `16`, and one matching line.

Serve the hub (`python3 -m http.server 8765 --bind 127.0.0.1`) and open `http://127.0.0.1:8765/`. Confirm: the new card is the last in the grid; its three action links and its main link work; searching "ansible" in the hub's project search shows it; the Education filter includes it; the explainer page renders and its back link returns to the trainer. Stop the server.

- [ ] **Step 5: Final verification**

```bash
node --test 'ansible-facts-trainer/tests/*.test.mjs'
git status --short
git diff --stat main
```

Expected: 44 tests pass, 0 fail; a clean tree after the commit below; the diff touches only `ansible-facts-trainer/` and the hub `index.html`.

- [ ] **Step 6: Commit**

```bash
git add ansible-facts-trainer/how-it-works.html index.html
git commit -m "feat(hub): add Ansible Facts Trainer card and explainer page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Stop and report**

Do not push and do not merge. Report the test count, the manual checklist result, and the branch name, then ask Eddie whether to merge and push.
