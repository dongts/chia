import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class SettlementCreate(BaseModel):
    from_member: uuid.UUID
    to_member: uuid.UUID
    amount: Decimal


class SettlementRead(BaseModel):
    id: uuid.UUID
    from_member: uuid.UUID
    from_member_name: str | None = None
    to_member: uuid.UUID
    to_member_name: str | None = None
    amount: Decimal
    settled_at: datetime

    model_config = {"from_attributes": True}


class BalanceRead(BaseModel):
    member_id: uuid.UUID
    member_name: str
    balance: Decimal


class SuggestedSettlement(BaseModel):
    from_member: uuid.UUID
    from_member_name: str
    to_member: uuid.UUID
    to_member_name: str
    amount: Decimal
