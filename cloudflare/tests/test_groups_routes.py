"""Behavioral coverage for the Cloudflare group and membership route cluster."""

import sqlite3
import uuid
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest


EXPECTED_ROUTES = {
    ("POST", "/api/v1/groups"),
    ("GET", "/api/v1/groups"),
    ("GET", "/api/v1/groups/{group_id}"),
    ("PATCH", "/api/v1/groups/{group_id}"),
    ("DELETE", "/api/v1/groups/{group_id}"),
    ("GET", "/api/v1/groups/preview/{invite_code}"),
    ("POST", "/api/v1/groups/join/{invite_code}"),
    ("GET", "/api/v1/groups/{group_id}/members"),
    ("POST", "/api/v1/groups/{group_id}/members"),
    ("PATCH", "/api/v1/groups/{group_id}/members/{member_id}"),
    ("POST", "/api/v1/groups/{group_id}/members/{member_id}/claim"),
    ("POST", "/api/v1/groups/{group_id}/members/{member_id}/unclaim"),
    ("DELETE", "/api/v1/groups/{group_id}/members/{member_id}"),
    ("GET", "/api/v1/groups/{group_id}/members/log"),
    ("GET", "/api/v1/groups/{group_id}/currencies"),
    ("POST", "/api/v1/groups/{group_id}/currencies"),
    ("PATCH", "/api/v1/groups/{group_id}/currencies/{currency_id}"),
    ("DELETE", "/api/v1/groups/{group_id}/currencies/{currency_id}"),
    ("GET", "/api/v1/categories"),
    ("GET", "/api/v1/groups/{group_id}/categories"),
    ("POST", "/api/v1/groups/{group_id}/categories"),
    ("PATCH", "/api/v1/groups/{group_id}/categories/{category_id}"),
    ("DELETE", "/api/v1/groups/{group_id}/categories/{category_id}"),
    ("GET", "/api/v1/users/me/payment-methods"),
    ("POST", "/api/v1/users/me/payment-methods"),
    ("PATCH", "/api/v1/users/me/payment-methods/{pm_id}"),
    ("DELETE", "/api/v1/users/me/payment-methods/{pm_id}"),
    ("POST", "/api/v1/users/me/payment-methods/{pm_id}/qr"),
    ("GET", "/api/v1/groups/{group_id}/payment-methods"),
    ("GET", "/api/v1/groups/{group_id}/payment-methods/mine"),
    ("POST", "/api/v1/groups/{group_id}/payment-methods"),
    ("DELETE", "/api/v1/groups/{group_id}/payment-methods/{pm_id}"),
}


def _registered_routes():
    from chia_api.routes_groups import router

    return {
        (method, route.path)
        for route in router.routes
        for method in route.methods
        if method not in {"HEAD", "OPTIONS"}
    }


def test_registers_the_complete_legacy_group_cluster_under_api_v1():
    assert _registered_routes() == EXPECTED_ROUTES


def _ledger_db() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(
        """
        CREATE TABLE _finance_assertions(
          token TEXT PRIMARY KEY,
          ok INTEGER NOT NULL CHECK(ok = 1)
        );
        CREATE TABLE group_members(
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          initial_balance INTEGER NOT NULL,
          is_active INTEGER NOT NULL
        );
        CREATE TABLE expenses(
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          paid_by TEXT NOT NULL,
          converted_amount INTEGER NOT NULL
        );
        CREATE TABLE expense_splits(
          expense_id TEXT NOT NULL,
          group_member_id TEXT NOT NULL,
          resolved_amount INTEGER NOT NULL
        );
        CREATE TABLE expense_fund_deductions(
          expense_id TEXT NOT NULL,
          amount INTEGER NOT NULL
        );
        CREATE TABLE settlements(
          group_id TEXT NOT NULL,
          from_member TEXT NOT NULL,
          to_member TEXT NOT NULL,
          type TEXT NOT NULL,
          amount INTEGER NOT NULL
        );
        INSERT INTO group_members VALUES ('target', 'group', 0, 1);
        INSERT INTO group_members VALUES ('other', 'group', 0, 1);
        INSERT INTO expenses VALUES ('meal', 'group', 'target', 10000);
        INSERT INTO expense_splits VALUES ('meal', 'target', 5000);
        INSERT INTO expense_splits VALUES ('meal', 'other', 5000);
        """
    )
    return db


