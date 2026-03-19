import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member
from app.core.security import get_current_user
from app.database import get_db
from app.models import (
    Expense,
    ExpenseSplit,
    GroupMember,
    Settlement,
    User,
)
from app.schemas.settlement import (
    BalanceRead,
    SettlementCreate,
    SettlementRead,
    SuggestedSettlement,
)
from app.services.debt_simplifier import simplify_debts
from app.services.notification import notify_group

router = APIRouter(prefix="/groups/{group_id}", tags=["settlements"])


async def _compute_balances(db: AsyncSession, group_id: uuid.UUID) -> dict[uuid.UUID, Decimal]:
    # Get active members
    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    members = {m.id: m for m in members_result.scalars().all()}
    balances: dict[uuid.UUID, Decimal] = defaultdict(Decimal)

    # Sum what each member paid (in group's main currency)
    expenses_result = await db.execute(
        select(Expense).where(Expense.group_id == group_id)
    )
    for expense in expenses_result.scalars().all():
        if expense.paid_by in members:
            balances[expense.paid_by] += expense.converted_amount

    # Subtract what each member owes
    splits_result = await db.execute(
        select(ExpenseSplit)
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .where(Expense.group_id == group_id)
    )
    for split in splits_result.scalars().all():
        if split.group_member_id in members:
            balances[split.group_member_id] -= split.resolved_amount

    # Factor in settlements
    settlements_result = await db.execute(
        select(Settlement).where(Settlement.group_id == group_id)
    )
    for s in settlements_result.scalars().all():
        if s.from_member in members:
            balances[s.from_member] += s.amount  # payer reduces debt
        if s.to_member in members:
            balances[s.to_member] -= s.amount  # receiver loses credit

    # Ensure all active members appear
    for mid in members:
        if mid not in balances:
            balances[mid] = Decimal("0")

    return balances


@router.get("/balances", response_model=list[BalanceRead])
async def get_balances(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    balances = await _compute_balances(db, group_id)

    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    members = {m.id: m for m in members_result.scalars().all()}

    return [
        BalanceRead(
            member_id=mid,
            member_name=members[mid].display_name,
            balance=balance.quantize(Decimal("0.01")),
        )
        for mid, balance in balances.items()
        if mid in members
    ]


@router.get("/settlements/suggested", response_model=list[SuggestedSettlement])
async def get_suggested_settlements(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    balances = await _compute_balances(db, group_id)

    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    members = {m.id: m for m in members_result.scalars().all()}

    # Convert to str keys for the simplifier
    str_balances = {str(k): v.quantize(Decimal("0.01")) for k, v in balances.items()}
    transfers = simplify_debts(str_balances)

    return [
        SuggestedSettlement(
            from_member=uuid.UUID(from_id),
            from_member_name=members[uuid.UUID(from_id)].display_name,
            to_member=uuid.UUID(to_id),
            to_member_name=members[uuid.UUID(to_id)].display_name,
            amount=amount,
        )
        for from_id, to_id, amount in transfers
    ]


@router.post("/settlements", response_model=SettlementRead)
async def create_settlement(
    group_id: uuid.UUID,
    data: SettlementCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    settlement = Settlement(
        group_id=group_id,
        from_member=data.from_member,
        to_member=data.to_member,
        amount=data.amount,
        description=data.description,
        type=data.type,
        created_by=current.id,
    )
    db.add(settlement)

    # Get member names for notification
    members_result = await db.execute(
        select(GroupMember).where(GroupMember.id.in_([data.from_member, data.to_member]))
    )
    member_names = {m.id: m.display_name for m in members_result.scalars().all()}

    await notify_group(
        db, group_id, current_user.id, "settlement_recorded",
        {
            "from": member_names.get(data.from_member, "Unknown"),
            "to": member_names.get(data.to_member, "Unknown"),
            "amount": str(data.amount),
        },
    )

    await db.commit()
    await db.refresh(settlement)

    return SettlementRead(
        id=settlement.id,
        from_member=settlement.from_member,
        from_member_name=member_names.get(data.from_member),
        to_member=settlement.to_member,
        to_member_name=member_names.get(data.to_member),
        amount=settlement.amount,
        description=settlement.description,
        type=settlement.type,
        settled_at=settlement.settled_at,
    )


@router.get("/settlements", response_model=list[SettlementRead])
async def list_settlements(
    group_id: uuid.UUID,
    limit: int = Query(50, le=100),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Settlement)
        .where(Settlement.group_id == group_id)
        .order_by(Settlement.settled_at.desc())
        .limit(limit)
        .offset(offset)
    )
    settlements = result.scalars().all()

    # Get member names
    member_ids = set()
    for s in settlements:
        member_ids.add(s.from_member)
        member_ids.add(s.to_member)

    if member_ids:
        members_result = await db.execute(
            select(GroupMember).where(GroupMember.id.in_(member_ids))
        )
        member_names = {m.id: m.display_name for m in members_result.scalars().all()}
    else:
        member_names = {}

    return [
        SettlementRead(
            id=s.id,
            from_member=s.from_member,
            from_member_name=member_names.get(s.from_member),
            to_member=s.to_member,
            to_member_name=member_names.get(s.to_member),
            amount=s.amount,
            description=s.description,
            type=s.type or "settle_up",
            settled_at=s.settled_at,
        )
        for s in settlements
    ]
