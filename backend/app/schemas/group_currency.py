import uuid
from decimal import Decimal

from pydantic import BaseModel


class GroupCurrencyCreate(BaseModel):
    currency_code: str
    exchange_rate: Decimal


class GroupCurrencyUpdate(BaseModel):
    exchange_rate: Decimal


class GroupCurrencyRead(BaseModel):
    id: uuid.UUID
    currency_code: str
    exchange_rate: Decimal

    model_config = {"from_attributes": True}