def _execute(db: sqlite3.Connection, command) -> None:
    db.execute(command.sql, command.params)


def test_deactivation_assertion_uses_the_live_ledger_and_accepts_repayment():
    """Removing the ledger predicate would allow a creditor to disappear."""
    from chia_api.routes_groups import _settled_assertion_command

    db = _ledger_db()
    command = _settled_assertion_command("group", "target", "USD", token="guard-1")
    with pytest.raises(sqlite3.IntegrityError):
        _execute(db, command)
    db.rollback()

    db.execute(
        "INSERT INTO settlements VALUES (?, ?, ?, ?, ?)",
        ("group", "other", "target", "settle_up", 5000),
    )
    command = _settled_assertion_command("group", "target", "USD", token="guard-2")
    _execute(db, command)


@pytest.mark.parametrize(
    ("initial_balance", "allowed"),
    [(50, True), (51, False), (-50, True), (-51, False)],
)
def test_zero_decimal_currency_deactivation_uses_the_legacy_dust_threshold(
    initial_balance: int, allowed: bool
):
    """Changing the VND half-unit boundary would regress existing settlement UX."""
    from chia_api.routes_groups import _settled_assertion_command

    db = _ledger_db()
    db.execute("DELETE FROM expenses")
    db.execute("DELETE FROM expense_splits")
    db.execute(
        "UPDATE group_members SET initial_balance = ? WHERE id = 'target'",
        (initial_balance,),
    )
    command = _settled_assertion_command("group", "target", "VND", token="dust")
    if allowed:
        _execute(db, command)
    else:
        with pytest.raises(sqlite3.IntegrityError):
            _execute(db, command)


def test_claim_assertion_rejects_inactive_invite_slots_but_direct_claim_can_reactivate_identity():
    """The two legacy claim flows intentionally differ on active placeholders."""
    from chia_api.routes_groups import _claim_assertion_command

    db = sqlite3.connect(":memory:")
    db.executescript(
        """
        CREATE TABLE _finance_assertions(token TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
        CREATE TABLE group_members(id TEXT PRIMARY KEY, group_id TEXT, user_id TEXT, is_active INTEGER);
        INSERT INTO group_members VALUES ('slot', 'group', NULL, 0);
        """
    )
    with pytest.raises(sqlite3.IntegrityError):
        _execute(
            db,
            _claim_assertion_command(
                "group", "slot", require_active=True, token="invite"
            ),
        )
    db.rollback()
    _execute(
        db,
        _claim_assertion_command(
            "group", "slot", require_active=False, token="direct"
        ),
    )


def test_money_values_remain_decimal_in_group_currency_commands():
    """Encoding through float would lose the six-decimal exchange-rate contract."""
    from chia_api.db import Store

    command = Store(None).insert(
        "group_currencies",
        {
            "id": "currency",
            "group_id": "group",
            "currency_code": "EUR",
            "exchange_rate": Decimal("0.123456"),
        },
    )
    assert 123456 in command.params


class _SQLiteStatement:
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


class _SQLiteBinding:
    """Small D1-compatible binding backed by real transactional SQLite."""

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def prepare(self, sql: str):
        return _SQLiteStatement(self.connection, sql)

    async def batch(self, statements):
        results = []
        with self.connection:
            for statement in statements:
                cursor = self.connection.execute(statement.sql, statement.params)
                rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
                results.append({"results": rows})
        return results


class _BeforeAssertionBinding(_SQLiteBinding):
    def __init__(self, connection: sqlite3.Connection, hook):
        super().__init__(connection)
        self.hook = hook
        self.fired = False

    async def batch(self, statements):
        if not self.fired and any(
            "INSERT INTO _finance_assertions" in statement.sql
            for statement in statements
        ):
            self.hook(self.connection)
            self.connection.commit()
            self.fired = True
        return await super().batch(statements)


