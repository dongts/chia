import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, GroupMemberLog, MemberRole, User
from app.schemas.group_member import MemberCreate, MemberRead, MemberUpdate
from app.services.member_log import log_member_event
from app.services.notification import notify_group

router = APIRouter(prefix="/groups/{group_id}/members", tags=["members"])


@router.get("", response_model=list[MemberRead])
async def list_members(
    group_id: uuid.UUID,
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    query = select(GroupMember).where(GroupMember.group_id == group_id)
    if not include_inactive:
        query = query.where(GroupMember.is_active.is_(True))
    result = await db.execute(query.order_by(GroupMember.joined_at))
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
    # Limit 100 members per group
    count = (await db.execute(
        select(func.count(GroupMember.id)).where(
            GroupMember.group_id == group_id, GroupMember.is_active.is_(True)
        )
    )).scalar()
    if count >= 100:
        raise BadRequest("Maximum 100 members per group")
    member = GroupMember(
        group_id=group_id,
        display_name=data.display_name,
        role=MemberRole.member,
    )
    db.add(member)
    await db.flush()
    await log_member_event(db, group_id, member.id, "joined", f"Added by {current.display_name}", current.id)
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
        await log_member_event(db, group_id, member_id, "role_changed", f"{old_role.value} → {data.role.value}", current.id)
        if target.user_id:
            await notify_group(
                db, group_id, current_user.id, "role_changed",
                {"member_name": target.display_name, "old_role": old_role.value, "new_role": data.role.value},
            )

    if data.display_name is not None:
        if target.id != current.id:
            require_role(current, MemberRole.owner, MemberRole.admin)
        old_name = target.display_name
        target.display_name = data.display_name
        if old_name != data.display_name:
            await log_member_event(db, group_id, member_id, "renamed", f'"{old_name}" → "{data.display_name}"', current.id)

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
    await log_member_event(db, group_id, member_id, "claimed", f"Claimed by {current_user.display_name}")
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
    await log_member_event(db, group_id, member_id, "removed", f"Removed by {current.display_name}", current.id)
    await notify_group(
        db, group_id, current_user.id, "member_removed",
        {"member_name": target.display_name},
    )
    await db.commit()
    return {"detail": "Member removed"}


# ── Member activity log ──────────────────────────────────────────────────────

@router.get("/log")
async def get_member_log(
    group_id: uuid.UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMemberLog)
        .where(GroupMemberLog.group_id == group_id)
        .options(
            selectinload(GroupMemberLog.member),
            selectinload(GroupMemberLog.performer),
        )
        .order_by(GroupMemberLog.created_at.desc())
        .limit(limit).offset(offset)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(log.id),
            "member_name": log.member.display_name if log.member else "Unknown",
            "action": log.action,
            "detail": log.detail,
            "performer_name": log.performer.display_name if log.performer else None,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]
