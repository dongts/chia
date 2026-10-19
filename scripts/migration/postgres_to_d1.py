#!/usr/bin/env python3
"""Convert a Chia PostgreSQL JSON snapshot into D1 schema and import SQL."""

from __future__ import annotations

import argparse
import base64
import json
import os
import pprint
import sqlite3
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


GROUP_CATEGORY_CYCLE = ("groups", "default_category_id")

MODEL_DEFAULTS = {
    ("categories", "icon"): "'📦'",
    ("groups", "currency_code"): "'USD'",
    ("groups", "allow_log_on_behalf"): "1",
    ("group_members", "role"): "'member'",
    ("group_members", "nicknames"): "''",
    ("group_members", "initial_balance"): "0",
    ("settlements", "type"): "'settle_up'",
    ("expenses", "exchange_rate"): "1000000",
    ("notifications", "data"): "'{}'",
}


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def quote_text(value: str) -> str:
    if "\x00" in value:
        raise ValueError("SQLite text cannot contain NUL")
    return "'" + value.replace("'", "''") + "'"


def _columns(snapshot: dict[str, Any], table_name: str) -> list[dict[str, Any]]:
    return sorted(snapshot["schema"][table_name]["columns"], key=lambda item: item["position"])


def build_schema_metadata(snapshot: dict[str, Any]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for table_name in snapshot["table_order"]:
        columns = _columns(snapshot, table_name)
        numeric = {
            column["name"]: int(column["scale"])
            for column in columns
            if column["sqlite_type"] == "NUMERIC"
        }
        metadata[table_name] = {
            "numeric": numeric,
            "boolean": [
                column["name"]
                for column in columns
                if column["postgres_type"].upper() == "BOOLEAN"
            ],
            "json": [
                column["name"]
                for column in columns
                if column["postgres_type"].upper() in {"JSON", "JSONB"}
            ],
            "columns": [column["name"] for column in columns],
        }
    return metadata


def _column_default(table_name: str, column: dict[str, Any]) -> str | None:
    key = (table_name, column["name"])
    if key in MODEL_DEFAULTS:
        return MODEL_DEFAULTS[key]
    if column["name"] == "is_active":
        return "1"
    if column["postgres_type"].upper() == "BOOLEAN":
        return "0"
    source_default = str(column.get("default") or "").lower()
    if "now()" in source_default or "current_timestamp" in source_default:
        return "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
    return None


def _column_sql(table_name: str, column: dict[str, Any]) -> str:
    postgres_type = column["postgres_type"].upper()
    if column["sqlite_type"] == "NUMERIC" or postgres_type == "BOOLEAN":
        storage_type = "INTEGER"
    elif column["sqlite_type"] == "BLOB":
        storage_type = "BLOB"
    else:
        storage_type = "TEXT"

    parts = [quote_identifier(column["name"]), storage_type]
    if not column["nullable"]:
        parts.append("NOT NULL")
    default = _column_default(table_name, column)
    if default is not None:
        parts.extend(["DEFAULT", default])
    if postgres_type == "BOOLEAN":
        parts.append(f"CHECK ({quote_identifier(column['name'])} IN (0, 1))")
    enum_values = column.get("enum_values") or []
    if enum_values:
        allowed = ", ".join(quote_text(value) for value in enum_values)
        parts.append(f"CHECK ({quote_identifier(column['name'])} IN ({allowed}))")
    return " ".join(parts)


def _constraint_sql(table_schema: dict[str, Any]) -> list[str]:
    constraints: list[str] = []
    primary_key = table_schema["primary_key"].get("constrained_columns") or []
    if primary_key:
        constraints.append(
            "PRIMARY KEY (" + ", ".join(quote_identifier(column) for column in primary_key) + ")"
        )

    seen_unique: set[tuple[str, ...]] = set()
    for unique in table_schema.get("unique_constraints", []):
        columns = tuple(unique.get("column_names") or [])
        if columns and columns not in seen_unique:
            seen_unique.add(columns)
            constraints.append(
                "UNIQUE (" + ", ".join(quote_identifier(column) for column in columns) + ")"
            )

    for foreign_key in table_schema.get("foreign_keys", []):
        local_columns = ", ".join(
            quote_identifier(column) for column in foreign_key["constrained_columns"]
        )
        remote_columns = ", ".join(
            quote_identifier(column) for column in foreign_key["referred_columns"]
        )
        clause = (
            f"FOREIGN KEY ({local_columns}) REFERENCES "
            f"{quote_identifier(foreign_key['referred_table'])} ({remote_columns})"
        )
        options = foreign_key.get("options") or {}
        if options.get("ondelete"):
            clause += " ON DELETE " + options["ondelete"].upper()
        if options.get("onupdate"):
            clause += " ON UPDATE " + options["onupdate"].upper()
        constraints.append(clause)
    return constraints


def build_schema_sql(snapshot: dict[str, Any]) -> str:
    statements = ["PRAGMA foreign_keys = ON;"]
    unique_constraints: dict[str, set[tuple[str, ...]]] = {}
    for table_name in snapshot["table_order"]:
        table_schema = snapshot["schema"][table_name]
        definitions = [_column_sql(table_name, column) for column in _columns(snapshot, table_name)]
        definitions.extend(_constraint_sql(table_schema))
        body = ",\n  ".join(definitions)
        statements.append(f"CREATE TABLE {quote_identifier(table_name)} (\n  {body}\n);")
        unique_constraints[table_name] = {
            tuple(unique.get("column_names") or [])
            for unique in table_schema.get("unique_constraints", [])
        }

    for table_name in snapshot["table_order"]:
        for index in snapshot["schema"][table_name].get("indexes", []):
            columns = tuple(index.get("column_names") or [])
            if not columns or (index.get("unique") and columns in unique_constraints[table_name]):
                continue
            unique = "UNIQUE " if index.get("unique") else ""
            column_sql = ", ".join(quote_identifier(column) for column in columns)
            statements.append(
                f"CREATE {unique}INDEX {quote_identifier(index['name'])} "
                f"ON {quote_identifier(table_name)} ({column_sql});"
            )
    return "\n\n".join(statements) + "\n"


def _scaled_integer(value: Any, scale: int, location: str) -> int:
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError(f"{location} is not a valid decimal") from error
    scaled = decimal_value * (Decimal(10) ** scale)
    integral = scaled.to_integral_value()
    if scaled != integral:
        raise ValueError(f"{location} cannot be represented exactly at scale {scale}")
    return int(integral)


def _encoded_value(
    table_name: str,
    column: dict[str, Any],
    value: Any,
    metadata: dict[str, Any],
) -> Any:
    if value is None:
        if not column["nullable"] and _column_default(table_name, column) is None:
            raise ValueError(f"{table_name}.{column['name']} is required")
        return None
    column_name = column["name"]
    if column_name in metadata[table_name]["numeric"]:
        return _scaled_integer(
            value,
            metadata[table_name]["numeric"][column_name],
            f"{table_name}.{column_name}",
        )
    if column_name in metadata[table_name]["boolean"]:
        if not isinstance(value, bool):
            raise ValueError(f"{table_name}.{column_name} must be a boolean")
        return int(value)
    if column_name in metadata[table_name]["json"]:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if column["sqlite_type"] == "BLOB":
        if not isinstance(value, dict) or value.get("encoding") != "base64":
            raise ValueError(f"{table_name}.{column_name} must be base64 encoded")
        return base64.b64decode(value["data"], validate=True)
    if isinstance(value, (str, int, float)):
        return value
    raise ValueError(f"unsupported value for {table_name}.{column_name}")


def _sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, str):
        return quote_text(value)
    raise ValueError(f"unsupported SQLite value: {type(value).__name__}")


