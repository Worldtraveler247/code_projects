#!/usr/bin/env python3
"""Reference oracle for tests/jinja-differential.test.mjs.

Reads {"variables": {...}, "expressions": [...]} on stdin and renders each expression with
the real Ansible templating engine, embedded in text ("<{{ expr }}>") so the result is always
a string. Writes a JSON list of {"ok": true, "text": ...} or {"ok": false, "error": ...}.
"""
from __future__ import annotations

import json
import sys

from ansible.parsing.dataloader import DataLoader
from ansible.template import Templar

try:  # ansible-core 2.19+ only renders strings that are marked as trusted templates.
    from ansible.template import trust_as_template
except ImportError:  # older ansible-core renders any string
    def trust_as_template(text: str) -> str:
        return text


def main() -> int:
    job = json.load(sys.stdin)
    templar = Templar(loader=DataLoader(), variables=job["variables"])
    results: list[dict[str, object]] = []
    for expression in job["expressions"]:
        try:
            text = templar.template(trust_as_template("<{{ " + expression + " }}>"))
            results.append({"ok": True, "text": str(text)})
        except Exception as exc:  # noqa: BLE001 - any failure is a legitimate oracle answer
            results.append({"ok": False, "error": f"{type(exc).__name__}: {exc}"[:200]})
    json.dump(results, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
