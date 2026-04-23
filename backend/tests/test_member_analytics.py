import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, Group, GroupMember, MemberRole, Settlement, User
from app.services.auth import hash_password


@pytest_asyncio.fixture
async def analytics_setup(db: AsyncSession, test_user: User):
    group = Group(name="Analytics Group", currency_code="USD", invite_code="ANALYTIC")
    db.add(group)
    await db.flush()

    alice = GroupMember(
        group_id=group.id,
        user_id=test_user.id,
        display_name="Alice",
        role=MemberRole.owner,
        initial_balance=Decimal("10.00"),
    )
    db.add(alice)
    await db.flush()

    bob_user = User(
        email="bob-analytics@test.com",
        password_hash=hash_password("pw"),
        display_name="Bob",
        is_verified=True,
    )
    db.add(bob_user)
    await db.flush()
    bob = GroupMember(
        group_id=group.id,
        user_id=bob_user.id,
        display_name="Bob",
        role=MemberRole.member,
    )
    db.add(bob)
    await db.flush()

    category = Category(name="Food", icon="🍕", is_default=True)
    db.add(category)
    await db.flush()

    await db.commit()
    for obj in (group, alice, bob, category):
        await db.refresh(obj)

    return {"group": group, "alice": alice, "bob": bob, "category": category}


@pytest.mark.asyncio
async def test_balance_activity_reconciles_to_net_balance(
    client: AsyncClient,
    auth_headers: dict,
    analytics_setup: dict,
    db: AsyncSession,
):
    """Sum of signed net_effect across balance_activity must equal
    net_balance − initial_balance. If this ever drifts, the list is lying
    to users about how their balance got there."""
    group = analytics_setup["group"]
    alice = analytics_setup["alice"]
    bob = analytics_setup["bob"]
    category = analytics_setup["category"]

    # Expense 1: Alice pays $30, split equally (Alice owes $15, Bob owes $15)
    await client.post(
        f"/api/v1/groups/{group.id}/expenses",
        json={
            "description": "Dinner",
            "amount": "30.00",
            "date": "2026-04-10",
            "paid_by": str(alice.id),
            "category_id": str(category.id),
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(alice.id), "value": 1},
                {"group_member_id": str(bob.id), "value": 1},
            ],
            "fund_deductions": [],
        },
        headers=auth_headers,
    )

    # Expense 2: Bob pays $20, only Alice owes (Alice owes full $20)
    await client.post(
        f"/api/v1/groups/{group.id}/expenses",
        json={
            "description": "Taxi",
            "amount": "20.00",
            "date": "2026-04-12",
            "paid_by": str(bob.id),
            "category_id": str(category.id),
            "split_type": "exact",
            "splits": [
                {"group_member_id": str(alice.id), "value": "20.00"},
            ],
            "fund_deductions": [],
        },
        headers=auth_headers,
    )

    # Settlement: Alice pays Bob $5 (Alice's balance goes up by 5)
    db.add(
        Settlement(
            group_id=group.id,
            from_member=alice.id,
            to_member=bob.id,
            amount=Decimal("5.00"),
            type="settle_up",
            created_by=alice.id,
        )
    )
    await db.commit()

    resp = await client.get(
        f"/api/v1/groups/{group.id}/reports/member/{alice.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    activity_sum = sum(Decimal(str(entry["net_effect"])) for entry in data["balance_activity"])
    expected = Decimal(str(data["net_balance"])) - Decimal(str(data["initial_balance"]))
    assert activity_sum.quantize(Decimal("0.01")) == expected.quantize(Decimal("0.01"))

    # Sanity checks
    assert data["initial_balance"] == 10.00
    # Paid by category is removed; owed by category stays
    assert "paid_by_category" not in data
    assert "owed_by_category" in data
    kinds = {entry["kind"] for entry in data["balance_activity"]}
    assert kinds == {"expense", "settle_up"}
