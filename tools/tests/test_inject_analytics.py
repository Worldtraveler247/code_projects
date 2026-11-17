# Run: python3 -m pytest tools/tests -q
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inject_analytics as ia  # noqa: E402

SCRIPT_HOST = "https://static.cloudflareinsights.com"
CONNECT_HOST = "https://cloudflareinsights.com"


def page(csp: str | None, beacon: bool = False) -> str:
    meta = f'<meta http-equiv="Content-Security-Policy" content="{csp}">' if csp else ""
    tail = f"{ia.BEACON_TEMPLATE}\n" if beacon else ""
    return f"<html><head>{meta}</head><body>\n<p>x</p>\n{tail}</body></html>\n"


def directive(policy: str, name: str) -> list[str]:
    for part in policy.split(";"):
        tokens = part.split()
        if tokens and tokens[0] == name:
            return tokens[1:]
    raise AssertionError(f"{name} missing from {policy!r}")


def test_adds_hosts_to_existing_directives() -> None:
    out = ia.allow_beacon_in_csp("default-src 'self'; script-src 'self'; connect-src 'self';")
    assert directive(out, "script-src") == ["'self'", SCRIPT_HOST]
    assert directive(out, "connect-src") == ["'self'", CONNECT_HOST]


def test_missing_connect_src_is_added_with_self() -> None:
    # Absent connect-src inherits default-src 'self'; we must keep 'self' when adding it.
    out = ia.allow_beacon_in_csp("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'")
    assert directive(out, "connect-src") == ["'self'", CONNECT_HOST]
    assert directive(out, "script-src") == ["'self'", "'wasm-unsafe-eval'", SCRIPT_HOST]


def test_none_directive_is_replaced_not_appended() -> None:
    # "'none' https://x" is invalid CSP — 'none' must be the only source.
    out = ia.allow_beacon_in_csp("default-src 'self'; script-src 'none'")
    assert directive(out, "script-src") == ["'self'", SCRIPT_HOST]


def test_policy_patch_is_idempotent() -> None:
    once = ia.allow_beacon_in_csp("default-src 'self'; script-src 'self'")
    assert ia.allow_beacon_in_csp(once) == once


def test_already_allowed_policy_is_returned_byte_for_byte() -> None:
    # No trailing ';' and odd spacing — must not be "normalised" into a diff.
    policy = f"default-src 'self';  script-src 'self' {SCRIPT_HOST}; connect-src 'self' {CONNECT_HOST}"
    assert ia.allow_beacon_in_csp(policy) is policy


def test_page_without_csp_is_untouched() -> None:
    html = page(None)
    assert ia.patch_csp(html) == (html, False)


def test_beacon_present_but_blocked_gets_csp_fixed(tmp_path: Path) -> None:
    """The regression: marker present, CSP blocks it — must NOT be reported as skipped."""
    f = tmp_path / "index.html"
    f.write_text(page("default-src 'self'; script-src 'self'", beacon=True))
    r = ia.process_file(f, check_only=False)
    assert r.status == "patched" and "CSP" in r.detail and "beacon" not in r.detail
    assert SCRIPT_HOST in f.read_text()
    assert ia.process_file(f, check_only=False).status == "skipped-present"


def test_new_page_gets_beacon_and_csp(tmp_path: Path) -> None:
    f = tmp_path / "index.html"
    f.write_text(page("default-src 'self'; script-src 'self'"))
    r = ia.process_file(f, check_only=False)
    assert r.detail == "[beacon + CSP]"
    text = f.read_text()
    assert text.count(ia.BEACON_MARKER) == 1 and CONNECT_HOST in text


def test_check_mode_writes_nothing(tmp_path: Path) -> None:
    f = tmp_path / "index.html"
    original = page("default-src 'self'; script-src 'self'")
    f.write_text(original)
    assert ia.process_file(f, check_only=True).status == "patched"
    assert f.read_text() == original


@pytest.mark.parametrize("bad", ["<html><body>no close tag", ""])
def test_missing_body_is_an_error_not_a_crash(tmp_path: Path, bad: str) -> None:
    f = tmp_path / "index.html"
    f.write_text(bad)
    assert ia.process_file(f, check_only=False).status == "error"
