import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SettlementCreate(BaseModel):
    from_member: uuid.UUID
    to_member: uuid.UUID
    amount: Decimal
    description: str | None = None
    type: str = "settle_up"  # "settle_up" or "transfer"


class DistributionCreate(BaseModel):
    from_member: uuid.UUID
    recipient_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=0)
    amount_mode: Literal["per_recipient", "total"] = "per_recipient"
    description: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_recipients(self):
        if len(set(self.recipient_ids)) != len(self.recipient_ids):
            raise ValueError("Recipients must be unique")
        if self.from_member in self.recipient_ids:
            raise ValueError("Sender cannot also be a recipient")
        return self


class SettlementUpdate(BaseModel):
    from_member: uuid.UUID | None = None
    to_member: uuid.UUID | None = None
    amount: Decimal | None = None
    description: str | None = None
    type: str | None = None


class SettlementRead(BaseModel):
    id: uuid.UUID
    from_member: uuid.UUID
    from_member_name: str | None = None
    to_member: uuid.UUID
    to_member_name: str | None = None
    amount: Decimal
    description: str | None = None
    type: str = "settle_up"
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
