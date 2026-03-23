# Payment Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save bank transfer info on their profile and selectively enable it per group, so other members can see how to pay them.

**Architecture:** Two new tables (payment_methods, group_payment_methods) with profile-level CRUD and group-level enable/disable endpoints. Frontend adds a payment methods section to Profile, a toggle section to Group Settings, and displays payment info in balances/settlements/transfer modal via shared components.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, React + TypeScript + Tailwind

**Spec:** `docs/superpowers/specs/2026-03-23-payment-methods-design.md`

---

## File Structure

### Backend — New Files
- `backend/app/models/payment_method.py` — PaymentMethod + GroupPaymentMethod SQLAlchemy models
- `backend/app/schemas/payment_method.py` — Pydantic request/response schemas
- `backend/app/api/v1/payment_methods.py` — Profile CRUD + group enable/disable endpoints

### Backend — Modified Files
- `backend/app/models/__init__.py` — Register new models
- `backend/app/api/v1/router.py` — Register new router

### Frontend — New Files
- `frontend/src/api/paymentMethods.ts` — API client functions
- `frontend/src/components/PaymentMethodCards.tsx` — Shared display component for payment method cards
- `frontend/src/components/PaymentInfoModal.tsx` — Modal to view a member's payment methods

### Frontend — Modified Files
- `frontend/src/types/index.ts` — Add TypeScript types
- `frontend/src/pages/Profile.tsx` — Add payment methods CRUD section
- `frontend/src/pages/GroupSettings.tsx` — Add per-group toggle section
- `frontend/src/pages/GroupView.tsx` — Payment info in balances, settlements, transfer modal

---

## Task 1: Backend Models

**Files:**
- Create: `backend/app/models/payment_method.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create the payment method models**

Create `backend/app/models/payment_method.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(100))
    bank_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_holder: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    qr_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()  # noqa: F821


class GroupPaymentMethod(Base):
    __tablename__ = "group_payment_methods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    payment_method_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment_methods.id", ondelete="CASCADE")
    )
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    payment_method: Mapped["PaymentMethod"] = relationship()
    member: Mapped["GroupMember"] = relationship()  # noqa: F821

    __table_args__ = (UniqueConstraint("group_id", "payment_method_id", name="uq_group_payment_method"),)
```

- [ ] **Step 2: Register models in __init__.py**

Add to `backend/app/models/__init__.py`:

```python
from app.models.payment_method import PaymentMethod, GroupPaymentMethod
```

And add `"PaymentMethod", "GroupPaymentMethod"` to the `__all__` list.

- [ ] **Step 3: Create Alembic migration**

Run:
```bash
cd backend
source venv/bin/activate
alembic revision --autogenerate -m "add payment_methods and group_payment_methods"
```

Review the generated migration file to verify it creates both tables with correct columns, FKs, and the unique constraint.

- [ ] **Step 4: Apply migration**

Run:
```bash
alembic upgrade head
```

Expected: Migration applies successfully.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/payment_method.py backend/app/models/__init__.py backend/migrations/versions/
git commit -m "feat: add PaymentMethod and GroupPaymentMethod models"
```

---

## Task 2: Backend Schemas

**Files:**
- Create: `backend/app/schemas/payment_method.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `backend/app/schemas/payment_method.py`:

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/payment_method.py
git commit -m "feat: add payment method Pydantic schemas"
```

---

## Task 3: Backend API Endpoints

