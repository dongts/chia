import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.group_member import MemberRole


class MemberCreate(BaseModel):
    display_name: str


class MemberUpdate(BaseModel):
    role: MemberRole | None = None
    display_name: str | None = None


class MemberRead(BaseModel):
    id: uuid.UUID
    display_name: str
    role: MemberRole
    user_id: uuid.UUID | None
    is_active: bool
    claimed_at: datetime | None
    joined_at: datetime

    model_config = {"from_attributes": True}
