import uuid
from datetime import datetime

from pydantic import BaseModel


class GroupCreate(BaseModel):
    name: str
    description: str | None = None
    currency_code: str = "USD"


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    currency_code: str | None = None
    require_verified_users: bool | None = None
    allow_log_on_behalf: bool | None = None


class GroupRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    currency_code: str
    invite_code: str
    require_verified_users: bool
    allow_log_on_behalf: bool
    created_at: datetime
    member_count: int | None = None

    model_config = {"from_attributes": True}


class GroupListItem(BaseModel):
    id: uuid.UUID
    name: str
    currency_code: str
    member_count: int
    my_balance: float = 0.0

    model_config = {"from_attributes": True}
