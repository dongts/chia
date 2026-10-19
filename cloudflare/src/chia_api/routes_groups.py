"""Groups, membership, currencies, categories, and payment-method routes."""

from __future__ import annotations

import secrets
import string
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel

from chia_api.common import (
    Context,
    auth_context,
    get_group,
    log_member_command,
    new_id,
    now,
    public_context,
    require_member,
    require_role,
    upload_file,
)
from chia_api.db import Command
from chia_api.ledger import balances, dashboard_balances
from shared.balances import settled_threshold, suggest_settlements_for_member
from shared.schemas.category import CategoryCreate, CategoryRead
from shared.schemas.group import GroupCreate, GroupListItem, GroupRead, GroupUpdate
from shared.schemas.group_currency import (
    GroupCurrencyCreate,
    GroupCurrencyRead,
    GroupCurrencyUpdate,
)
from shared.schemas.group_member import MemberCreate, MemberRead, MemberUpdate
from shared.schemas.payment_method import (
    EnablePaymentMethodRequest,
    GroupPaymentMethodRead,
    MyGroupPaymentMethodRead,
    PaymentMethodCreate,
    PaymentMethodRead,
    PaymentMethodUpdate,
)


router = APIRouter(prefix="/api/v1")
ZERO = Decimal("0")
CENT = Decimal("0.01")


def _invite_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _assertion_cleanup(token: str) -> Command:
    return Command("DELETE FROM _finance_assertions WHERE token = ?", (token,))


def _claim_assertion_command(
    group_id: str,
    member_id: str,
    *,
    require_active: bool,
    user_is_verified: bool | None = None,
    token: str | None = None,
) -> Command:
    """Assert that a placeholder is still claimable inside the write batch."""
    token = token or new_id()
    active = " AND is_active = 1" if require_active else ""
    admission = ""
    params: list = [token, str(member_id), str(group_id)]
    if user_is_verified is not None:
        admission = (
            " AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND is_deleted = 0 "
            "AND (require_verified_users = 0 OR ? = 1))"
        )
        params.extend([str(group_id), user_is_verified])
    return Command(
        "INSERT INTO _finance_assertions(token, ok) "
        "SELECT ?, CASE WHEN EXISTS ("
        "SELECT 1 FROM group_members "
        f"WHERE id = ? AND group_id = ? AND user_id IS NULL{active}"
        ")" + admission + " THEN 1 ELSE 0 END",
        tuple(params),
    )


def _member_limit_assertion_command(
    group_id: str, token: str, user_is_verified: bool | None = None
) -> Command:
    admission = ""
    params: list = [token, str(group_id)]
    if user_is_verified is not None:
        admission = (
            " AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND is_deleted = 0 "
            "AND (require_verified_users = 0 OR ? = 1))"
        )
        params.extend([str(group_id), user_is_verified])
    return Command(
        "INSERT INTO _finance_assertions(token, ok) "
        "SELECT ?, CASE WHEN (SELECT COUNT(*) FROM group_members "
        "WHERE group_id = ? AND is_active = 1) < 100"
        + admission
        + " THEN 1 ELSE 0 END",
        tuple(params),
    )


def _member_mutation_assertion_command(
    group_id: str,
    actor_id: str,
    target_id: str,
    roles: tuple[str, ...],
    *,
    target_must_be_claimed: bool = False,
    target_must_not_be_owner: bool = False,
    token: str | None = None,
) -> Command:
    """Recheck membership authorization and target invariants in the batch."""
    token = token or new_id()
    role_slots = ",".join("?" for _ in roles)
    target_checks = ""
    if target_must_be_claimed:
        target_checks += " AND user_id IS NOT NULL"
    if target_must_not_be_owner:
        target_checks += " AND role <> 'owner'"
    return Command(
        "INSERT INTO _finance_assertions(token, ok) SELECT ?, CASE WHEN "
        "EXISTS (SELECT 1 FROM group_members WHERE id = ? AND group_id = ? "
        f"AND is_active = 1 AND role IN ({role_slots})) "
        "AND EXISTS (SELECT 1 FROM group_members WHERE id = ? AND group_id = ?"
        + target_checks
        + ") THEN 1 ELSE 0 END",
        (token, str(actor_id), str(group_id), *roles, str(target_id), str(group_id)),
    )


