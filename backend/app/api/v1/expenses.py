import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.funds import compute_fund_balance
from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Expense, ExpenseLog, ExpenseSplit, Group, GroupCurrency, GroupMember, MemberRole, User
from app.models.expense_fund_deduction import ExpenseFundDeduction
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.schemas.expense import ExpenseCreate, ExpenseLogRead, ExpenseRead, ExpenseUpdate, FundDeductionRead, SplitRead
from app.services.expense_logger import add_log, diff_snapshots, snapshot_expense
from app.services.file_storage import save_upload
from app.services.notification import notify_members, resolve_member_user_ids
from app.services.split_calculator import calculate_splits

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


def _build_expense_read(expense: Expense, group_currency: str | None = None) -> ExpenseRead:
    splits = []
    for s in expense.splits:
        sr = SplitRead.model_validate(s)
        sr.member_name = s.member.display_name if s.member else None
        splits.append(sr)

    fund_deductions = []
    for d in expense.fund_deductions:
        fund_deductions.append(FundDeductionRead(
            id=d.id,
            fund_id=d.fund_id,
            fund_name=d.fund.name if d.fund else "Unknown",
            amount=d.amount,
        ))

    result = ExpenseRead(
        id=expense.id,
        description=expense.description,
        amount=expense.amount,
        currency_code=expense.currency_code,
        exchange_rate=expense.exchange_rate,
        converted_amount=expense.converted_amount,
        date=expense.date,
        paid_by=expense.paid_by,
        payer_name=expense.payer.display_name if expense.payer else None,
        created_by=expense.created_by,
        category_id=expense.category_id,
        fund_deductions=fund_deductions,
        receipt_url=expense.receipt_url,
        splits=splits,
        created_at=expense.created_at,
        group_currency=group_currency or (expense.group.currency_code if expense.group else None),
    )
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

    if data.paid_by != current.id:
        if current.role == MemberRole.member and not group.allow_log_on_behalf:
            raise Forbidden("This group does not allow logging expenses on behalf of others")

    expense_currency = (data.currency_code or group.currency_code).upper().strip()
    exchange_rate = Decimal("1")
    if expense_currency != group.currency_code:
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
        if data.exchange_rate is not None and data.exchange_rate > 0:
            exchange_rate = data.exchange_rate
        else:
            exchange_rate = allowed_currency.exchange_rate
    converted_amount = (data.amount * exchange_rate).quantize(Decimal("0.01"))

    # Validate fund deductions
    total_deductions = Decimal("0")
    validated_funds: list[tuple[Fund, Decimal]] = []

    if data.fund_deductions:
        seen_fund_ids = set()
        for fd in data.fund_deductions:
            if fd.fund_id in seen_fund_ids:
                raise BadRequest("Duplicate fund in deductions")
            seen_fund_ids.add(fd.fund_id)

            if fd.amount <= 0:
                raise BadRequest("Fund deduction amount must be greater than zero")

            fund_result = await db.execute(
                select(Fund).where(
                    Fund.id == fd.fund_id,
                    Fund.group_id == group_id,
                    Fund.is_active == True,
                )
            )
            fund = fund_result.scalars().first()
            if not fund:
                raise BadRequest(f"Fund {fd.fund_id} not found or inactive")

            balance = await compute_fund_balance(db, fund.id)
            if fd.amount > balance:
                raise BadRequest(
                    f"Fund '{fund.name}' has insufficient balance "
                    f"({balance} available, {fd.amount} requested)"
                )

            total_deductions += fd.amount
            validated_funds.append((fund, fd.amount))

        if total_deductions > converted_amount:
            raise BadRequest(
                f"Total fund deductions ({total_deductions}) exceed expense amount ({converted_amount})"
            )

    splittable_amount = converted_amount - total_deductions
    members_map = {str(s.group_member_id): s.value for s in data.splits}

    if splittable_amount == 0:
        resolved = {mid: Decimal("0") for mid in members_map}
    else:
        resolved = calculate_splits(splittable_amount, data.split_type.value, members_map)

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
        date=data.date,
    )
    db.add(expense)
    await db.flush()

    for fund, deduction_amount in validated_funds:
        deduction = ExpenseFundDeduction(
            expense_id=expense.id,
            fund_id=fund.id,
            amount=deduction_amount,
            created_by=current.id,
        )
        db.add(deduction)
        await db.flush()

        fund_tx = FundTransaction(
            fund_id=fund.id,
            type=FundTransactionType.expense,
            amount=deduction_amount,
            member_id=data.paid_by,
            expense_id=expense.id,
            deduction_id=deduction.id,
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

    add_log(
        db,
        expense_id=expense.id,
        group_id=group_id,
        actor_member_id=current.id,
        action="created",
        changes={
            "description": data.description,
            "amount": str(data.amount),
            "currency_code": expense_currency,
            "paid_by": str(data.paid_by),
        },
    )
    logger.info(
        "expense_create expense_id=%s group_id=%s creator_member_id=%s creator=%s",
        expense.id, group_id, current.id, current.display_name,
    )

    involved_member_ids = {data.paid_by, *(s.group_member_id for s in data.splits)}
    affected_user_ids = await resolve_member_user_ids(db, involved_member_ids)
    await notify_members(
        db, affected_user_ids, group_id, "expense_added",
        {"description": data.description, "amount": str(data.amount), "payer": current.display_name},
        exclude_user_id=current_user.id,
    )

    await db.commit()

    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
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
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
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
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
        )
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")
    return _build_expense_read(expense, group.currency_code)


