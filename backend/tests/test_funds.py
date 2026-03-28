import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupMember, MemberRole, User
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.services.auth import hash_password


@pytest_asyncio.fixture
async def fund_setup(db: AsyncSession, test_user: User):
    """Create a group with 2 members for fund testing."""
    group = Group(name="Tennis Club", currency_code="VND", invite_code="TENNIS123")
    db.add(group)
    await db.flush()

    member1 = GroupMember(
        group_id=group.id, user_id=test_user.id, display_name="Player 1", role=MemberRole.owner
    )
    db.add(member1)
    await db.flush()

    user2 = User(email="player2@test.com", password_hash=hash_password("pass123"), display_name="Player 2", is_verified=True)
    db.add(user2)
    await db.flush()

    member2 = GroupMember(
        group_id=group.id, user_id=user2.id, display_name="Player 2", role=MemberRole.member
    )
    db.add(member2)
    await db.commit()
    await db.refresh(group)
    await db.refresh(member1)
    await db.refresh(member2)

    return {"group": group, "member1": member1, "member2": member2}


@pytest.mark.asyncio
async def test_create_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ tiền phạt"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Quỹ tiền phạt"
    assert data["is_active"] is True
    assert Decimal(str(data["balance"])) == Decimal("0")
    assert data["holder_id"] == str(fund_setup["member1"].id)


@pytest.mark.asyncio
async def test_list_funds(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ 1"},
        headers=auth_headers,
    )
    resp = await client.get(f"/api/v1/groups/{group.id}/funds", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_contribute_to_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "200000", "member_id": str(member1.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["type"] == "contribute"
    assert Decimal(str(resp.json()["amount"])) == Decimal("200000")

    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert Decimal(str(detail_resp.json()["balance"])) == Decimal("200000")


@pytest.mark.asyncio
async def test_withdraw_from_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]
    await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "500000", "member_id": str(member1.id)},
        headers=auth_headers,
    )

    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "withdraw", "amount": "100000", "member_id": str(member1.id), "note": "Trả lại tiền dư"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert Decimal(str(detail_resp.json()["balance"])) == Decimal("400000")


@pytest.mark.asyncio
async def test_close_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ tạm"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    resp = await client.delete(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200

    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "100000", "member_id": str(fund_setup["member1"].id)},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_change_holder(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member2 = fund_setup["member2"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        json={"holder_id": str(member2.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["holder_id"] == str(member2.id)

    tx_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        headers=auth_headers,
    )
    transactions = tx_resp.json()
    assert any(tx["type"] == "holder_change" for tx in transactions)


@pytest.mark.asyncio
async def test_delete_transaction(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    tx_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "100000", "member_id": str(member1.id)},
        headers=auth_headers,
    )
    tx_id = tx_resp.json()["id"]

    resp = await client.delete(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions/{tx_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200

    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert Decimal(str(detail_resp.json()["balance"])) == Decimal("0")
