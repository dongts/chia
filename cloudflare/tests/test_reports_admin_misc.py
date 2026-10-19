import sqlite3
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _operations(router):
    return {
        (method, route.path)
        for route in router.routes
        for method in route.methods
        if method not in {"HEAD", "OPTIONS"}
    }


def test_registers_complete_reports_admin_and_misc_routes():
    from chia_api.routes_admin import router as admin_router
    from chia_api.routes_misc import router as misc_router
    from chia_api.routes_reports import router as reports_router

    assert _operations(reports_router) == {
        ("GET", "/api/v1/groups/{group_id}/reports/summary"),
        ("GET", "/api/v1/groups/{group_id}/reports/member/{member_id}"),
    }
    assert _operations(misc_router) == {
        ("GET", "/api/v1/notifications"),
        ("PATCH", "/api/v1/notifications/{notification_id}"),
        ("POST", "/api/v1/notifications/mark-all-read"),
        ("POST", "/api/v1/groups/{group_id}/expenses/parse"),
    }
    assert _operations(admin_router) == {
        ("GET", "/api/v1/admin/stats"),
        ("GET", "/api/v1/admin/users"),
        ("GET", "/api/v1/admin/users/{user_id}"),
        ("PATCH", "/api/v1/admin/users/{user_id}"),
        ("POST", "/api/v1/admin/users/{user_id}/reset-password"),
        ("DELETE", "/api/v1/admin/users/{user_id}"),
        ("POST", "/api/v1/admin/users/{user_id}/add-to-group"),
        ("GET", "/api/v1/admin/groups"),
        ("GET", "/api/v1/admin/groups/{group_id}"),
        ("POST", "/api/v1/admin/groups/{group_id}/members"),
        ("PATCH", "/api/v1/admin/groups/{group_id}/members/{member_id}"),
        ("DELETE", "/api/v1/admin/groups/{group_id}/members/{member_id}"),
        ("DELETE", "/api/v1/admin/groups/{group_id}"),
        ("GET", "/api/v1/admin/groups/{group_id}/expenses"),
        ("DELETE", "/api/v1/admin/expenses/{expense_id}"),
        ("DELETE", "/api/v1/admin/settlements/{settlement_id}"),
        ("DELETE", "/api/v1/admin/notifications/all"),
        ("GET", "/api/v1/admin/me"),
        ("POST", "/api/v1/admin/groups/{group_id}/members/{source_member_id}/merge-into/{target_member_id}"),
        ("POST", "/api/v1/admin/users/{source_user_id}/merge-into/{target_user_id}"),
        ("GET", "/api/v1/admin/config"),
        ("PATCH", "/api/v1/admin/config/{key:path}"),
    }


class SQLiteStatement:
    def __init__(self, connection, sql):
        self.connection = connection
        self.sql = sql
        self.params = ()

    def bind(self, *params):
        self.params = params
        return self

    async def all(self):
        cursor = self.connection.execute(self.sql, self.params)
        return {"results": [dict(row) for row in cursor.fetchall()] if cursor.description else []}


class SQLiteBinding:
    def __init__(self, connection):
        self.connection = connection

    def prepare(self, sql):
        return SQLiteStatement(self.connection, sql)

    async def batch(self, statements):
        results = []
        with self.connection:
            for statement in statements:
                cursor = self.connection.execute(statement.sql, statement.params)
                results.append({
                    "results": [dict(row) for row in cursor.fetchall()] if cursor.description else []
                })
        return results


def _store():
    from chia_api.db import Store

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    migration = Path(__file__).parents[1] / "migrations" / "0001_initial.sql"
    connection.executescript(migration.read_text())
    return connection, Store(SQLiteBinding(connection))


