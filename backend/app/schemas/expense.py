import uuid
from datetime import date as DateType
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel

from app.models.expense import SplitType


class SplitInput(BaseModel):
    group_member_id: uuid.UUID
    value: Decimal


class FundDeductionInput(BaseModel):
    fund_id: uuid.UUID
    amount: Decimal


class FundDeductionRead(BaseModel):
    id: uuid.UUID
    fund_id: uuid.UUID
    fund_name: str
    amount: Decimal

    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    currency_code: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    date: DateType
    paid_by: uuid.UUID
    category_id: uuid.UUID
    fund_deductions: list[FundDeductionInput] = []
    split_type: SplitType
    splits: list[SplitInput]


class SplitRead(BaseModel):
    id: uuid.UUID
    group_member_id: uuid.UUID
    member_name: Optional[str] = None
    split_type: SplitType
    value: Decimal
    resolved_amount: Decimal

    model_config = {"from_attributes": True}


class ExpenseRead(BaseModel):
    id: uuid.UUID
    description: str
    amount: Decimal
    currency_code: str
    exchange_rate: Decimal
    converted_amount: Decimal
    group_currency: Optional[str] = None
    date: DateType
    paid_by: uuid.UUID
    payer_name: Optional[str] = None
    created_by: uuid.UUID
    category_id: uuid.UUID
    fund_deductions: list[FundDeductionRead] = []
    receipt_url: Optional[str]
    splits: list[SplitRead] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ExpenseUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[Decimal] = None
    currency_code: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    date: Optional[DateType] = None
    paid_by: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    fund_deductions: Optional[list[FundDeductionInput]] = None
    split_type: Optional[SplitType] = None
    splits: Optional[list[SplitInput]] = None


class ExpenseLogRead(BaseModel):
    id: uuid.UUID
    expense_id: uuid.UUID
    actor_member_id: Optional[uuid.UUID] = None
    actor_name: Optional[str] = None
    action: str
    changes: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}
