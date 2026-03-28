import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel

from app.models.fund import FundTransactionType


class FundCreate(BaseModel):
    name: str
    description: Optional[str] = None
    holder_id: Optional[uuid.UUID] = None  # Defaults to creator


class FundUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    holder_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class FundRead(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    name: str
    description: Optional[str] = None
    holder_id: uuid.UUID
    holder_name: Optional[str] = None
    created_by: uuid.UUID
    is_active: bool
    balance: Decimal = Decimal("0")
    transaction_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FundDetailRead(FundRead):
    contributions_by_member: list["MemberContribution"] = []


class MemberContribution(BaseModel):
    member_id: uuid.UUID
    member_name: str
    total: Decimal


class FundTransactionCreate(BaseModel):
    type: FundTransactionType  # contribute or withdraw
    amount: Decimal
    member_id: uuid.UUID
    note: Optional[str] = None


class FundTransactionRead(BaseModel):
    id: uuid.UUID
    fund_id: uuid.UUID
    type: FundTransactionType
    amount: Decimal
    member_id: uuid.UUID
    member_name: Optional[str] = None
    expense_id: Optional[uuid.UUID] = None
    note: Optional[str] = None
    created_by: uuid.UUID
    created_by_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