def _settled_assertion_command(
    group_id: str,
    member_id: str,
    currency_code: str,
    *,
    token: str | None = None,
) -> Command:
    """Assert against the live ledger in the same transaction as deactivation.

    D1 stores every amount in hundredths. For zero-decimal currencies the
    legacy Decimal quantization treats up to half a unit as settlement dust.
    """
    token = token or new_id()
    max_abs_cents = 50 if currency_code.upper() in {
        "VND", "JPY", "KRW", "CLP", "ISK", "UGX", "GNF", "BIF", "DJF",
        "KMF", "MGA", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
    } else 0
    sql = """
        INSERT INTO _finance_assertions(token, ok)
        SELECT ?, CASE WHEN ABS(
            gm.initial_balance
            + COALESCE((
                SELECT SUM(e.converted_amount - COALESCE((
                    SELECT SUM(d.amount)
                    FROM expense_fund_deductions d
                    WHERE d.expense_id = e.id
                ), 0))
                FROM expenses e
                WHERE e.group_id = gm.group_id AND e.paid_by = gm.id
            ), 0)
            - COALESCE((
                SELECT SUM(s.resolved_amount)
                FROM expense_splits s
                JOIN expenses e ON e.id = s.expense_id
                WHERE e.group_id = gm.group_id AND s.group_member_id = gm.id
            ), 0)
            + COALESCE((
                SELECT SUM(
                    CASE WHEN st.from_member = gm.id
                        THEN CASE WHEN st.type = 'gift' THEN -st.amount ELSE st.amount END
                        ELSE 0 END
                    + CASE WHEN st.to_member = gm.id
                        THEN CASE WHEN st.type = 'gift' THEN st.amount ELSE -st.amount END
                        ELSE 0 END
                )
                FROM settlements st
                WHERE st.group_id = gm.group_id
            ), 0)
        ) <= ? THEN 1 ELSE 0 END
        FROM group_members gm
        WHERE gm.id = ? AND gm.group_id = ?
    """
    return Command(sql, (token, max_abs_cents, str(member_id), str(group_id)))


async def _group_by_invite(ctx: Context, invite_code: str) -> dict:
    group = await ctx.db.one(
        "groups", "invite_code = ? AND is_deleted = 0", (invite_code,)
    )
    if group is None:
        raise HTTPException(404, "Invalid invite code")
    return group


