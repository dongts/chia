import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupMember, MemberRole, User, Category
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.services.auth import hash_password


@pytest_asyncio.fixture
async def expense_fund_setup(db: AsyncSession, test_user: User):
    """Create a group with 3 members, a category, and 2 funded funds."""
    group = Group(name="Trip Group", currency_code="USD", invite_code="TRIP123")
    db.add(group)
    await db.flush()

    member1 = GroupMember(
        group_id=group.id, user_id=test_user.id, display_name="Alice", role=MemberRole.owner
    )
    db.add(member1)
    await db.flush()

    user2 = User(email="bob@test.com", password_hash=hash_password("pass"), display_name="Bob", is_verified=True)
    db.add(user2)
    await db.flush()
    member2 = GroupMember(group_id=group.id, user_id=user2.id, display_name="Bob", role=MemberRole.member)
    db.add(member2)
    await db.flush()

    user3 = User(email="carol@test.com", password_hash=hash_password("pass"), display_name="Carol", is_verified=True)
    db.add(user3)
    await db.flush()
    member3 = GroupMember(group_id=group.id, user_id=user3.id, display_name="Carol", role=MemberRole.member)
    db.add(member3)
    await db.flush()

    category = Category(name="Food", icon="🍕", is_default=True)
    db.add(category)
    await db.flush()

    fund_a = Fund(group_id=group.id, name="Party Fund", holder_id=member1.id, created_by=member1.id)
    db.add(fund_a)
    await db.flush()

    tx_a = FundTransaction(
        fund_id=fund_a.id, type=FundTransactionType.contribute,
        amount=Decimal("500.00"), member_id=member1.id, created_by=member1.id,
    )
    db.add(tx_a)

    fund_b = Fund(group_id=group.id, name="Emergency Fund", holder_id=member1.id, created_by=member1.id)
    db.add(fund_b)
    await db.flush()

    tx_b = FundTransaction(
        fund_id=fund_b.id, type=FundTransactionType.contribute,
        amount=Decimal("300.00"), member_id=member1.id, created_by=member1.id,
    )
    db.add(tx_b)

    await db.commit()
    for obj in [group, member1, member2, member3, category, fund_a, fund_b]:
        await db.refresh(obj)

    return {
        "group": group, "member1": member1, "member2": member2, "member3": member3,
        "category": category, "fund_a": fund_a, "fund_b": fund_b,
    }


def _expense_payload(setup: dict, **overrides) -> dict:
    """Build a minimal expense create payload."""
    base = {
        "description": "Dinner",
        "amount": "100.00",
        "date": "2026-04-03",
        "paid_by": str(setup["member1"].id),
        "category_id": str(setup["category"].id),
        "split_type": "equal",
        "splits": [
            {"group_member_id": str(setup["member1"].id), "value": 1},
            {"group_member_id": str(setup["member2"].id), "value": 1},
            {"group_member_id": str(setup["member3"].id), "value": 1},
        ],
        "fund_deductions": [],
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_create_expense_no_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup)
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["fund_deductions"] == []
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("100.00")


@pytest.mark.asyncio
async def test_create_expense_single_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["fund_deductions"]) == 1
    assert Decimal(data["fund_deductions"][0]["amount"]) == Decimal("40.00")
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("60.00")


@pytest.mark.asyncio
async def test_create_expense_multiple_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "20.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["fund_deductions"]) == 2
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("50.00")

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("470.00")

    fb_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_b'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fb_resp.json()["balance"])) == Decimal("280.00")


@pytest.mark.asyncio
async def test_create_expense_fund_covers_100_percent(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "100.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    for s in data["splits"]:
        assert Decimal(s["resolved_amount"]) == Decimal("0")


@pytest.mark.asyncio
async def test_create_expense_deduction_exceeds_fund_balance(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "999.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "insufficient balance" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_deductions_exceed_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "60.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "50.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "exceed expense amount" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_duplicate_fund_id(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "20.00"},
        {"fund_id": str(setup["fund_a"].id), "amount": "10.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "Duplicate fund" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_inactive_fund(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    await client.delete(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "10.00"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "not found or inactive" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_zero_deduction_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "0"},
    ])
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "greater than zero" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_exact_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup,
        split_type="exact",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "40.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "20.00"},
            {"group_member_id": str(setup["member2"].id), "value": "20.00"},
            {"group_member_id": str(setup["member3"].id), "value": "20.00"},
        ],
    )
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    total_split = sum(Decimal(s["resolved_amount"]) for s in resp.json()["splits"])
    assert total_split == Decimal("60.00")


@pytest.mark.asyncio
async def test_percentage_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup,
        split_type="percentage",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "50.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "50"},
            {"group_member_id": str(setup["member2"].id), "value": "30"},
            {"group_member_id": str(setup["member3"].id), "value": "20"},
        ],
    )
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    splits = resp.json()["splits"]
    amounts = {s["group_member_id"]: Decimal(s["resolved_amount"]) for s in splits}
    assert amounts[str(setup["member1"].id)] == Decimal("25.00")
    assert amounts[str(setup["member2"].id)] == Decimal("15.00")
    assert amounts[str(setup["member3"].id)] == Decimal("10.00")


@pytest.mark.asyncio
async def test_shares_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup,
        split_type="shares",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "40.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "2"},
            {"group_member_id": str(setup["member2"].id), "value": "1"},
        ],
    )
    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    splits = resp.json()["splits"]
    amounts = {s["group_member_id"]: Decimal(s["resolved_amount"]) for s in splits}
    assert amounts[str(setup["member1"].id)] == Decimal("40.00")
    assert amounts[str(setup["member2"].id)] == Decimal("20.00")


@pytest.mark.asyncio
async def test_update_add_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup)
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [
                {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
            ],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert len(data["fund_deductions"]) == 1
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("70.00")

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("470.00")


@pytest.mark.asyncio
async def test_update_remove_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["fund_deductions"] == []
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("100.00")

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("500.00")


@pytest.mark.asyncio
async def test_update_change_deduction_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [
                {"fund_id": str(setup["fund_a"].id), "amount": "60.00"},
            ],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    total_split = sum(Decimal(s["resolved_amount"]) for s in update_resp.json()["splits"])
    assert total_split == Decimal("40.00")

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("440.00")


@pytest.mark.asyncio
async def test_delete_expense_restores_fund_balances(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "20.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    del_resp = await client.delete(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 200

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("500.00")

    fb_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_b'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fb_resp.json()["balance"])) == Decimal("300.00")