**Files:**
- Create: `backend/app/api/v1/payment_methods.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Create the API route file**

Create `backend/app/api/v1/payment_methods.py`:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member
from app.core.security import get_current_user
from app.database import get_db
from app.models import User, GroupMember
from app.models.payment_method import PaymentMethod, GroupPaymentMethod
from app.schemas.payment_method import (
    EnablePaymentMethodRequest,
    GroupPaymentMethodRead,
    MyGroupPaymentMethodRead,
    PaymentMethodCreate,
    PaymentMethodRead,
    PaymentMethodUpdate,
)
from app.services.file_storage import save_upload

router = APIRouter(tags=["payment-methods"])


# ── Profile-level CRUD ──────────────────────────────────────────────


@router.get("/users/me/payment-methods", response_model=list[PaymentMethodRead])
async def list_my_payment_methods(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaymentMethod)
        .where(PaymentMethod.user_id == current_user.id)
        .order_by(PaymentMethod.created_at)
    )
    return result.scalars().all()


@router.post("/users/me/payment-methods", response_model=PaymentMethodRead)
async def create_payment_method(
    data: PaymentMethodCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = PaymentMethod(user_id=current_user.id, **data.model_dump())
    db.add(pm)
    await db.commit()
    await db.refresh(pm)
    return pm


@router.patch("/users/me/payment-methods/{pm_id}", response_model=PaymentMethodRead)
async def update_payment_method(
    pm_id: uuid.UUID,
    data: PaymentMethodUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(pm, key, value)
    await db.commit()
    await db.refresh(pm)
    return pm


@router.delete("/users/me/payment-methods/{pm_id}")
async def delete_payment_method(
    pm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    await db.delete(pm)
    await db.commit()
    return {"detail": "Payment method deleted"}


@router.post("/users/me/payment-methods/{pm_id}/qr", response_model=PaymentMethodRead)
async def upload_qr_image(
    pm_id: uuid.UUID,
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pm = await _get_own_pm(db, pm_id, current_user.id)
    try:
        url = await save_upload(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pm.qr_image_url = url
    await db.commit()
    await db.refresh(pm)
    return pm


async def _get_own_pm(db: AsyncSession, pm_id: uuid.UUID, user_id: uuid.UUID) -> PaymentMethod:
    result = await db.execute(
        select(PaymentMethod).where(PaymentMethod.id == pm_id, PaymentMethod.user_id == user_id)
    )
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return pm


# ── Group-level enable/disable + view ───────────────────────────────


@router.get("/groups/{group_id}/payment-methods", response_model=list[GroupPaymentMethodRead])
async def list_group_payment_methods(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupPaymentMethod)
        .where(GroupPaymentMethod.group_id == group_id)
        .options(selectinload(GroupPaymentMethod.payment_method), selectinload(GroupPaymentMethod.member))
    )
    rows = result.scalars().all()
    return [
        GroupPaymentMethodRead(
            id=r.id,
            member_id=r.member_id,
            member_name=r.member.display_name,
            payment_method=PaymentMethodRead.model_validate(r.payment_method),
        )
        for r in rows
    ]


@router.get("/groups/{group_id}/payment-methods/mine", response_model=list[MyGroupPaymentMethodRead])
async def list_my_group_payment_methods(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)

    # All my payment methods
    pm_result = await db.execute(
        select(PaymentMethod).where(PaymentMethod.user_id == current_user.id).order_by(PaymentMethod.created_at)
    )
    my_methods = pm_result.scalars().all()

    # Which are enabled in this group
    gpm_result = await db.execute(
        select(GroupPaymentMethod.payment_method_id).where(GroupPaymentMethod.group_id == group_id)
    )
    enabled_ids = set(gpm_result.scalars().all())

    return [
        MyGroupPaymentMethodRead(
            payment_method=PaymentMethodRead.model_validate(pm),
            enabled=pm.id in enabled_ids,
        )
        for pm in my_methods
    ]


@router.post("/groups/{group_id}/payment-methods", response_model=GroupPaymentMethodRead)
async def enable_payment_method_in_group(
    group_id: uuid.UUID,
    data: EnablePaymentMethodRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = await get_current_member(db, group_id, current_user.id)
    pm = await _get_own_pm(db, data.payment_method_id, current_user.id)

    # Check not already enabled
    existing = await db.execute(
        select(GroupPaymentMethod).where(
            GroupPaymentMethod.group_id == group_id,
            GroupPaymentMethod.payment_method_id == pm.id,
        )
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Already enabled in this group")

    gpm = GroupPaymentMethod(group_id=group_id, payment_method_id=pm.id, member_id=member.id)
    db.add(gpm)
    await db.commit()
    await db.refresh(gpm)
    await db.refresh(member)

    return GroupPaymentMethodRead(
        id=gpm.id,
        member_id=member.id,
        member_name=member.display_name,
        payment_method=PaymentMethodRead.model_validate(pm),
    )


@router.delete("/groups/{group_id}/payment-methods/{pm_id}")
async def disable_payment_method_in_group(
    group_id: uuid.UUID,
    pm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupPaymentMethod).where(
            GroupPaymentMethod.group_id == group_id,
            GroupPaymentMethod.payment_method_id == pm_id,
        )
    )
    gpm = result.scalars().first()
    if not gpm:
        raise HTTPException(status_code=404, detail="Payment method not enabled in this group")

    # Verify ownership: the payment method must belong to the current user
    pm = await _get_own_pm(db, pm_id, current_user.id)  # noqa: F841

    await db.delete(gpm)
    await db.commit()
    return {"detail": "Payment method removed from group"}
```

