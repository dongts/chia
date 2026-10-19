"""Superadmin routes for D1-backed operational administration."""

from decimal import Decimal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from chia_api.auth import hash_password, merge_user_into
from chia_api.common import Context, admin_context, new_id, now
from chia_api.db import Command
from chia_api.routes_misc import CONFIG_REGISTRY


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
ROLES = {"owner", "admin", "member"}


def _user_read(user):
    return {key: user.get(key) for key in ("id", "email", "display_name", "avatar_url", "is_verified", "created_at")}


async def _required(db, table, where, params, message):
    row = await db.one(table, where, params)
    if row is None:
        raise HTTPException(404, message)
    return row


def _check_role(role):
    if role not in ROLES:
        raise HTTPException(400, "Invalid member role")
    return role


@router.get("/stats")
async def get_stats(ctx: Context = Depends(admin_context)):
    values = {}
    for name, table in (("users", "users"), ("groups", "groups"),
                        ("expenses", "expenses"), ("settlements", "settlements")):
        values[name] = await ctx.db.scalar(f'SELECT COUNT(*) FROM "{table}"')
    return values


@router.get("/users")
async def list_users(limit: int = Query(50, le=200), offset: int = Query(0),
                     search: str = Query(""), ctx: Context = Depends(admin_context)):
    where, params = "", ()
    if search:
        where, params = "WHERE LOWER(display_name) LIKE ? OR LOWER(email) LIKE ?", (f"%{search.lower()}%",) * 2
    rows = await ctx.db.all(f"SELECT * FROM users {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                            (*params, limit, offset))
    total = await ctx.db.scalar(f"SELECT COUNT(*) FROM users {where}", params)
    return {"items": [_user_read(ctx.db.decode("users", row)) for row in rows], "total": total}


@router.get("/users/{user_id}")
async def get_user(user_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    user = await _required(ctx.db, "users", "id = ?", (str(user_id),), "User not found")
    groups = await ctx.db.all("""SELECT g.id,g.name,g.currency_code,m.role FROM group_members m
        JOIN groups g ON g.id=m.group_id WHERE m.user_id=? AND m.is_active=1""", (str(user_id),))
    return {**_user_read(user), "groups": groups}


@router.patch("/users/{user_id}")
async def update_user(user_id: uuid.UUID, data: dict, ctx: Context = Depends(admin_context)):
    user = await _required(ctx.db, "users", "id = ?", (str(user_id),), "User not found")
    changes = {key: data[key] for key in ("display_name", "email", "is_verified") if key in data}
    if changes:
        changes["updated_at"] = now()
        await ctx.db.batch([ctx.db.update("users", changes, "id = ?", (str(user_id),))])
        user.update(changes)
    return _user_read(user)


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: uuid.UUID, data: ResetPasswordRequest,
                         ctx: Context = Depends(admin_context)):
    await _required(ctx.db, "users", "id = ?", (str(user_id),), "User not found")
    await ctx.db.batch([ctx.db.update("users", {"password_hash": hash_password(data.new_password),
                                                "updated_at": now()}, "id = ?", (str(user_id),))])
    return {"detail": "Password reset successfully"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    await _required(ctx.db, "users", "id = ?", (str(user_id),), "User not found")
    await ctx.db.batch([ctx.db.delete("users", "id = ?", (str(user_id),))])
    return {"detail": "User deleted"}


class AddUserToGroupRequest(BaseModel):
    group_id: uuid.UUID
    role: str = "member"


@router.post("/users/{user_id}/add-to-group")
async def add_user_to_group(user_id: uuid.UUID, data: AddUserToGroupRequest,
                            ctx: Context = Depends(admin_context)):
    user = await _required(ctx.db, "users", "id = ?", (str(user_id),), "User not found")
    group = await _required(ctx.db, "groups", "id = ?", (str(data.group_id),), "Group not found")
    if await ctx.db.one("group_members", "group_id = ? AND user_id = ? AND is_active = 1",
                        (str(data.group_id), str(user_id))):
        raise HTTPException(400, "User is already a member of this group")
    timestamp = now()
    await ctx.db.batch([ctx.db.insert("group_members", {"id": new_id(), "group_id": str(data.group_id),
        "user_id": str(user_id), "display_name": user["display_name"], "nicknames": "",
        "role": _check_role(data.role), "claimed_at": timestamp, "initial_balance": Decimal("0"),
        "is_active": True, "joined_at": timestamp})])
    return {"detail": f"User added to {group['name']} as {data.role}"}


@router.get("/groups")
async def list_groups(limit: int = Query(50, le=200), offset: int = Query(0),
                      search: str = Query(""), ctx: Context = Depends(admin_context)):
    where, params = "", ()
    if search:
        where, params = "WHERE LOWER(g.name) LIKE ?", (f"%{search.lower()}%",)
    rows = await ctx.db.all(f"""SELECT g.*,COUNT(m.id) member_count FROM groups g
        LEFT JOIN group_members m ON m.group_id=g.id AND m.is_active=1 {where}
        GROUP BY g.id ORDER BY g.created_at DESC LIMIT ? OFFSET ?""", (*params, limit, offset))
    total = await ctx.db.scalar(f"SELECT COUNT(*) FROM groups g {where}", params)
    return {"items": [{"id": row["id"], "name": row["name"], "currency_code": row["currency_code"],
        "invite_code": row["invite_code"], "member_count": row["member_count"],
        "created_at": row["created_at"]} for row in rows], "total": total}


@router.get("/groups/{group_id}")
async def get_group_detail(group_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    key = str(group_id)
    group = await _required(ctx.db, "groups", "id = ?", (key,), "Group not found")
    members = await ctx.db.all("""SELECT m.*,u.email FROM group_members m LEFT JOIN users u ON u.id=m.user_id
        WHERE m.group_id=? ORDER BY m.joined_at""", (key,))
    currencies = await ctx.db.rows("group_currencies", "group_id = ?", (key,))
    return {**group, "members": [{"id": row["id"], "display_name": row["display_name"],
        "role": row["role"], "user_id": row["user_id"], "email": row["email"],
        "is_active": bool(row["is_active"])} for row in members],
        "currencies": [{"id": row["id"], "currency_code": row["currency_code"],
                        "exchange_rate": float(row["exchange_rate"])} for row in currencies],
        "expenses_count": await ctx.db.scalar("SELECT COUNT(*) FROM expenses WHERE group_id=?", (key,))}


class AddMemberToGroupRequest(BaseModel):
    display_name: str
    user_id: uuid.UUID | None = None
    role: str = "member"


@router.post("/groups/{group_id}/members")
async def add_member_to_group(group_id: uuid.UUID, data: AddMemberToGroupRequest,
                              ctx: Context = Depends(admin_context)):
    key = str(group_id)
    group = await _required(ctx.db, "groups", "id = ?", (key,), "Group not found")
    user_id = str(data.user_id) if data.user_id else None
    if user_id and await ctx.db.one("group_members", "group_id = ? AND user_id = ? AND is_active = 1", (key, user_id)):
        raise HTTPException(400, "User is already a member of this group")
    timestamp = now()
    await ctx.db.batch([ctx.db.insert("group_members", {"id": new_id(), "group_id": key,
        "user_id": user_id, "display_name": data.display_name, "nicknames": "",
        "role": _check_role(data.role), "claimed_at": timestamp if user_id else None,
        "initial_balance": Decimal("0"), "is_active": True, "joined_at": timestamp})])
    return {"detail": f"Member '{data.display_name}' added to {group['name']}"}


class UpdateMemberRequest(BaseModel):
    display_name: str | None = None
    role: str | None = None


@router.patch("/groups/{group_id}/members/{member_id}")
async def update_group_member(group_id: uuid.UUID, member_id: uuid.UUID, data: UpdateMemberRequest,
                              ctx: Context = Depends(admin_context)):
    member = await _required(ctx.db, "group_members", "id = ? AND group_id = ?",
                             (str(member_id), str(group_id)), "Member not found")
    changes = data.model_dump(exclude_none=True)
    if "role" in changes: changes["role"] = _check_role(changes["role"])
    if changes:
        await ctx.db.batch([ctx.db.update("group_members", changes, "id = ?", (str(member_id),))])
        member.update(changes)
    return {key: member[key] for key in ("id", "display_name", "role", "is_active")}


@router.delete("/groups/{group_id}/members/{member_id}")
async def delete_group_member(group_id: uuid.UUID, member_id: uuid.UUID,
                              ctx: Context = Depends(admin_context)):
    key = str(member_id)
    member = await _required(ctx.db, "group_members", "id = ? AND group_id = ?",
                             (key, str(group_id)), "Member not found")
    commands = [Command("DELETE FROM expenses WHERE paid_by=? OR created_by=?", (key, key)),
        Command("DELETE FROM settlements WHERE from_member=? OR to_member=? OR created_by=?", (key, key, key)),
        Command("DELETE FROM group_member_logs WHERE member_id=? OR performed_by=?", (key, key)),
        ctx.db.delete("group_payment_methods", "member_id = ?", (key,)),
        Command("DELETE FROM fund_transactions WHERE (member_id=? OR created_by=? OR fund_id IN "
                "(SELECT id FROM funds WHERE holder_id=? OR created_by=?)) "
                "AND type IN ('withdraw','expense')", (key, key, key, key)),
        Command("DELETE FROM fund_transactions WHERE member_id=? OR created_by=? OR fund_id IN "
                "(SELECT id FROM funds WHERE holder_id=? OR created_by=?)", (key, key, key, key)),
        ctx.db.delete("expense_fund_deductions", "created_by = ?", (key,)),
        ctx.db.delete("funds", "holder_id = ? OR created_by = ?", (key, key)),
        ctx.db.delete("expense_splits", "group_member_id = ?", (key,)),
        ctx.db.delete("group_members", "id = ?", (key,))]
    await ctx.db.batch(commands)
    return {"detail": f"Member '{member['display_name']}' permanently deleted"}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    group = await _required(ctx.db, "groups", "id = ?", (str(group_id),), "Group not found")
    await ctx.db.batch([ctx.db.delete("groups", "id = ?", (group["id"],))])
    return {"detail": "Group deleted"}


@router.get("/groups/{group_id}/expenses")
async def list_group_expenses(group_id: uuid.UUID, limit: int = Query(50, le=200),
                              offset: int = Query(0), ctx: Context = Depends(admin_context)):
    rows = await ctx.db.all("""SELECT e.*,m.display_name payer_name FROM expenses e
        LEFT JOIN group_members m ON m.id=e.paid_by WHERE e.group_id=?
        ORDER BY e.date DESC LIMIT ? OFFSET ?""", (str(group_id), limit, offset))
    items = []
    for raw in rows:
        payer = raw.pop("payer_name", None)
        row = ctx.db.decode("expenses", raw)
        items.append({"id": row["id"], "description": row["description"], "amount": float(row["amount"]),
            "currency_code": row["currency_code"], "exchange_rate": float(row["exchange_rate"]),
            "converted_amount": float(row["converted_amount"]), "date": row["date"],
            "payer_name": payer, "created_at": row["created_at"]})
    total = await ctx.db.scalar("SELECT COUNT(*) FROM expenses WHERE group_id=?", (str(group_id),))
    return {"items": items, "total": total}


async def _delete_named(ctx, table, row_id, label):
    await _required(ctx.db, table, "id = ?", (str(row_id),), f"{label} not found")
    await ctx.db.batch([ctx.db.delete(table, "id = ?", (str(row_id),))])
    return {"detail": f"{label} deleted"}


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    return await _delete_named(ctx, "expenses", expense_id, "Expense")


@router.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    return await _delete_named(ctx, "settlements", settlement_id, "Settlement")


@router.delete("/notifications/all")
async def delete_all_notifications(ctx: Context = Depends(admin_context)):
    await ctx.db.batch([Command("DELETE FROM notifications")])
    return {"detail": "All notifications deleted"}


@router.get("/me")
async def admin_check(ctx: Context = Depends(admin_context)):
    return {"email": ctx.user["email"], "is_superadmin": True}


@router.post("/groups/{group_id}/members/{source_member_id}/merge-into/{target_member_id}")
async def merge_group_members(group_id: uuid.UUID, source_member_id: uuid.UUID,
                              target_member_id: uuid.UUID, ctx: Context = Depends(admin_context)):
    source_key, target_key = str(source_member_id), str(target_member_id)
    if source_key == target_key: raise HTTPException(400, "Cannot merge a member into themselves")
    source = await _required(ctx.db, "group_members", "id = ? AND group_id = ?",
                             (source_key, str(group_id)), "Source member not found")
    target = await _required(ctx.db, "group_members", "id = ? AND group_id = ?",
                             (target_key, str(group_id)), "Target member not found")
    if not source["is_active"]:
        raise HTTPException(400, "Source member is inactive")
    if not target["is_active"]:
        raise HTTPException(400, "Target member is inactive")
    refs = {"expenses": ("paid_by", "created_by"), "expense_splits": ("group_member_id",),
        "settlements": ("from_member", "to_member", "created_by"),
        "group_member_logs": ("member_id", "performed_by"), "group_payment_methods": ("member_id",),
        "funds": ("holder_id", "created_by"), "fund_transactions": ("member_id", "created_by"),
        "expense_fund_deductions": ("created_by",), "expense_logs": ("actor_member_id",)}
    token = new_id()
    commands = [Command("INSERT INTO _finance_assertions(token,ok) SELECT ?,CASE WHEN "
        "EXISTS(SELECT 1 FROM group_members WHERE id=? AND group_id=? AND is_active=1) AND "
        "EXISTS(SELECT 1 FROM group_members WHERE id=? AND group_id=? AND is_active=1) "
        "THEN 1 ELSE 0 END", (token, source_key, str(group_id), target_key, str(group_id)))]
    commands.extend(ctx.db.update(table, {column: target_key}, f"{column} = ?", (source_key,))
                    for table, columns in refs.items() for column in columns)
    role = max((source["role"], target["role"]), key=lambda value: {"owner": 3, "admin": 2, "member": 1}[value])
    commands.extend([Command("UPDATE group_members SET initial_balance=initial_balance+"
        "(SELECT initial_balance FROM group_members WHERE id=?),role=?,is_active=1 WHERE id=?",
        (source_key, role, target_key)),
        ctx.db.update("group_members", {"initial_balance": Decimal("0"), "is_active": False,
                                        "user_id": None}, "id = ?", (source_key,)),
        Command("DELETE FROM _finance_assertions WHERE token=?", (token,))])
    await ctx.db.batch(commands)
    return {"detail": f"Merged member '{source['display_name']}' into '{target['display_name']}'",
            "source_name": source["display_name"], "target_name": target["display_name"]}


@router.post("/users/{source_user_id}/merge-into/{target_user_id}")
async def merge_users(source_user_id: uuid.UUID, target_user_id: uuid.UUID,
                      ctx: Context = Depends(admin_context)):
    try: result = await merge_user_into(ctx.db, source_user_id, target_user_id)
    except ValueError as error: raise HTTPException(404, str(error)) from error
    return {"detail": f"Merged user '{result['source_name']}' into '{result['target_name']}'",
            "merged_groups": result["merged_groups"], "moved_groups": result["moved_groups"],
            "source_deleted": True}


@router.get("/config")
async def list_config(ctx: Context = Depends(admin_context)):
    rows = {row["key"]: row["value"] for row in await ctx.db.rows("system_config")}
    return [{"key": key, "value": rows.get(key, meta["default"]), **meta}
            for key, meta in CONFIG_REGISTRY.items()]


class ConfigUpdateRequest(BaseModel):
    value: str


@router.patch("/config/{key:path}")
async def update_config(key: str, data: ConfigUpdateRequest, ctx: Context = Depends(admin_context)):
    if key not in CONFIG_REGISTRY: raise HTTPException(404, f"Config key '{key}' not found")
    command = Command("INSERT INTO system_config(key,value,updated_at) VALUES(?,?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                      (key, data.value, now()))
    await ctx.db.batch([command])
    return {"key": key, "value": data.value}
