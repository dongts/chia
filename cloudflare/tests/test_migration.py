import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).parents[2] / "scripts" / "migration" / "postgres_to_d1.py"
SPEC = importlib.util.spec_from_file_location("postgres_to_d1", MODULE_PATH)
postgres_to_d1 = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = postgres_to_d1
SPEC.loader.exec_module(postgres_to_d1)


def _column(name, pg_type, sqlite_type="TEXT", nullable=False, **overrides):
    column = {
        "position": 0,
        "name": name,
        "postgres_type": pg_type,
        "sqlite_type": sqlite_type,
        "nullable": nullable,
        "default": None,
        "precision": None,
        "scale": None,
        "length": None,
        "enum_values": [],
    }
    column.update(overrides)
    return column


def _table(columns, primary_key, foreign_keys=None, uniques=None, indexes=None):
    for position, column in enumerate(columns):
        column["position"] = position
    return {
        "columns": columns,
        "primary_key": {"name": None, "constrained_columns": primary_key},
        "foreign_keys": foreign_keys or [],
        "unique_constraints": [
            {"name": None, "column_names": unique} for unique in (uniques or [])
        ],
        "indexes": indexes or [],
        "check_constraints": [],
    }


@pytest.fixture
def sample_snapshot():
    group_columns = [
        _column("id", "UUID"),
        _column("name", "VARCHAR(200)"),
        _column("default_category_id", "UUID", nullable=True),
        _column("allow_log_on_behalf", "BOOLEAN", sqlite_type="INTEGER"),
    ]
    category_columns = [
        _column("id", "UUID"),
        _column("group_id", "UUID"),
        _column("name", "VARCHAR(100)"),
        _column("rate", "NUMERIC(12, 6)", sqlite_type="NUMERIC", precision=12, scale=6),
        _column("is_default", "BOOLEAN", sqlite_type="INTEGER"),
        _column("payload", "JSONB", nullable=True),
        _column("status", "VARCHAR(8)", enum_values=["active", "archived"]),
    ]
    return {
        "format_version": 1,
        "table_order": ["groups", "categories"],
        "schema": {
            "groups": _table(
                group_columns,
                ["id"],
                foreign_keys=[{
                    "name": "fk_groups_default_category",
                    "constrained_columns": ["default_category_id"],
                    "referred_table": "categories",
                    "referred_columns": ["id"],
                    "options": {"ondelete": "SET NULL"},
                }],
            ),
            "categories": _table(
                category_columns,
                ["id"],
                foreign_keys=[{
                    "name": "categories_group_id_fkey",
                    "constrained_columns": ["group_id"],
                    "referred_table": "groups",
                    "referred_columns": ["id"],
                    "options": {"ondelete": "CASCADE"},
                }],
                uniques=[["group_id", "name"]],
                indexes=[{
                    "name": "ix_categories_name",
                    "column_names": ["name"],
                    "unique": False,
                }],
            ),
        },
        "tables": {
            "groups": {
                "row_count": 1,
                "rows": [{
                    "id": "g1",
                    "name": "Trip",
                    "default_category_id": "c1",
                    "allow_log_on_behalf": True,
                }],
            },
            "categories": {
                "row_count": 1,
                "rows": [{
                    "id": "c1",
                    "group_id": "g1",
                    "name": "Traveler's",
                    "rate": "1.234567",
                    "is_default": False,
                    "payload": {"amount": "12.30", "labels": ["one", "two"]},
                    "status": "active",
                }],
            },
        },
    }


def test_schema_metadata_records_conversion_rules(sample_snapshot):
    metadata = postgres_to_d1.build_schema_metadata(sample_snapshot)

    assert metadata == {
        "groups": {
            "numeric": {},
            "boolean": ["allow_log_on_behalf"],
            "json": [],
            "columns": ["id", "name", "default_category_id", "allow_log_on_behalf"],
        },
        "categories": {
            "numeric": {"rate": 6},
            "boolean": ["is_default"],
            "json": ["payload"],
            "columns": ["id", "group_id", "name", "rate", "is_default", "payload", "status"],
        },
    }


def test_schema_preserves_constraints_enums_and_defaults(sample_snapshot):
    sql = postgres_to_d1.build_schema_sql(sample_snapshot)

    assert '"rate" INTEGER NOT NULL' in sql
    assert 'CHECK ("is_default" IN (0, 1))' in sql
    assert 'CHECK ("status" IN (\'active\', \'archived\'))' in sql
    assert 'FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE' in sql
    assert 'UNIQUE ("group_id", "name")' in sql
    assert 'CREATE INDEX "ix_categories_name" ON "categories" ("name")' in sql
    assert '"allow_log_on_behalf" INTEGER NOT NULL DEFAULT 1' in sql


def test_private_import_uses_scaled_integers_and_repairs_group_category_cycle(sample_snapshot):
    schema_sql = postgres_to_d1.build_schema_sql(sample_snapshot)
    import_sql = postgres_to_d1.build_import_sql(sample_snapshot)
    connection = sqlite3.connect(":memory:")
    connection.executescript(schema_sql)
    connection.executescript(import_sql)

    group = connection.execute(
        'SELECT default_category_id, allow_log_on_behalf FROM "groups"'
    ).fetchone()
    category = connection.execute(
        'SELECT name, rate, is_default, payload FROM "categories"'
    ).fetchone()

    assert group == ("c1", 1)
    assert category[:3] == ("Traveler's", 1234567, 0)
    assert json.loads(category[3]) == {"amount": "12.30", "labels": ["one", "two"]}
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    assert import_sql.index('INSERT INTO "groups"') < import_sql.index('INSERT INTO "categories"')
    assert 'VALUES (\'g1\', \'Trip\', NULL, 1)' in import_sql
    assert 'UPDATE "groups" SET "default_category_id" = \'c1\'' in import_sql
    assert "BEGIN" not in import_sql
    assert "COMMIT" not in import_sql
    assert "PRAGMA" not in import_sql


def test_validate_conversion_rejects_fractional_scaled_integer(sample_snapshot):
    sample_snapshot["tables"]["categories"]["rows"][0]["rate"] = "1.2345678"

    with pytest.raises(ValueError, match="categories.rate.*scale 6"):
        postgres_to_d1.build_import_sql(sample_snapshot)


def test_validate_conversion_rejects_dangling_foreign_key(sample_snapshot):
    sample_snapshot["tables"]["categories"]["rows"][0]["group_id"] = "missing"

    with pytest.raises(ValueError, match="foreign key check failed"):
        postgres_to_d1.validate_conversion(sample_snapshot)
