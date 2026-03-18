import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Expense, ExpenseSplit, Group, GroupMember, MemberRole, User
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate, SplitRead
from app.services.notification import notify_group
from app.services.split_calculator import calculate_splits

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


def _build_expense_read(expense: Expense) -> ExpenseRead:
    splits = []
    for s in expense.splits:
        sr = SplitRead.model_validate(s)
        sr.member_name = s.member.display_name if s.member else None
        splits.append(sr)
    result = ExpenseRead.model_validate(expense)
    result.splits = splits
    result.payer_name = expense.payer.display_name if expense.payer else None
    return result


@router.post("", response_model=ExpenseRead)
async def create_expense(
    group_id: uuid.UUID,
    data: ExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)

    # Check on-behalf permission
    if data.paid_by != current.id:
        if current.role == MemberRole.member and not group.allow_log_on_behalf:
            raise Forbidden("This group does not allow logging expenses on behalf of others")

    # Compute splits
    members_map = {str(s.group_member_id): s.value for s in data.splits}
    resolved = calculate_splits(data.amount, data.split_type.value, members_map)

    expense = Expense(
        group_id=group_id,
        paid_by=data.paid_by,
        created_by=current.id,
        description=data.description,
        amount=data.amount,
        currency_code=group.currency_code,
        category_id=data.category_id,
        date=data.date,
    )
    db.add(expense)
    await db.flush()

    for s in data.splits:
        split = ExpenseSplit(
            expense_id=expense.id,
            group_member_id=s.group_member_id,
            split_type=data.split_type,
            value=s.value,
            resolved_amount=resolved[str(s.group_member_id)],
        )
        db.add(split)

    await notify_group(
        db, group_id, current_user.id, "expense_added",
        {"description": data.description, "amount": str(data.amount), "payer": current.display_name},
    )

    await db.commit()

    # Reload with relationships
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense)


@router.get("", response_model=list[ExpenseRead])
async def list_expenses(
    group_id: uuid.UUID,
    category_id: uuid.UUID | None = Query(None),
    member_id: uuid.UUID | None = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    query = (
        select(Expense)
        .where(Expense.group_id == group_id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
        )
        .order_by(Expense.date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if category_id:
        query = query.where(Expense.category_id == category_id)
    if member_id:
        query = query.where(Expense.paid_by == member_id)

    result = await db.execute(query)
    return [_build_expense_read(e) for e in result.scalars().all()]


@router.get("/{expense_id}", response_model=ExpenseRead)
async def get_expense(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense_id, Expense.group_id == group_id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
        )
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")
    return _build_expense_read(expense)


@router.patch("/{expense_id}", response_model=ExpenseRead)
async def update_expense(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    data: ExpenseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense_id, Expense.group_id == group_id)
        .options(selectinload(Expense.splits))
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")

    # Permission: own expense or admin/owner
    if expense.created_by != current.id:
        require_role(current, MemberRole.owner, MemberRole.admin)

    if data.description is not None:
        expense.description = data.description
    if data.amount is not None:
        expense.amount = data.amount
    if data.date is not None:
        expense.date = data.date
    if data.paid_by is not None:
        expense.paid_by = data.paid_by
    if data.category_id is not None:
        expense.category_id = data.category_id

    # Recalculate splits if provided
    if data.splits is not None and data.split_type is not None:
        # Delete old splits
        for old_split in expense.splits:
            await db.delete(old_split)
        await db.flush()

        members_map = {str(s.group_member_id): s.value for s in data.splits}
        resolved = calculate_splits(expense.amount, data.split_type.value, members_map)

        for s in data.splits:
            split = ExpenseSplit(
                expense_id=expense.id,
                group_member_id=s.group_member_id,
                split_type=data.split_type,
                value=s.value,
                resolved_amount=resolved[str(s.group_member_id)],
            )
            db.add(split)

    await notify_group(
        db, group_id, current_user.id, "expense_updated",
        {"description": expense.description, "amount": str(expense.amount)},
    )

    await db.commit()

    # Reload
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense)


@router.delete("/{expense_id}")
async def delete_expense(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.group_id == group_id)
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")

    if expense.created_by != current.id:
        require_role(current, MemberRole.owner, MemberRole.admin)

    await notify_group(
        db, group_id, current_user.id, "expense_deleted",
        {"description": expense.description, "amount": str(expense.amount)},
    )

    await db.delete(expense)
    await db.commit()
    return {"detail": "Expense deleted"}
