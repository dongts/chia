import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member
from app.core.security import get_current_user
from app.database import get_db
from app.models import User, GroupMember
from app.models.payment_method import PaymentMethod, GroupPaymentMethod
from app.schemas.payment_method import (
    EnablePaymentMethodRequest,
    GroupPaymentMethodRead,
    MyGroupPaymentMethodRead,
    PaymentMethodCreate,
    PaymentMethodRead,
    PaymentMethodUpdate,
)
from app.services.file_storage import save_upload

router = APIRouter(tags=["payment-methods"])


# ── Profile-level CRUD ──────────────────────────────────────────────


@router.get("/users/me/payment-methods", response_model=list[PaymentMethodRead])
async def list_my_payment_methods(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaymentMethod)
        .where(PaymentMethod.user_id == current_user.id)
        .order_by(PaymentMethod.created_at)
    )
    return result.scalars().all()


@router.post("/users/me/payment-methods", response_model=PaymentMethodRead)
async def create_payment_method(
    data: PaymentMethodCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = PaymentMethod(user_id=current_user.id, **data.model_dump())
    db.add(pm)
    await db.commit()
    await db.refresh(pm)
    return pm


@router.patch("/users/me/payment-methods/{pm_id}", response_model=PaymentMethodRead)
async def update_payment_method(
    pm_id: uuid.UUID,
    data: PaymentMethodUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(pm, key, value)
    await db.commit()
    await db.refresh(pm)
    return pm


@router.delete("/users/me/payment-methods/{pm_id}")
async def delete_payment_method(
    pm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    await db.delete(pm)
    await db.commit()
    return {"detail": "Payment method deleted"}


@router.post("/users/me/payment-methods/{pm_id}/qr", response_model=PaymentMethodRead)
async def upload_qr_image(
    pm_id: uuid.UUID,
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    try:
        url = await save_upload(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pm.qr_image_url = url
    await db.commit()
    await db.refresh(pm)
    return pm


async def _get_own_pm(db: AsyncSession, pm_id: uuid.UUID, user_id: uuid.UUID) -> PaymentMethod:
    result = await db.execute(
        select(PaymentMethod).where(PaymentMethod.id == pm_id, PaymentMethod.user_id == user_id)
    )
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return pm


# ── Group-level enable/disable + view ───────────────────────────────


@router.get("/groups/{group_id}/payment-methods", response_model=list[GroupPaymentMethodRead])
async def list_group_payment_methods(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupPaymentMethod)
        .where(GroupPaymentMethod.group_id == group_id)
        .options(selectinload(GroupPaymentMethod.payment_method), selectinload(GroupPaymentMethod.member))
    )
    rows = result.scalars().all()
    return [
        GroupPaymentMethodRead(
            id=r.id,
            member_id=r.member_id,
            member_name=r.member.display_name,
            payment_method=PaymentMethodRead.model_validate(r.payment_method),
        )
        for r in rows
    ]


@router.get("/groups/{group_id}/payment-methods/mine", response_model=list[MyGroupPaymentMethodRead])
async def list_my_group_payment_methods(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)

    pm_result = await db.execute(
        select(PaymentMethod).where(PaymentMethod.user_id == current_user.id).order_by(PaymentMethod.created_at)
    )
    my_methods = pm_result.scalars().all()

    gpm_result = await db.execute(
        select(GroupPaymentMethod.payment_method_id).where(GroupPaymentMethod.group_id == group_id)
    )
    enabled_ids = set(gpm_result.scalars().all())

    return [
        MyGroupPaymentMethodRead(
            payment_method=PaymentMethodRead.model_validate(pm),
            enabled=pm.id in enabled_ids,
        )
        for pm in my_methods
    ]


@router.post("/groups/{group_id}/payment-methods", response_model=GroupPaymentMethodRead)
async def enable_payment_method_in_group(
    group_id: uuid.UUID,
    data: EnablePaymentMethodRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    pm = await _get_own_pm(db, data.payment_method_id, current_user.id)

    existing = await db.execute(
        select(GroupPaymentMethod).where(
            GroupPaymentMethod.group_id == group_id,
            GroupPaymentMethod.payment_method_id == pm.id,
        )
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Already enabled in this group")

    gpm = GroupPaymentMethod(group_id=group_id, payment_method_id=pm.id, member_id=member.id)
    db.add(gpm)
    await db.commit()
    await db.refresh(gpm)
    await db.refresh(member)

    return GroupPaymentMethodRead(
        id=gpm.id,
        member_id=member.id,
        member_name=member.display_name,
        payment_method=PaymentMethodRead.model_validate(pm),
    )


@router.delete("/groups/{group_id}/payment-methods/{pm_id}")
async def disable_payment_method_in_group(
    group_id: uuid.UUID,
    pm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupPaymentMethod).where(
            GroupPaymentMethod.group_id == group_id,
            GroupPaymentMethod.payment_method_id == pm_id,
        )
    )
    gpm = result.scalars().first()
    if not gpm:
        raise HTTPException(status_code=404, detail="Payment method not enabled in this group")

    pm = await _get_own_pm(db, pm_id, current_user.id)  # noqa: F841

    await db.delete(gpm)
    await db.commit()
    return {"detail": "Payment method removed from group"}
