import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GroupMemberLog(Base):
    __tablename__ = "group_member_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(30))  # joined, left, removed, role_changed, renamed, claimed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # e.g. "member → admin", "by Alice"
    performed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    member: Mapped["GroupMember"] = relationship(foreign_keys=[member_id])  # noqa: F821
    performer: Mapped["GroupMember | None"] = relationship(foreign_keys=[performed_by])  # noqa: F821
