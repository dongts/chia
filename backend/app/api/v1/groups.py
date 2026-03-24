import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from collections import defaultdict
from decimal import Decimal

from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Expense, ExpenseSplit, Group, GroupMember, MemberRole, Settlement, User
from app.schemas.group import GroupCreate, GroupListItem, GroupRead, GroupUpdate
from app.services.member_log import log_member_event
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
    groups_data = result.all()
    group_ids = [g.id for g, _ in groups_data]

    # Compute my_balance for each group
    balances: dict[uuid.UUID, float] = {gid: 0.0 for gid in group_ids}

    if group_ids:
        # Get my member IDs per group
        my_members_result = await db.execute(
            select(GroupMember.id, GroupMember.group_id).where(
                GroupMember.user_id == current_user.id,
                GroupMember.group_id.in_(group_ids),
                GroupMember.is_active.is_(True),
            )
        )
        my_member_map: dict[uuid.UUID, uuid.UUID] = {}  # group_id -> member_id
        for mid, gid in my_members_result.all():
            my_member_map[gid] = mid

        if my_member_map:
            all_member_ids = list(my_member_map.values())

            # What I paid
            paid_result = await db.execute(
                select(Expense.group_id, func.coalesce(func.sum(Expense.converted_amount), 0))
                .where(Expense.paid_by.in_(all_member_ids))
                .group_by(Expense.group_id)
            )
            for gid, total in paid_result.all():
                balances[gid] = float(total)

            # What I owe
            owed_result = await db.execute(
                select(Expense.group_id, func.coalesce(func.sum(ExpenseSplit.resolved_amount), 0))
                .join(Expense, Expense.id == ExpenseSplit.expense_id)
                .where(ExpenseSplit.group_member_id.in_(all_member_ids))
                .group_by(Expense.group_id)
            )
            for gid, total in owed_result.all():
                balances[gid] -= float(total)

            # Settlements I made (paid out)
            sent_result = await db.execute(
                select(Settlement.group_id, func.coalesce(func.sum(Settlement.amount), 0))
                .where(Settlement.from_member.in_(all_member_ids))
                .group_by(Settlement.group_id)
            )
            for gid, total in sent_result.all():
                balances[gid] += float(total)

            # Settlements I received
            recv_result = await db.execute(
                select(Settlement.group_id, func.coalesce(func.sum(Settlement.amount), 0))
                .where(Settlement.to_member.in_(all_member_ids))
                .group_by(Settlement.group_id)
            )
            for gid, total in recv_result.all():
                balances[gid] -= float(total)

            # Initial balances (for migrated debts)
            init_result = await db.execute(
                select(GroupMember.group_id, GroupMember.initial_balance)
                .where(GroupMember.id.in_(all_member_ids))
            )
            for gid, init_bal in init_result.all():
                if init_bal:
                    balances[gid] += float(init_bal)

    items = []
    for group, member_count in groups_data:
        items.append(GroupListItem(
            id=group.id,
            name=group.name,
            currency_code=group.currency_code,
            member_count=member_count,
            my_balance=round(balances.get(group.id, 0.0), 2),
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


@router.get("/preview/{invite_code}")
async def preview_group(invite_code: str, db: AsyncSession = Depends(get_db)):
    """Preview a group from invite code — no auth required. Returns group name and unclaimed members."""
    result = await db.execute(select(Group).where(Group.invite_code == invite_code))
    group = result.scalars().first()
    if not group:
        raise NotFound("Invalid invite code")
    # Get unclaimed (placeholder) members
    unclaimed_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.user_id.is_(None),
            GroupMember.is_active.is_(True),
        ).order_by(GroupMember.display_name)
    )
    unclaimed = unclaimed_result.scalars().all()
    member_count_result = await db.execute(
        select(func.count(GroupMember.id)).where(
            GroupMember.group_id == group.id, GroupMember.is_active.is_(True)
        )
    )
    return {
        "id": str(group.id),
        "name": group.name,
        "currency_code": group.currency_code,
        "member_count": member_count_result.scalar(),
        "require_verified_users": group.require_verified_users,
        "unclaimed_members": [
            {"id": str(m.id), "display_name": m.display_name}
            for m in unclaimed
        ],
    }


class JoinGroupRequest(BaseModel):
    claim_member_id: uuid.UUID | None = None
    display_name: str | None = None


@router.post("/join/{invite_code}", response_model=GroupRead)
async def join_group(
    invite_code: str,
    data: JoinGroupRequest | None = None,
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

    claim_id = data.claim_member_id if data else None
    custom_name = data.display_name if data and data.display_name else None

    if claim_id:
        # Claim an existing placeholder member
        claim_result = await db.execute(
            select(GroupMember).where(
                GroupMember.id == claim_id,
                GroupMember.group_id == group.id,
                GroupMember.user_id.is_(None),
                GroupMember.is_active.is_(True),
            )
        )
        member = claim_result.scalars().first()
        if not member:
            raise BadRequest("This member slot is no longer available")
        member.user_id = current_user.id
        member.claimed_at = func.now()
        old_name = member.display_name
        if custom_name and custom_name != old_name:
            member.display_name = custom_name
            await log_member_event(db, group.id, member.id, "renamed", f'"{old_name}" → "{custom_name}" (on claim)')
        await log_member_event(db, group.id, member.id, "claimed", f"Claimed by {current_user.display_name} via invite link")
    else:
        # Create new member
        count = (await db.execute(
            select(func.count(GroupMember.id)).where(
                GroupMember.group_id == group.id, GroupMember.is_active.is_(True)
            )
        )).scalar()
        if count >= 100:
            raise BadRequest("This group has reached the maximum of 100 members")

        name = custom_name or current_user.display_name
        member = GroupMember(
            group_id=group.id,
            user_id=current_user.id,
            display_name=name,
            role=MemberRole.member,
            claimed_at=func.now(),
        )
        db.add(member)
        await db.flush()
        await log_member_event(db, group.id, member.id, "joined", "Joined via invite link")

    await db.commit()
    await db.refresh(group)
    return group
