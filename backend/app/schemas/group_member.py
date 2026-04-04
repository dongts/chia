import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.group_member import MemberRole


class MemberCreate(BaseModel):
    display_name: str
    nicknames: str = ""
    initial_balance: Decimal | None = None


class MemberUpdate(BaseModel):
    role: MemberRole | None = None
    display_name: str | None = None
    nicknames: str | None = None
    initial_balance: Decimal | None = None


class MemberRead(BaseModel):
    id: uuid.UUID
    display_name: str
    nicknames: str
    role: MemberRole
    user_id: uuid.UUID | None
    is_active: bool
    initial_balance: Decimal
    claimed_at: datetime | None
    joined_at: datetime

    model_config = {"from_attributes": True}
