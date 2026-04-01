import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Expense, ExpenseSplit, Group, GroupCurrency, GroupMember, MemberRole, User
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate, SplitRead
from app.services.file_storage import save_upload
from app.services.notification import notify_group
from app.services.split_calculator import calculate_splits

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


def _build_expense_read(expense: Expense, group_currency: str | None = None) -> ExpenseRead:
    splits = []
    for s in expense.splits:
        sr = SplitRead.model_validate(s)
        sr.member_name = s.member.display_name if s.member else None
        splits.append(sr)
    result = ExpenseRead.model_validate(expense)
    result.splits = splits
    result.payer_name = expense.payer.display_name if expense.payer else None
    result.fund_name = expense.fund.name if expense.fund else None
    result.group_currency = group_currency or expense.group.currency_code if expense.group else None
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

    # Determine currency and exchange rate
    expense_currency = (data.currency_code or group.currency_code).upper().strip()
    exchange_rate = Decimal("1")
    if expense_currency != group.currency_code:
        # Look up allowed currency for default rate
        gc_result = await db.execute(
            select(GroupCurrency).where(
                GroupCurrency.group_id == group_id,
                GroupCurrency.currency_code == expense_currency,
            )
        )
        allowed_currency = gc_result.scalars().first()
        if not allowed_currency:
            raise BadRequest(
                f"{expense_currency} is not an allowed currency for this group. "
                f"Add it in group settings first."
            )
        # Use provided rate or fall back to default
        if data.exchange_rate is not None and data.exchange_rate > 0:
            exchange_rate = data.exchange_rate
        else:
            exchange_rate = allowed_currency.exchange_rate
    converted_amount = (data.amount * exchange_rate).quantize(Decimal("0.01"))

    # Validate fund if provided
    fund = None
    if data.fund_id:
        fund_result = await db.execute(
            select(Fund).where(
                Fund.id == data.fund_id,
                Fund.group_id == group_id,
                Fund.is_active == True,
            )
        )
        fund = fund_result.scalars().first()
        if not fund:
            raise BadRequest("Fund not found or inactive")

    # Compute splits against converted amount (in group's main currency)
    members_map = {str(s.group_member_id): s.value for s in data.splits}
    resolved = calculate_splits(converted_amount, data.split_type.value, members_map)

    expense = Expense(
        group_id=group_id,
        paid_by=data.paid_by,
        created_by=current.id,
        description=data.description,
        amount=data.amount,
        currency_code=expense_currency,
        exchange_rate=exchange_rate,
        converted_amount=converted_amount,
        category_id=data.category_id,
        fund_id=data.fund_id,
        date=data.date,
    )
    db.add(expense)
    await db.flush()

    # Create fund transaction if expense is linked to a fund
    if data.fund_id:
        fund_tx = FundTransaction(
            fund_id=data.fund_id,
            type=FundTransactionType.expense,
            amount=converted_amount,
            member_id=data.paid_by,
            expense_id=expense.id,
            note=data.description,
            created_by=current.id,
        )
        db.add(fund_tx)

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
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)


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
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    query = (
        select(Expense)
        .where(Expense.group_id == group_id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund),
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
    return [_build_expense_read(e, group.currency_code) for e in result.scalars().all()]


@router.get("/{expense_id}", response_model=ExpenseRead)
async def get_expense(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense_id, Expense.group_id == group_id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")
    return _build_expense_read(expense, group.currency_code)


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
    if data.currency_code is not None:
        expense.currency_code = data.currency_code
    if data.exchange_rate is not None:
        expense.exchange_rate = data.exchange_rate
    if data.date is not None:
        expense.date = data.date
    if data.paid_by is not None:
        expense.paid_by = data.paid_by
    if data.category_id is not None:
        expense.category_id = data.category_id

    if data.fund_id is not None:
        if data.fund_id != expense.fund_id:
            # Remove old fund transaction
            if expense.fund_id:
                old_ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.expense_id == expense.id)
                )
                old_ft = old_ft_result.scalars().first()
                if old_ft:
                    await db.delete(old_ft)

            # Add new fund transaction
            if data.fund_id:
                fund_result = await db.execute(
                    select(Fund).where(
                        Fund.id == data.fund_id,
                        Fund.group_id == group_id,
                        Fund.is_active == True,
                    )
                )
                if not fund_result.scalars().first():
                    raise BadRequest("Fund not found or inactive")

                new_ft = FundTransaction(
                    fund_id=data.fund_id,
                    type=FundTransactionType.expense,
                    amount=expense.converted_amount,
                    member_id=expense.paid_by,
                    expense_id=expense.id,
                    note=expense.description,
                    created_by=current.id,
                )
                db.add(new_ft)

            expense.fund_id = data.fund_id

    # Recalculate converted amount
    if data.amount is not None or data.exchange_rate is not None or data.currency_code is not None:
        rate = expense.exchange_rate if expense.currency_code != group.currency_code else Decimal("1")
        expense.converted_amount = (expense.amount * rate).quantize(Decimal("0.01"))

    # Recalculate splits if provided
    if data.splits is not None and data.split_type is not None:
        for old_split in expense.splits:
            await db.delete(old_split)
        await db.flush()

        members_map = {str(s.group_member_id): s.value for s in data.splits}
        resolved = calculate_splits(expense.converted_amount, data.split_type.value, members_map)

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
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)


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

    # Delete linked fund transaction if any
    if expense.fund_id:
        ft_result = await db.execute(
            select(FundTransaction).where(FundTransaction.expense_id == expense_id)
        )
        ft = ft_result.scalars().first()
        if ft:
            await db.delete(ft)

    await db.delete(expense)
    await db.commit()
    return {"detail": "Expense deleted"}


@router.post("/{expense_id}/receipt", response_model=ExpenseRead)
async def upload_receipt(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.group_id == group_id)
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")

    if expense.created_by != current.id:
        require_role(current, MemberRole.owner, MemberRole.admin)

    try:
        url = await save_upload(file)
    except ValueError as e:
        raise BadRequest(str(e))

    expense.receipt_url = url
    await db.commit()

    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)


@router.delete("/{expense_id}/receipt", response_model=ExpenseRead)
async def delete_receipt(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.group_id == group_id)
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")

    if expense.created_by != current.id:
        require_role(current, MemberRole.owner, MemberRole.admin)

    expense.receipt_url = None
    await db.commit()

    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)
