import uuid
from datetime import datetime

from pydantic import BaseModel


class PaymentMethodCreate(BaseModel):
    label: str
    bank_name: str | None = None
    account_number: str | None = None
    account_holder: str | None = None
    note: str | None = None


class PaymentMethodUpdate(BaseModel):
    label: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    account_holder: str | None = None
    note: str | None = None


class PaymentMethodRead(BaseModel):
    id: uuid.UUID
    label: str
    bank_name: str | None
    account_number: str | None
    account_holder: str | None
    note: str | None
    qr_image_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class GroupPaymentMethodRead(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    payment_method: PaymentMethodRead


class MyGroupPaymentMethodRead(BaseModel):
    payment_method: PaymentMethodRead
    enabled: bool


class EnablePaymentMethodRequest(BaseModel):
    payment_method_id: uuid.UUID
