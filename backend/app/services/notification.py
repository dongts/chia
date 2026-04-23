import uuid
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GroupMember, Notification


async def notify_members(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID | None],
    group_id: uuid.UUID,
    type: str,
    data: dict,
    exclude_user_id: uuid.UUID | None = None,
):
    """Create one Notification per unique user_id in user_ids.

    Unclaimed members (user_id=None), the actor (exclude_user_id), and
    duplicates are silently skipped. Callers should commit.
    """
    seen: set[uuid.UUID] = set()
    for uid in user_ids:
        if uid is None or uid == exclude_user_id or uid in seen:
            continue
        seen.add(uid)
        db.add(Notification(
            user_id=uid,
            group_id=group_id,
            type=type,
            data=data,
        ))


async def resolve_member_user_ids(
    db: AsyncSession,
    member_ids: Iterable[uuid.UUID],
) -> list[uuid.UUID]:
    """Return user_ids for the given group_member_ids, skipping unclaimed."""
    ids = list({m for m in member_ids if m is not None})
    if not ids:
        return []
    result = await db.execute(
        select(GroupMember.user_id).where(
            GroupMember.id.in_(ids),
            GroupMember.user_id.is_not(None),
        )
    )
    return [uid for (uid,) in result.all()]
