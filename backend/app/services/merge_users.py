"""Merge one user into another, transferring all group data."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Expense, ExpenseSplit, GroupMember, GroupMemberLog,
    GroupPaymentMethod, Notification, PaymentMethod, Settlement, User,
)


async def merge_user_into(
    db: AsyncSession,
    source_user_id: uuid.UUID,
    target_user_id: uuid.UUID,
) -> dict:
    """Merge source user into target user.

    Reassigns all group memberships, expenses, settlements, and payment methods
    from source to target user, then deletes the source.

    Returns a summary dict with merged_groups, moved_groups, source name, target name.
    """
    source = await db.get(User, source_user_id)
    target = await db.get(User, target_user_id)
    if not source:
        raise ValueError("Source user not found")
    if not target:
        raise ValueError("Target user not found")

    source_name = source.display_name
    target_name = target.display_name

    # Get all group memberships for both users
    source_members_result = await db.execute(
        select(GroupMember).where(GroupMember.user_id == source_user_id, GroupMember.is_active.is_(True))
    )
    source_members = source_members_result.scalars().all()

    target_members_result = await db.execute(
        select(GroupMember).where(GroupMember.user_id == target_user_id, GroupMember.is_active.is_(True))
    )
    target_members_by_group = {m.group_id: m for m in target_members_result.scalars().all()}

    merged_groups = []
    moved_groups = []

    for src_member in source_members:
        tgt_member = target_members_by_group.get(src_member.group_id)

        if tgt_member:
            # Both users in same group — reassign all references
            await db.execute(
                Expense.__table__.update()
                .where(Expense.paid_by == src_member.id)
                .values(paid_by=tgt_member.id)
            )
            await db.execute(
                Expense.__table__.update()
                .where(Expense.created_by == src_member.id)
                .values(created_by=tgt_member.id)
            )
            await db.execute(
                ExpenseSplit.__table__.update()
                .where(ExpenseSplit.group_member_id == src_member.id)
                .values(group_member_id=tgt_member.id)
            )
            await db.execute(
                Settlement.__table__.update()
                .where(Settlement.from_member == src_member.id)
                .values(from_member=tgt_member.id)
            )
            await db.execute(
                Settlement.__table__.update()
                .where(Settlement.to_member == src_member.id)
                .values(to_member=tgt_member.id)
            )
            await db.execute(
                Settlement.__table__.update()
                .where(Settlement.created_by == src_member.id)
                .values(created_by=tgt_member.id)
            )
            await db.execute(
                GroupMemberLog.__table__.update()
                .where(GroupMemberLog.member_id == src_member.id)
                .values(member_id=tgt_member.id)
            )
            await db.execute(
                GroupMemberLog.__table__.update()
                .where(GroupMemberLog.performed_by == src_member.id)
                .values(performed_by=tgt_member.id)
            )
            await db.execute(
                GroupPaymentMethod.__table__.update()
                .where(GroupPaymentMethod.member_id == src_member.id)
                .values(member_id=tgt_member.id)
            )

            tgt_member.initial_balance += src_member.initial_balance

            role_priority = {"owner": 3, "admin": 2, "member": 1}
            if role_priority.get(src_member.role.value, 0) > role_priority.get(tgt_member.role.value, 0):
                tgt_member.role = src_member.role

            src_member.is_active = False
            src_member.user_id = None
            merged_groups.append(str(src_member.group_id))
        else:
            # Only source in this group — transfer membership
            src_member.user_id = target_user_id
            moved_groups.append(str(src_member.group_id))

    # Move payment methods
    await db.execute(
        PaymentMethod.__table__.update()
        .where(PaymentMethod.user_id == source_user_id)
        .values(user_id=target_user_id)
    )

    # Delete source notifications
    await db.execute(
        delete(Notification).where(Notification.user_id == source_user_id)
    )

    # Delete source user
    await db.delete(source)
    await db.commit()

    return {
        "source_name": source_name,
        "target_name": target_name,
        "merged_groups": merged_groups,
        "moved_groups": moved_groups,
    }
