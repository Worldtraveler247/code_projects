#!/usr/bin/env python3
"""Idempotently inject the Cloudflare Web Analytics beacon into App Hub pages.

The App Hub is a hand-authored static portfolio served via GitHub Pages. We add
a cookieless, consent-banner-free analytics beacon to every hand-authored
`index.html`. Running this script repeatedly is a no-op: it detects an existing
beacon by a stable HTML-comment marker before inserting, so it survives new
project cards being added later.

Scope decisions (see module-level constants below):
  - We track the root hub page plus each hand-authored project's index.html.
  - We EXCLUDE machine-generated output: the Next.js export under
    `mathpath-to-ai/` (a `next build` would overwrite any beacon we inject —
    analytics for that app belongs in its source layout, not the export) and
    anything under `.venv/`, `node_modules/`, `_next/`, or `.git/`.

Usage:
    python3 tools/inject_analytics.py            # patch the tree
    python3 tools/inject_analytics.py --check     # report only, change nothing
    python3 tools/inject_analytics.py --root /path/to/code_projects

Swap the placeholder token (CF_BEACON_TOKEN) for the real one from the
Cloudflare dashboard before this provides live data — see the marker constant.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# A stable, unique marker that identifies a beacon WE injected. Idempotency
# hinges on this string: we grep for it before inserting. It must never change
# between runs, or re-runs would duplicate the beacon. We deliberately key off
# this comment rather than the script src or the token, so the check still holds
# after Eddie swaps the placeholder token for the real one.
BEACON_MARKER = "<!-- cf-web-analytics (managed by tools/inject_analytics.py) -->"

# Placeholder token. Eddie provisions the real value in the Cloudflare dashboard
# (Web Analytics -> his site -> the JS snippet) and swaps it in afterward. The
# placeholder is safe to commit because it is not a secret and not functional.
BEACON_TOKEN_PLACEHOLDER = "CF_BEACON_TOKEN"

# The snippet inserted immediately before </body>. The leading marker comment is
# load-bearing for idempotency. Indentation is normalized at insertion time to
# match the file's </body> line, so this template is unindented.
BEACON_TEMPLATE = (
    f"{BEACON_MARKER}\n"
    '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
    f"data-cf-beacon='{{\"token\": \"{BEACON_TOKEN_PLACEHOLDER}\"}}'></script>"
)

# Directory names that mark machine-generated or non-deployed trees. Any target
# whose path contains one of these (as a path segment) is skipped.
EXCLUDED_DIR_SEGMENTS: frozenset[str] = frozenset(
    {".git", "node_modules", ".venv", "venv", "_next", "mathpath-to-ai"}
)

# Match the closing body tag, case-insensitively, capturing the leading
# whitespace on its line so we can mirror the file's indentation style.
_BODY_CLOSE_RE = re.compile(r"(?im)^([ \t]*)</body>")


@dataclass(frozen=True)
class Result:
    """Outcome of processing a single file."""

    path: Path
    status: str  # "patched", "skipped-present", or "error"
    detail: str = ""


def find_target_files(root: Path) -> list[Path]:
    """Return every hand-authored index.html under `root`, sorted, excluding
    machine-generated and non-deployed trees."""
    targets: list[Path] = []
    for path in root.rglob("index.html"):
        # rglob yields files; guard against a directory literally named index.html.
        if not path.is_file():
            continue
        rel_parts = set(path.relative_to(root).parts)
        if rel_parts & EXCLUDED_DIR_SEGMENTS:
            continue
        targets.append(path)
    return sorted(targets)


def inject_into_text(html: str) -> tuple[str, bool]:
    """Return (new_html, changed). Idempotent: if the marker is already present,
    returns the input unchanged. Raises ValueError if there is no </body> to
    anchor against."""
    if BEACON_MARKER in html:
        return html, False

    match = _BODY_CLOSE_RE.search(html)
    if match is None:
        raise ValueError("no </body> tag found")

    indent = match.group(1)
    # Indent every line of the snippet to match the </body> line, so the output
    # respects each file's existing style (some pages use 4-space, some 2-space).
    snippet = "\n".join(
        f"{indent}{line}" if line else line for line in BEACON_TEMPLATE.splitlines()
    )
    # Insert the snippet on its own line directly before </body>.
    insertion = f"{snippet}\n{match.group(0)}"
    new_html = html[: match.start()] + insertion + html[match.end():]
    return new_html, True


def process_file(path: Path, *, check_only: bool) -> Result:
    """Read, (maybe) inject, and write back a single file. Never raises for
    expected conditions — returns a Result describing what happened."""
    try:
        original = path.read_text(encoding="utf-8")
    except OSError as exc:
        return Result(path, "error", f"read failed: {exc}")
    except UnicodeDecodeError as exc:
        return Result(path, "error", f"not valid UTF-8: {exc}")

    try:
        updated, changed = inject_into_text(original)
    except ValueError as exc:
        return Result(path, "error", str(exc))

    if not changed:
        return Result(path, "skipped-present")

    if check_only:
        return Result(path, "patched", "(check mode: not written)")

    try:
        path.write_text(updated, encoding="utf-8")
    except OSError as exc:
        return Result(path, "error", f"write failed: {exc}")

    return Result(path, "patched")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="App Hub repo root (default: parent of this script's directory).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Report what would change without writing any files.",
    )
    args = parser.parse_args(argv)

    root: Path = args.root.resolve()
    if not (root / "index.html").is_file():
        print(
            f"error: {root} does not look like the App Hub root "
            "(no index.html found there).",
            file=sys.stderr,
        )
        return 2

    targets = find_target_files(root)
    if not targets:
        print(f"error: no target index.html files found under {root}.", file=sys.stderr)
        return 2

    results = [process_file(p, check_only=args.check) for p in targets]

    patched = [r for r in results if r.status == "patched"]
    skipped = [r for r in results if r.status == "skipped-present"]
    errors = [r for r in results if r.status == "error"]

    mode = "CHECK (no files written)" if args.check else "APPLY"
    print(f"Cloudflare beacon injection — {mode}")
    print(f"  root: {root}")
    print(f"  scanned: {len(results)} file(s)\n")

    for r in patched:
        suffix = f" {r.detail}" if r.detail else ""
        print(f"  PATCHED  {r.path.relative_to(root)}{suffix}")
    for r in skipped:
        print(f"  skipped  {r.path.relative_to(root)} (beacon already present)")
    for r in errors:
        print(f"  ERROR    {r.path.relative_to(root)}: {r.detail}", file=sys.stderr)

    print(
        f"\nSummary: {len(patched)} patched, {len(skipped)} already present, "
        f"{len(errors)} error(s)."
    )
    if BEACON_TOKEN_PLACEHOLDER in BEACON_TEMPLATE:
        print(
            f"\nNOTE: beacon still uses the placeholder token "
            f"'{BEACON_TOKEN_PLACEHOLDER}'. Replace it with the real token from "
            "the Cloudflare dashboard before expecting live data."
        )

    # Non-zero exit if anything errored, so CI/automation can catch it.
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
