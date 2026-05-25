import argparse
import sys
from collections.abc import Sequence

import boto3

from .checks.base import Check
from .checks.unused_access_keys import UnusedAccessKeys
from .models import Finding
from .reporters.json_reporter import render_json
from .reporters.terminal_reporter import render_terminal


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iam-auditor",
        description="Audit AWS IAM for common security risks.",
    )
    parser.add_argument("--profile", help="AWS named profile to use")
    parser.add_argument("--region", default="us-east-1", help="AWS region (default: us-east-1)")
    parser.add_argument(
        "--format",
        choices=["terminal", "json"],
        default="terminal",
        help="Output format (default: terminal)",
    )
    parser.add_argument(
        "--max-key-age-days",
        type=int,
        default=90,
        help="Flag access keys idle longer than this (default: 90)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    iam = session.client("iam")

    checks: list[Check] = [UnusedAccessKeys(max_age_days=args.max_key_age_days)]
    findings: list[Finding] = [f for check in checks for f in check.run(iam)]

    if args.format == "json":
        render_json(findings, sys.stdout)
    else:
        render_terminal(findings, sys.stdout)

    return 1 if findings else 0