def _group_store(*, reject_owner: bool = False):
    from chia_api.db import Store

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    owner_check = "CHECK(role <> 'owner')" if reject_owner else ""
    db.executescript(
        f"""
        CREATE TABLE groups(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          currency_code TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL,
          default_category_id TEXT, require_verified_users INTEGER NOT NULL,
          allow_log_on_behalf INTEGER NOT NULL, is_deleted INTEGER NOT NULL,
          deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE group_members(
          id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
          user_id TEXT, display_name TEXT NOT NULL, nicknames TEXT NOT NULL,
          role TEXT NOT NULL {owner_check}, claimed_at TEXT,
          initial_balance INTEGER NOT NULL, is_active INTEGER NOT NULL,
          joined_at TEXT NOT NULL, UNIQUE(group_id, user_id)
        );
        """
    )
    return db, Store(_SQLiteBinding(db))


def _full_store():
    from chia_api.db import Store

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    root = Path(__file__).resolve().parents[1]
    db.executescript((root / "migrations/0001_initial.sql").read_text())
    db.executescript((root / "finance_triggers.sql").read_text())
    timestamp = "2026-09-18T00:00:00+00:00"
    db.executemany(
        """INSERT INTO users(
          id, email, password_hash, display_name, device_id, avatar_url,
          is_verified, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, NULL, 1, ?, ?)""",
        [
            ("10000000-0000-0000-0000-000000000001", "owner@example.com", "Owner", None, timestamp, timestamp),
            ("10000000-0000-0000-0000-000000000002", "guest@example.com", "Guest", "device-123456789", timestamp, timestamp),
        ],
    )
    db.commit()
    return db, Store(_SQLiteBinding(db))


def _user(user_id: str, display_name: str) -> dict:
    return {
        "id": user_id,
        "display_name": display_name,
        "email": None,
        "device_id": None,
        "is_verified": True,
    }


@pytest.mark.asyncio
async def test_create_group_writes_owner_and_group_in_one_store_batch():
    """Dropping either insert would leave a group inaccessible to its creator."""
    from chia_api.common import Context
    from chia_api.routes_groups import create_group
    from shared.schemas.group import GroupCreate

    sqlite_db, store = _group_store()
    ctx = Context(
        store,
        SimpleNamespace(),
        {"id": "user-1", "display_name": "Ada", "is_verified": True},
    )
    group = await create_group(GroupCreate(name="Trip", currency_code="VND"), ctx)

    stored_group = sqlite_db.execute("SELECT * FROM groups").fetchone()
    owner = sqlite_db.execute("SELECT * FROM group_members").fetchone()
    assert stored_group["id"] == group["id"]
    assert (owner["group_id"], owner["user_id"], owner["role"]) == (
        group["id"],
        "user-1",
        "owner",
    )
    assert owner["initial_balance"] == 0


