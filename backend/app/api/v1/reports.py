import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.security import get_current_user
from app.database import get_db
from app.models import Expense, ExpenseSplit, GroupMember, Category, User

router = APIRouter(prefix="/groups/{group_id}/reports", tags=["reports"])


@router.get("/summary")
async def report_summary(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Overall group summary: total spent, expense count, per-member totals, per-category totals."""
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)

    # All expenses
    expenses_result = await db.execute(
        select(Expense).where(Expense.group_id == group_id)
    )
    expenses = expenses_result.scalars().all()

    # Members
    members_result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.is_active.is_(True))
    )
    members = {m.id: m for m in members_result.scalars().all()}

    # Categories
    cats_result = await db.execute(select(Category))
    categories = {c.id: c for c in cats_result.scalars().all()}

    # All splits
    splits_result = await db.execute(
        select(ExpenseSplit)
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .where(Expense.group_id == group_id)
    )
    all_splits = splits_result.scalars().all()

    total_spent = sum((e.converted_amount for e in expenses), Decimal("0"))
    expense_count = len(expenses)

    # Per member: total paid, total owed
    paid_by_member: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    owed_by_member: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    expense_count_by_member: dict[uuid.UUID, int] = defaultdict(int)

    for e in expenses:
        if e.paid_by in members:
            paid_by_member[e.paid_by] += e.converted_amount
            expense_count_by_member[e.paid_by] += 1

    for s in all_splits:
        if s.group_member_id in members:
            owed_by_member[s.group_member_id] += s.resolved_amount

    per_member = []
    for mid, m in members.items():
        per_member.append({
            "member_id": str(mid),
            "member_name": m.display_name,
            "total_paid": float(paid_by_member.get(mid, Decimal("0")).quantize(Decimal("0.01"))),
            "total_owed": float(owed_by_member.get(mid, Decimal("0")).quantize(Decimal("0.01"))),
            "expense_count": expense_count_by_member.get(mid, 0),
        })
    per_member.sort(key=lambda x: x["total_paid"], reverse=True)

    # Per category
    by_category: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    count_by_category: dict[uuid.UUID, int] = defaultdict(int)
    for e in expenses:
        by_category[e.category_id] += e.converted_amount
        count_by_category[e.category_id] += 1

    per_category = []
    for cid, amount in by_category.items():
        cat = categories.get(cid)
        per_category.append({
            "category_id": str(cid),
            "category_name": cat.name if cat else "Unknown",
            "category_icon": cat.icon if cat else "📦",
            "total_amount": float(amount.quantize(Decimal("0.01"))),
            "expense_count": count_by_category[cid],
            "percentage": float((amount / total_spent * 100).quantize(Decimal("0.1"))) if total_spent > 0 else 0,
        })
    per_category.sort(key=lambda x: x["total_amount"], reverse=True)

    return {
        "currency_code": group.currency_code,
        "total_spent": float(total_spent.quantize(Decimal("0.01"))),
        "expense_count": expense_count,
        "per_member": per_member,
        "per_category": per_category,
    }


@router.get("/member/{member_id}")
async def report_member_detail(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Detailed breakdown for a specific member: what they paid, what they owe, by category."""
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)

    # Get member
    member_result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    member = member_result.scalars().first()
    if not member:
        return {"detail": "Member not found"}

    # Categories
    cats_result = await db.execute(select(Category))
    categories = {c.id: c for c in cats_result.scalars().all()}

    # Expenses this member paid
    paid_result = await db.execute(
        select(Expense).where(Expense.group_id == group_id, Expense.paid_by == member_id)
        .order_by(Expense.date.desc())
    )
    paid_expenses = paid_result.scalars().all()

    # Splits where this member owes
    owed_result = await db.execute(
        select(ExpenseSplit, Expense)
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .where(Expense.group_id == group_id, ExpenseSplit.group_member_id == member_id)
        .order_by(Expense.date.desc())
    )
    owed_splits = owed_result.all()

    # Paid by category
    paid_by_cat: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for e in paid_expenses:
        paid_by_cat[e.category_id] += e.converted_amount

    paid_categories = []
    for cid, amount in paid_by_cat.items():
        cat = categories.get(cid)
        paid_categories.append({
            "category_name": cat.name if cat else "Unknown",
            "category_icon": cat.icon if cat else "📦",
            "total_amount": float(amount.quantize(Decimal("0.01"))),
        })
    paid_categories.sort(key=lambda x: x["total_amount"], reverse=True)

    # Owed by category
    owed_by_cat: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for split, expense in owed_splits:
        owed_by_cat[expense.category_id] += split.resolved_amount

    owed_categories = []
    for cid, amount in owed_by_cat.items():
        cat = categories.get(cid)
        owed_categories.append({
            "category_name": cat.name if cat else "Unknown",
            "category_icon": cat.icon if cat else "📦",
            "total_amount": float(amount.quantize(Decimal("0.01"))),
        })
    owed_categories.sort(key=lambda x: x["total_amount"], reverse=True)

    # Recent expenses paid
    recent_paid = [
        {
            "id": str(e.id), "description": e.description,
            "amount": float(e.converted_amount), "currency_code": group.currency_code,
            "original_amount": float(e.amount), "original_currency": e.currency_code,
            "category_name": categories.get(e.category_id, None) and categories[e.category_id].name or "Unknown",
            "category_icon": categories.get(e.category_id, None) and categories[e.category_id].icon or "📦",
            "date": e.date.isoformat(),
        }
        for e in paid_expenses[:50]
    ]

    # Recent expenses owed
    recent_owed = [
        {
            "id": str(expense.id), "description": expense.description,
            "owed_amount": float(split.resolved_amount),
            "total_amount": float(expense.converted_amount),
            "currency_code": group.currency_code,
            "category_name": categories.get(expense.category_id, None) and categories[expense.category_id].name or "Unknown",
            "category_icon": categories.get(expense.category_id, None) and categories[expense.category_id].icon or "📦",
            "date": expense.date.isoformat(),
        }
        for split, expense in owed_splits[:50]
    ]

    total_paid = sum((e.converted_amount for e in paid_expenses), Decimal("0"))
    total_owed = sum((s.resolved_amount for s, _ in owed_splits), Decimal("0"))

    return {
        "member_id": str(member_id),
        "member_name": member.display_name,
        "currency_code": group.currency_code,
        "total_paid": float(total_paid.quantize(Decimal("0.01"))),
        "total_owed": float(total_owed.quantize(Decimal("0.01"))),
        "paid_by_category": paid_categories,
        "owed_by_category": owed_categories,
        "recent_paid": recent_paid,
        "recent_owed": recent_owed,
    }
