from collections.abc import Iterable
from typing import TextIO

from ..models import Finding


def render_terminal(findings: Iterable[Finding], out: TextIO) -> None:
    findings_list = list(findings)
    if not findings_list:
        out.write("No findings.\n")
        return
    out.write(f"Found {len(findings_list)} finding(s):\n\n")
    for f in findings_list:
        out.write(f"[{f.severity.upper()}] {f.check_id}  {f.resource}\n")
        out.write(f"    {f.title}\n")
        out.write(f"    {f.detail}\n\n")
