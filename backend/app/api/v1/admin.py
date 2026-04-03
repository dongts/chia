import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.admin import require_superadmin
from app.core.exceptions import BadRequest, NotFound
from app.database import get_db
from app.models import (
    Category, Expense, ExpenseSplit, Group, GroupCurrency,
    GroupMember, GroupMemberLog, MemberRole, Notification, Settlement, User,
    PaymentMethod, GroupPaymentMethod,
)
from app.schemas.user import UserRead
from app.services.auth import hash_password

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


# ── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(func.count(User.id)))).scalar()
    groups = (await db.execute(select(func.count(Group.id)))).scalar()
    expenses = (await db.execute(select(func.count(Expense.id)))).scalar()
    settlements = (await db.execute(select(func.count(Settlement.id)))).scalar()
    return {"users": users, "groups": groups, "expenses": expenses, "settlements": settlements}


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    query = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    count_q = select(func.count(User.id))
    if search:
        filt = User.display_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        query = query.where(filt)
        count_q = count_q.where(filt)
    result = await db.execute(query)
    total = (await db.execute(count_q)).scalar()
    return {"items": [UserRead.model_validate(u) for u in result.scalars().all()], "total": total}


@router.get("/users/{user_id}")
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    memberships = await db.execute(
        select(GroupMember, Group)
        .join(Group, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user_id, GroupMember.is_active.is_(True))
    )
    groups = [
        {"id": str(g.id), "name": g.name, "currency_code": g.currency_code, "role": m.role.value}
        for m, g in memberships.all()
    ]
    return {**UserRead.model_validate(user).model_dump(), "groups": groups}


@router.patch("/users/{user_id}")
async def update_user(user_id: uuid.UUID, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    for field in ["display_name", "email", "is_verified"]:
        if field in data:
            setattr(user, field, data[field])
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: uuid.UUID, data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    user.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"detail": "Password reset successfully"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    await db.delete(user)
    await db.commit()
    return {"detail": "User deleted"}


class AddUserToGroupRequest(BaseModel):
    group_id: uuid.UUID
    role: str = "member"


@router.post("/users/{user_id}/add-to-group")
async def add_user_to_group(user_id: uuid.UUID, data: AddUserToGroupRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if not user:
        raise NotFound("User not found")
    group = (await db.execute(select(Group).where(Group.id == data.group_id))).scalars().first()
    if not group:
        raise NotFound("Group not found")
    existing = (await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == data.group_id,
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
        )
    )).scalars().first()
    if existing:
        raise BadRequest("User is already a member of this group")
    member = GroupMember(
        group_id=data.group_id,
        user_id=user_id,
        display_name=user.display_name,
        role=MemberRole(data.role),
        claimed_at=func.now(),
    )
    db.add(member)
    await db.commit()
    return {"detail": f"User added to {group.name} as {data.role}"}


# ── Groups ───────────────────────────────────────────────────────────────────

