"""Real SQLite verifies transaction rollback rather than a mocked batch API."""
import sqlite3
from pathlib import Path
import pytest

SQL = Path(__file__).resolve().parents[1] / "finance_triggers.sql"


def database():
    db = sqlite3.connect(":memory:")
    db.executescript("""
        CREATE TABLE funds(id TEXT PRIMARY KEY, is_active INTEGER);
        CREATE TABLE fund_transactions(id TEXT PRIMARY KEY, fund_id TEXT, type TEXT, amount INTEGER);
        CREATE TABLE expenses(id TEXT PRIMARY KEY, updated_at TEXT);
        INSERT INTO funds VALUES ('f', 1);
        INSERT INTO fund_transactions VALUES ('deposit', 'f', 'contribute', 10000);
    """)
    assert SQL.exists(), "Atomic fund guards must be installed in D1"
    db.executescript(SQL.read_text())
    return db


def test_competing_fund_spends_rollback_all_related_writes():
    db = database()
    db.execute("INSERT INTO fund_transactions VALUES ('winner', 'f', 'expense', 8000)")
    db.commit()
    with pytest.raises(sqlite3.IntegrityError, match="Insufficient fund balance"):
        with db:
            db.execute("INSERT INTO expenses VALUES ('loser', 'one')")
            db.execute("INSERT INTO fund_transactions VALUES ('loser', 'f', 'expense', 8000)")
    assert db.execute("SELECT count(*) FROM expenses").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM fund_transactions").fetchone()[0] == 2


def test_cannot_delete_contribution_already_spent():
    db = database()
    db.execute("INSERT INTO fund_transactions VALUES ('spend', 'f', 'expense', 8000)")
    db.commit()
    with pytest.raises(sqlite3.IntegrityError, match="Insufficient fund balance"):
        with db:
            db.execute("DELETE FROM fund_transactions WHERE id='deposit'")
    assert db.execute("SELECT count(*) FROM fund_transactions").fetchone()[0] == 2


def test_stale_snapshot_guard_aborts_entire_operation():
    db = database()
    with pytest.raises(sqlite3.IntegrityError):
        with db:
            db.execute("INSERT INTO expenses VALUES ('e', 'new')")
            db.execute("INSERT INTO _finance_assertions VALUES ('guard', (SELECT count(*) FROM expenses WHERE id='e' AND updated_at='old'))")
    assert db.execute("SELECT count(*) FROM expenses").fetchone()[0] == 0
