import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupCurrency, MemberRole, User
from app.schemas.group_currency import GroupCurrencyCreate, GroupCurrencyRead, GroupCurrencyUpdate

router = APIRouter(prefix="/groups/{group_id}/currencies", tags=["group_currencies"])


@router.get("", response_model=list[GroupCurrencyRead])
async def list_group_currencies(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupCurrency)
        .where(GroupCurrency.group_id == group_id)
        .order_by(GroupCurrency.currency_code)
    )
    return result.scalars().all()


@router.post("", response_model=GroupCurrencyRead)
async def add_group_currency(
    group_id: uuid.UUID,
    data: GroupCurrencyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)

    code = data.currency_code.upper().strip()
    if len(code) != 3:
        raise BadRequest("Currency code must be 3 characters (e.g. EUR, VND)")
    if code == group.currency_code:
        raise BadRequest(f"{code} is already the group's main currency")
    if data.exchange_rate <= 0:
        raise BadRequest("Exchange rate must be positive")

    # Check for duplicate
    existing = await db.execute(
        select(GroupCurrency).where(
            GroupCurrency.group_id == group_id,
            GroupCurrency.currency_code == code,
        )
    )
    if existing.scalars().first():
        raise BadRequest(f"{code} is already added to this group")

    gc = GroupCurrency(
        group_id=group_id,
        currency_code=code,
        exchange_rate=data.exchange_rate,
    )
    db.add(gc)
    await db.commit()
    await db.refresh(gc)
    return gc


@router.patch("/{currency_id}", response_model=GroupCurrencyRead)
async def update_group_currency(
    group_id: uuid.UUID,
    currency_id: uuid.UUID,
    data: GroupCurrencyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)

    if data.exchange_rate <= 0:
        raise BadRequest("Exchange rate must be positive")

    result = await db.execute(
        select(GroupCurrency).where(
            GroupCurrency.id == currency_id,
            GroupCurrency.group_id == group_id,
        )
    )
    gc = result.scalars().first()
    if not gc:
        raise NotFound("Currency not found")

    gc.exchange_rate = data.exchange_rate
    await db.commit()
    await db.refresh(gc)
    return gc


@router.delete("/{currency_id}")
async def delete_group_currency(
    group_id: uuid.UUID,
    currency_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)

    result = await db.execute(
        select(GroupCurrency).where(
            GroupCurrency.id == currency_id,
            GroupCurrency.group_id == group_id,
        )
    )
    gc = result.scalars().first()
    if not gc:
        raise NotFound("Currency not found")

    await db.delete(gc)
    await db.commit()
    return {"detail": "Currency removed"}
