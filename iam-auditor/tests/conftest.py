from collections.abc import Iterator

import boto3
import pytest
from moto import mock_aws


@pytest.fixture(autouse=True)
def _aws_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stop boto3 from picking up real credentials during tests."""
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(key, "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.delenv("AWS_PROFILE", raising=False)


@pytest.fixture
def iam() -> Iterator[boto3.client]:
    with mock_aws():
        yield boto3.client("iam", region_name="us-east-1")
