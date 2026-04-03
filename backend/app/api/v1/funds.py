import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, MemberRole, User
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.schemas.fund import (
    FundCreate,
    FundDetailRead,
    FundRead,
    FundTransactionCreate,
    FundTransactionRead,
    FundUpdate,
    MemberContribution,
)

router = APIRouter(prefix="/groups/{group_id}/funds", tags=["funds"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_fund_or_404(
    db: AsyncSession, group_id: uuid.UUID, fund_id: uuid.UUID
) -> Fund:
    result = await db.execute(
        select(Fund).where(Fund.id == fund_id, Fund.group_id == group_id)
    )
    fund = result.scalars().first()
    if not fund:
        raise NotFound("Fund not found")
    return fund


async def compute_fund_balance(db: AsyncSession, fund_id: uuid.UUID) -> Decimal:
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (FundTransaction.type == FundTransactionType.contribute, FundTransaction.amount),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            )
            - func.coalesce(
                func.sum(
                    case(
                        (
                            FundTransaction.type.in_([FundTransactionType.withdraw, FundTransactionType.expense]),
                            FundTransaction.amount,
                        ),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            )
        ).where(FundTransaction.fund_id == fund_id)
    )
    return result.scalar() or Decimal("0")


async def _build_fund_read(db: AsyncSession, fund: Fund) -> FundRead:
    holder_result = await db.execute(
        select(GroupMember.display_name).where(GroupMember.id == fund.holder_id)
    )
    holder_name = holder_result.scalar()
    balance = await compute_fund_balance(db, fund.id)
    count_result = await db.execute(
        select(func.count()).where(FundTransaction.fund_id == fund.id)
    )
    tx_count = count_result.scalar() or 0
    return FundRead(
        id=fund.id,
        group_id=fund.group_id,
        name=fund.name,
        description=fund.description,
        holder_id=fund.holder_id,
        holder_name=holder_name,
        created_by=fund.created_by,
        is_active=fund.is_active,
        balance=balance,
        transaction_count=tx_count,
        created_at=fund.created_at,
        updated_at=fund.updated_at,
    )


# ---------------------------------------------------------------------------
# Fund CRUD
# ---------------------------------------------------------------------------

@router.post("", response_model=FundRead)
async def create_fund(
    group_id: uuid.UUID,
    data: FundCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)

    holder_id = data.holder_id or current.id

    # Validate holder is an active member of the group
    if holder_id != current.id:
        holder_result = await db.execute(
            select(GroupMember).where(
                GroupMember.id == holder_id,
                GroupMember.group_id == group_id,
                GroupMember.is_active.is_(True),
            )
        )
        if not holder_result.scalars().first():
            raise BadRequest("Holder must be an active member of the group")

    fund = Fund(
        group_id=group_id,
        name=data.name,
        description=data.description,
        holder_id=holder_id,
        created_by=current.id,
    )
    db.add(fund)
    await db.commit()
    await db.refresh(fund)

    return await _build_fund_read(db, fund)


@router.get("", response_model=list[FundRead])
async def list_funds(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)

    result = await db.execute(
        select(Fund)
        .where(Fund.group_id == group_id)
        .order_by(Fund.is_active.desc(), Fund.created_at.desc())
    )
    funds = result.scalars().all()

    return [await _build_fund_read(db, f) for f in funds]


@router.get("/{fund_id}", response_model=FundDetailRead)
async def get_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    fund_read = await _build_fund_read(db, fund)

    # Compute contributions by member (sum of contribute transactions)
    contrib_result = await db.execute(
        select(
            FundTransaction.member_id,
            func.sum(FundTransaction.amount).label("total"),
        )
        .where(
            FundTransaction.fund_id == fund_id,
            FundTransaction.type == FundTransactionType.contribute,
        )
        .group_by(FundTransaction.member_id)
    )
    contributions = contrib_result.all()

    # Batch fetch member names
    member_ids = [row.member_id for row in contributions]
    if member_ids:
        members_result = await db.execute(
            select(GroupMember).where(GroupMember.id.in_(member_ids))
        )
        member_names = {m.id: m.display_name for m in members_result.scalars().all()}
    else:
        member_names = {}

    contributions_by_member = [
        MemberContribution(
            member_id=row.member_id,
            member_name=member_names.get(row.member_id, "Unknown"),
            total=row.total,
        )
        for row in contributions
    ]

    return FundDetailRead(
        **fund_read.model_dump(),
        contributions_by_member=contributions_by_member,
    )


@router.patch("/{fund_id}", response_model=FundRead)
async def update_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    data: FundUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    if data.name is not None:
        fund.name = data.name
    if data.description is not None:
        fund.description = data.description

    # Holder change: only admin/owner or current holder
    if data.holder_id is not None and data.holder_id != fund.holder_id:
        is_admin_or_owner = current.role in (MemberRole.admin, MemberRole.owner)
        is_current_holder = current.id == fund.holder_id
        if not is_admin_or_owner and not is_current_holder:
            raise Forbidden("Only admin/owner or current holder can change the fund holder")

        # Validate new holder is an active member
        holder_result = await db.execute(
            select(GroupMember).where(
                GroupMember.id == data.holder_id,
                GroupMember.group_id == group_id,
                GroupMember.is_active.is_(True),
            )
        )
        if not holder_result.scalars().first():
            raise BadRequest("New holder must be an active member of the group")

        fund.holder_id = data.holder_id

        # Log holder change transaction
        tx = FundTransaction(
            fund_id=fund.id,
            type=FundTransactionType.holder_change,
            amount=Decimal("0"),
            member_id=data.holder_id,
            note=f"Holder changed to {data.holder_id}",
            created_by=current.id,
        )
        db.add(tx)

    # Close/reopen: only admin/owner
    if data.is_active is not None and data.is_active != fund.is_active:
        require_role(current, MemberRole.admin, MemberRole.owner)
        fund.is_active = data.is_active

    await db.commit()
    await db.refresh(fund)

    return await _build_fund_read(db, fund)


@router.delete("/{fund_id}", response_model=FundRead)
async def delete_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.admin, MemberRole.owner)

    fund = await _get_fund_or_404(db, group_id, fund_id)
    fund.is_active = False

    await db.commit()
    await db.refresh(fund)

    return await _build_fund_read(db, fund)


