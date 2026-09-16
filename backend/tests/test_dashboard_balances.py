from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupMember, MemberRole, Settlement, User


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("settlement_type", "is_sender", "expected"),
    [
        ("gift", True, "2183834"),
        ("gift", False, "2553834"),
        ("settle_up", True, "2553834"),
        ("settle_up", False, "2183834"),
        ("transfer", True, "2553834"),
        ("transfer", False, "2183834"),
    ],
)
async def test_dashboard_balance_matches_group_balance_for_transfer(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict,
    settlement_type: str,
    is_sender: bool,
    expected: str,
):
    group = Group(name="Gift Group", currency_code="VND", invite_code="GIFTDASH")
    db.add(group)
    await db.flush()

    giver = GroupMember(
        group_id=group.id,
        user_id=test_user.id if is_sender else None,
        display_name="Giver",
        role=MemberRole.owner,
    )
    recipient = GroupMember(
        group_id=group.id,
        user_id=None if is_sender else test_user.id,
        display_name="Recipient",
        role=MemberRole.member,
    )
    current_member = giver if is_sender else recipient
    current_member.initial_balance = Decimal("2368834")
    db.add_all([giver, recipient])
    await db.flush()
    db.add(Settlement(
        group_id=group.id,
        from_member=giver.id,
        to_member=recipient.id,
        amount=Decimal("185000"),
        type=settlement_type,
        created_by=giver.id,
    ))
    await db.commit()

    dashboard_response = await client.get("/api/v1/groups", headers=auth_headers)
    group_response = await client.get(
        f"/api/v1/groups/{group.id}/balances", headers=auth_headers
    )

    assert dashboard_response.status_code == 200
    assert group_response.status_code == 200
    dashboard_balance = Decimal(str(dashboard_response.json()[0]["my_balance"]))
    group_balances = {
        item["member_id"]: Decimal(str(item["balance"]))
        for item in group_response.json()
    }
    assert dashboard_balance == group_balances[str(current_member.id)] == Decimal(expected)
