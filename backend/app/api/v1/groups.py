import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Group, GroupMember, MemberRole, User
from app.schemas.group import GroupCreate, GroupListItem, GroupRead, GroupUpdate
from app.utils.invite_code import generate_invite_code

router = APIRouter(prefix="/groups", tags=["groups"])


async def get_group_or_404(db: AsyncSession, group_id: uuid.UUID) -> Group:
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    return group


async def get_current_member(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember:
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
        )
    )
    member = result.scalars().first()
    if not member:
        raise Forbidden("Not a member of this group")
    return member


@router.post("", response_model=GroupRead)
async def create_group(
    data: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = Group(
        name=data.name,
        description=data.description,
        currency_code=data.currency_code,
        invite_code=generate_invite_code(),
    )
    db.add(group)
    await db.flush()
    member = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        display_name=current_user.display_name,
        role=MemberRole.owner,
        claimed_at=func.now(),
    )
    db.add(member)
    await db.commit()
    await db.refresh(group)
    return group


@router.get("", response_model=list[GroupListItem])
async def list_groups(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group, func.count(GroupMember.id).label("member_count"))
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            GroupMember.is_active.is_(True),
            Group.id.in_(
                select(GroupMember.group_id).where(
                    GroupMember.user_id == current_user.id,
                    GroupMember.is_active.is_(True),
                )
            ),
        )
        .group_by(Group.id)
    )
    items = []
    for group, member_count in result.all():
        items.append(GroupListItem(
            id=group.id,
            name=group.name,
            currency_code=group.currency_code,
            member_count=member_count,
        ))
    return items


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    count_result = await db.execute(
        select(func.count(GroupMember.id)).where(
            GroupMember.group_id == group_id, GroupMember.is_active.is_(True)
        )
    )
    result = GroupRead.model_validate(group)
    result.member_count = count_result.scalar()
    return result


@router.patch("/{group_id}", response_model=GroupRead)
async def update_group(
    group_id: uuid.UUID,
    data: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}")
async def delete_group(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner)
    await db.delete(group)
    await db.commit()
    return {"detail": "Group deleted"}


@router.post("/join/{invite_code}", response_model=GroupRead)
async def join_group(
    invite_code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).where(Group.invite_code == invite_code))
    group = result.scalars().first()
    if not group:
        raise NotFound("Invalid invite code")

    if group.require_verified_users and not current_user.is_verified:
        raise Forbidden("This group requires verified users")

    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.user_id == current_user.id,
        )
    )
    if existing.scalars().first():
        raise BadRequest("Already a member of this group")

    member = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        display_name=current_user.display_name,
        role=MemberRole.member,
        claimed_at=func.now(),
    )
    db.add(member)
    await db.commit()
    await db.refresh(group)
    return group