# ---------------------------------------------------------------------------
# Fund Transactions
# ---------------------------------------------------------------------------

@router.post("/{fund_id}/transactions", response_model=FundTransactionRead)
async def create_transaction(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    data: FundTransactionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    if not fund.is_active:
        raise BadRequest("Cannot add transactions to a closed fund")

    if data.type not in (FundTransactionType.contribute, FundTransactionType.withdraw):
        raise BadRequest("Transaction type must be 'contribute' or 'withdraw'")

    if data.amount <= 0:
        raise BadRequest("Amount must be greater than zero")

    # Validate member is an active group member
    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == data.member_id,
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    member = member_result.scalars().first()
    if not member:
        raise BadRequest("Member must be an active member of the group")

    tx = FundTransaction(
        fund_id=fund.id,
        type=data.type,
        amount=data.amount,
        member_id=data.member_id,
        note=data.note,
        created_by=current.id,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)

    return FundTransactionRead(
        id=tx.id,
        fund_id=tx.fund_id,
        type=tx.type,
        amount=tx.amount,
        member_id=tx.member_id,
        member_name=member.display_name,
        expense_id=tx.expense_id,
        note=tx.note,
        created_by=tx.created_by,
        created_by_name=current.display_name,
        created_at=tx.created_at,
    )


@router.get("/{fund_id}/transactions", response_model=list[FundTransactionRead])
async def list_transactions(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    limit: int = Query(50, le=100),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    await _get_fund_or_404(db, group_id, fund_id)

    result = await db.execute(
        select(FundTransaction)
        .where(FundTransaction.fund_id == fund_id)
        .order_by(FundTransaction.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    transactions = result.scalars().all()

    # Batch fetch member names
    member_ids = set()
    for tx in transactions:
        member_ids.add(tx.member_id)
        member_ids.add(tx.created_by)

    if member_ids:
        members_result = await db.execute(
            select(GroupMember).where(GroupMember.id.in_(member_ids))
        )
        member_names = {m.id: m.display_name for m in members_result.scalars().all()}
    else:
        member_names = {}

    return [
        FundTransactionRead(
            id=tx.id,
            fund_id=tx.fund_id,
            type=tx.type,
            amount=tx.amount,
            member_id=tx.member_id,
            member_name=member_names.get(tx.member_id),
            expense_id=tx.expense_id,
            note=tx.note,
            created_by=tx.created_by,
            created_by_name=member_names.get(tx.created_by),
            created_at=tx.created_at,
        )
        for tx in transactions
    ]


@router.delete("/{fund_id}/transactions/{transaction_id}")
async def delete_transaction(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    await _get_fund_or_404(db, group_id, fund_id)

    result = await db.execute(
        select(FundTransaction).where(
            FundTransaction.id == transaction_id,
            FundTransaction.fund_id == fund_id,
        )
    )
    tx = result.scalars().first()
    if not tx:
        raise NotFound("Transaction not found")

    # Cannot delete expense-linked or holder_change transactions
    if tx.expense_id is not None:
        raise BadRequest("Cannot delete expense-linked transactions")
    if tx.type == FundTransactionType.holder_change:
        raise BadRequest("Cannot delete holder change transactions")

    # Permission: own transaction or admin/owner
    is_admin_or_owner = current.role in (MemberRole.admin, MemberRole.owner)
    is_own_transaction = tx.created_by == current.id
    if not is_admin_or_owner and not is_own_transaction:
        raise Forbidden("You can only delete your own transactions")

    await db.delete(tx)
    await db.commit()

    return {"detail": "Transaction deleted"}
