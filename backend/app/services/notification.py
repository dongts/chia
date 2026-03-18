import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GroupMember, Notification


async def notify_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    exclude_user_id: uuid.UUID | None,
    type: str,
    data: dict,
):
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
            GroupMember.user_id.is_not(None),
        )
    )
    members = result.scalars().all()
    for member in members:
        if member.user_id == exclude_user_id:
            continue
        db.add(Notification(
            user_id=member.user_id,
            group_id=group_id,
            type=type,
            data=data,
        ))
