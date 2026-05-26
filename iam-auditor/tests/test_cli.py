import json
from typing import Any

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, ProfileNotFound

from iam_auditor import cli


def _session_returning(client: Any) -> type:
    """A fake boto3.Session whose .client() hands back a pre-built (moto) client."""

    class _FakeSession:
        def __init__(self, *args: Any, **kwargs: Any) -> None: ...

        def client(self, _name: str) -> Any:
            return client

    return _FakeSession


# --- happy paths: the CLI entry point was previously untested -----------------


def test_cli_clean_account_exits_zero(iam: Any, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    monkeypatch.setattr(cli.boto3, "Session", _session_returning(iam))
    rc = cli.main(["--region", "us-east-1"])
    assert rc == cli.EXIT_OK
    assert "No findings" in capsys.readouterr().out


def test_cli_findings_exit_one(iam: Any, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    iam.create_user(UserName="ghost")
    iam.create_access_key(UserName="ghost")
    monkeypatch.setattr(cli.boto3, "Session", _session_returning(iam))
    rc = cli.main(["--max-key-age-days", "-1"])
    out = capsys.readouterr().out
    assert rc == cli.EXIT_FINDINGS
    assert "IAM-001" in out


def test_cli_json_format_is_valid_json(iam: Any, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    iam.create_user(UserName="ghost")
    iam.create_access_key(UserName="ghost")
    monkeypatch.setattr(cli.boto3, "Session", _session_returning(iam))
    rc = cli.main(["--max-key-age-days", "-1", "--format", "json"])
    data = json.loads(capsys.readouterr().out)
    assert rc == cli.EXIT_FINDINGS
    assert data[0]["check_id"] == "IAM-001"


# --- error handling: must exit EXIT_ERROR (2) with a clean message, no traceback


def test_cli_profile_not_found_exits_error(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    def _raise(*_a: Any, **_k: Any) -> Any:
        raise ProfileNotFound(profile="nope")

    monkeypatch.setattr(cli.boto3, "Session", _raise)
    rc = cli.main(["--profile", "nope"])
    err = capsys.readouterr().err
    assert rc == cli.EXIT_ERROR
    assert "nope" in err
    assert "Traceback" not in err


def test_cli_no_credentials_exits_error(iam: Any, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    class _Boom:
        def __init__(self, **_k: Any) -> None: ...

        def run(self, _client: Any) -> Any:
            raise NoCredentialsError()

    monkeypatch.setattr(cli, "UnusedAccessKeys", _Boom)
    monkeypatch.setattr(cli.boto3, "Session", _session_returning(iam))
    rc = cli.main([])
    err = capsys.readouterr().err
    assert rc == cli.EXIT_ERROR
    assert "credential" in err.lower()
    assert "Traceback" not in err


def test_cli_access_denied_exits_error(iam: Any, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    class _Boom:
        def __init__(self, **_k: Any) -> None: ...

        def run(self, _client: Any) -> Any:
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "not authorized"}},
                "ListUsers",
            )

    monkeypatch.setattr(cli, "UnusedAccessKeys", _Boom)
    monkeypatch.setattr(cli.boto3, "Session", _session_returning(iam))
    rc = cli.main([])
    err = capsys.readouterr().err
    assert rc == cli.EXIT_ERROR
    assert "AccessDenied" in err
    assert "Traceback" not in err
