import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.admin import require_superadmin
from app.core.exceptions import NotFound
from app.database import get_db
from app.models import (
    Category, Expense, ExpenseSplit, Group, GroupCurrency,
    GroupMember, MemberRole, Notification, Settlement, User,
)
from app.schemas.user import UserRead

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


# ── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(func.count(User.id)))).scalar()
    groups = (await db.execute(select(func.count(Group.id)))).scalar()
    expenses = (await db.execute(select(func.count(Expense.id)))).scalar()
    settlements = (await db.execute(select(func.count(Settlement.id)))).scalar()
    return {
        "users": users,
        "groups": groups,
        "expenses": expenses,
        "settlements": settlements,
    }


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    query = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if search:
        query = query.where(
            User.display_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        )
    result = await db.execute(query)
    users = result.scalars().all()
    count_q = select(func.count(User.id))
    if search:
        count_q = count_q.where(
            User.display_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        )
    total = (await db.execute(count_q)).scalar()
    return {"items": [UserRead.model_validate(u) for u in users], "total": total}


@router.get("/users/{user_id}")
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    # Get user's groups
    memberships = await db.execute(
        select(GroupMember, Group)
        .join(Group, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user_id, GroupMember.is_active.is_(True))
    )
    groups = [
        {"group_id": str(m.group_id), "group_name": g.name, "role": m.role.value, "display_name": m.display_name}
        for m, g in memberships.all()
    ]
    return {**UserRead.model_validate(user).model_dump(), "groups": groups}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
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


@router.delete("/users/{user_id}")
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise NotFound("User not found")
    await db.delete(user)
    await db.commit()
    return {"detail": "User deleted"}


# ── Groups ───────────────────────────────────────────────────────────────────

@router.get("/groups")
async def list_groups(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    query = select(Group, func.count(GroupMember.id).label("mc")).join(
        GroupMember, (GroupMember.group_id == Group.id) & GroupMember.is_active.is_(True), isouter=True
    ).group_by(Group.id).order_by(Group.created_at.desc()).limit(limit).offset(offset)
    if search:
        query = query.where(Group.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    items = [
        {
            "id": str(g.id), "name": g.name, "currency_code": g.currency_code,
            "invite_code": g.invite_code, "member_count": mc,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
        for g, mc in result.all()
    ]
    count_q = select(func.count(Group.id))
    if search:
        count_q = count_q.where(Group.name.ilike(f"%{search}%"))
    total = (await db.execute(count_q)).scalar()
    return {"items": items, "total": total}


@router.get("/groups/{group_id}")
async def get_group_detail(group_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    members = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id).order_by(GroupMember.joined_at)
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
            {"id": str(m.id), "display_name": m.display_name, "role": m.role.value,
             "user_id": str(m.user_id) if m.user_id else None, "is_active": m.is_active}
            for m in members.scalars().all()
        ],
        "currencies": [
            {"id": str(c.id), "currency_code": c.currency_code, "exchange_rate": float(c.exchange_rate)}
            for c in currencies.scalars().all()
        ],
        "expenses_count": expenses_count,
    }


@router.delete("/groups/{group_id}")
async def delete_group(group_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    await db.delete(group)
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
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
        )
        .order_by(Expense.date.desc())
        .limit(limit).offset(offset)
    )
    expenses = result.scalars().all()
    return [
        {
            "id": str(e.id), "description": e.description,
            "amount": float(e.amount), "currency_code": e.currency_code,
            "exchange_rate": float(e.exchange_rate), "converted_amount": float(e.converted_amount),
            "date": e.date.isoformat(), "payer_name": e.payer.display_name if e.payer else None,
            "splits": [
                {"member_name": s.member.display_name if s.member else None,
                 "resolved_amount": float(s.resolved_amount)}
                for s in e.splits
            ],
        }
        for e in expenses
    ]


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
