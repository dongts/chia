import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group_member_log import GroupMemberLog


async def log_member_event(
    db: AsyncSession,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    action: str,
    detail: str | None = None,
    performed_by: uuid.UUID | None = None,
):
    db.add(GroupMemberLog(
        group_id=group_id,
        member_id=member_id,
        action=action,
        detail=detail,
        performed_by=performed_by,
    ))
