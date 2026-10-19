"""Account-merge integrity and concurrency tests against the real D1 schema."""

import sqlite3
from pathlib import Path

import pytest

from chia_api.auth import merge_user_into
from chia_api.db import Store


class SQLiteStatement:
    def __init__(self, connection: sqlite3.Connection, sql: str):
        self.connection = connection
        self.sql = sql
        self.params = ()

    def bind(self, *params):
        self.params = params
        return self

    async def all(self):
        cursor = self.connection.execute(self.sql, self.params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        return {"results": rows}


class SQLiteBinding:
    def __init__(self, connection: sqlite3.Connection, before_write=None):
        self.connection = connection
        self.before_write = before_write
        self.fired = False

    def prepare(self, sql: str):
        return SQLiteStatement(self.connection, sql)

    async def batch(self, statements):
        if self.before_write is not None and not self.fired:
            self.before_write(self.connection)
            self.connection.commit()
            self.fired = True
        results = []
        with self.connection:
            for statement in statements:
                cursor = self.connection.execute(statement.sql, statement.params)
                rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
                results.append({"results": rows})
        return results


def database() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    root = Path(__file__).resolve().parents[1]
    db.executescript((root / "migrations/0001_initial.sql").read_text())
    db.executescript((root / "finance_triggers.sql").read_text())
    return db


def seed_users_and_members(db: sqlite3.Connection):
    timestamp = "2026-09-18T00:00:00+00:00"
    source_user = "10000000-0000-0000-0000-000000000001"
    target_user = "10000000-0000-0000-0000-000000000002"
    group_id = "20000000-0000-0000-0000-000000000001"
    source_member = "30000000-0000-0000-0000-000000000001"
    target_member = "30000000-0000-0000-0000-000000000002"
    db.executemany(
        """INSERT INTO users(
          id, email, password_hash, display_name, device_id, avatar_url,
          is_verified, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?)""",
        [
            (source_user, None, "Guest", "guest-device", 0, timestamp, timestamp),
            (target_user, "target@example.com", "Target", None, 1, timestamp, timestamp),
        ],
    )
    db.execute(
        """INSERT INTO groups(
          id, name, description, currency_code, invite_code, default_category_id,
          require_verified_users, allow_log_on_behalf, created_at, updated_at,
          is_deleted, deleted_at
        ) VALUES (?, 'Trip', NULL, 'USD', 'MERGE001', NULL, 0, 1, ?, ?, 0, NULL)""",
        (group_id, timestamp, timestamp),
    )
    db.executemany(
        """INSERT INTO group_members(
          id, group_id, user_id, display_name, role, claimed_at,
          is_active, joined_at, initial_balance, nicknames
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, '')""",
        [
            (source_member, group_id, source_user, "Guest", "admin", timestamp, timestamp, 100),
            (target_member, group_id, target_user, "Target", "member", timestamp, timestamp, 200),
        ],
    )
    db.commit()
    return source_user, target_user, group_id, source_member, target_member


def seed_every_member_reference(
    db: sqlite3.Connection,
    source_user: str,
    group_id: str,
    source_member: str,
):
    timestamp = "2026-09-18T00:00:00+00:00"
    category = "40000000-0000-0000-0000-000000000001"
    expense = "50000000-0000-0000-0000-000000000001"
    fund = "60000000-0000-0000-0000-000000000001"
    deduction = "70000000-0000-0000-0000-000000000001"
    payment = "80000000-0000-0000-0000-000000000001"
    db.execute(
        "INSERT INTO categories VALUES (?, ?, 'Food', '🍜', 0, ?)",
        (category, group_id, timestamp),
    )
    db.execute(
        """INSERT INTO expenses VALUES(
          ?, ?, ?, ?, 'Dinner', 1000, 'USD', ?, NULL, '2026-09-18',
          ?, ?, 1000000, 1000
        )""",
        (expense, group_id, source_member, source_member, category, timestamp, timestamp),
    )
    db.execute(
        "INSERT INTO expense_splits VALUES (?, ?, ?, 'exact', 10000000, 1000)",
        ("51000000-0000-0000-0000-000000000001", expense, source_member),
    )
    db.execute(
        """INSERT INTO settlements(
          id, group_id, from_member, to_member, amount, created_by,
          settled_at, description, type
        ) VALUES (?, ?, ?, ?, 100, ?, ?, NULL, 'settle_up')""",
        ("52000000-0000-0000-0000-000000000001", group_id, source_member, source_member, source_member, timestamp),
    )
    db.execute(
        "INSERT INTO group_member_logs VALUES (?, ?, ?, 'renamed', NULL, ?, ?)",
        ("53000000-0000-0000-0000-000000000001", group_id, source_member, source_member, timestamp),
    )
    db.execute(
        """INSERT INTO payment_methods VALUES(
          ?, ?, 'Main', NULL, NULL, NULL, NULL, NULL, ?, NULL
        )""",
        (payment, source_user, timestamp),
    )
    db.execute(
        "INSERT INTO group_payment_methods VALUES (?, ?, ?, ?, ?)",
        ("54000000-0000-0000-0000-000000000001", group_id, payment, source_member, timestamp),
    )
    db.execute(
        """INSERT INTO funds VALUES(
          ?, ?, 'Fund', NULL, ?, ?, 1, ?, ?
        )""",
        (fund, group_id, source_member, source_member, timestamp, timestamp),
    )
    db.execute(
        """INSERT INTO expense_fund_deductions VALUES(
          ?, ?, ?, 100, ?, ?
        )""",
        (deduction, expense, fund, source_member, timestamp),
    )
    db.execute(
        """INSERT INTO fund_transactions VALUES(
          ?, ?, 'contribute', 100, ?, NULL, NULL, ?, ?, NULL
        )""",
        ("55000000-0000-0000-0000-000000000001", fund, source_member, source_member, timestamp),
    )
    db.execute(
        """INSERT INTO expense_logs VALUES(
          ?, ?, ?, ?, 'created', NULL, ?
        )""",
        ("56000000-0000-0000-0000-000000000001", expense, group_id, source_member, timestamp),
    )
    db.execute(
        "INSERT INTO user_oauth VALUES (?, ?, 'legacy', 'subject', ?)",
        ("57000000-0000-0000-0000-000000000001", source_user, timestamp),
    )
    db.execute(
        "INSERT INTO notifications VALUES (?, ?, ?, 'test', '{}', 0, ?)",
        ("58000000-0000-0000-0000-000000000001", source_user, group_id, timestamp),
    )
    db.commit()


@pytest.mark.asyncio
async def test_merge_reassigns_every_d1_group_member_reference():
    """Adding a member foreign key without updating merge would leave split identities."""
    db = database()
    source_user, target_user, group_id, source_member, target_member = seed_users_and_members(db)
    seed_every_member_reference(db, source_user, group_id, source_member)

    summary = await merge_user_into(Store(SQLiteBinding(db)), source_user, target_user)

    assert summary == {
        "source_name": "Guest",
        "target_name": "Target",
        "merged_groups": [group_id],
        "moved_groups": [],
    }
    tables = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )]
    checked = set()
    for table in tables:
        for foreign_key in db.execute(f'PRAGMA foreign_key_list("{table}")'):
            if foreign_key[2] == "group_members":
                column = foreign_key[3]
                checked.add((table, column))
                remaining = db.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" = ?',
                    (source_member,),
                ).fetchone()[0]
                assert remaining == 0, f"{table}.{column} still references source member"
    assert len(checked) == 15
    target = db.execute(
        "SELECT initial_balance, role, is_active FROM group_members WHERE id = ?",
        (target_member,),
    ).fetchone()
    assert tuple(target) == (300, "admin", 1)
    source = db.execute(
        "SELECT initial_balance, user_id, is_active FROM group_members WHERE id = ?",
        (source_member,),
    ).fetchone()
    assert tuple(source) == (0, None, 0)
    assert db.execute("SELECT COUNT(*) FROM users WHERE id = ?", (source_user,)).fetchone()[0] == 0
    assert db.execute("SELECT user_id FROM payment_methods").fetchone()[0] == target_user
    assert db.execute("SELECT user_id FROM user_oauth").fetchone()[0] == target_user
    assert db.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_stale_duplicate_merge_aborts_instead_of_adding_initial_balance_twice():
    """A second link request must not replay a completed merge from stale reads."""
    from fastapi import HTTPException

    db = database()
    source_user, target_user, _, source_member, target_member = seed_users_and_members(db)

    def competing_merge(connection: sqlite3.Connection):
        connection.execute(
            "UPDATE group_members SET initial_balance = initial_balance + 100, role = 'admin' WHERE id = ?",
            (target_member,),
        )
        connection.execute(
            "UPDATE group_members SET is_active = 0, user_id = NULL WHERE id = ?",
            (source_member,),
        )
        connection.execute("DELETE FROM users WHERE id = ?", (source_user,))

    store = Store(SQLiteBinding(db, before_write=competing_merge))
    with pytest.raises(HTTPException) as error:
        await merge_user_into(store, source_user, target_user)
    assert error.value.status_code == 409
    assert db.execute(
        "SELECT initial_balance FROM group_members WHERE id = ?", (target_member,)
    ).fetchone()[0] == 300


