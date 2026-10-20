"""Merge one user into another, transferring all group data."""

import uuid

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Expense, ExpenseSplit, GroupMember, GroupMemberLog,
    GroupPaymentMethod, Notification, PaymentMethod, Settlement, User,
)
from app.models.expense import SplitType
from app.models.expense_fund_deduction import ExpenseFundDeduction
from app.models.expense_log import ExpenseLog
from app.models.fund import Fund, FundTransaction
from app.models.user import UserOAuth

# Every column that points at a group member. Keep in sync with the models.
MEMBER_REFERENCES = [
    (Expense, ("paid_by", "created_by")),
    (ExpenseSplit, ("group_member_id",)),
    (Settlement, ("from_member", "to_member", "created_by")),
    (GroupMemberLog, ("member_id", "performed_by")),
    (GroupPaymentMethod, ("member_id",)),
    (Fund, ("holder_id", "created_by")),
    (FundTransaction, ("member_id", "created_by")),
    (ExpenseFundDeduction, ("created_by",)),
    (ExpenseLog, ("actor_member_id",)),
]

ROLE_PRIORITY = {"owner": 3, "admin": 2, "member": 1}


async def merge_member_into(db: AsyncSession, src: GroupMember, tgt: GroupMember) -> None:
    """Fold src into tgt within one group. The caller commits."""
    for model, columns in MEMBER_REFERENCES:
        for column in columns:
            await db.execute(
                model.__table__.update()
                .where(getattr(model, column) == src.id)
                .values({column: tgt.id})
            )
    await _consolidate_splits(db, tgt.id)

    tgt.initial_balance += src.initial_balance
    if ROLE_PRIORITY.get(src.role.value, 0) > ROLE_PRIORITY.get(tgt.role.value, 0):
        tgt.role = src.role
    tgt.is_active = True

    # The balance moved to tgt; clear it so a later claim cannot count it twice.
    src.initial_balance = Decimal("0")
    src.is_active = False
    src.user_id = None


async def _consolidate_splits(db: AsyncSession, member_id) -> None:
    """Fold the duplicate splits a merge leaves when both members shared an expense.

    Equal splits become shares (1 each, so the survivor holds one per merged
    member); other types sum their inputs. Resolved amounts are summed, so
    balances do not move.
    """
    splits = (await db.execute(
        select(ExpenseSplit).where(ExpenseSplit.group_member_id == member_id)
        .order_by(ExpenseSplit.id).execution_options(populate_existing=True)
    )).scalars().all()
    by_expense = defaultdict(list)
    for split in splits:
        by_expense[split.expense_id].append(split)
    for expense_id, rows in by_expense.items():
        if len(rows) < 2:
            continue
        if rows[0].split_type.value == "equal":
            await db.execute(
                ExpenseSplit.__table__.update()
                .where(ExpenseSplit.expense_id == expense_id)
                .values(split_type=SplitType.shares, value=Decimal("1"))
            )
            await db.flush()
            for row in rows:
                await db.refresh(row)
        keeper, *duplicates = rows
        keeper.value = sum((row.value for row in rows), Decimal("0"))
        keeper.resolved_amount = sum((row.resolved_amount for row in rows), Decimal("0"))
        for row in duplicates:
            await db.delete(row)
    await db.flush()


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

    # Include inactive target memberships: moving the source membership onto
    # them would break the (group_id, user_id) uniqueness, so merge and reactivate.
    target_members_result = await db.execute(
        select(GroupMember).where(GroupMember.user_id == target_user_id)
    )
    target_members_by_group = {}
    for member in target_members_result.scalars().all():
        current = target_members_by_group.get(member.group_id)
        if current is None or (member.is_active and not current.is_active):
            target_members_by_group[member.group_id] = member

    merged_groups = []
    moved_groups = []

    for src_member in source_members:
        tgt_member = target_members_by_group.get(src_member.group_id)

        if tgt_member:
            await merge_member_into(db, src_member, tgt_member)
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

    await db.execute(
        UserOAuth.__table__.update()
        .where(UserOAuth.user_id == source_user_id)
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
