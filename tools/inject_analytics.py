#!/usr/bin/env python3
"""Idempotently inject the Cloudflare Web Analytics beacon into App Hub pages.

The App Hub is a hand-authored static portfolio served via GitHub Pages. We add
a cookieless, consent-banner-free analytics beacon to every hand-authored
`index.html`. Running this script repeatedly is a no-op: it detects an existing
beacon by a stable HTML-comment marker before inserting, so it survives new
project cards being added later.

It also reconciles each page's Content-Security-Policy <meta> so the beacon is
actually allowed to load and report (script-src + connect-src). A beacon behind
a CSP that blocks it records nothing and fails silently, so the CSP check runs
on every page, including ones whose beacon is already present.

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

# Root-relative pages to track in addition to every index.html.
EXTRA_TARGETS: tuple[str, ...] = ("playground.html",)

# Match the closing body tag, case-insensitively, capturing the leading
# whitespace on its line so we can mirror the file's indentation style.
_BODY_CLOSE_RE = re.compile(r"(?im)^([ \t]*)</body>")

# Hosts the beacon needs through a page's Content-Security-Policy: the script is
# served from static.*, and it reports page views to cloudflareinsights.com.
# Injecting the <script> without these is silently useless on any page with a
# CSP — the browser blocks it and records nothing (bug fixed 2026-11-18, 5b028ba).
CSP_ALLOW: tuple[tuple[str, str], ...] = (
    ("script-src", "https://static.cloudflareinsights.com"),
    ("connect-src", "https://cloudflareinsights.com"),
)

# The CSP <meta> tag's content attribute (pages here set CSP via meta, not headers).
_CSP_META_RE = re.compile(
    r'(http-equiv=["\']Content-Security-Policy["\']\s+content=")([^"]*)(")', re.I
)


def allow_beacon_in_csp(policy: str) -> str:
    """Return `policy` with the beacon's hosts allowed. Idempotent.

    A directive set to 'none' becomes 'self' plus the host. A missing directive
    falls back to default-src in the browser, so we add it explicitly with 'self'
    to keep same-origin loads working.
    """
    parts = [p.strip() for p in policy.strip().rstrip(";").split(";") if p.strip()]
    if all(
        any(p.split()[0] == d and h in p.split() for p in parts) for d, h in CSP_ALLOW
    ):
        # Already allowed: return byte-for-byte so we never reformat a page
        # (e.g. the generated newsletter) just to normalise punctuation.
        return policy
    for directive, host in CSP_ALLOW:
        idx = next((i for i, p in enumerate(parts) if p.split()[0] == directive), None)
        if idx is None:
            after = next(
                (i + 1 for i, p in enumerate(parts) if p.split()[0] == "script-src"),
                len(parts),
            )
            parts.insert(after, f"{directive} 'self' {host}")
            continue
        tokens = parts[idx].split()
        if "'none'" in tokens:
            tokens = [directive, "'self'"]
        if host not in tokens:
            tokens.append(host)
        parts[idx] = " ".join(tokens)
    return "; ".join(parts) + ";"


def patch_csp(html: str) -> tuple[str, bool]:
    """Return (new_html, changed) with the page's CSP meta allowing the beacon.
    Pages without a CSP need nothing and come back unchanged."""
    match = _CSP_META_RE.search(html)
    if match is None:
        return html, False
    new_policy = allow_beacon_in_csp(match.group(2))
    if new_policy == match.group(2):
        return html, False
    return html[: match.start(2)] + new_policy + html[match.end(2):], True


@dataclass(frozen=True)
class Result:
    """Outcome of processing a single file."""

    path: Path
    status: str  # "patched", "skipped-present", or "error"
    detail: str = ""
    # Whether the file's effective content still carries the placeholder token.
    # Drives the "swap the real token" NOTE off real file state, not the template.
    uses_placeholder: bool = False


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
    # Tracked pages that aren't named index.html. Listed explicitly rather than
    # scanning *.html, which would also pull in the how-it-works pages.
    targets += [root / name for name in EXTRA_TARGETS if (root / name).is_file()]
    return sorted(targets)


def inject_into_text(html: str) -> tuple[str, bool]:
    """Return (new_html, changed). Idempotent: if the marker is already present,
    returns the input unchanged. Raises ValueError if there is no </body> to
    anchor against. Only inserts the <script>; see `patch_csp` for the policy."""
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
        updated, injected = inject_into_text(original)
    except ValueError as exc:
        return Result(path, "error", str(exc))
    # Always reconcile the CSP, even when the beacon was already present: a page
    # can carry the beacon yet block it, which is exactly the silent failure.
    updated, csp_changed = patch_csp(updated)

    # Effective content is what ends up on disk: the injected text if we changed
    # it, otherwise the file as-is. The NOTE keys off this real content, so a file
    # already carrying the swapped-in real token won't trigger a false warning.
    uses_placeholder = BEACON_TOKEN_PLACEHOLDER in updated

    if not (injected or csp_changed):
        return Result(path, "skipped-present", uses_placeholder=uses_placeholder)

    what = " + ".join(
        w for w, on in (("beacon", injected), ("CSP", csp_changed)) if on
    )
    if check_only:
        return Result(
            path, "patched", f"[{what}] (check mode: not written)", uses_placeholder
        )

    try:
        path.write_text(updated, encoding="utf-8")
    except OSError as exc:
        return Result(path, "error", f"write failed: {exc}")

    return Result(path, "patched", f"[{what}]", uses_placeholder)


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
        print(f"  skipped  {r.path.relative_to(root)} (beacon present, CSP allows it)")
    for r in errors:
        print(f"  ERROR    {r.path.relative_to(root)}: {r.detail}", file=sys.stderr)

    print(
        f"\nSummary: {len(patched)} patched, {len(skipped)} already present, "
        f"{len(errors)} error(s)."
    )
    placeholder_files = [r for r in results if r.uses_placeholder]
    if placeholder_files:
        print(
            f"\nNOTE: {len(placeholder_files)} file(s) still carry the placeholder "
            f"token '{BEACON_TOKEN_PLACEHOLDER}'. Replace it with the real token "
            "from the Cloudflare dashboard before expecting live data:"
        )
        for r in placeholder_files:
            print(f"  - {r.path.relative_to(root)}")

    # Non-zero exit if anything errored, so CI/automation can catch it.
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