- [ ] **Step 2: Register router**

Add to `backend/app/api/v1/router.py`:

```python
from app.api.v1.payment_methods import router as payment_methods_router
api_router.include_router(payment_methods_router)
```

- [ ] **Step 3: Verify server starts**

Run:
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload
```

Check that the server starts without import errors. Verify new endpoints appear at `https://api.chia.dongtran.asia/docs` (or locally at `http://localhost:8000/docs`).

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/payment_methods.py backend/app/api/v1/router.py
git commit -m "feat: add payment methods API endpoints"
```

---

## Task 4: Frontend Types and API Client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/paymentMethods.ts`

- [ ] **Step 1: Add TypeScript types**

Add to the end of `frontend/src/types/index.ts`:

```typescript
// Payment Methods
export interface PaymentMethod {
  id: string;
  label: string;
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  note: string | null;
  qr_image_url: string | null;
  created_at: string;
}

export interface PaymentMethodCreate {
  label: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  note?: string | null;
}

export interface PaymentMethodUpdate {
  label?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  note?: string | null;
}

export interface GroupPaymentMethod {
  id: string;
  member_id: string;
  member_name: string;
  payment_method: PaymentMethod;
}

export interface MyGroupPaymentMethod {
  payment_method: PaymentMethod;
  enabled: boolean;
}
```

- [ ] **Step 2: Create API client**

Create `frontend/src/api/paymentMethods.ts`:

```typescript
import type { PaymentMethod, PaymentMethodCreate, PaymentMethodUpdate, GroupPaymentMethod, MyGroupPaymentMethod } from "@/types";
import client from "./client";

// Profile-level
export async function listMyPaymentMethods(): Promise<PaymentMethod[]> {
  const res = await client.get<PaymentMethod[]>("/users/me/payment-methods");
  return res.data;
}

export async function createPaymentMethod(data: PaymentMethodCreate): Promise<PaymentMethod> {
  const res = await client.post<PaymentMethod>("/users/me/payment-methods", data);
  return res.data;
}

export async function updatePaymentMethod(id: string, data: PaymentMethodUpdate): Promise<PaymentMethod> {
  const res = await client.patch<PaymentMethod>(`/users/me/payment-methods/${id}`, data);
  return res.data;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await client.delete(`/users/me/payment-methods/${id}`);
}

export async function uploadQrImage(id: string, file: File): Promise<PaymentMethod> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post<PaymentMethod>(`/users/me/payment-methods/${id}/qr`, form);
  return res.data;
}

// Group-level
export async function listGroupPaymentMethods(groupId: string): Promise<GroupPaymentMethod[]> {
  const res = await client.get<GroupPaymentMethod[]>(`/groups/${groupId}/payment-methods`);
  return res.data;
}

export async function listMyGroupPaymentMethods(groupId: string): Promise<MyGroupPaymentMethod[]> {
  const res = await client.get<MyGroupPaymentMethod[]>(`/groups/${groupId}/payment-methods/mine`);
  return res.data;
}

export async function enablePaymentMethodInGroup(groupId: string, paymentMethodId: string): Promise<GroupPaymentMethod> {
  const res = await client.post<GroupPaymentMethod>(`/groups/${groupId}/payment-methods`, { payment_method_id: paymentMethodId });
  return res.data;
}

export async function disablePaymentMethodInGroup(groupId: string, paymentMethodId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/payment-methods/${paymentMethodId}`);
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc -b
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/paymentMethods.ts
git commit -m "feat: add payment methods types and API client"
```

---

## Task 5: Shared Frontend Components

**Files:**
- Create: `frontend/src/components/PaymentMethodCards.tsx`
- Create: `frontend/src/components/PaymentInfoModal.tsx`

- [ ] **Step 1: Create PaymentMethodCards component**

Create `frontend/src/components/PaymentMethodCards.tsx`:

```tsx
import type { PaymentMethod } from "@/types";

interface PaymentMethodCardsProps {
  methods: PaymentMethod[];
  compact?: boolean;
}