@pytest.mark.asyncio
async def test_notification_updates_are_scoped_to_authenticated_user():
    from chia_api.common import Context
    from chia_api.routes_misc import mark_notification_read

    connection, store = _store()
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())
    notification_id = str(uuid.uuid4())
    connection.execute(
        "INSERT INTO users(id,display_name,is_verified,created_at,updated_at) VALUES(?,?,0,?,?)",
        (user_a, "A", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO users(id,display_name,is_verified,created_at,updated_at) VALUES(?,?,0,?,?)",
        (user_b, "B", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO notifications(id,user_id,type,data,read,created_at) VALUES(?,?,?,'{}',0,?)",
        (notification_id, user_b, "test", "2026-01-01T00:00:00Z"),
    )
    connection.commit()
    ctx = Context(store, SimpleNamespace(), {"id": user_a})

    with pytest.raises(HTTPException) as error:
        await mark_notification_read(uuid.UUID(notification_id), ctx)
    assert error.value.status_code == 404
    assert connection.execute("SELECT read FROM notifications").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_member_report_activity_reconciles_with_authoritative_balance():
    from chia_api.common import Context
    from chia_api.routes_reports import report_member_detail

    connection, store = _store()
    ids = {name: str(uuid.uuid4()) for name in ("user", "group", "category", "target", "other", "expense", "split_a", "split_a2", "split_b", "settlement")}
    timestamp = "2026-01-02T00:00:00+00:00"
    connection.executescript("PRAGMA foreign_keys=ON;")
    connection.execute("INSERT INTO users(id,display_name,is_verified,created_at,updated_at) VALUES(?,?,1,?,?)", (ids["user"], "Ada", timestamp, timestamp))
    connection.execute("INSERT INTO groups(id,name,currency_code,invite_code,require_verified_users,allow_log_on_behalf,is_deleted,created_at,updated_at) VALUES(?,?,?,?,0,1,0,?,?)", (ids["group"], "Trip", "USD", "INVITE", timestamp, timestamp))
    connection.execute("INSERT INTO categories(id,group_id,name,icon,is_default,created_at) VALUES(?,?,?,?,0,?)", (ids["category"], ids["group"], "Food", "🍜", timestamp))
    for member_id, user_id, name, initial in ((ids["target"], ids["user"], "Ada", 500), (ids["other"], None, "Bob", 0)):
        connection.execute("INSERT INTO group_members(id,group_id,user_id,display_name,nicknames,role,initial_balance,is_active,joined_at) VALUES(?,?,?,?,?,'member',?,1,?)", (member_id, ids["group"], user_id, name, "", initial, timestamp))
    connection.execute("INSERT INTO expenses(id,group_id,paid_by,created_by,description,amount,currency_code,exchange_rate,converted_amount,category_id,date,created_at,updated_at) VALUES(?,?,?,?,?,10000,'USD',1000000,10000,?,'2026-01-01',?,?)", (ids["expense"], ids["group"], ids["target"], ids["target"], "Meal", ids["category"], timestamp, timestamp))
    connection.execute("INSERT INTO expense_splits VALUES(?,?,?,'exact',400000,4000)", (ids["split_a"], ids["expense"], ids["target"]))
    connection.execute("INSERT INTO expense_splits VALUES(?,?,?,'exact',100000,1000)", (ids["split_a2"], ids["expense"], ids["target"]))
    connection.execute("INSERT INTO expense_splits VALUES(?,?,?,'exact',500000,5000)", (ids["split_b"], ids["expense"], ids["other"]))
    connection.execute("INSERT INTO settlements(id,group_id,from_member,to_member,amount,created_by,settled_at,description,type) VALUES(?,?,?,?,1000,?,?,?,'settle_up')", (ids["settlement"], ids["group"], ids["other"], ids["target"], ids["other"], timestamp, "Paid"))
    connection.commit()
    ctx = Context(store, SimpleNamespace(), {"id": ids["user"]})

    report = await report_member_detail(uuid.UUID(ids["group"]), uuid.UUID(ids["target"]), ctx)

    assert report["net_balance"] == 45.0
    assert report["initial_balance"] == 5.0
    assert sum(item["net_effect"] for item in report["balance_activity"]) == 40.0
    assert {item["kind"] for item in report["balance_activity"]} == {"expense", "settle_up"}


@pytest.mark.asyncio
async def test_admin_config_upsert_uses_store_and_preserves_registry_defaults():
    from chia_api.common import Context
    from chia_api.routes_admin import ConfigUpdateRequest, list_config, update_config

    connection, store = _store()
    ctx = Context(store, SimpleNamespace(), {"id": "admin", "email": "admin@example.com"})

    defaults = await list_config(ctx)
    assert {item["key"]: item["value"] for item in defaults}["llm.default_parsing_level"] == "basic"

    await update_config("llm.default_parsing_level", ConfigUpdateRequest(value="full"), ctx)
    await update_config("llm.default_parsing_level", ConfigUpdateRequest(value="smart"), ctx)

    assert connection.execute(
        "SELECT value FROM system_config WHERE key='llm.default_parsing_level'"
    ).fetchone()[0] == "smart"
    assert connection.execute("SELECT COUNT(*) FROM system_config").fetchone()[0] == 1


@pytest.mark.asyncio
async def test_admin_member_merge_transfers_initial_balance_once_and_clears_source():
    from decimal import Decimal

    from chia_api.common import Context
    from chia_api.routes_admin import merge_group_members

    connection, store = _store()
    connection.execute(
        "CREATE TABLE _finance_assertions(token TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1))"
    )
    group_id, source_id, target_id = (str(uuid.uuid4()) for _ in range(3))
    timestamp = "2026-01-01T00:00:00Z"
    connection.execute("INSERT INTO groups(id,name,currency_code,invite_code,require_verified_users,allow_log_on_behalf,is_deleted,created_at,updated_at) VALUES(?,?,?, ?,0,1,0,?,?)", (group_id, "Trip", "USD", "MERGE", timestamp, timestamp))
    for member_id, name, initial in ((source_id, "Source", 725), (target_id, "Target", -200)):
        connection.execute("INSERT INTO group_members(id,group_id,display_name,nicknames,role,initial_balance,is_active,joined_at) VALUES(?,?,?,'','member',?,1,?)", (member_id, group_id, name, initial, timestamp))
    connection.commit()
    ctx = Context(store, SimpleNamespace(), {"id": "admin", "email": "admin@example.com"})

    await merge_group_members(uuid.UUID(group_id), uuid.UUID(source_id), uuid.UUID(target_id), ctx)

    source = await store.one("group_members", "id=?", (source_id,))
    target = await store.one("group_members", "id=?", (target_id,))
    assert source["initial_balance"] == Decimal("0")
    assert source["is_active"] is False
    assert target["initial_balance"] == Decimal("5.25")

    with pytest.raises(HTTPException) as error:
        await merge_group_members(uuid.UUID(group_id), uuid.UUID(source_id), uuid.UUID(target_id), ctx)
    assert error.value.status_code in {400, 409}
    assert (await store.one("group_members", "id=?", (target_id,)))["initial_balance"] == Decimal("5.25")
