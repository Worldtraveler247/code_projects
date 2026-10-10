#!/usr/bin/env python3
"""Sanitize an `ansible -m setup` capture and emit facts.js for the trainer.

Usage:
    python3 sanitize_facts.py RAW_CAPTURE OUT_JS --user REAL_USERNAME

Writes OUT_JS (the facts as a playbook sees them) and, beside it, setup-output.js
(the same data as the text `ansible HOST -m setup` prints).

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
from typing import Any, Callable

MAC_ANY_RE = re.compile(r"\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b", re.IGNORECASE)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
LVM_ID_RE = re.compile(r"\bLVM-[A-Za-z0-9]{32,}")
LVM_PV_RE = re.compile(r"\blvm-pv-uuid-[A-Za-z0-9-]+")
FAT_ID_RE = re.compile(r"[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}")
UUID_KEYS = {"uuid", "uuids"}
IPV6_TOKEN_RE = re.compile(r"(?<![0-9A-Fa-f:.])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![0-9A-Fa-f:.])")
# Keys whose values identify hardware: product/board/chassis serials, disk serials,
# WWNs, iSCSI names, and the DMI product UUID.
HARDWARE_KEY_RE = re.compile(r"(?:^|_)(?:serial|wwn|wwid|iqn)$|_uuid$")
BLANK_VALUES = {"", "NA", "N/A"}
# /dev/disk/by-id names embed the drive's model and serial.
DEVICE_ID_RE = re.compile(r"^(ata|scsi|wwn|nvme|usb|virtio|mmc|sas|ieee1394)-")
PLACEHOLDER_MACHINE_ID = "0123456789abcdef0123456789abcdef"
PLACEHOLDER_UUID = "00000000-0000-4000-8000-000000000001"
PLACEHOLDER_DNS = "192.0.2.53"
PLACEHOLDER_IPV6 = "2001:db8::53"
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


def eui64_id(mac: str) -> int:
    """Return the 64-bit IPv6 interface id derived from a MAC (modified EUI-64)."""
    b = [int(part, 16) for part in mac.split(":")]
    b[0] ^= 0x02
    return int.from_bytes(bytes([b[0], b[1], b[2], 0xFF, 0xFE, b[3], b[4], b[5]]), "big")


def mac_forms(mac: str) -> dict[str, str]:
    """Colon, hyphen, and bare-hex spellings of one MAC, keyed by separator."""
    return {":": mac, "-": mac.replace(":", "-"), "": mac.replace(":", "")}


def replace_identifiers(facts: dict[str, Any], user: str) -> tuple[dict[str, Any], dict[int, int]]:
    """Swap MACs and the username across the whole document.

    Returns the cleaned facts and a map of real -> placeholder IPv6 interface ids,
    which scrub_leaf uses to rewrite MAC-derived addresses in any spelling.
    """
    text = json.dumps(facts)
    found = {m.lower().replace("-", ":") for m in MAC_ANY_RE.findall(text)}
    real_macs = sorted(found - {ZERO_MAC})
    interface_ids: dict[int, int] = {}
    for index, mac in enumerate(real_macs, start=1):
        new_mac = f"00:00:5e:00:53:{index:02x}"
        interface_ids[eui64_id(mac)] = eui64_id(new_mac)
        new_forms = mac_forms(new_mac)
        for separator, spelling in mac_forms(mac).items():
            text = re.sub(re.escape(spelling), new_forms[separator], text, flags=re.IGNORECASE)
    # Substring and case-insensitive: a word-boundary match would miss "user_archive",
    # and a case-sensitive one would miss "User".
    text = re.sub(re.escape(user), PLACEHOLDER_USER, text, flags=re.IGNORECASE)
    # The same real id maps to the same placeholder everywhere, so cross-references
    # between mounts, devices, and device_links still line up. 01 is kept for hostnqn.
    text = number_matches(UUID_RE, text, lambda n: f"00000000-0000-4000-8000-{n + 1:012x}")
    text = number_matches(LVM_ID_RE, text, lambda n: f"LVM-PLACEHOLDER{n:02d}")
    text = number_matches(LVM_PV_RE, text, lambda n: f"lvm-pv-uuid-PLACEHOLDER{n:02d}")
    return json.loads(text), interface_ids


def number_matches(pattern: re.Pattern[str], text: str, make: Callable[[int], str]) -> str:
    """Replace each distinct match with a numbered placeholder, consistently."""
    seen: dict[str, str] = {}

    def swap(match: re.Match[str]) -> str:
        key = match.group(0).lower() if pattern is UUID_RE else match.group(0)
        if key not in seen:
            seen[key] = make(len(seen) + 1)
        return seen[key]

    return pattern.sub(swap, text)


def scrub_ipv4_token(match: re.Match[str]) -> str:
    try:
        return PLACEHOLDER_DNS if ipaddress.ip_address(match.group(0)).is_global else match.group(0)
    except ValueError:
        return match.group(0)


def rewrite_ipv6(ip: ipaddress.IPv6Address, interface_ids: dict[int, int]) -> str | None:
    """Return a replacement for an identifying IPv6 address, or None to keep it."""
    if ip.is_global:
        return PLACEHOLDER_IPV6
    # Compare by value, not by text, so compressed, expanded, and upper-case
    # spellings of a MAC-derived address are all caught.
    low = int(ip) & 0xFFFF_FFFF_FFFF_FFFF
    if low in interface_ids:
        # ipaddress accepts a zone suffix ("fe80::1%eth0"); keep it on the rewrite.
        zone = f"%{ip.scope_id}" if ip.scope_id else ""
        return f"{ipaddress.IPv6Address((int(ip) >> 64 << 64) | interface_ids[low])}{zone}"
    if ip.is_link_local and low > 0xFFFF and low not in interface_ids.values():
        # A stable-privacy address is unique to the host; fe80::1 and fe80::2 are not.
        return PLACEHOLDER_LINK_LOCAL
    return None


def scrub_leaf(value: str, interface_ids: dict[int, int]) -> str:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        # Not a bare address: replace addresses embedded in longer text, such as
        # "fe80::1%eth0", "fd00::1/64", or "203.0.113.9 50000 10.0.0.5 22".
        def swap_ipv6(match: re.Match[str]) -> str:
            try:
                token = ipaddress.IPv6Address(match.group(0))
            except ValueError:
                return match.group(0)
            return rewrite_ipv6(token, interface_ids) or match.group(0)

        return IPV6_TOKEN_RE.sub(swap_ipv6, IPV4_RE.sub(scrub_ipv4_token, value))
    if isinstance(ip, ipaddress.IPv4Address):
        return PLACEHOLDER_DNS if ip.is_global else value
    return rewrite_ipv6(ip, interface_ids) or value


def scrub_tree(node: Any, interface_ids: dict[int, int], fat_ids: dict[str, str], context: str = "") -> Any:
    """Walk the document. `context` is "uuid" or "ids" beneath those keys, else ""."""
    if isinstance(node, dict):
        cleaned: dict[str, Any] = {}
        for key, child in node.items():
            if HARDWARE_KEY_RE.search(key) and key not in UUID_KEYS:
                if isinstance(child, str):
                    cleaned[key] = child if child in BLANK_VALUES else "NA"
                    continue
                if isinstance(child, list):
                    cleaned[key] = []
                    continue
            child_context = "uuid" if key in UUID_KEYS else "ids" if key == "ids" else context
            cleaned[key] = scrub_tree(child, interface_ids, fat_ids, child_context)
        return cleaned
    if isinstance(node, list):
        return [scrub_tree(child, interface_ids, fat_ids, context) for child in node]
    if isinstance(node, str):
        # FAT volumes carry an 8-hex-digit id, not a full UUID. The pattern is too
        # loose to apply everywhere, so it is applied only beneath uuid keys.
        if context == "uuid" and FAT_ID_RE.fullmatch(node):
            return fat_ids.setdefault(node.upper(), f"0000-{len(fat_ids) + 1:04X}")
        if context == "ids" and (match := DEVICE_ID_RE.match(node)):
            return f"{match.group(1)}-PLACEHOLDER"
        return scrub_leaf(node, interface_ids)
    return node


def scrub_fields(facts: dict[str, Any]) -> None:
    if "ansible_user_gecos" in facts:
        facts["ansible_user_gecos"] = ""
    if "ansible_machine_id" in facts:
        facts["ansible_machine_id"] = PLACEHOLDER_MACHINE_ID
    if isinstance(facts.get("ansible_hostnqn"), str):
        facts["ansible_hostnqn"] = UUID_RE.sub(PLACEHOLDER_UUID, facts["ansible_hostnqn"])
    for key in facts:
        if re.fullmatch(r"ansible_ssh_host_key_(\w+)_public", key):
            kind = key.removeprefix("ansible_ssh_host_key_").removesuffix("_public").upper()
            facts[key] = f"AAAA{kind}PLACEHOLDERKEYNOTREAL"


def strip_prefix(facts: dict[str, Any]) -> dict[str, Any]:
    """Mirror Ansible's namespace_facts: every key loses ansible_ except ansible_local."""
    return {key if key == "ansible_local" else key.removeprefix("ansible_"): value for key, value in facts.items()}


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

    facts, interface_ids = replace_identifiers(facts, args.user)
    facts = scrub_tree(facts, interface_ids, {})
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
    # The same sanitized data, formatted the way `ansible HOST -m setup` prints it:
    # prefixed keys, sorted, four-space indent, Python number formatting.
    setup_text = f"{host} | SUCCESS => " + json.dumps(
        {"ansible_facts": facts, "changed": False}, indent=4, sort_keys=True, ensure_ascii=False
    )
    setup_path = args.out.with_name("setup-output.js")
    setup_path.write_text(
        "// Generated by tools/sanitize_facts.py: the sanitized capture as `ansible HOST -m setup` prints it.\n"
        "// Do not edit by hand; re-run the sanitizer.\n"
        f"export const SETUP_OUTPUT = {json.dumps(setup_text, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out} and {setup_path.name} ({len(clean)} top-level facts, host {host})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