@router.get("/{expense_id}/logs", response_model=list[ExpenseLogRead])
async def list_expense_logs(
    group_id: uuid.UUID,
    expense_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)

    exists = await db.execute(
        select(Expense.id).where(Expense.id == expense_id, Expense.group_id == group_id)
    )
    if not exists.scalar():
        raise NotFound("Expense not found")

    result = await db.execute(
        select(ExpenseLog)
        .where(ExpenseLog.expense_id == expense_id)
        .options(selectinload(ExpenseLog.actor))
        .order_by(ExpenseLog.created_at.asc())
    )
    logs = result.scalars().all()
    return [
        ExpenseLogRead(
            id=log.id,
            expense_id=log.expense_id,
            actor_member_id=log.actor_member_id,
            actor_name=log.actor.display_name if log.actor else None,
            action=log.action,
            changes=log.changes,
            created_at=log.created_at,
        )
        for log in logs
    ]


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
        .options(
            selectinload(Expense.splits),
            selectinload(Expense.fund_deductions),
        )
    )
    expense = result.scalars().first()
    if not expense:
        raise NotFound("Expense not found")

    logger.info(
        "expense_edit expense_id=%s group_id=%s editor_member_id=%s editor=%s creator_member_id=%s",
        expense.id, group_id, current.id, current.display_name, expense.created_by,
    )

    before_snapshot = snapshot_expense(expense)

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

    # Handle fund deductions update
    if data.fund_deductions is not None:
        existing_deductions_result = await db.execute(
            select(ExpenseFundDeduction).where(ExpenseFundDeduction.expense_id == expense.id)
        )
        existing_deductions = {d.fund_id: d for d in existing_deductions_result.scalars().all()}

        new_fund_ids = set()
        total_deductions = Decimal("0")

        for fd in data.fund_deductions:
            if fd.fund_id in new_fund_ids:
                raise BadRequest("Duplicate fund in deductions")
            new_fund_ids.add(fd.fund_id)

            if fd.amount <= 0:
                raise BadRequest("Fund deduction amount must be greater than zero")

            fund_result = await db.execute(
                select(Fund).where(
                    Fund.id == fd.fund_id,
                    Fund.group_id == group_id,
                    Fund.is_active == True,
                )
            )
            fund = fund_result.scalars().first()
            if not fund:
                raise BadRequest(f"Fund {fd.fund_id} not found or inactive")

            balance = await compute_fund_balance(db, fund.id)
            old_deduction = existing_deductions.get(fd.fund_id)
            available = balance + (old_deduction.amount if old_deduction else Decimal("0"))
            if fd.amount > available:
                raise BadRequest(
                    f"Fund '{fund.name}' has insufficient balance "
                    f"({available} available, {fd.amount} requested)"
                )

            total_deductions += fd.amount

        effective_converted = expense.converted_amount
        if data.amount is not None or data.exchange_rate is not None or data.currency_code is not None:
            rate = expense.exchange_rate if expense.currency_code != group.currency_code else Decimal("1")
            effective_converted = (expense.amount * rate).quantize(Decimal("0.01"))

        if total_deductions > effective_converted:
            raise BadRequest(
                f"Total fund deductions ({total_deductions}) exceed expense amount ({effective_converted})"
            )

        # Delete removed deductions and their fund transactions
        for old_fund_id, old_deduction in existing_deductions.items():
            if old_fund_id not in new_fund_ids:
                old_ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.deduction_id == old_deduction.id)
                )
                old_ft = old_ft_result.scalars().first()
                if old_ft:
                    await db.delete(old_ft)
                await db.delete(old_deduction)

        # Upsert deductions
        for fd in data.fund_deductions:
            old_deduction = existing_deductions.get(fd.fund_id)
            if old_deduction:
                old_deduction.amount = fd.amount
                ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.deduction_id == old_deduction.id)
                )
                ft = ft_result.scalars().first()
                if ft:
                    ft.amount = fd.amount
            else:
                new_deduction = ExpenseFundDeduction(
                    expense_id=expense.id,
                    fund_id=fd.fund_id,
                    amount=fd.amount,
                    created_by=current.id,
                )
                db.add(new_deduction)
                await db.flush()

                new_ft = FundTransaction(
                    fund_id=fd.fund_id,
                    type=FundTransactionType.expense,
                    amount=fd.amount,
                    member_id=expense.paid_by,
                    expense_id=expense.id,
                    deduction_id=new_deduction.id,
                    note=expense.description,
                    created_by=current.id,
                )
                db.add(new_ft)

    # Recalculate converted amount
    if data.amount is not None or data.exchange_rate is not None or data.currency_code is not None:
        rate = expense.exchange_rate if expense.currency_code != group.currency_code else Decimal("1")
        expense.converted_amount = (expense.amount * rate).quantize(Decimal("0.01"))

    # Recalculate splits if provided, or if deductions/amount changed
    deductions_changed = data.fund_deductions is not None
    amount_changed = data.amount is not None or data.exchange_rate is not None or data.currency_code is not None
    if data.splits is not None and data.split_type is not None:
        for old_split in expense.splits:
            await db.delete(old_split)
        await db.flush()

        deductions_result = await db.execute(
            select(func.coalesce(func.sum(ExpenseFundDeduction.amount), Decimal("0")))
            .where(ExpenseFundDeduction.expense_id == expense.id)
        )
        total_deductions = deductions_result.scalar() or Decimal("0")
        splittable_amount = expense.converted_amount - total_deductions

        members_map = {str(s.group_member_id): s.value for s in data.splits}
        if splittable_amount == 0:
            resolved = {mid: Decimal("0") for mid in members_map}
        else:
            resolved = calculate_splits(splittable_amount, data.split_type.value, members_map)

        for s in data.splits:
            split = ExpenseSplit(
                expense_id=expense.id,
                group_member_id=s.group_member_id,
                split_type=data.split_type,
                value=s.value,
                resolved_amount=resolved[str(s.group_member_id)],
            )
            db.add(split)
    elif (deductions_changed or amount_changed) and expense.splits:
        # Re-resolve existing splits against new splittable_amount
        deductions_result = await db.execute(
            select(func.coalesce(func.sum(ExpenseFundDeduction.amount), Decimal("0")))
            .where(ExpenseFundDeduction.expense_id == expense.id)
        )
        total_deductions = deductions_result.scalar() or Decimal("0")
        splittable_amount = expense.converted_amount - total_deductions

        current_split_type = expense.splits[0].split_type.value
        members_map = {str(s.group_member_id): s.value for s in expense.splits}

        if splittable_amount == 0:
            resolved = {mid: Decimal("0") for mid in members_map}
        else:
            resolved = calculate_splits(splittable_amount, current_split_type, members_map)

        for s in expense.splits:
            s.resolved_amount = resolved[str(s.group_member_id)]

    await db.flush()
    await db.refresh(expense, attribute_names=["splits", "fund_deductions"])
    after_snapshot = snapshot_expense(expense)
    changes = diff_snapshots(before_snapshot, after_snapshot)
    if changes:
        add_log(
            db,
            expense_id=expense.id,
            group_id=group_id,
            actor_member_id=current.id,
            action="updated",
            changes=changes,
        )

    involved_member_ids = {expense.paid_by, *(s.group_member_id for s in expense.splits)}
    affected_user_ids = await resolve_member_user_ids(db, involved_member_ids)
    await notify_members(
        db, affected_user_ids, group_id, "expense_updated",
        {
            "description": expense.description,
            "amount": str(expense.amount),
            "editor": current.display_name,
        },
        exclude_user_id=current_user.id,
    )

    expense_id_val = expense.id
    await db.commit()

    # Clear session to avoid stale identity map entries causing lazy loads
    db.expunge_all()

    # Reload with completely fresh objects
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense_id_val)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
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

    splits_result = await db.execute(
        select(ExpenseSplit.group_member_id).where(ExpenseSplit.expense_id == expense_id)
    )
    involved_member_ids = {expense.paid_by, *(mid for (mid,) in splits_result.all())}
    affected_user_ids = await resolve_member_user_ids(db, involved_member_ids)
    await notify_members(
        db, affected_user_ids, group_id, "expense_deleted",
        {"description": expense.description, "amount": str(expense.amount)},
        exclude_user_id=current_user.id,
    )

    # Delete linked fund transactions
    ft_result = await db.execute(
        select(FundTransaction).where(FundTransaction.expense_id == expense_id)
    )
    for ft in ft_result.scalars().all():
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

    old_url = expense.receipt_url
    expense.receipt_url = url
    add_log(
        db,
        expense_id=expense.id,
        group_id=group_id,
        actor_member_id=current.id,
        action="receipt_uploaded",
        changes={"receipt_url": {"from": old_url, "to": url}},
    )
    await db.commit()

    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
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

    old_url = expense.receipt_url
    expense.receipt_url = None
    add_log(
        db,
        expense_id=expense.id,
        group_id=group_id,
        actor_member_id=current.id,
        action="receipt_deleted",
        changes={"receipt_url": {"from": old_url, "to": None}},
    )
    await db.commit()

    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)
