import argparse
import sys
from collections.abc import Sequence

import boto3
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    ProfileNotFound,
)

from .checks.base import Check
from .checks.unused_access_keys import UnusedAccessKeys
from .models import Finding
from .reporters.json_reporter import render_json
from .reporters.terminal_reporter import render_terminal

# Distinct exit codes so a CI gate can tell "IAM has findings" apart from
# "the auditor itself failed to run" — both used to collapse to 1.
EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_ERROR = 2


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

    try:
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        iam = session.client("iam")
        checks: list[Check] = [UnusedAccessKeys(max_age_days=args.max_key_age_days)]
        # Materialize inside the try so lazy API calls surface here, not later.
        findings: list[Finding] = [f for check in checks for f in check.run(iam)]
    except ProfileNotFound as exc:
        print(f"iam-auditor: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except NoCredentialsError:
        print(
            "iam-auditor: no AWS credentials found. Configure a profile, env vars, "
            "or an instance/role credential source.",
            file=sys.stderr,
        )
        return EXIT_ERROR
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "Unknown")
        print(f"iam-auditor: AWS API error [{code}]: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except BotoCoreError as exc:
        # Catch-all for connection/endpoint/config errors from botocore.
        print(f"iam-auditor: AWS error: {exc}", file=sys.stderr)
        return EXIT_ERROR

    if args.format == "json":
        render_json(findings, sys.stdout)
    else:
        render_terminal(findings, sys.stdout)

    return EXIT_FINDINGS if findings else EXIT_OK