@pytest.mark.asyncio
async def test_create_group_rolls_back_when_owner_insert_fails():
    """A failed owner insert must never commit the first half of group creation."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.routes_groups import create_group
    from shared.schemas.group import GroupCreate

    sqlite_db, store = _group_store(reject_owner=True)
    ctx = Context(
        store,
        SimpleNamespace(),
        {"id": "user-1", "display_name": "Ada", "is_verified": True},
    )
    with pytest.raises(HTTPException) as error:
        await create_group(GroupCreate(name="Trip"), ctx)
    assert error.value.status_code == 409
    assert sqlite_db.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_placeholder_lifecycle_preserves_inactive_direct_claim_and_member_logs():
    """Requiring active on direct claim would strand migrated inactive identities."""
    from chia_api.common import Context
    from chia_api.routes_groups import add_member, claim_member, create_group, update_member
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate, MemberUpdate

    sqlite_db, store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    guest_id = "10000000-0000-0000-0000-000000000002"
    owner_ctx = Context(
        store,
        SimpleNamespace(),
        {"id": owner_id, "display_name": "Owner", "email": "owner@example.com", "is_verified": True},
    )
    group = await create_group(GroupCreate(name="Trip"), owner_ctx)
    placeholder = await add_member(
        uuid.UUID(group["id"]), MemberCreate(display_name="Traveler"), owner_ctx
    )
    await update_member(
        uuid.UUID(group["id"]),
        uuid.UUID(placeholder["id"]),
        MemberUpdate(is_active=False),
        owner_ctx,
    )
    guest_ctx = Context(
        store,
        SimpleNamespace(),
        {
            "id": guest_id,
            "display_name": "Guest",
            "email": "guest@example.com",
            "device_id": "device-123456789",
            "is_verified": True,
        },
    )
    claimed = await claim_member(
        uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), guest_ctx
    )

    assert claimed["user_id"] == guest_id
    assert claimed["is_active"] is False
    actions = [
        row[0]
        for row in sqlite_db.execute(
            "SELECT action FROM group_member_logs WHERE member_id = ? ORDER BY created_at, rowid",
            (placeholder["id"],),
        )
    ]
    assert actions == ["joined", "removed", "claimed"]


@pytest.mark.asyncio
async def test_removing_already_inactive_migrated_member_keeps_legacy_idempotence():
    """Inactive members are outside the ledger even if migrated history is non-zero."""
    from chia_api.common import Context
    from chia_api.routes_groups import create_group, remove_member
    from shared.schemas.group import GroupCreate

    sqlite_db, store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    ctx = Context(
        store,
        SimpleNamespace(),
        {"id": owner_id, "display_name": "Owner", "is_verified": True},
    )
    group = await create_group(GroupCreate(name="Trip"), ctx)
    inactive_id = "20000000-0000-0000-0000-000000000001"
    sqlite_db.execute(
        """INSERT INTO group_members(
          id, group_id, user_id, display_name, role, claimed_at,
          is_active, joined_at, initial_balance, nicknames
        ) VALUES (?, ?, NULL, 'Old member', 'member', NULL, 0, ?, 1000, '')""",
        (inactive_id, group["id"], "2026-09-18T00:00:00+00:00"),
    )
    sqlite_db.commit()

    response = await remove_member(
        uuid.UUID(group["id"]), uuid.UUID(inactive_id), ctx
    )
    assert response == {"detail": "Member removed"}


@pytest.mark.asyncio
async def test_claim_batch_aborts_when_another_user_claims_after_the_precheck():
    """A guarded claim must not overwrite a winner or leave a false audit log."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.db import Store
    from chia_api.routes_groups import add_member, claim_member, create_group
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate

    sqlite_db, initial_store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    guest_id = "10000000-0000-0000-0000-000000000002"
    winner_id = "10000000-0000-0000-0000-000000000003"
    timestamp = "2026-09-18T00:00:00+00:00"
    sqlite_db.execute(
        """INSERT INTO users(
          id, email, password_hash, display_name, device_id, avatar_url,
          is_verified, created_at, updated_at
        ) VALUES (?, NULL, NULL, 'Winner', NULL, NULL, 1, ?, ?)""",
        (winner_id, timestamp, timestamp),
    )
    sqlite_db.commit()
    owner_ctx = Context(initial_store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Trip"), owner_ctx)
    placeholder = await add_member(
        uuid.UUID(group["id"]), MemberCreate(display_name="Traveler"), owner_ctx
    )

    def competing_claim(connection):
        connection.execute(
            "UPDATE group_members SET user_id = ?, claimed_at = ? WHERE id = ?",
            (winner_id, timestamp, placeholder["id"]),
        )

    racing_store = Store(_BeforeAssertionBinding(sqlite_db, competing_claim))
    guest_ctx = Context(racing_store, SimpleNamespace(), _user(guest_id, "Guest"))
    with pytest.raises(HTTPException) as error:
        await claim_member(
            uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), guest_ctx
        )
    assert error.value.status_code == 409
    assert sqlite_db.execute(
        "SELECT user_id FROM group_members WHERE id = ?", (placeholder["id"],)
    ).fetchone()[0] == winner_id
    assert sqlite_db.execute(
        "SELECT COUNT(*) FROM group_member_logs WHERE member_id = ? AND action = 'claimed'",
        (placeholder["id"],),
    ).fetchone()[0] == 0


