# iam-auditor

A CLI that audits AWS IAM for common security risks. Built as a learning-in-public project on the way to a cloud-security engineering role.

## What it checks (today)

| ID      | Check                              | Severity |
| ------- | ---------------------------------- | -------- |
| IAM-001 | Access keys unused for 90+ days    | High     |

## Roadmap

- [ ] IAM-002: Console users without MFA
- [ ] IAM-003: Inline policies on users (should be on groups/managed)
- [ ] IAM-004: Wildcard `Action: "*"` on customer-managed policies
- [ ] IAM-005: Roles with trust policies that allow `*` principals
- [ ] IAM-006: Old passwords (>90 days) on console users
- [ ] IAM-007: Root account access keys present
- [ ] HTML report output
- [ ] `--severity-threshold` flag for CI gating
- [ ] Per-account allowlist (YAML) for accepted risks

## Install

Requires Python 3.12+.

```bash
git clone <your-repo-url>
cd iam-auditor
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

Against a real AWS account (uses your default credential chain — `AWS_PROFILE`, env vars, SSO, instance role, etc.):

```bash
iam-auditor --profile my-profile
iam-auditor --profile my-profile --format json > findings.json
iam-auditor --max-key-age-days 30
```

Exit codes (so a CI gate can tell findings apart from a broken run):

| Code | Meaning                                                        |
| ---- | ------------------------------------------------------------- |
| `0`  | Audit ran, no findings                                        |
| `1`  | Audit ran, one or more findings (fail the build)              |
| `2`  | Audit could not run — bad profile, missing creds, API denied  |

Credential, profile, and AWS API errors print a single clean line to stderr (no traceback).

## Develop

```bash
pytest                  # tests, no AWS needed (moto mocks IAM)
ruff check . && ruff format .
mypy
```

## Required IAM permissions

The runtime principal needs read-only IAM access. The smallest scope:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "iam:ListUsers",
      "iam:ListAccessKeys",
      "iam:GetAccessKeyLastUsed"
    ],
    "Resource": "*"
  }]
}
```

(`SecurityAudit` or `ReadOnlyAccess` AWS-managed policies also work.)

## Architecture

```
src/iam_auditor/
  cli.py              # argparse + wires checks → reporter
  models.py           # Finding, Severity
  checks/
    base.py           # Check ABC
    unused_access_keys.py
  reporters/
    terminal_reporter.py
    json_reporter.py
```

Each check is a class implementing `Check.run(iam_client) -> Iterator[Finding]`. To add a new check: drop a file in `checks/`, register it in `cli.py`, write tests against `moto`.