def _new_group_values(data: GroupCreate) -> dict:
    timestamp = now()
    return {
        "id": new_id(),
        "name": data.name,
        "description": data.description,
        "currency_code": data.currency_code,
        "invite_code": _invite_code(),
        "default_category_id": None,
        "require_verified_users": False,
        "allow_log_on_behalf": True,
        "is_deleted": False,
        "deleted_at": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _new_member_values(
    group_id: str,
    display_name: str,
    *,
    user_id: str | None = None,
    role: str = "member",
    nicknames: str = "",
    initial_balance: Decimal = ZERO,
) -> dict:
    timestamp = now()
    return {
        "id": new_id(),
        "group_id": str(group_id),
        "user_id": user_id,
        "display_name": display_name,
        "nicknames": nicknames,
        "role": role,
        "claimed_at": timestamp if user_id else None,
        "initial_balance": initial_balance,
        "is_active": True,
        "joined_at": timestamp,
    }


@router.post("/groups", response_model=GroupRead, tags=["groups"])
async def create_group(data: GroupCreate, ctx: Context = Depends(auth_context)):
    group = _new_group_values(data)
    member = _new_member_values(
        group["id"], ctx.user["display_name"], user_id=ctx.user["id"], role="owner"
    )
    await ctx.db.batch(
        [ctx.db.insert("groups", group), ctx.db.insert("group_members", member)]
    )
    return group


@router.get("/groups", response_model=list[GroupListItem], tags=["groups"])
async def list_groups(ctx: Context = Depends(auth_context)):
    rows, all_balances = await dashboard_balances(ctx.db, ctx.user["id"])
    result = []
    for row in rows:
        group = ctx.db.decode("groups", row)
        group_balances = all_balances[group["id"]]
        result.append(
            {
                "id": group["id"],
                "name": group["name"],
                "currency_code": group["currency_code"],
                "member_count": row["member_count"],
                "my_balance": float(
                    group_balances.get(row["my_member_id"], ZERO).quantize(CENT)
                ),
                "created_at": group["created_at"],
            }
        )
    return result


@router.get("/groups/{group_id}", response_model=GroupRead, tags=["groups"])
async def read_group(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    await require_member(ctx, group_id)
    group["member_count"] = await ctx.db.scalar(
        "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND is_active = 1",
        (str(group_id),),
    )
    return group


@router.patch("/groups/{group_id}", response_model=GroupRead, tags=["groups"])
async def update_group(
    group_id: uuid.UUID, data: GroupUpdate, ctx: Context = Depends(auth_context)
):
    group = await get_group(ctx.db, group_id)
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    changes = data.model_dump(exclude_unset=True)
    if changes:
        changes["updated_at"] = now()
        await ctx.db.batch(
            [ctx.db.update("groups", changes, "id = ?", (str(group_id),))]
        )
        group.update(changes)
    return group


@router.delete("/groups/{group_id}", tags=["groups"])
async def delete_group(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await get_group(ctx.db, group_id)
    member = await require_member(ctx, group_id)
    require_role(member, "owner")
    await ctx.db.batch(
        [
            ctx.db.update(
                "groups",
                {"is_deleted": True, "deleted_at": now(), "updated_at": now()},
                "id = ?",
                (str(group_id),),
            )
        ]
    )
    return {"detail": "Group deleted"}


@router.get("/groups/preview/{invite_code}", tags=["groups"])
async def preview_group(
    invite_code: str, ctx: Context = Depends(public_context)
):
    group = await _group_by_invite(ctx, invite_code)
    unclaimed = await ctx.db.rows(
        "group_members",
        "group_id = ? AND user_id IS NULL AND is_active = 1",
        (group["id"],),
        "display_name",
    )
    count = await ctx.db.scalar(
        "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND is_active = 1",
        (group["id"],),
    )
    return {
        "id": group["id"],
        "name": group["name"],
        "currency_code": group["currency_code"],
        "member_count": count,
        "require_verified_users": group["require_verified_users"],
        "unclaimed_members": [
            {"id": member["id"], "display_name": member["display_name"]}
            for member in unclaimed
        ],
    }


class JoinGroupRequest(BaseModel):
    claim_member_id: uuid.UUID | None = None
    display_name: str | None = None


@router.post("/groups/join/{invite_code}", response_model=GroupRead, tags=["groups"])
async def join_group(
    invite_code: str,
    data: JoinGroupRequest | None = None,
    ctx: Context = Depends(auth_context),
):
    group = await _group_by_invite(ctx, invite_code)
    if group["require_verified_users"] and not ctx.user["is_verified"]:
        raise HTTPException(403, "This group requires verified users")
    existing = await ctx.db.one(
        "group_members", "group_id = ? AND user_id = ?", (group["id"], ctx.user["id"])
    )
    if existing:
        raise HTTPException(400, "Already a member of this group")

    claim_id = str(data.claim_member_id) if data and data.claim_member_id else None
    custom_name = data.display_name if data and data.display_name else None
    commands: list[Command] = []
    if claim_id:
        member = await ctx.db.one(
            "group_members",
            "id = ? AND group_id = ? AND user_id IS NULL AND is_active = 1",
            (claim_id, group["id"]),
        )
        if member is None:
            raise HTTPException(400, "This member slot is no longer available")
        token = new_id()
        commands.append(
            _claim_assertion_command(
                group["id"],
                claim_id,
                require_active=True,
                user_is_verified=bool(ctx.user["is_verified"]),
                token=token,
            )
        )
        changes = {"user_id": ctx.user["id"], "claimed_at": now()}
        if custom_name and custom_name != member["display_name"]:
            old_name = member["display_name"]
            changes["display_name"] = custom_name
            commands.append(
                log_member_command(
                    ctx.db,
                    group["id"],
                    claim_id,
                    "renamed",
                    f'"{old_name}" → "{custom_name}" (on claim)',
                )
            )
        commands.extend(
            [
                ctx.db.update(
                    "group_members", changes, "id = ? AND user_id IS NULL", (claim_id,)
                ),
                log_member_command(
                    ctx.db,
                    group["id"],
                    claim_id,
                    "claimed",
                    f"Claimed by {ctx.user['display_name']} via invite link",
                ),
                _assertion_cleanup(token),
            ]
        )
    else:
        count = await ctx.db.scalar(
            "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND is_active = 1",
            (group["id"],),
        )
        if count >= 100:
            raise HTTPException(400, "This group has reached the maximum of 100 members")
        member = _new_member_values(
            group["id"], custom_name or ctx.user["display_name"], user_id=ctx.user["id"]
        )
        token = new_id()
        commands.extend(
            [
                _member_limit_assertion_command(
                    group["id"], token, bool(ctx.user["is_verified"])
                ),
                ctx.db.insert("group_members", member),
                log_member_command(
                    ctx.db,
                    group["id"],
                    member["id"],
                    "joined",
                    "Joined via invite link",
                ),
                _assertion_cleanup(token),
            ]
        )
    await ctx.db.batch(commands)
    return group


def _claimed_user(row: dict) -> dict | None:
    if row.get("user_id") is None:
        return None
    device_id = row.get("claimed_device_id")
    providers = row.get("oauth_providers") or ""
    return {
        "user_id": row["user_id"],
        "display_name": row["claimed_display_name"],
        "email": row.get("claimed_email"),
        "is_verified": bool(row.get("claimed_is_verified")),
        "oauth_providers": sorted(set(filter(None, providers.split(",")))),
        "device_id_short": device_id[:8] + "…" if device_id else None,
    }


@router.get(
    "/groups/{group_id}/members", response_model=list[MemberRead], tags=["members"]
)
async def list_members(
    group_id: uuid.UUID,
    include_inactive: bool = Query(False),
    ctx: Context = Depends(auth_context),
):
    current = await require_member(ctx, group_id)
    admin = current["role"] in {"owner", "admin"}
    where_active = "" if include_inactive else " AND gm.is_active = 1"
    if admin:
        rows = await ctx.db.all(
            """SELECT gm.*, u.display_name AS claimed_display_name,
                   u.email AS claimed_email, u.is_verified AS claimed_is_verified,
                   u.device_id AS claimed_device_id,
                   GROUP_CONCAT(DISTINCT uo.provider) AS oauth_providers
            FROM group_members gm
            LEFT JOIN users u ON u.id = gm.user_id
            LEFT JOIN user_oauth uo ON uo.user_id = u.id
            WHERE gm.group_id = ?"""
            + where_active
            + " GROUP BY gm.id ORDER BY gm.joined_at",
            (str(group_id),),
        )
        members = []
        for raw in rows:
            member = ctx.db.decode("group_members", raw)
            member["claimed_user"] = _claimed_user(raw)
            members.append(member)
        return members
    return await ctx.db.rows(
        "group_members",
        "group_id = ?" + ("" if include_inactive else " AND is_active = 1"),
        (str(group_id),),
        "joined_at",
    )


@router.post("/groups/{group_id}/members", response_model=MemberRead, tags=["members"])
async def add_member(
    group_id: uuid.UUID, data: MemberCreate, ctx: Context = Depends(auth_context)
):
    await get_group(ctx.db, group_id)
    current = await require_member(ctx, group_id)
    require_role(current, "owner", "admin")
    count = await ctx.db.scalar(
        "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND is_active = 1",
        (str(group_id),),
    )
    if count >= 100:
        raise HTTPException(400, "Maximum 100 members per group")
    member = _new_member_values(
        str(group_id),
        data.display_name,
        nicknames=data.nicknames,
        initial_balance=data.initial_balance or ZERO,
    )
    token = new_id()
    await ctx.db.batch(
        [
            _member_limit_assertion_command(str(group_id), token),
            ctx.db.insert("group_members", member),
            log_member_command(
                ctx.db,
                group_id,
                member["id"],
                "joined",
                f"Added by {current['display_name']}",
                current["id"],
            ),
            _assertion_cleanup(token),
        ]
    )
    return member


async def _unsettled_error(
    ctx: Context, group: dict, target: dict, prospective_initial: Decimal | None = None
) -> None:
    group_balances = await balances(ctx.db, group["id"])
    balance = group_balances.get(target["id"], ZERO)
    if prospective_initial is not None:
        balance += prospective_initial - target["initial_balance"]
    threshold = settled_threshold(group["currency_code"])
    balance = balance.quantize(threshold)
    if abs(balance) < threshold:
        return
    suggestions = suggest_settlements_for_member(group_balances | {target["id"]: balance}, uuid.UUID(target["id"]))
    ids = {target["id"]}
    for from_id, to_id, _ in suggestions:
        ids.update((str(from_id), str(to_id)))
    placeholders = ",".join("?" for _ in ids)
    name_rows = await ctx.db.all(
        f"SELECT id, display_name FROM group_members WHERE id IN ({placeholders})",
        tuple(ids),
    )
    names = {row["id"]: row["display_name"] for row in name_rows}
    owed = balance > 0
    raise HTTPException(
        400,
        {
            "code": "member_has_balance",
            "message": (
                f"{target['display_name']} still has an unsettled balance "
                f"({'is owed' if owed else 'owes'} {abs(balance)} {group['currency_code']}). "
                "Settle up before deactivating."
            ),
            "balance": str(balance),
            "currency_code": group["currency_code"],
            "suggested_settlements": [
                {
                    "from_member": str(from_id),
                    "from_member_name": names.get(str(from_id), "Unknown"),
                    "to_member": str(to_id),
                    "to_member_name": names.get(str(to_id), "Unknown"),
                    "amount": str(amount),
                }
                for from_id, to_id, amount in suggestions
            ],
        },
    )


@router.patch(
    "/groups/{group_id}/members/{member_id}", response_model=MemberRead, tags=["members"]
)
async def update_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    data: MemberUpdate,
    ctx: Context = Depends(auth_context),
):
    current = await require_member(ctx, group_id)
    target = await ctx.db.one(
        "group_members", "id = ? AND group_id = ?", (str(member_id), str(group_id))
    )
    if target is None:
        raise HTTPException(404, "Member not found")

    commands: list[Command] = []
    changes: dict = {}
    required_roles = ("owner", "admin", "member")
    if data.role is not None:
        require_role(current, "owner")
        required_roles = ("owner",)
        if target["id"] == current["id"]:
            raise HTTPException(400, "Cannot change own role")
        role = data.role.value
        changes["role"] = role
        commands.append(
            log_member_command(
                ctx.db,
                group_id,
                member_id,
                "role_changed",
                f"{target['role']} → {role}",
                current["id"],
            )
        )
    if data.display_name is not None:
        if target["id"] != current["id"]:
            require_role(current, "owner", "admin")
            if required_roles != ("owner",):
                required_roles = ("owner", "admin")
        changes["display_name"] = data.display_name
        if target["display_name"] != data.display_name:
            commands.append(
                log_member_command(
                    ctx.db,
                    group_id,
                    member_id,
                    "renamed",
                    f'"{target["display_name"]}" → "{data.display_name}"',
                    current["id"],
                )
            )
    if data.nicknames is not None:
        if target["id"] != current["id"]:
            require_role(current, "owner", "admin")
            if required_roles != ("owner",):
                required_roles = ("owner", "admin")
        changes["nicknames"] = data.nicknames
    if data.initial_balance is not None:
        require_role(current, "owner", "admin")
        if required_roles != ("owner",):
            required_roles = ("owner", "admin")
        changes["initial_balance"] = data.initial_balance

    final_role = changes.get("role", target["role"])
    active_change = data.is_active is not None and data.is_active != target["is_active"]
    group = None
    guard_token = None
    if active_change:
        require_role(current, "owner", "admin")
        if required_roles != ("owner",):
            required_roles = ("owner", "admin")
        if final_role == "owner":
            raise HTTPException(400, "Cannot deactivate the group owner")
        if data.is_active:
            changes["is_active"] = True
            commands.append(
                log_member_command(
                    ctx.db,
                    group_id,
                    member_id,
                    "reactivated",
                    f"Reactivated by {current['display_name']}",
                    current["id"],
                )
            )
        else:
            group = await get_group(ctx.db, group_id)
            await _unsettled_error(ctx, group, target, data.initial_balance)
            changes["is_active"] = False
            guard_token = new_id()
            commands.append(
                log_member_command(
                    ctx.db,
                    group_id,
                    member_id,
                    "removed",
                    f"Removed by {current['display_name']}",
                    current["id"],
                )
            )

    if changes:
        # Apply prospective initial balance before the live-ledger assertion;
        # a failed assertion rolls the whole batch back.
        commands.insert(
            0,
            ctx.db.update(
                "group_members", changes, "id = ? AND group_id = ?", (str(member_id), str(group_id))
            ),
        )
        authorization_token = new_id()
        commands.insert(
            0,
            _member_mutation_assertion_command(
                str(group_id),
                current["id"],
                str(member_id),
                required_roles,
                target_must_not_be_owner=(
                    bool(active_change and not data.is_active) and data.role is None
                ),
                token=authorization_token,
            ),
        )
    if guard_token:
        commands.append(
            _settled_assertion_command(
                str(group_id), str(member_id), group["currency_code"], token=guard_token
            )
        )
        commands.append(_assertion_cleanup(guard_token))
    if changes:
        commands.append(_assertion_cleanup(authorization_token))
    if commands:
        await ctx.db.batch(commands)
    target.update(changes)
    return target


@router.post(
    "/groups/{group_id}/members/{member_id}/claim",
    response_model=MemberRead,
    tags=["members"],
)
async def claim_member(
    group_id: uuid.UUID, member_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    group = await get_group(ctx.db, group_id)
    if group["require_verified_users"] and not ctx.user["is_verified"]:
        raise HTTPException(403, "This group requires verified users")
    existing = await ctx.db.one(
        "group_members",
        "group_id = ? AND user_id = ? AND is_active = 1",
        (str(group_id), ctx.user["id"]),
    )
    if existing:
        raise HTTPException(400, "You already have a member profile in this group")
    target = await ctx.db.one(
        "group_members",
        "id = ? AND group_id = ? AND user_id IS NULL",
        (str(member_id), str(group_id)),
    )
    if target is None:
        raise HTTPException(404, "Unclaimed member not found")
    token = new_id()
    claimed_at = now()
    parts = [f"Claimed by {ctx.user['display_name']}"]
    if ctx.user.get("email"):
        parts.append(ctx.user["email"])
    if ctx.user.get("device_id"):
        parts.append(f"device {ctx.user['device_id'][:8]}…")
    await ctx.db.batch(
        [
            _claim_assertion_command(
                str(group_id),
                str(member_id),
                require_active=False,
                user_is_verified=bool(ctx.user["is_verified"]),
                token=token,
            ),
            ctx.db.update(
                "group_members",
                {"user_id": ctx.user["id"], "claimed_at": claimed_at},
                "id = ? AND user_id IS NULL",
                (str(member_id),),
            ),
            log_member_command(
                ctx.db, group_id, member_id, "claimed", " · ".join(parts)
            ),
            _assertion_cleanup(token),
        ]
    )
    target.update({"user_id": ctx.user["id"], "claimed_at": claimed_at})
    return target


@router.post(
    "/groups/{group_id}/members/{member_id}/unclaim",
    response_model=MemberRead,
    tags=["members"],
)
async def unclaim_member(
    group_id: uuid.UUID, member_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    current = await require_member(ctx, group_id)
    require_role(current, "owner", "admin")
    target = await ctx.db.one(
        "group_members", "id = ? AND group_id = ?", (str(member_id), str(group_id))
    )
    if target is None:
        raise HTTPException(404, "Member not found")
    if target["user_id"] is None:
        raise HTTPException(400, "Member is not claimed")
    if target["role"] == "owner":
        raise HTTPException(400, "Cannot unclaim the group owner")
    user = await ctx.db.one("users", "id = ?", (target["user_id"],))
    previous = user["display_name"] if user else "unknown account"
    if user and user.get("email"):
        previous = f"{previous} ({user['email']})"
    authorization_token = new_id()
    await ctx.db.batch(
        [
            _member_mutation_assertion_command(
                str(group_id),
                current["id"],
                str(member_id),
                ("owner", "admin"),
                target_must_be_claimed=True,
                target_must_not_be_owner=True,
                token=authorization_token,
            ),
            ctx.db.update(
                "group_members",
                {"user_id": None, "claimed_at": None},
                "id = ? AND group_id = ?",
                (str(member_id), str(group_id)),
            ),
            log_member_command(
                ctx.db,
                group_id,
                member_id,
                "unclaimed",
                f"Unclaimed from {previous} by {current['display_name']}",
                current["id"],
            ),
            _assertion_cleanup(authorization_token),
        ]
    )
    target.update({"user_id": None, "claimed_at": None})
    return target


@router.delete("/groups/{group_id}/members/{member_id}", tags=["members"])
async def remove_member(
    group_id: uuid.UUID, member_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    current = await require_member(ctx, group_id)
    require_role(current, "owner", "admin")
    target = await ctx.db.one(
        "group_members", "id = ? AND group_id = ?", (str(member_id), str(group_id))
    )
    if target is None:
        raise HTTPException(404, "Member not found")
    if target["role"] == "owner":
        raise HTTPException(400, "Cannot remove the group owner")
    group = await get_group(ctx.db, group_id)
    await _unsettled_error(ctx, group, target)
    token = new_id() if target["is_active"] else None
    authorization_token = new_id()
    commands = [
        _member_mutation_assertion_command(
            str(group_id),
            current["id"],
            str(member_id),
            ("owner", "admin"),
            target_must_not_be_owner=True,
            token=authorization_token,
        )
    ]
    if token:
        commands.append(
            _settled_assertion_command(
                str(group_id), str(member_id), group["currency_code"], token=token
            )
        )
    commands.extend(
        [
            ctx.db.update(
                "group_members", {"is_active": False}, "id = ?", (str(member_id),)
            ),
            log_member_command(
                ctx.db,
                group_id,
                member_id,
                "removed",
                f"Removed by {current['display_name']}",
                current["id"],
            ),
        ]
    )
    if token:
        commands.append(_assertion_cleanup(token))
    commands.append(_assertion_cleanup(authorization_token))
    await ctx.db.batch(commands)
    return {"detail": "Member removed"}


@router.get("/groups/{group_id}/members/log", tags=["members"])
async def get_member_log(
    group_id: uuid.UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    ctx: Context = Depends(auth_context),
):
    await require_member(ctx, group_id)
    return await ctx.db.all(
        """SELECT l.id, COALESCE(m.display_name, 'Unknown') AS member_name,
               l.action, l.detail, p.display_name AS performer_name, l.created_at
        FROM group_member_logs l
        LEFT JOIN group_members m ON m.id = l.member_id
        LEFT JOIN group_members p ON p.id = l.performed_by
        WHERE l.group_id = ?
        ORDER BY l.created_at DESC LIMIT ? OFFSET ?""",
        (str(group_id), limit, offset),
    )


@router.get(
    "/groups/{group_id}/currencies",
    response_model=list[GroupCurrencyRead],
    tags=["group_currencies"],
)
async def list_group_currencies(
    group_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    await require_member(ctx, group_id)
    return await ctx.db.rows(
        "group_currencies", "group_id = ?", (str(group_id),), "currency_code"
    )


@router.post(
    "/groups/{group_id}/currencies",
    response_model=GroupCurrencyRead,
    tags=["group_currencies"],
)
async def add_group_currency(
    group_id: uuid.UUID,
    data: GroupCurrencyCreate,
    ctx: Context = Depends(auth_context),
):
    group = await get_group(ctx.db, group_id)
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    code = data.currency_code.upper().strip()
    if len(code) != 3:
        raise HTTPException(400, "Currency code must be 3 characters (e.g. EUR, VND)")
    if code == group["currency_code"]:
        raise HTTPException(400, f"{code} is already the group's main currency")
    if data.exchange_rate <= 0:
        raise HTTPException(400, "Exchange rate must be positive")
    if await ctx.db.one(
        "group_currencies", "group_id = ? AND currency_code = ?", (str(group_id), code)
    ):
        raise HTTPException(400, f"{code} is already added to this group")
    timestamp = now()
    currency = {
        "id": new_id(),
        "group_id": str(group_id),
        "currency_code": code,
        "exchange_rate": data.exchange_rate,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    await ctx.db.batch([ctx.db.insert("group_currencies", currency)])
    return currency


@router.patch(
    "/groups/{group_id}/currencies/{currency_id}",
    response_model=GroupCurrencyRead,
    tags=["group_currencies"],
)
async def update_group_currency(
    group_id: uuid.UUID,
    currency_id: uuid.UUID,
    data: GroupCurrencyUpdate,
    ctx: Context = Depends(auth_context),
):
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    if data.exchange_rate <= 0:
        raise HTTPException(400, "Exchange rate must be positive")
    currency = await ctx.db.one(
        "group_currencies",
        "id = ? AND group_id = ?",
        (str(currency_id), str(group_id)),
    )
    if currency is None:
        raise HTTPException(404, "Currency not found")
    changes = {"exchange_rate": data.exchange_rate, "updated_at": now()}
    await ctx.db.batch(
        [ctx.db.update("group_currencies", changes, "id = ?", (str(currency_id),))]
    )
    currency.update(changes)
    return currency


@router.delete(
    "/groups/{group_id}/currencies/{currency_id}", tags=["group_currencies"]
)
async def delete_group_currency(
    group_id: uuid.UUID,
    currency_id: uuid.UUID,
    ctx: Context = Depends(auth_context),
):
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    currency = await ctx.db.one(
        "group_currencies",
        "id = ? AND group_id = ?",
        (str(currency_id), str(group_id)),
    )
    if currency is None:
        raise HTTPException(404, "Currency not found")
    await ctx.db.batch(
        [ctx.db.delete("group_currencies", "id = ?", (str(currency_id),))]
    )
    return {"detail": "Currency removed"}


@router.get("/categories", response_model=list[CategoryRead], tags=["categories"])
async def list_system_categories(ctx: Context = Depends(public_context)):
    return await ctx.db.rows("categories", "group_id IS NULL")


@router.get(
    "/groups/{group_id}/categories",
    response_model=list[CategoryRead],
    tags=["categories"],
)
async def list_group_categories(
    group_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    await require_member(ctx, group_id)
    return await ctx.db.rows(
        "categories", "group_id = ? OR group_id IS NULL", (str(group_id),)
    )


@router.post(
    "/groups/{group_id}/categories", response_model=CategoryRead, tags=["categories"]
)
async def create_category(
    group_id: uuid.UUID, data: CategoryCreate, ctx: Context = Depends(auth_context)
):
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    category = {
        "id": new_id(),
        "group_id": str(group_id),
        "name": data.name,
        "icon": data.icon,
        "is_default": data.is_default,
        "created_at": now(),
    }
    await ctx.db.batch([ctx.db.insert("categories", category)])
    return category


@router.patch(
    "/groups/{group_id}/categories/{category_id}",
    response_model=CategoryRead,
    tags=["categories"],
)
async def update_category(
    group_id: uuid.UUID,
    category_id: uuid.UUID,
    data: CategoryCreate,
    ctx: Context = Depends(auth_context),
):
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    category = await ctx.db.one(
        "categories", "id = ? AND group_id = ?", (str(category_id), str(group_id))
    )
    if category is None:
        raise HTTPException(404, "Category not found")
    changes = data.model_dump()
    await ctx.db.batch(
        [ctx.db.update("categories", changes, "id = ?", (str(category_id),))]
    )
    category.update(changes)
    return category


@router.delete("/groups/{group_id}/categories/{category_id}", tags=["categories"])
async def delete_category(
    group_id: uuid.UUID,
    category_id: uuid.UUID,
    ctx: Context = Depends(auth_context),
):
    member = await require_member(ctx, group_id)
    require_role(member, "owner", "admin")
    category = await ctx.db.one(
        "categories", "id = ? AND group_id = ?", (str(category_id), str(group_id))
    )
    if category is None:
        raise HTTPException(404, "Category not found")
    await ctx.db.batch([ctx.db.delete("categories", "id = ?", (str(category_id),))])
    return {"detail": "Category deleted"}


async def _own_payment_method(ctx: Context, pm_id: uuid.UUID | str) -> dict:
    payment = await ctx.db.one(
        "payment_methods", "id = ? AND user_id = ?", (str(pm_id), ctx.user["id"])
    )
    if payment is None:
        raise HTTPException(404, "Payment method not found")
    return payment


@router.get(
    "/users/me/payment-methods",
    response_model=list[PaymentMethodRead],
    tags=["payment-methods"],
)
async def list_my_payment_methods(ctx: Context = Depends(auth_context)):
    return await ctx.db.rows(
        "payment_methods", "user_id = ?", (ctx.user["id"],), "created_at"
    )


@router.post(
    "/users/me/payment-methods",
    response_model=PaymentMethodRead,
    tags=["payment-methods"],
)
async def create_payment_method(
    data: PaymentMethodCreate, ctx: Context = Depends(auth_context)
):
    payment = {
        "id": new_id(),
        "user_id": ctx.user["id"],
        **data.model_dump(),
        "qr_image_url": None,
        "created_at": now(),
    }
    await ctx.db.batch([ctx.db.insert("payment_methods", payment)])
    return payment


@router.patch(
    "/users/me/payment-methods/{pm_id}",
    response_model=PaymentMethodRead,
    tags=["payment-methods"],
)
async def update_payment_method(
    pm_id: uuid.UUID,
    data: PaymentMethodUpdate,
    ctx: Context = Depends(auth_context),
):
    payment = await _own_payment_method(ctx, pm_id)
    changes = data.model_dump(exclude_unset=True)
    if changes:
        await ctx.db.batch(
            [ctx.db.update("payment_methods", changes, "id = ?", (str(pm_id),))]
        )
        payment.update(changes)
    return payment


@router.delete("/users/me/payment-methods/{pm_id}", tags=["payment-methods"])
async def delete_payment_method(
    pm_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    await _own_payment_method(ctx, pm_id)
    await ctx.db.batch(
        [ctx.db.delete("payment_methods", "id = ?", (str(pm_id),))]
    )
    return {"detail": "Payment method deleted"}


@router.post(
    "/users/me/payment-methods/{pm_id}/qr",
    response_model=PaymentMethodRead,
    tags=["payment-methods"],
)
async def upload_qr_image(
    pm_id: uuid.UUID,
    file: UploadFile,
    ctx: Context = Depends(auth_context),
):
    payment = await _own_payment_method(ctx, pm_id)
    url = await upload_file(ctx, file)
    await ctx.db.batch(
        [
            ctx.db.update(
                "payment_methods", {"qr_image_url": url}, "id = ?", (str(pm_id),)
            )
        ]
    )
    payment["qr_image_url"] = url
    return payment


def _payment_from_join(row: dict) -> dict:
    return {
        "id": row["payment_method_id"],
        "label": row["pm_label"],
        "bank_name": row["pm_bank_name"],
        "bank_bin": row["pm_bank_bin"],
        "account_number": row["pm_account_number"],
        "account_holder": row["pm_account_holder"],
        "note": row["pm_note"],
        "qr_image_url": row["pm_qr_image_url"],
        "created_at": row["pm_created_at"],
    }


@router.get(
    "/groups/{group_id}/payment-methods",
    response_model=list[GroupPaymentMethodRead],
    tags=["payment-methods"],
)
async def list_group_payment_methods(
    group_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    await require_member(ctx, group_id)
    rows = await ctx.db.all(
        """SELECT gpm.id, gpm.member_id, gm.display_name AS member_name,
               pm.id AS payment_method_id, pm.label AS pm_label,
               pm.bank_name AS pm_bank_name, pm.bank_bin AS pm_bank_bin,
               pm.account_number AS pm_account_number,
               pm.account_holder AS pm_account_holder, pm.note AS pm_note,
               pm.qr_image_url AS pm_qr_image_url, pm.created_at AS pm_created_at
        FROM group_payment_methods gpm
        JOIN payment_methods pm ON pm.id = gpm.payment_method_id
        JOIN group_members gm ON gm.id = gpm.member_id
        WHERE gpm.group_id = ?""",
        (str(group_id),),
    )
    return [
        {
            "id": row["id"],
            "member_id": row["member_id"],
            "member_name": row["member_name"],
            "payment_method": _payment_from_join(row),
        }
        for row in rows
    ]


@router.get(
    "/groups/{group_id}/payment-methods/mine",
    response_model=list[MyGroupPaymentMethodRead],
    tags=["payment-methods"],
)
async def list_my_group_payment_methods(
    group_id: uuid.UUID, ctx: Context = Depends(auth_context)
):
    await require_member(ctx, group_id)
    methods = await ctx.db.rows(
        "payment_methods", "user_id = ?", (ctx.user["id"],), "created_at"
    )
    enabled = await ctx.db.all(
        "SELECT payment_method_id FROM group_payment_methods WHERE group_id = ?",
        (str(group_id),),
    )
    enabled_ids = {row["payment_method_id"] for row in enabled}
    return [
        {"payment_method": payment, "enabled": payment["id"] in enabled_ids}
        for payment in methods
    ]


@router.post(
    "/groups/{group_id}/payment-methods",
    response_model=GroupPaymentMethodRead,
    tags=["payment-methods"],
)
async def enable_payment_method_in_group(
    group_id: uuid.UUID,
    data: EnablePaymentMethodRequest,
    ctx: Context = Depends(auth_context),
):
    member = await require_member(ctx, group_id)
    payment = await _own_payment_method(ctx, data.payment_method_id)
    if await ctx.db.one(
        "group_payment_methods",
        "group_id = ? AND payment_method_id = ?",
        (str(group_id), str(data.payment_method_id)),
    ):
        raise HTTPException(400, "Already enabled in this group")
    association = {
        "id": new_id(),
        "group_id": str(group_id),
        "payment_method_id": str(data.payment_method_id),
        "member_id": member["id"],
        "created_at": now(),
    }
    await ctx.db.batch([ctx.db.insert("group_payment_methods", association)])
    return {
        "id": association["id"],
        "member_id": member["id"],
        "member_name": member["display_name"],
        "payment_method": payment,
    }


@router.delete(
    "/groups/{group_id}/payment-methods/{pm_id}", tags=["payment-methods"]
)
async def disable_payment_method_in_group(
    group_id: uuid.UUID,
    pm_id: uuid.UUID,
    ctx: Context = Depends(auth_context),
):
    await require_member(ctx, group_id)
    association = await ctx.db.one(
        "group_payment_methods",
        "group_id = ? AND payment_method_id = ?",
        (str(group_id), str(pm_id)),
    )
    if association is None:
        raise HTTPException(404, "Payment method not enabled in this group")
    await _own_payment_method(ctx, pm_id)
    await ctx.db.batch(
        [
            ctx.db.delete(
                "group_payment_methods",
                "group_id = ? AND payment_method_id = ?",
                (str(group_id), str(pm_id)),
            )
        ]
    )
    return {"detail": "Payment method removed from group"}
