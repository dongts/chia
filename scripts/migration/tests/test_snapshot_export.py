import importlib.util
import json
import sys
import tempfile
import unittest
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "snapshot_export.py"
SPEC = importlib.util.spec_from_file_location("snapshot_export", MODULE_PATH)
snapshot_export = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = snapshot_export
SPEC.loader.exec_module(snapshot_export)


class Kind(str, Enum):
    gift = "gift"


class JsonCompatibleTests(unittest.TestCase):
    def test_preserves_decimals_as_strings_recursively(self):
        value = {
            "amount": Decimal("12.3400"),
            "nested": [Decimal("0.00"), {"rate": Decimal("1.234567")}],
        }

        self.assertEqual(
            snapshot_export.json_compatible(value),
            {
                "amount": "12.3400",
                "nested": ["0.00", {"rate": "1.234567"}],
            },
        )

    def test_serializes_database_scalar_types_deterministically(self):
        identifier = uuid.UUID("3a7dcfc5-2c3a-481f-a56b-b819654ee589")
        value = {
            "id": identifier,
            "created_at": datetime(2026, 9, 18, 12, 30, tzinfo=timezone.utc),
            "date": date(2026, 9, 18),
            "kind": Kind.gift,
            "payload": b"chia",
        }

        self.assertEqual(
            snapshot_export.json_compatible(value),
            {
                "id": "3a7dcfc5-2c3a-481f-a56b-b819654ee589",
                "created_at": "2026-09-18T12:30:00+00:00",
                "date": "2026-09-18",
                "kind": "gift",
                "payload": {"encoding": "base64", "data": "Y2hpYQ=="},
            },
        )


class ManifestTests(unittest.TestCase):
    def _snapshot(self):
        return {
            "format_version": 1,
            "database": {"alembic_version": "abc123"},
            "tables": {
                table: {"row_count": index, "rows": [{} for _ in range(index)]}
                for index, table in enumerate(snapshot_export.EXPECTED_TABLES)
            },
            "balances": {"groups": [], "funds": []},
        }

    def test_manifest_hashes_artifacts_and_records_table_counts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "database.dump").write_bytes(b"dump")
            (root / "data.json").write_text(json.dumps(self._snapshot()))
            (root / "uploads.tar").write_bytes(b"tar")

            manifest = snapshot_export.build_manifest(
                root, ["database.dump", "data.json", "uploads.tar"]
            )

        self.assertEqual(manifest["format_version"], 1)
        self.assertEqual(manifest["database"]["alembic_version"], "abc123")
        self.assertEqual(manifest["table_counts"]["categories"], 0)
        self.assertEqual(manifest["table_counts"]["users"], 17)
        self.assertEqual(
            manifest["files"]["database.dump"]["sha256"],
            "b6ca0868bca6a2926b70aa1a71592038d9030fe26d4214edcfbd6cf41f2f4654",
        )
        self.assertEqual(manifest["files"]["database.dump"]["bytes"], 4)

    def test_manifest_rejects_missing_application_table(self):
        snapshot = self._snapshot()
        del snapshot["tables"]["settlements"]

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "data.json").write_text(json.dumps(snapshot))

            with self.assertRaisesRegex(ValueError, "missing.*settlements"):
                snapshot_export.build_manifest(root, ["data.json"])

    def test_manifest_rejects_unexpected_application_table(self):
        snapshot = self._snapshot()
        snapshot["tables"]["surprise"] = {"row_count": 0, "rows": []}

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "data.json").write_text(json.dumps(snapshot))

            with self.assertRaisesRegex(ValueError, "unexpected.*surprise"):
                snapshot_export.build_manifest(root, ["data.json"])


if __name__ == "__main__":
    unittest.main()
