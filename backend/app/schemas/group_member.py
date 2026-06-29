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
    is_active: bool | None = None


class ClaimedUserInfo(BaseModel):
    """Identifying details of the account behind a claimed member.

    Only populated for owner/admin viewers — surfaces enough to recognise
    a user across devices/accounts when they forget which one they used.
    """

    user_id: uuid.UUID
    display_name: str
    email: str | None
    is_verified: bool
    oauth_providers: list[str]
    device_id_short: str | None  # first 8 chars + ellipsis, for visual matching


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
    claimed_user: ClaimedUserInfo | None = None

    model_config = {"from_attributes": True}
