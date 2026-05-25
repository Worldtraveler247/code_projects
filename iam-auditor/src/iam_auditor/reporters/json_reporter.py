import json
from collections.abc import Iterable
from dataclasses import asdict
from typing import TextIO

from ..models import Finding


def render_json(findings: Iterable[Finding], out: TextIO) -> None:
    out.write(json.dumps([asdict(f) for f in findings], indent=2, default=str))
    out.write("\n")