def _import_order(snapshot: dict[str, Any]) -> list[str]:
    table_names = list(snapshot["table_order"])
    known = set(table_names)
    dependencies: dict[str, set[str]] = {name: set() for name in table_names}
    for table_name in table_names:
        for foreign_key in snapshot["schema"][table_name].get("foreign_keys", []):
            if (
                table_name == GROUP_CATEGORY_CYCLE[0]
                and GROUP_CATEGORY_CYCLE[1] in foreign_key["constrained_columns"]
            ):
                continue
            referred_table = foreign_key["referred_table"]
            if referred_table in known and referred_table != table_name:
                dependencies[table_name].add(referred_table)

    result: list[str] = []
    remaining = set(table_names)
    while remaining:
        ready = [name for name in table_names if name in remaining and not (dependencies[name] & remaining)]
        if not ready:
            raise ValueError("unresolved foreign key cycle: " + ", ".join(sorted(remaining)))
        result.extend(ready)
        remaining.difference_update(ready)
    return result


def _encoded_rows(snapshot: dict[str, Any], table_name: str) -> list[list[Any]]:
    metadata = build_schema_metadata(snapshot)
    columns = _columns(snapshot, table_name)
    column_names = {column["name"] for column in columns}
    encoded_rows = []
    for row_index, row in enumerate(snapshot["tables"][table_name]["rows"]):
        if set(row) != column_names:
            missing = sorted(column_names - set(row))
            unexpected = sorted(set(row) - column_names)
            raise ValueError(
                f"{table_name} row {row_index} columns mismatch; "
                f"missing={missing}, unexpected={unexpected}"
            )
        encoded = []
        for column in columns:
            value = row[column["name"]]
            if (table_name, column["name"]) == GROUP_CATEGORY_CYCLE:
                value = None
            encoded.append(_encoded_value(table_name, column, value, metadata))
        encoded_rows.append(encoded)
    return encoded_rows


