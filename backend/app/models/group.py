import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    invite_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL", use_alter=True, name="fk_groups_default_category"),
        nullable=True,
    )
    require_verified_users: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_log_on_behalf: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    members: Mapped[list["GroupMember"]] = relationship(back_populates="group")  # noqa: F821
    expenses: Mapped[list["Expense"]] = relationship(back_populates="group")  # noqa: F821
    settlements: Mapped[list["Settlement"]] = relationship(back_populates="group")  # noqa: F821
    funds: Mapped[list["Fund"]] = relationship(back_populates="group")  # noqa: F821
