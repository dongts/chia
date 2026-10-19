#!/usr/bin/env python3
"""Read-only verification of a Chia preview against a private snapshot."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import stat
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "cloudflare" / "src"))
from shared.balances import calculate_balances  # noqa: E402


DEFAULT_BASE_URL = "https://chia.dongts1201.workers.dev"


def _decimal_rows(rows: list[dict], *fields: str) -> list[dict]:
    result = []
    for source in rows:
        row = dict(source)
        for field in fields:
            if row.get(field) is not None:
                row[field] = Decimal(row[field])
        result.append(row)
    return result


def verify_offline(snapshot: dict[str, Any]) -> dict[str, int]:
    """Recalculate every private group and fund baseline without API filtering."""
    tables = snapshot["tables"]
    members = _decimal_rows(tables["group_members"]["rows"], "initial_balance")
    expenses = _decimal_rows(tables["expenses"]["rows"], "converted_amount")
    splits = _decimal_rows(tables["expense_splits"]["rows"], "resolved_amount")
    deductions = _decimal_rows(tables["expense_fund_deductions"]["rows"], "amount")
    settlements = _decimal_rows(tables["settlements"]["rows"], "amount")

    group_count = 0
    for baseline in snapshot["balances"]["groups"]:
        group_id = baseline["group_id"]
        group_expenses = [row for row in expenses if row["group_id"] == group_id]
        expense_ids = {row["id"] for row in group_expenses}
        actual = calculate_balances(
            [row for row in members if row["group_id"] == group_id],
            group_expenses,
            [row for row in splits if row["expense_id"] in expense_ids],
            [row for row in deductions if row["expense_id"] in expense_ids],
            [row for row in settlements if row["group_id"] == group_id],
        )
        expected = {
            row["member_id"]: Decimal(row["balance"])
            for row in baseline["members"]
        }
        if actual != expected:
            raise ValueError("group balance mismatch in offline verification")
        group_count += 1

    transactions = _decimal_rows(tables["fund_transactions"]["rows"], "amount")
    fund_count = 0
    for baseline in snapshot["balances"]["funds"]:
        balance = Decimal("0")
        for transaction in transactions:
            if transaction["fund_id"] != baseline["fund_id"]:
                continue
            if transaction["type"] == "contribute":
                balance += transaction["amount"]
            elif transaction["type"] in {"withdraw", "expense"}:
                balance -= transaction["amount"]
        if balance != Decimal(baseline["balance"]):
            raise ValueError("fund balance mismatch in offline verification")
        fund_count += 1
    return {"groups": group_count, "funds": fund_count}


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _access_token(secret: str, user_id: str) -> str:
    header = _base64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _base64url(json.dumps({"sub": user_id, "exp": int(time.time()) + 3600,
                                     "type": "access"}, separators=(",", ":")).encode())
    message = f"{header}.{payload}"
    signature = _base64url(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())
    return f"{message}.{signature}"


def _request(url: str, *, token: str | None = None) -> bytes:
    headers = {"User-Agent": "chia-migration-verifier/1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"preview request failed with HTTP {error.code}") from error


def _request_json(url: str, *, token: str | None = None) -> Any:
    return json.loads(_request(url, token=token))


def verify_api(snapshot: dict[str, Any], base_url: str, jwt_secret: str) -> dict[str, int]:
    """Compare all API-accessible member and active-fund balances exactly."""
    base_url = base_url.rstrip("/")
    groups = {row["id"]: row for row in snapshot["tables"]["groups"]["rows"]}
    members = snapshot["tables"]["group_members"]["rows"]
    funds = {row["id"]: row for row in snapshot["tables"]["funds"]["rows"]}
    fund_baselines = {row["fund_id"]: Decimal(row["balance"])
                      for row in snapshot["balances"]["funds"]}
    checked_groups = checked_members = checked_funds = 0
    for baseline in snapshot["balances"]["groups"]:
        group_id = baseline["group_id"]
        if groups[group_id]["is_deleted"]:
            continue
        actor = next((row["user_id"] for row in members
                      if row["group_id"] == group_id and row["is_active"] and row["user_id"]), None)
        if not actor:
            continue
        token = _access_token(jwt_secret, actor)
        actual_rows = _request_json(f"{base_url}/api/v1/groups/{group_id}/balances", token=token)
        actual = {row["member_id"]: Decimal(row["balance"]) for row in actual_rows}
        expected = {row["member_id"]: Decimal(row["balance"]) for row in baseline["members"]}
        if actual != expected:
            raise ValueError("member balance mismatch in preview API verification")

        actual_funds = _request_json(f"{base_url}/api/v1/groups/{group_id}/funds", token=token)
        expected_ids = {fund_id for fund_id, fund in funds.items()
                        if fund["group_id"] == group_id and fund["is_active"]}
        if {row["id"] for row in actual_funds} != expected_ids:
            raise ValueError("active fund set mismatch in preview API verification")
        for fund in actual_funds:
            if Decimal(fund["balance"]) != fund_baselines[fund["id"]]:
                raise ValueError("fund balance mismatch in preview API verification")
        checked_groups += 1
        checked_members += len(actual)
        checked_funds += len(actual_funds)
    return {"groups": checked_groups, "members": checked_members, "funds": checked_funds,
            "inaccessible_groups": len(snapshot["balances"]["groups"]) - checked_groups,
            "inaccessible_funds": len(snapshot["balances"]["funds"]) - checked_funds}


def verify_uploads(archive_path: Path, base_url: str) -> int:
    """Compare every regular archived upload with its public preview bytes."""
    checked = 0
    with tarfile.open(archive_path) as archive:
        for member in archive:
            if not member.isfile():
                continue
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("upload archive member cannot be read")
            name = member.name.removeprefix("./")
            remote = _request(base_url.rstrip("/") + "/uploads/" + urllib.parse.quote(name, safe="/"))
            if hashlib.sha256(remote).digest() != hashlib.sha256(source.read()).digest():
                raise ValueError("upload byte mismatch in preview verification")
            checked += 1
    return checked


def _private_json(path: Path) -> dict[str, Any]:
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise ValueError("secrets file must not be accessible by group or others")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-dir", type=Path, required=True)
    parser.add_argument("--secrets-file", type=Path,
                        help="mode-600 JSON containing CHIA_JWT_SECRET")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--offline-only", action="store_true")
    parser.add_argument("--skip-uploads", action="store_true")
    args = parser.parse_args(argv)
    snapshot = json.loads((args.snapshot_dir / "data.json").read_text(encoding="utf-8"))
    offline = verify_offline(snapshot)
    print(f"offline exact: {offline['groups']} groups, {offline['funds']} funds")
    if args.offline_only:
        return 0
    if args.secrets_file is None:
        parser.error("--secrets-file is required unless --offline-only is used")
    secrets = _private_json(args.secrets_file)
    secret = secrets.get("CHIA_JWT_SECRET")
    if not isinstance(secret, str) or not secret:
        raise ValueError("secrets file is missing CHIA_JWT_SECRET")
    api = verify_api(snapshot, args.base_url, secret)
    print(f"API exact: {api['groups']} groups, {api['members']} member balances, {api['funds']} funds")
    print(f"covered offline only: {api['inaccessible_groups']} groups, {api['inaccessible_funds']} funds")
    if not args.skip_uploads:
        uploads = verify_uploads(args.snapshot_dir / "uploads.tar", args.base_url)
        print(f"uploads exact: {uploads} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