@router.get("/groups")
async def list_groups(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Group, func.count(GroupMember.id).label("mc"))
        .join(GroupMember, (GroupMember.group_id == Group.id) & GroupMember.is_active.is_(True), isouter=True)
        .group_by(Group.id)
        .order_by(Group.created_at.desc())
        .limit(limit).offset(offset)
    )
    count_q = select(func.count(Group.id))
    if search:
        query = query.where(Group.name.ilike(f"%{search}%"))
        count_q = count_q.where(Group.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    total = (await db.execute(count_q)).scalar()
    items = [
        {
            "id": str(g.id), "name": g.name, "currency_code": g.currency_code,
            "invite_code": g.invite_code, "member_count": mc,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
        for g, mc in result.all()
    ]
    return {"items": items, "total": total}


@router.get("/groups/{group_id}")
async def get_group_detail(group_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    members = await db.execute(
        select(GroupMember, User)
        .outerjoin(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at)
    )
    currencies = await db.execute(
        select(GroupCurrency).where(GroupCurrency.group_id == group_id)
    )
    expenses_count = (await db.execute(
        select(func.count(Expense.id)).where(Expense.group_id == group_id)
    )).scalar()
    return {
        "id": str(group.id), "name": group.name, "description": group.description,
        "currency_code": group.currency_code, "invite_code": group.invite_code,
        "require_verified_users": group.require_verified_users,
        "allow_log_on_behalf": group.allow_log_on_behalf,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "members": [
            {
                "id": str(m.id), "display_name": m.display_name, "role": m.role.value,
                "user_id": str(m.user_id) if m.user_id else None,
                "email": u.email if u else None, "is_active": m.is_active,
            }
            for m, u in members.all()
        ],
        "currencies": [
            {"id": str(c.id), "currency_code": c.currency_code, "exchange_rate": float(c.exchange_rate)}
            for c in currencies.scalars().all()
        ],
        "expenses_count": expenses_count,
    }


class AddMemberToGroupRequest(BaseModel):
    display_name: str
    user_id: uuid.UUID | None = None
    role: str = "member"


@router.post("/groups/{group_id}/members")
async def add_member_to_group(group_id: uuid.UUID, data: AddMemberToGroupRequest, db: AsyncSession = Depends(get_db)):
    group = (await db.execute(select(Group).where(Group.id == group_id))).scalars().first()
    if not group:
        raise NotFound("Group not found")
    if data.user_id:
        existing = (await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == data.user_id,
                GroupMember.is_active.is_(True),
            )
        )).scalars().first()
        if existing:
            raise BadRequest("User is already a member of this group")
    member = GroupMember(
        group_id=group_id,
        user_id=data.user_id,
        display_name=data.display_name,
        role=MemberRole(data.role),
        claimed_at=func.now() if data.user_id else None,
    )
    db.add(member)
    await db.commit()
    return {"detail": f"Member '{data.display_name}' added to {group.name}"}


class UpdateMemberRequest(BaseModel):
    display_name: str | None = None
    role: str | None = None


@router.patch("/groups/{group_id}/members/{member_id}")
async def update_group_member(
    group_id: uuid.UUID, member_id: uuid.UUID, data: UpdateMemberRequest, db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    member = result.scalars().first()
    if not member:
        raise NotFound("Member not found")
    if data.display_name is not None:
        member.display_name = data.display_name
    if data.role is not None:
        member.role = MemberRole(data.role)
    await db.commit()
    await db.refresh(member)
    return {
        "id": str(member.id), "display_name": member.display_name,
        "role": member.role.value, "is_active": member.is_active,
    }


@router.delete("/groups/{group_id}/members/{member_id}")
async def delete_group_member(
    group_id: uuid.UUID, member_id: uuid.UUID, db: AsyncSession = Depends(get_db),
):
    """Hard-delete a group member and all their associated data."""
    member = (await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )).scalars().first()
    if not member:
        raise NotFound("Member not found")

    name = member.display_name

    # Delete associated data
    await db.execute(delete(ExpenseSplit).where(ExpenseSplit.group_member_id == member_id))
    await db.execute(delete(Settlement).where(
        (Settlement.from_member == member_id) | (Settlement.to_member == member_id)
    ))
    await db.execute(delete(GroupMemberLog).where(
        (GroupMemberLog.member_id == member_id) | (GroupMemberLog.performed_by == member_id)
    ))
    await db.execute(delete(GroupPaymentMethod).where(GroupPaymentMethod.member_id == member_id))

    # Delete expenses paid by this member
    await db.execute(delete(Expense).where(Expense.paid_by == member_id))

    # Nullify created_by references on remaining expenses
    await db.execute(
        Expense.__table__.update().where(Expense.created_by == member_id).values(created_by=None)
    )

    await db.delete(member)
    await db.commit()
    return {"detail": f"Member '{name}' permanently deleted"}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    # Use raw DELETE to let DB-level CASCADE handle all child tables
    await db.execute(delete(Group).where(Group.id == group_id))
    await db.commit()
    return {"detail": "Group deleted"}


# ── Expenses ─────────────────────────────────────────────────────────────────

@router.get("/groups/{group_id}/expenses")
async def list_group_expenses(
    group_id: uuid.UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Expense)
        .where(Expense.group_id == group_id)
        .options(selectinload(Expense.payer))
        .order_by(Expense.date.desc())
        .limit(limit).offset(offset)
    )
    total = (await db.execute(
        select(func.count(Expense.id)).where(Expense.group_id == group_id)
    )).scalar()
    expenses = result.scalars().all()
    return {
        "items": [
            {
                "id": str(e.id), "description": e.description,
                "amount": float(e.amount), "currency_code": e.currency_code,
                "exchange_rate": float(e.exchange_rate), "converted_amount": float(e.converted_amount),
                "date": e.date.isoformat(),
                "payer_name": e.payer.display_name if e.payer else None,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in expenses
        ],
        "total": total,
    }


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Expense).where(Expense.id == expense_id))
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")
    await db.delete(expense)
    await db.commit()
    return {"detail": "Expense deleted"}


