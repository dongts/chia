import datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Category, Expense, ExpenseSplit, Group, GroupMember, MemberRole, User
from app.models.expense import SplitType
from app.models.fund import Fund
from app.services.merge_users import merge_user_into


@pytest_asyncio.fixture
async def shared_expenses(db: AsyncSession, test_user: User):
    """Source, target and other share an equal and an exact expense."""
    group = Group(name="Trip", currency_code="USD", invite_code="MERGE123")
    guest = User(display_name="Guest", device_id="guest-device", is_verified=False)
    db.add_all([group, guest])
    await db.flush()
    source = GroupMember(group_id=group.id, user_id=guest.id, display_name="Guest",
                         role=MemberRole.admin, initial_balance=Decimal("1"))
    target = GroupMember(group_id=group.id, user_id=test_user.id, display_name="Target",
                         role=MemberRole.member, initial_balance=Decimal("2"))
    other = GroupMember(group_id=group.id, display_name="Other", role=MemberRole.member)
    category = Category(group_id=group.id, name="Food")
    db.add_all([source, target, other, category])
    await db.flush()
    expenses = {}
    for kind, values in (("equal", (1, 1, 1)), ("exact", (20, 30, 40))):
        expense = Expense(group_id=group.id, paid_by=other.id, created_by=other.id, description=kind,
                          amount=Decimal("90"), currency_code="USD", converted_amount=Decimal("90"),
                          category_id=category.id, date=datetime.date(2026, 9, 18))
        db.add(expense)
        await db.flush()
        resolved = (30, 30, 30) if kind == "equal" else (20, 30, 40)
        for member, value, amount in zip((source, target, other), values, resolved):
            db.add(ExpenseSplit(expense_id=expense.id, group_member_id=member.id, split_type=SplitType(kind),
                                value=Decimal(value), resolved_amount=Decimal(amount)))
        expenses[kind] = expense.id
    db.add(Fund(group_id=group.id, name="Fund", holder_id=source.id, created_by=source.id))
    await db.commit()
    return {"group": group, "guest": guest, "source": source, "target": target, "other": other, **expenses}


async def _splits(db: AsyncSession, expense_id):
    rows = (await db.execute(
        select(ExpenseSplit).where(ExpenseSplit.expense_id == expense_id)
        .execution_options(populate_existing=True)
    )).scalars().all()
    return {row.group_member_id: (row.split_type.value, row.value, row.resolved_amount) for row in rows}


async def _assert_folded(db: AsyncSession, s: dict):
    target, other = s["target"].id, s["other"].id
    assert await _splits(db, s["equal"]) == {
        target: ("shares", Decimal("2"), Decimal("60")), other: ("shares", Decimal("1"), Decimal("30")),
    }
    assert await _splits(db, s["exact"]) == {
        target: ("exact", Decimal("50"), Decimal("50")), other: ("exact", Decimal("40"), Decimal("40")),
    }
    fund = (await db.execute(select(Fund).execution_options(populate_existing=True))).scalars().one()
    assert fund.holder_id == target and fund.created_by == target
    await db.refresh(s["source"])
    await db.refresh(s["target"])
    assert (s["source"].is_active, s["source"].user_id, s["source"].initial_balance) == (False, None, Decimal("0"))
    assert (s["target"].role, s["target"].initial_balance) == (MemberRole.admin, Decimal("3"))


@pytest.mark.asyncio
async def test_user_merge_folds_duplicate_splits(db: AsyncSession, shared_expenses: dict, test_user: User):
    await merge_user_into(db, shared_expenses["guest"].id, test_user.id)
    await _assert_folded(db, shared_expenses)


@pytest.mark.asyncio
async def test_admin_member_merge_folds_duplicate_splits(
    client: AsyncClient, auth_headers: dict, db: AsyncSession, shared_expenses: dict,
    test_user: User, monkeypatch,
):
    monkeypatch.setattr(settings, "superadmin_emails", [test_user.email])
    s = shared_expenses
    resp = await client.post(
        f"/api/v1/admin/groups/{s['group'].id}/members/{s['source'].id}/merge-into/{s['target'].id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    await _assert_folded(db, s)

    again = await client.post(
        f"/api/v1/admin/groups/{s['group'].id}/members/{s['source'].id}/merge-into/{s['target'].id}",
        headers=auth_headers,
    )
    assert again.status_code == 400