@pytest.mark.asyncio
async def test_merge_aborts_if_source_gains_membership_after_snapshot():
    """Deleting the source after a concurrent join would silently unclaim that join."""
    from fastapi import HTTPException

    db = database()
    source_user, target_user, _, _, _ = seed_users_and_members(db)
    second_group = "20000000-0000-0000-0000-000000000002"
    second_member = "30000000-0000-0000-0000-000000000003"
    timestamp = "2026-09-18T00:00:00+00:00"

    def concurrent_join(connection: sqlite3.Connection):
        connection.execute(
            """INSERT INTO groups(
              id, name, description, currency_code, invite_code, default_category_id,
              require_verified_users, allow_log_on_behalf, created_at, updated_at,
              is_deleted, deleted_at
            ) VALUES (?, 'New', NULL, 'USD', 'MERGE002', NULL, 0, 1, ?, ?, 0, NULL)""",
            (second_group, timestamp, timestamp),
        )
        connection.execute(
            """INSERT INTO group_members(
              id, group_id, user_id, display_name, role, claimed_at,
              is_active, joined_at, initial_balance, nicknames
            ) VALUES (?, ?, ?, 'Guest', 'member', ?, 1, ?, 0, '')""",
            (second_member, second_group, source_user, timestamp, timestamp),
        )

    store = Store(SQLiteBinding(db, before_write=concurrent_join))
    with pytest.raises(HTTPException) as error:
        await merge_user_into(store, source_user, target_user)
    assert error.value.status_code == 409
    assert db.execute(
        "SELECT user_id FROM group_members WHERE id = ?", (second_member,)
    ).fetchone()[0] == source_user
    assert db.execute("SELECT COUNT(*) FROM users WHERE id = ?", (source_user,)).fetchone()[0] == 1


@pytest.mark.asyncio
async def test_merge_uses_live_owner_role_instead_of_stale_precheck_role():
    """A concurrent promotion must survive identity consolidation."""
    db = database()
    source_user, target_user, _, source_member, target_member = seed_users_and_members(db)

    def concurrent_promotion(connection: sqlite3.Connection):
        connection.execute(
            "UPDATE group_members SET role = 'owner' WHERE id = ?", (source_member,)
        )

    await merge_user_into(
        Store(SQLiteBinding(db, before_write=concurrent_promotion)),
        source_user,
        target_user,
    )
    assert db.execute(
        "SELECT role FROM group_members WHERE id = ?", (target_member,)
    ).fetchone()[0] == "owner"