export default function PaymentMethodCards({ methods, compact = false }: PaymentMethodCardsProps) {
  if (methods.length === 0) return null;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {methods.map((m) => (
        <div key={m.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{m.label}</p>
              {m.bank_name && <p className="text-xs text-gray-500 mt-0.5">{m.bank_name}</p>}
              {m.account_number && (
                <p className="text-sm text-gray-700 mt-1 font-mono">{m.account_number}</p>
              )}
              {m.account_holder && (
                <p className="text-xs text-gray-500 mt-0.5">{m.account_holder}</p>
              )}
              {m.note && <p className="text-xs text-gray-400 mt-1 italic">{m.note}</p>}
            </div>
            {m.qr_image_url && (
              <img
                src={m.qr_image_url}
                alt={`QR for ${m.label}`}
                className={compact ? "w-16 h-16 rounded object-cover" : "w-24 h-24 rounded-lg object-cover"}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create PaymentInfoModal component**

Create `frontend/src/components/PaymentInfoModal.tsx`:

```tsx
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { GroupPaymentMethod } from "@/types";
import PaymentMethodCards from "./PaymentMethodCards";

interface PaymentInfoModalProps {
  memberName: string;
  methods: GroupPaymentMethod[];
  isOpen: boolean;
  onClose: () => void;
}

export default function PaymentInfoModal({ memberName, methods, isOpen, onClose }: PaymentInfoModalProps) {
  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const paymentMethods = methods.map((m) => m.payment_method);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Payment Info — {memberName}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No payment methods shared</p>
        ) : (
          <PaymentMethodCards methods={paymentMethods} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc -b
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PaymentMethodCards.tsx frontend/src/components/PaymentInfoModal.tsx
git commit -m "feat: add shared PaymentMethodCards and PaymentInfoModal components"
```

---

## Task 6: Profile Page — Payment Methods CRUD

**Files:**
- Modify: `frontend/src/pages/Profile.tsx`

- [ ] **Step 1: Read the current Profile.tsx**

Read `frontend/src/pages/Profile.tsx` to understand current structure.

- [ ] **Step 2: Add payment methods section to Profile**

Add below the existing profile sections. The section should include:

1. A "Payment Methods" heading
2. List of existing methods, each showing: label, bank details, note, QR thumbnail, edit/delete buttons
3. "Add Payment Method" button that opens an inline form
4. Edit mode that shows the same form pre-filled
5. QR image upload button per method (appears after creation)

Import and use:
- `listMyPaymentMethods`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`, `uploadQrImage` from `@/api/paymentMethods`
- `PaymentMethod`, `PaymentMethodCreate` from `@/types`
- `Pencil`, `Trash2`, `Plus`, `Upload` from `lucide-react`

State needed:
- `paymentMethods: PaymentMethod[]`
- `showForm: boolean`
- `editingId: string | null`
- `formData: PaymentMethodCreate` (label, bank_name, account_number, account_holder, note)
- `saving: boolean`

Behavior:
- Load payment methods on mount alongside existing user data fetch
- Add form: label required, other fields optional. On save, call `createPaymentMethod()`, append to list, reset form.
- Edit: pre-fill form with existing values. On save, call `updatePaymentMethod()`, update in list.
- Delete: confirm dialog, call `deletePaymentMethod()`, remove from list.
- QR upload: file input (accept images), call `uploadQrImage()`, update method in list.
- QR display: thumbnail with click-to-enlarge.

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc -b
```

- [ ] **Step 4: Manual test**

Open the profile page. Verify:
- Can add a payment method with label only
- Can add with all fields filled
- Can upload QR image
- Can edit fields
- Can delete

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Profile.tsx
git commit -m "feat: add payment methods CRUD to profile page"
```

---

## Task 7: Group Settings — Toggle Payment Methods

**Files:**
- Modify: `frontend/src/pages/GroupSettings.tsx`

- [ ] **Step 1: Read the current GroupSettings.tsx**

Read `frontend/src/pages/GroupSettings.tsx` to understand current structure and where to add the new section.

- [ ] **Step 2: Add "My Payment Methods" toggle section**

Add a new section after the settings toggles (require_verified_users, allow_log_on_behalf) and before the members list. Only show if the current user has a linked account (user_id is not null on their member record).

Import and use:
- `listMyGroupPaymentMethods`, `enablePaymentMethodInGroup`, `disablePaymentMethodInGroup` from `@/api/paymentMethods`
- `MyGroupPaymentMethod` from `@/types`

State needed:
- `myGroupPMs: MyGroupPaymentMethod[]`
- `togglingId: string | null` (loading state per toggle)

Behavior:
- Fetch from `GET /groups/{gid}/payment-methods/mine` on mount
- Display each payment method as a row: label + bank_name on left, toggle switch on right
- Toggle on → call `enablePaymentMethodInGroup()` → update local state
- Toggle off → call `disablePaymentMethodInGroup()` → update local state
- If user has no payment methods at all: show "No payment methods saved yet." with a link to `/profile`
- Use the same toggle switch styling as the existing require_verified / allow_log_on_behalf toggles

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc -b
```

- [ ] **Step 4: Manual test**

Open group settings. Verify:
- Section appears for claimed members
- Can toggle methods on/off
- Link to profile works if no methods

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/GroupSettings.tsx
git commit -m "feat: add payment method toggles to group settings"
```

---

## Task 8: GroupView — Payment Info in Balances, Settlements, Transfer

**Files:**
- Modify: `frontend/src/pages/GroupView.tsx`

- [ ] **Step 1: Read current GroupView.tsx**

Read `frontend/src/pages/GroupView.tsx` to understand balances tab, settlements section, and transfer modal.

- [ ] **Step 2: Fetch group payment methods**

Add to the `loadAll()` function: fetch `listGroupPaymentMethods(groupId)` in the `Promise.all()`. Store in new state `groupPMs: GroupPaymentMethod[]`.

Import:
- `listGroupPaymentMethods` from `@/api/paymentMethods`
- `GroupPaymentMethod` from `@/types`
- `Landmark` (bank icon) from `lucide-react`
- `PaymentInfoModal` from `@/components/PaymentInfoModal`
- `PaymentMethodCards` from `@/components/PaymentMethodCards`

Add state:
- `groupPMs: GroupPaymentMethod[]`
- `paymentInfoMemberId: string | null` (which member's payment modal is open)

Add helper:
```typescript
function getMemberPaymentMethods(memberId: string) {
  return groupPMs.filter((pm) => pm.member_id === memberId);
}
```

- [ ] **Step 3: Add bank icon to Balances tab**

In each member balance row, after the member name, add:

```tsx
{getMemberPaymentMethods(b.member_id).length > 0 && (
  <button
    onClick={() => setPaymentInfoMemberId(b.member_id)}
    className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
    title="Payment info"
  >
    <Landmark size={14} />
  </button>
)}
```

- [ ] **Step 4: Add bank icon to Suggested Settlements**

In each settlement suggestion row, next to the payee name (`s.to_member_name`), add the same bank icon button if `getMemberPaymentMethods(s.to_member).length > 0`.

- [ ] **Step 5: Add payment info to Transfer modal**

In the transfer modal, after the "To" select dropdown, add:

```tsx
{transferTo && getMemberPaymentMethods(transferTo).length > 0 && (
  <div className="mt-2">
    <p className="text-xs font-medium text-gray-500 mb-1">Payment info</p>
    <PaymentMethodCards
      methods={getMemberPaymentMethods(transferTo).map((pm) => pm.payment_method)}
      compact
    />
  </div>
)}
```

- [ ] **Step 6: Add PaymentInfoModal**

Add at the bottom of the component (before the closing `</div>`):

```tsx
<PaymentInfoModal
  memberName={members.find((m) => m.id === paymentInfoMemberId)?.display_name ?? ""}
  methods={paymentInfoMemberId ? getMemberPaymentMethods(paymentInfoMemberId) : []}
  isOpen={!!paymentInfoMemberId}
  onClose={() => setPaymentInfoMemberId(null)}
/>
```

- [ ] **Step 7: Verify build**

Run:
```bash
cd frontend && npx tsc -b
```

- [ ] **Step 8: Manual test**

Verify:
- Balances tab shows bank icon for members with payment methods
- Clicking icon opens modal with payment info
- Settlements show bank icon for payee
- Transfer modal shows payment info below "To" when selected
- No icon shown for members without payment methods

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/GroupView.tsx
git commit -m "feat: show payment info in balances, settlements, and transfer modal"
```

---

## Task 9: Final Integration Test and Push

- [ ] **Step 1: Full build check**

```bash
cd frontend && npx tsc -b && npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 2: End-to-end manual test**

1. Go to Profile → add a payment method (e.g. "Vietcombank", account number, holder name, upload QR)
2. Go to a Group Settings → toggle the method ON for this group
3. Go to Group → Balances tab → see bank icon next to your name, click it → modal shows info + QR
4. Go to Transfer modal → select yourself in "To" → see payment info inline
5. Check settlements tab if applicable

- [ ] **Step 3: Push to master**

```bash
git push origin master
```