# ── Settlements ──────────────────────────────────────────────────────────────

@router.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Settlement).where(Settlement.id == settlement_id))
    settlement = result.scalars().first()
    if not settlement:
        raise NotFound("Settlement not found")
    await db.delete(settlement)
    await db.commit()
    return {"detail": "Settlement deleted"}


# ── Notifications (bulk cleanup) ─────────────────────────────────────────────

@router.delete("/notifications/all")
async def delete_all_notifications(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Notification))
    await db.commit()
    return {"detail": "All notifications deleted"}


# ── Check admin status ───────────────────────────────────────────────────────

@router.get("/me")
async def admin_check(current_user: User = Depends(require_superadmin)):
    return {"email": current_user.email, "is_superadmin": True}


# ── Merge Group Members ──────────────────────────────────────────────────


@router.post("/groups/{group_id}/members/{source_member_id}/merge-into/{target_member_id}")
async def merge_group_members(
    group_id: uuid.UUID,
    source_member_id: uuid.UUID,
    target_member_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_superadmin),
):
    """Merge source member into target member within the same group.

    Reassigns all expenses, splits, settlements, and logs from source to target,
    adds initial_balance, keeps the higher role, then deactivates source.
    Works for unclaimed members (no user_id).
    """
    if source_member_id == target_member_id:
        raise BadRequest("Cannot merge a member into themselves")

    src = (await db.execute(
        select(GroupMember).where(GroupMember.id == source_member_id, GroupMember.group_id == group_id)
    )).scalars().first()
    tgt = (await db.execute(
        select(GroupMember).where(GroupMember.id == target_member_id, GroupMember.group_id == group_id)
    )).scalars().first()
    if not src:
        raise NotFound("Source member not found")
    if not tgt:
        raise NotFound("Target member not found")

    source_name = src.display_name
    target_name = tgt.display_name

    # Reassign all references from source to target
    await db.execute(
        Expense.__table__.update().where(Expense.paid_by == src.id).values(paid_by=tgt.id)
    )
    await db.execute(
        Expense.__table__.update().where(Expense.created_by == src.id).values(created_by=tgt.id)
    )
    await db.execute(
        ExpenseSplit.__table__.update().where(ExpenseSplit.group_member_id == src.id).values(group_member_id=tgt.id)
    )
    await db.execute(
        Settlement.__table__.update().where(Settlement.from_member == src.id).values(from_member=tgt.id)
    )
    await db.execute(
        Settlement.__table__.update().where(Settlement.to_member == src.id).values(to_member=tgt.id)
    )
    await db.execute(
        Settlement.__table__.update().where(Settlement.created_by == src.id).values(created_by=tgt.id)
    )
    await db.execute(
        GroupMemberLog.__table__.update().where(GroupMemberLog.member_id == src.id).values(member_id=tgt.id)
    )
    await db.execute(
        GroupMemberLog.__table__.update().where(GroupMemberLog.performed_by == src.id).values(performed_by=tgt.id)
    )
    await db.execute(
        GroupPaymentMethod.__table__.update().where(GroupPaymentMethod.member_id == src.id).values(member_id=tgt.id)
    )

    # Combine initial balances and keep higher role
    tgt.initial_balance += src.initial_balance

    role_priority = {"owner": 3, "admin": 2, "member": 1}
    if role_priority.get(src.role.value, 0) > role_priority.get(tgt.role.value, 0):
        tgt.role = src.role

    # Deactivate source
    src.is_active = False
    src.user_id = None

    await db.commit()

    return {
        "detail": f"Merged member '{source_name}' into '{target_name}'",
        "source_name": source_name,
        "target_name": target_name,
    }


# ── Merge Users ──────────────────────────────────────────────────────────


@router.post("/users/{source_user_id}/merge-into/{target_user_id}")
async def merge_users(
    source_user_id: uuid.UUID,
    target_user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_superadmin),
):
    """Merge source user (typically guest) into target user (typically verified)."""
    if source_user_id == target_user_id:
        raise BadRequest("Cannot merge a user into themselves")

    from app.services.merge_users import merge_user_into
    try:
        result = await merge_user_into(db, source_user_id, target_user_id)
    except ValueError as e:
        raise NotFound(str(e))

    return {
        "detail": f"Merged user '{result['source_name']}' into '{result['target_name']}'",
        "merged_groups": result["merged_groups"],
        "moved_groups": result["moved_groups"],
        "source_deleted": True,
    }
