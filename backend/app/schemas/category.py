import uuid

from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    icon: str = "📦"
    is_default: bool = False


class CategoryRead(BaseModel):
    id: uuid.UUID
    name: str
    icon: str
    is_default: bool
    group_id: uuid.UUID | None

    model_config = {"from_attributes": True}
