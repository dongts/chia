import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, MemberRole, User
from app.schemas.group_member import MemberCreate, MemberRead, MemberUpdate
from app.services.notification import notify_group

router = APIRouter(prefix="/groups/{group_id}/members", tags=["members"])


@router.get("", response_model=list[MemberRead])
async def list_members(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    return result.scalars().all()


@router.post("", response_model=MemberRead)
async def add_member(
    group_id: uuid.UUID,
    data: MemberCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    member = GroupMember(
        group_id=group_id,
        display_name=data.display_name,
        role=MemberRole.member,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.patch("/{member_id}", response_model=MemberRead)
async def update_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    data: MemberUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")

    if data.role is not None:
        require_role(current, MemberRole.owner)
        if target.id == current.id:
            raise BadRequest("Cannot change own role")
        old_role = target.role
        target.role = data.role
        if target.user_id:
            await notify_group(
                db, group_id, current_user.id, "role_changed",
                {"member_name": target.display_name, "old_role": old_role.value, "new_role": data.role.value},
            )

    if data.display_name is not None:
        target.display_name = data.display_name

    await db.commit()
    await db.refresh(target)
    return target


@router.post("/{member_id}/claim", response_model=MemberRead)
async def claim_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
            GroupMember.is_active.is_(True),
        )
    )
    if existing.scalars().first():
        raise BadRequest("You already have a member profile in this group")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == member_id,
            GroupMember.group_id == group_id,
            GroupMember.user_id.is_(None),
        )
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Unclaimed member not found")

    target.user_id = current_user.id
    target.claimed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{member_id}")
async def remove_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")
    if target.role == MemberRole.owner:
        raise BadRequest("Cannot remove the group owner")
    target.is_active = False
    await notify_group(
        db, group_id, current_user.id, "member_removed",
        {"member_name": target.display_name},
    )
    await db.commit()
    return {"detail": "Member removed"}
