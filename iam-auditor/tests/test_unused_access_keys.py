from datetime import UTC, datetime, timedelta
from typing import Any

from iam_auditor.checks.unused_access_keys import UnusedAccessKeys


def _frozen(now: datetime):
    def _now() -> datetime:
        return now

    return _now


def test_no_users_no_findings(iam: Any) -> None:
    findings = list(UnusedAccessKeys().run(iam))
    assert findings == []


def test_recent_key_not_flagged(iam: Any) -> None:
    iam.create_user(UserName="alice")
    iam.create_access_key(UserName="alice")
    findings = list(UnusedAccessKeys().run(iam))
    assert findings == []


def test_old_unused_key_is_flagged(iam: Any) -> None:
    iam.create_user(UserName="bob")
    iam.create_access_key(UserName="bob")
    # moto stamps CreateDate at "now". Pretend "now" is 200 days later.
    future = datetime.now(UTC) + timedelta(days=200)
    check = UnusedAccessKeys(max_age_days=90, now=_frozen(future))

    findings = list(check.run(iam))

    assert len(findings) == 1
    assert "user/bob/key/" in findings[0].resource
    assert findings[0].check_id == "IAM-001"
    assert "never used" in findings[0].detail


def test_threshold_boundary(iam: Any) -> None:
    iam.create_user(UserName="carol")
    iam.create_access_key(UserName="carol")
    # 89 days later — under the 90-day threshold, no finding.
    near_future = datetime.now(UTC) + timedelta(days=89)
    check = UnusedAccessKeys(max_age_days=90, now=_frozen(near_future))
    assert list(check.run(iam)) == []
