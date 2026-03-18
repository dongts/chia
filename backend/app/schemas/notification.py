import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationRead(BaseModel):
    id: uuid.UUID
    type: str
    data: dict
    read: bool
    group_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
