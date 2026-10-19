#!/usr/bin/env python3
"""Export a read-only Chia database snapshot or build its local manifest.

The export command is designed to be piped to ``python -`` in the production
backend container. It writes only JSON to stdout so the caller can stream the
snapshot directly into a private local file.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Iterable


EXPECTED_TABLES = (
    "categories",
    "expense_fund_deductions",
    "expense_logs",
    "expense_splits",
    "expenses",
    "fund_transactions",
    "funds",
    "group_currencies",
    "group_member_logs",
    "group_members",
    "group_payment_methods",
    "groups",
    "notifications",
    "payment_methods",
    "settlements",
    "system_config",
    "user_oauth",
    "users",
)


def json_compatible(value: Any) -> Any:
    """Convert database values to deterministic, lossless JSON values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return json_compatible(value.value)
    if isinstance(value, bytes):
        return {
            "encoding": "base64",
            "data": base64.b64encode(value).decode("ascii"),
        }
    if isinstance(value, dict):
        return {str(key): json_compatible(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_compatible(item) for item in value]
    raise TypeError(f"Unsupported database value type: {type(value).__name__}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(root: Path, artifact_names: Iterable[str]) -> dict[str, Any]:
    """Validate the JSON snapshot and describe the private artifact set."""
    root = Path(root)
    snapshot_path = root / "data.json"
    with snapshot_path.open(encoding="utf-8") as source:
        snapshot = json.load(source)

    actual_tables = set(snapshot.get("tables", {}))
    expected_tables = set(EXPECTED_TABLES)
    missing = sorted(expected_tables - actual_tables)
    unexpected = sorted(actual_tables - expected_tables)
    if missing:
        raise ValueError(f"snapshot is missing application tables: {', '.join(missing)}")
    if unexpected:
        raise ValueError(f"snapshot has unexpected application tables: {', '.join(unexpected)}")

    table_counts: dict[str, int] = {}
    for table_name in EXPECTED_TABLES:
        table = snapshot["tables"][table_name]
        row_count = table.get("row_count")
        rows = table.get("rows")
        if not isinstance(row_count, int) or not isinstance(rows, list):
            raise ValueError(f"invalid table payload: {table_name}")
        if row_count != len(rows):
            raise ValueError(f"row count mismatch for table: {table_name}")
        table_counts[table_name] = row_count

    files: dict[str, dict[str, Any]] = {}
    for artifact_name in artifact_names:
        if Path(artifact_name).name != artifact_name:
            raise ValueError(f"artifact name must be a basename: {artifact_name}")
        artifact_path = root / artifact_name
        files[artifact_name] = {
            "bytes": artifact_path.stat().st_size,
            "sha256": _sha256(artifact_path),
        }

    return {
        "format_version": snapshot.get("format_version"),
        "database": snapshot.get("database", {}),
        "table_counts": table_counts,
        "balance_counts": {
            "groups": len(snapshot.get("balances", {}).get("groups", [])),
            "funds": len(snapshot.get("balances", {}).get("funds", [])),
        },
        "files": files,
    }


def _sqlite_type(column_type: Any) -> str:
    """Map a SQLAlchemy PostgreSQL column type to SQLite affinity."""
    from sqlalchemy import Boolean, Date, DateTime, Float, Integer, LargeBinary, Numeric

    if isinstance(column_type, Boolean):
        return "INTEGER"
    if isinstance(column_type, Integer):
        return "INTEGER"
    if isinstance(column_type, (Numeric, Float)):
        # Decimal values remain strings in JSON; migration code must parse them.
        return "NUMERIC"
    if isinstance(column_type, LargeBinary):
        return "BLOB"
    if isinstance(column_type, (Date, DateTime)):
        return "TEXT"
    return "TEXT"


def _inspect_schema(sync_connection: Any, table_names: tuple[str, ...]) -> dict[str, Any]:
    from sqlalchemy import inspect

    inspector = inspect(sync_connection)
    schema: dict[str, Any] = {}
    for table_name in table_names:
        columns = []
        for position, column in enumerate(inspector.get_columns(table_name)):
            column_type = column["type"]
            columns.append(
                {
                    "position": position,
                    "name": column["name"],
                    "postgres_type": str(column_type),
                    "sqlite_type": _sqlite_type(column_type),
                    "nullable": column["nullable"],
                    "default": column.get("default"),
                    "autoincrement": json_compatible(column.get("autoincrement")),
                    "comment": column.get("comment"),
                    "precision": getattr(column_type, "precision", None),
                    "scale": getattr(column_type, "scale", None),
                    "length": getattr(column_type, "length", None),
                    "enum_values": list(getattr(column_type, "enums", ()) or ()),
                }
            )
        schema[table_name] = {
            "columns": columns,
            "primary_key": inspector.get_pk_constraint(table_name),
            "foreign_keys": inspector.get_foreign_keys(table_name),
            "unique_constraints": inspector.get_unique_constraints(table_name),
            "indexes": inspector.get_indexes(table_name),
            "check_constraints": inspector.get_check_constraints(table_name),
        }
    return json_compatible(schema)


async def export_snapshot() -> dict[str, Any]:
    """Read all app data and authoritative balances in one read-only snapshot."""
    from sqlalchemy import select, text

    from app.api.v1.funds import compute_fund_balance
    from app.database import Base, async_session
    from app.models import Fund, Group
    from app.services.balances import compute_balances

    metadata_tables = {table.name: table for table in Base.metadata.tables.values()}
    missing = sorted(set(EXPECTED_TABLES) - set(metadata_tables))
    unexpected = sorted(set(metadata_tables) - set(EXPECTED_TABLES))
    if missing or unexpected:
        detail = []
        if missing:
            detail.append(f"missing: {', '.join(missing)}")
        if unexpected:
            detail.append(f"unexpected: {', '.join(unexpected)}")
        raise RuntimeError("application model table mismatch (" + "; ".join(detail) + ")")

    async with async_session() as session:
        async with session.begin():
            await session.execute(
                text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            )
            transaction_info = (
                await session.execute(
                    text(
                        "SELECT transaction_timestamp(), "
                        "current_setting('transaction_isolation'), "
                        "current_setting('transaction_read_only')"
                    )
                )
            ).one()

            connection = await session.connection()
            schema = await connection.run_sync(_inspect_schema, EXPECTED_TABLES)

            tables: dict[str, Any] = {}
            for table_name in EXPECTED_TABLES:
                table = metadata_tables[table_name]
                primary_key = list(table.primary_key.columns)
                statement = select(table)
                if primary_key:
                    statement = statement.order_by(*primary_key)
                rows = [
                    json_compatible(dict(row))
                    for row in (await session.execute(statement)).mappings().all()
                ]
                tables[table_name] = {"row_count": len(rows), "rows": rows}

            group_balances = []
            group_ids = (
                await session.execute(select(Group.id, Group.currency_code).order_by(Group.id))
            ).all()
            for group_id, currency_code in group_ids:
                balances = await compute_balances(session, group_id)
                group_balances.append(
                    {
                        "group_id": str(group_id),
                        "currency_code": currency_code,
                        "members": [
                            {"member_id": str(member_id), "balance": str(balance)}
                            for member_id, balance in sorted(
                                balances.items(), key=lambda item: str(item[0])
                            )
                        ],
                    }
                )

            fund_balances = []
            fund_ids = (await session.execute(select(Fund.id, Fund.group_id).order_by(Fund.id))).all()
            for fund_id, group_id in fund_ids:
                fund_balances.append(
                    {
                        "fund_id": str(fund_id),
                        "group_id": str(group_id),
                        "balance": str(await compute_fund_balance(session, fund_id)),
                    }
                )

            inspector_table_names = set(
                await connection.run_sync(lambda sync_conn: __import__("sqlalchemy").inspect(sync_conn).get_table_names())
            )
            alembic_version = None
            if "alembic_version" in inspector_table_names:
                alembic_version = (
                    await session.execute(text("SELECT version_num FROM alembic_version"))
                ).scalar_one_or_none()

            return {
                "format_version": 1,
                "database": {
                    "exported_at": transaction_info[0].isoformat(),
                    "transaction_isolation": transaction_info[1],
                    "transaction_read_only": transaction_info[2] == "on",
                    "alembic_version": alembic_version,
                },
                "table_order": list(EXPECTED_TABLES),
                "schema": schema,
                "tables": tables,
                "balances": {"groups": group_balances, "funds": fund_balances},
            }


def _write_manifest(root: Path, output: Path, artifact_names: list[str]) -> None:
    manifest = build_manifest(root, artifact_names)
    with output.open("w", encoding="utf-8") as destination:
        json.dump(manifest, destination, indent=2, sort_keys=True)
        destination.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("export", help="write the database JSON snapshot to stdout")
    manifest_parser = subparsers.add_parser("manifest", help="build a local artifact manifest")
    manifest_parser.add_argument("--root", type=Path, required=True)
    manifest_parser.add_argument("--output", type=Path, required=True)
    manifest_parser.add_argument("artifacts", nargs="+")
    args = parser.parse_args(argv)

    if args.command == "export":
        json.dump(asyncio.run(export_snapshot()), sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
    else:
        _write_manifest(args.root, args.output, args.artifacts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
