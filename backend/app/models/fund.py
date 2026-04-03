import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FundTransactionType(str, enum.Enum):
    contribute = "contribute"
    withdraw = "withdraw"
    expense = "expense"
    holder_change = "holder_change"


class Fund(Base):
    __tablename__ = "funds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    holder_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    group: Mapped["Group"] = relationship(back_populates="funds")
    holder: Mapped["GroupMember"] = relationship(foreign_keys=[holder_id])
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])
    transactions: Mapped[list["FundTransaction"]] = relationship(back_populates="fund", cascade="all, delete-orphan")


class FundTransaction(Base):
    __tablename__ = "fund_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fund_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("funds.id", ondelete="CASCADE"))
    type: Mapped[FundTransactionType] = mapped_column(Enum(FundTransactionType))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    expense_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True
    )
    deduction_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expense_fund_deductions.id", ondelete="CASCADE"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fund: Mapped["Fund"] = relationship(back_populates="transactions")
    member: Mapped["GroupMember"] = relationship(foreign_keys=[member_id])
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])
    expense: Mapped["Expense | None"] = relationship()
