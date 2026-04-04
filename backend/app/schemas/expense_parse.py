import uuid
from datetime import date as DateType
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.expense import SplitInput


class ParsingLevel(str, Enum):
    basic = "basic"
    smart = "smart"
    full = "full"


class ExpenseParseRequest(BaseModel):
    text: str = Field(..., max_length=500)
    parsing_level: ParsingLevel | None = None  # None → use server default


class FundDeductionDraft(BaseModel):
    fund_id: uuid.UUID
    amount: Decimal


class ExpenseParseDraft(BaseModel):
    description: str | None = None
    amount: Decimal | None = None
    currency_code: str | None = None
    date: DateType | None = None
    paid_by_member_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    split_type: str | None = None  # "equal" | "exact" | "percentage" | "shares"
    splits: list[SplitInput] | None = None
    fund_deductions: list[FundDeductionDraft] | None = None
    confidence: float = 0.0
    raw_extraction: dict[str, Any] = {}