def build_import_sql(snapshot: dict[str, Any]) -> str:
    # D1 import endpoints manage transactions and reject explicit BEGIN/COMMIT.
    statements = []
    for table_name in _import_order(snapshot):
        columns = _columns(snapshot, table_name)
        column_sql = ", ".join(quote_identifier(column["name"]) for column in columns)
        for encoded in _encoded_rows(snapshot, table_name):
            value_sql = ", ".join(_sql_literal(value) for value in encoded)
            statements.append(
                f"INSERT INTO {quote_identifier(table_name)} ({column_sql}) VALUES ({value_sql});"
            )

    if GROUP_CATEGORY_CYCLE[0] in snapshot["tables"]:
        for row in snapshot["tables"][GROUP_CATEGORY_CYCLE[0]]["rows"]:
            category_id = row.get(GROUP_CATEGORY_CYCLE[1])
            if category_id is not None:
                statements.append(
                    f"UPDATE {quote_identifier(GROUP_CATEGORY_CYCLE[0])} SET "
                    f"{quote_identifier(GROUP_CATEGORY_CYCLE[1])} = {_sql_literal(category_id)} "
                    f"WHERE {quote_identifier('id')} = {_sql_literal(row['id'])};"
                )
    return "\n".join(statements) + "\n"


def validate_conversion(snapshot: dict[str, Any]) -> dict[str, int]:
    schema_sql = build_schema_sql(snapshot)
    import_sql = build_import_sql(snapshot)
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(schema_sql)
        try:
            connection.executescript("BEGIN TRANSACTION;\n" + import_sql + "COMMIT;\n")
        except sqlite3.IntegrityError as error:
            if "FOREIGN KEY" in str(error).upper():
                raise ValueError("foreign key check failed during import") from error
            raise ValueError(f"SQLite constraint validation failed: {error}") from error
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise ValueError(f"foreign key check failed ({len(foreign_key_errors)} violations)")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite integrity check failed: {integrity}")

        counts: dict[str, int] = {}
        for table_name in snapshot["table_order"]:
            columns = _columns(snapshot, table_name)
            column_sql = ", ".join(quote_identifier(column["name"]) for column in columns)
            primary_key = snapshot["schema"][table_name]["primary_key"].get("constrained_columns") or []
            order_sql = ""
            if primary_key:
                order_sql = " ORDER BY " + ", ".join(quote_identifier(column) for column in primary_key)
            actual = connection.execute(
                f"SELECT {column_sql} FROM {quote_identifier(table_name)}{order_sql}"
            ).fetchall()

            expected = _encoded_rows(snapshot, table_name)
            if table_name == GROUP_CATEGORY_CYCLE[0]:
                category_index = [column["name"] for column in columns].index(GROUP_CATEGORY_CYCLE[1])
                for encoded, row in zip(expected, snapshot["tables"][table_name]["rows"], strict=True):
                    encoded[category_index] = row[GROUP_CATEGORY_CYCLE[1]]
            expected_tuples = [tuple(row) for row in expected]
            if actual != expected_tuples:
                raise ValueError(f"round-trip value mismatch for table: {table_name}")
            counts[table_name] = len(actual)
        return counts
    finally:
        connection.close()


def _write_text(path: Path, value: str, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    os.chmod(path, 0o600 if private else 0o644)


def _schema_module(metadata: dict[str, Any]) -> str:
    formatted = pprint.pformat(metadata, width=100, sort_dicts=False)
    return '"""Generated D1 conversion metadata; contains no application rows."""\n\nSCHEMA = ' + formatted + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--schema-output", type=Path)
    parser.add_argument("--metadata-output", type=Path)
    parser.add_argument("--data-output", type=Path)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args(argv)
    if not any((args.schema_output, args.metadata_output, args.data_output, args.validate)):
        parser.error("request at least one output or --validate")

    with args.snapshot.open(encoding="utf-8") as source:
        snapshot = json.load(source)
    metadata = build_schema_metadata(snapshot)
    if args.schema_output:
        _write_text(args.schema_output, build_schema_sql(snapshot))
    if args.metadata_output:
        _write_text(args.metadata_output, _schema_module(metadata))
    if args.data_output:
        _write_text(args.data_output, build_import_sql(snapshot), private=True)
    if args.validate:
        validate_conversion(snapshot)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