@pytest.mark.asyncio
async def test_deactivation_batch_rechecks_balance_after_the_python_precheck():
    """A concurrent ledger change must roll back removal and its audit log."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.db import Store
    from chia_api.routes_groups import add_member, create_group, remove_member
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate

    sqlite_db, initial_store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    owner_ctx = Context(initial_store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Trip"), owner_ctx)
    placeholder = await add_member(
        uuid.UUID(group["id"]), MemberCreate(display_name="Traveler"), owner_ctx
    )

    def concurrent_balance_change(connection):
        connection.execute(
            "UPDATE group_members SET initial_balance = 1000 WHERE id = ?",
            (placeholder["id"],),
        )

    racing_ctx = Context(
        Store(_BeforeAssertionBinding(sqlite_db, concurrent_balance_change)),
        SimpleNamespace(),
        _user(owner_id, "Owner"),
    )
    with pytest.raises(HTTPException) as error:
        await remove_member(
            uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), racing_ctx
        )
    assert error.value.status_code == 409
    assert sqlite_db.execute(
        "SELECT is_active FROM group_members WHERE id = ?", (placeholder["id"],)
    ).fetchone()[0] == 1
    assert sqlite_db.execute(
        "SELECT COUNT(*) FROM group_member_logs WHERE member_id = ? AND action = 'removed'",
        (placeholder["id"],),
    ).fetchone()[0] == 0


@pytest.mark.asyncio
async def test_regular_member_cannot_add_group_members():
    """Weakening the role check would expose admin-only membership mutation."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.routes_groups import add_member, create_group
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate

    sqlite_db, store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    guest_id = "10000000-0000-0000-0000-000000000002"
    owner_ctx = Context(store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Trip"), owner_ctx)
    sqlite_db.execute(
        """INSERT INTO group_members(
          id, group_id, user_id, display_name, role, claimed_at,
          is_active, joined_at, initial_balance, nicknames
        ) VALUES (?, ?, ?, 'Guest', 'member', ?, 1, ?, 0, '')""",
        (
            "20000000-0000-0000-0000-000000000002",
            group["id"],
            guest_id,
            "2026-09-18T00:00:00+00:00",
            "2026-09-18T00:00:00+00:00",
        ),
    )
    sqlite_db.commit()
    before = sqlite_db.execute("SELECT COUNT(*) FROM group_members").fetchone()[0]
    guest_ctx = Context(store, SimpleNamespace(), _user(guest_id, "Guest"))
    with pytest.raises(HTTPException) as error:
        await add_member(
            uuid.UUID(group["id"]), MemberCreate(display_name="Forbidden"), guest_ctx
        )
    assert error.value.status_code == 403
    assert sqlite_db.execute("SELECT COUNT(*) FROM group_members").fetchone()[0] == before


@pytest.mark.asyncio
async def test_currency_category_and_payment_method_crud_uses_the_d1_schema():
    """Column drift in any of the three smaller CRUD clusters breaks this flow."""
    from chia_api.common import Context
    from chia_api.routes_groups import (
        add_group_currency,
        create_category,
        create_group,
        create_payment_method,
        delete_category,
        delete_group_currency,
        delete_payment_method,
        disable_payment_method_in_group,
        enable_payment_method_in_group,
        list_group_categories,
        list_group_currencies,
        list_group_payment_methods,
        list_my_group_payment_methods,
        update_category,
        update_group_currency,
        update_payment_method,
    )
    from shared.schemas.category import CategoryCreate
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_currency import GroupCurrencyCreate, GroupCurrencyUpdate
    from shared.schemas.payment_method import (
        EnablePaymentMethodRequest,
        PaymentMethodCreate,
        PaymentMethodUpdate,
    )

    _, store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    ctx = Context(store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Trip", currency_code="USD"), ctx)
    group_id = uuid.UUID(group["id"])

    currency = await add_group_currency(
        group_id,
        GroupCurrencyCreate(currency_code=" eur ", exchange_rate=Decimal("0.923456")),
        ctx,
    )
    assert currency["currency_code"] == "EUR"
    await update_group_currency(
        group_id,
        uuid.UUID(currency["id"]),
        GroupCurrencyUpdate(exchange_rate=Decimal("0.900001")),
        ctx,
    )
    assert (await list_group_currencies(group_id, ctx))[0]["exchange_rate"] == Decimal("0.900001")

    category = await create_category(
        group_id, CategoryCreate(name="Transit", icon="🚇"), ctx
    )
    category = await update_category(
        group_id,
        uuid.UUID(category["id"]),
        CategoryCreate(name="Transport", icon="🚌", is_default=True),
        ctx,
    )
    assert any(
        row["name"] == "Transport" and row["is_default"]
        for row in await list_group_categories(group_id, ctx)
    )

    payment = await create_payment_method(
        PaymentMethodCreate(label="Main", bank_bin="970415", account_number="123"),
        ctx,
    )
    payment = await update_payment_method(
        uuid.UUID(payment["id"]), PaymentMethodUpdate(note="USD only"), ctx
    )
    association = await enable_payment_method_in_group(
        group_id,
        EnablePaymentMethodRequest(payment_method_id=uuid.UUID(payment["id"])),
        ctx,
    )
    assert association["payment_method"]["note"] == "USD only"
    assert (await list_group_payment_methods(group_id, ctx))[0]["member_name"] == "Owner"
    assert (await list_my_group_payment_methods(group_id, ctx))[0]["enabled"] is True

    await disable_payment_method_in_group(group_id, uuid.UUID(payment["id"]), ctx)
    await delete_payment_method(uuid.UUID(payment["id"]), ctx)
    await delete_category(group_id, uuid.UUID(category["id"]), ctx)
    await delete_group_currency(group_id, uuid.UUID(currency["id"]), ctx)
    assert await list_group_currencies(group_id, ctx) == []


@pytest.mark.asyncio
async def test_direct_claim_enforces_verified_only_and_non_deleted_group_admission():
    """Knowing a placeholder UUID must not bypass the group's admission policy."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.routes_groups import add_member, claim_member, create_group
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate

    sqlite_db, store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    guest_id = "10000000-0000-0000-0000-000000000002"
    owner_ctx = Context(store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Private"), owner_ctx)
    placeholder = await add_member(
        uuid.UUID(group["id"]), MemberCreate(display_name="Traveler"), owner_ctx
    )
    sqlite_db.execute(
        "UPDATE groups SET require_verified_users = 1 WHERE id = ?", (group["id"],)
    )
    sqlite_db.commit()
    unverified = _user(guest_id, "Guest") | {"is_verified": False}
    guest_ctx = Context(store, SimpleNamespace(), unverified)

    with pytest.raises(HTTPException) as error:
        await claim_member(
            uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), guest_ctx
        )
    assert (error.value.status_code, error.value.detail) == (
        403,
        "This group requires verified users",
    )
    assert sqlite_db.execute(
        "SELECT user_id FROM group_members WHERE id = ?", (placeholder["id"],)
    ).fetchone()[0] is None

    sqlite_db.execute(
        "UPDATE groups SET require_verified_users = 0, is_deleted = 1 WHERE id = ?",
        (group["id"],),
    )
    sqlite_db.commit()
    with pytest.raises(HTTPException) as error:
        await claim_member(
            uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), guest_ctx
        )
    assert (error.value.status_code, error.value.detail) == (404, "Group not found")


@pytest.mark.asyncio
async def test_member_removal_aborts_if_actor_is_demoted_after_permission_precheck():
    """A stale owner read must not authorize a later destructive write."""
    from fastapi import HTTPException

    from chia_api.common import Context
    from chia_api.db import Store
    from chia_api.routes_groups import add_member, create_group, remove_member
    from shared.schemas.group import GroupCreate
    from shared.schemas.group_member import MemberCreate

    sqlite_db, initial_store = _full_store()
    owner_id = "10000000-0000-0000-0000-000000000001"
    owner_ctx = Context(initial_store, SimpleNamespace(), _user(owner_id, "Owner"))
    group = await create_group(GroupCreate(name="Trip"), owner_ctx)
    placeholder = await add_member(
        uuid.UUID(group["id"]), MemberCreate(display_name="Traveler"), owner_ctx
    )

    def concurrent_demotion(connection):
        connection.execute(
            "UPDATE group_members SET role = 'member' WHERE group_id = ? AND user_id = ?",
            (group["id"], owner_id),
        )

    racing_ctx = Context(
        Store(_BeforeAssertionBinding(sqlite_db, concurrent_demotion)),
        SimpleNamespace(),
        _user(owner_id, "Owner"),
    )
    with pytest.raises(HTTPException) as error:
        await remove_member(
            uuid.UUID(group["id"]), uuid.UUID(placeholder["id"]), racing_ctx
        )
    assert error.value.status_code == 409
    assert sqlite_db.execute(
        "SELECT is_active FROM group_members WHERE id = ?", (placeholder["id"],)
    ).fetchone()[0] == 1


@pytest.mark.asyncio
async def test_dashboard_batches_120_group_ledgers_with_decimal_parity():
    """Group count must not exceed Free-plan queries or D1's 100 bind limit."""
    from chia_api.common import Context
    from chia_api.db import Store
    from chia_api.ledger import balances
    from chia_api.routes_groups import list_groups

    connection = _ledger_db()
    connection.row_factory = sqlite3.Row
    connection.executescript('''
        DELETE FROM group_members;
        DELETE FROM expenses;
        DELETE FROM expense_splits;
        ALTER TABLE group_members ADD COLUMN user_id TEXT;
        CREATE TABLE groups(id TEXT PRIMARY KEY, name TEXT, currency_code TEXT,
                            is_deleted INTEGER, created_at TEXT);
    ''')
    for index in range(123):
        group, a, b, expense = (f'{kind}-{index}' for kind in ('g', 'a', 'b', 'e'))
        connection.execute('INSERT INTO groups VALUES (?, ?, ?, ?, ?)',
                           (group, group, 'USD', int(index == 120), f'{index:03}'))
        connection.executemany('INSERT INTO group_members VALUES (?, ?, ?, ?, ?)', [
            (a, group, 501, int(index != 121), 'owner' if index != 122 else 'stranger'),
            (b, group, -501, 1, None)])
        connection.execute('INSERT INTO expenses VALUES (?, ?, ?, ?)', (expense, group, a, 10001))
        connection.executemany('INSERT INTO expense_splits VALUES (?, ?, ?)',
                               [(expense, a, 4000), (expense, b, 4001)])
        connection.execute('INSERT INTO expense_fund_deductions VALUES (?, ?)', (expense, 2000))
        connection.executemany('INSERT INTO settlements VALUES (?, ?, ?, ?, ?)', [
            (group, b, a, 'settle_up', 1001), (group, a, b, 'gift', 1501)])
    connection.commit()

    class CountingStore(Store):
        query_count = 0
        batch_count = 0

        async def all(self, sql, params=()):
            self.query_count += 1
            assert len(params) <= 100
            return await super().all(sql, params)

        async def batch(self, commands):
            self.query_count += len(commands)
            self.batch_count += 1
            assert all(len(command.params) <= 100 for command in commands)
            return await super().batch(commands)

    store = CountingStore(_SQLiteBinding(connection))
    result = await list_groups(Context(store, {}, {'id': 'owner'}))
    assert len(result) == 120
    assert store.query_count == 6
    assert store.batch_count == 1  # list and ledgers share a transaction snapshot
    for index, row in enumerate(result):
        expected = await balances(store, f'g-{index}')
        assert all(isinstance(value, Decimal) for value in expected.values())
        assert expected == {f'a-{index}': Decimal('20.00'), f'b-{index}': Decimal('-20.00')}
        assert row['my_balance'] == float(expected[f'a-{index}'])
        assert row['member_count'] == 2
    assert await list_groups(Context(store, {}, {'id': 'nobody'})) == []
