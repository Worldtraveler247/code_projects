from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from ..models import Finding, Severity
from .base import Check


def _utcnow() -> datetime:
    return datetime.now(UTC)


class UnusedAccessKeys(Check):
    check_id = "IAM-001"
    title = "Access key unused beyond age threshold"

    def __init__(
        self,
        max_age_days: int = 90,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.max_age_days = max_age_days
        self._now = now or _utcnow

    def run(self, iam_client: Any) -> Iterator[Finding]:
        threshold = self._now() - timedelta(days=self.max_age_days)
        for page in iam_client.get_paginator("list_users").paginate():
            for user in page["Users"]:
                yield from self._check_user(iam_client, user["UserName"], threshold)

    def _check_user(self, iam_client: Any, username: str, threshold: datetime) -> Iterator[Finding]:
        keys = iam_client.list_access_keys(UserName=username)["AccessKeyMetadata"]
        for key in keys:
            key_id = key["AccessKeyId"]
            last_used_resp = iam_client.get_access_key_last_used(AccessKeyId=key_id)
            last_used_date = last_used_resp.get("AccessKeyLastUsed", {}).get("LastUsedDate")
            last_active = last_used_date or key["CreateDate"]
            if last_active >= threshold:
                continue
            days_idle = (self._now() - last_active).days
            note = "never used" if last_used_date is None else f"last used {days_idle} days ago"
            yield Finding(
                check_id=self.check_id,
                severity=Severity.HIGH,
                resource=f"user/{username}/key/{key_id}",
                title=self.title,
                detail=f"Access key {note}; threshold is {self.max_age_days} days.",
            )
