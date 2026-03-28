# Group Funds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group funds (quỹ) — members can create shared money pools, contribute/withdraw, and link expenses to funds.

**Architecture:** Two new tables (Fund, FundTransaction) with a standalone API module. Expense gets an optional fund_id FK. Frontend adds a conditional "Funds" tab to GroupView with list and detail views.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React + TypeScript + Tailwind (frontend), Alembic (migrations), pytest (tests)

**Spec:** `docs/superpowers/specs/2026-03-28-group-funds-design.md`

---

### Task 1: Backend Models — Fund and FundTransaction

**Files:**
- Create: `backend/app/models/fund.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/group.py`

- [ ] **Step 1: Create Fund and FundTransaction models**

Create `backend/app/models/fund.py`:

```python
import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FundTransactionType(str, enum.Enum):
    contribute = "contribute"
    withdraw = "withdraw"
    expense = "expense"
    holder_change = "holder_change"


class Fund(Base):
    __tablename__ = "funds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    holder_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    group: Mapped["Group"] = relationship(back_populates="funds")  # noqa: F821
    holder: Mapped["GroupMember"] = relationship(foreign_keys=[holder_id])  # noqa: F821
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])  # noqa: F821
    transactions: Mapped[list["FundTransaction"]] = relationship(back_populates="fund", cascade="all, delete-orphan")


class FundTransaction(Base):
    __tablename__ = "fund_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fund_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("funds.id", ondelete="CASCADE"))
    type: Mapped[FundTransactionType] = mapped_column(Enum(FundTransactionType))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    expense_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fund: Mapped["Fund"] = relationship(back_populates="transactions")
    member: Mapped["GroupMember"] = relationship(foreign_keys=[member_id])  # noqa: F821
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])  # noqa: F821
    expense: Mapped["Expense | None"] = relationship()  # noqa: F821
```

- [ ] **Step 2: Register models in `__init__.py`**

Add to `backend/app/models/__init__.py`:

```python
from app.models.fund import Fund, FundTransaction, FundTransactionType
```

And add to `__all__`:

```python
"Fund", "FundTransaction", "FundTransactionType",
```

- [ ] **Step 3: Add funds relationship to Group model**

In `backend/app/models/group.py`, add after the `settlements` relationship (line 31):

```python
    funds: Mapped[list["Fund"]] = relationship(back_populates="group")  # noqa: F821
```

- [ ] **Step 4: Add fund_id to Expense model**

In `backend/app/models/expense.py`, add after `receipt_url` field:

```python
    fund_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("funds.id", ondelete="SET NULL"), nullable=True
    )
```

Add import for `Fund` relationship:

```python
    fund: Mapped["Fund | None"] = relationship()  # noqa: F821
```

- [ ] **Step 5: Generate and run migration**

```bash
cd backend
source venv/bin/activate
alembic revision --autogenerate -m "add fund and fund_transaction tables, add fund_id to expenses"
alembic upgrade head
```

Review the generated migration to ensure it creates `funds` and `fund_transactions` tables and adds `fund_id` column to `expenses`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/fund.py backend/app/models/__init__.py backend/app/models/group.py backend/app/models/expense.py backend/migrations/versions/
git commit -m "feat: add Fund and FundTransaction models, add fund_id to Expense"
```

---

### Task 2: Backend Schemas

**Files:**
- Create: `backend/app/schemas/fund.py`
- Modify: `backend/app/schemas/expense.py`

- [ ] **Step 1: Create fund schemas**

Create `backend/app/schemas/fund.py`:

```python
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel

from app.models.fund import FundTransactionType


class FundCreate(BaseModel):
    name: str
    description: Optional[str] = None
    holder_id: Optional[uuid.UUID] = None  # Defaults to creator


class FundUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    holder_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class FundRead(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    name: str
    description: Optional[str] = None
    holder_id: uuid.UUID
    holder_name: Optional[str] = None
    created_by: uuid.UUID
    is_active: bool
    balance: Decimal = Decimal("0")
    transaction_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FundDetailRead(FundRead):
    contributions_by_member: list["MemberContribution"] = []


class MemberContribution(BaseModel):
    member_id: uuid.UUID
    member_name: str
    total: Decimal


class FundTransactionCreate(BaseModel):
    type: FundTransactionType  # contribute or withdraw
    amount: Decimal
    member_id: uuid.UUID
    note: Optional[str] = None


class FundTransactionRead(BaseModel):
    id: uuid.UUID
    fund_id: uuid.UUID
    type: FundTransactionType
    amount: Decimal
    member_id: uuid.UUID
    member_name: Optional[str] = None
    expense_id: Optional[uuid.UUID] = None
    note: Optional[str] = None
    created_by: uuid.UUID
    created_by_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Add fund_id to expense schemas**

In `backend/app/schemas/expense.py`:

Add to `ExpenseCreate` (after `category_id`):
```python
    fund_id: Optional[uuid.UUID] = None
```

Add to `ExpenseRead` (after `category_id`):
```python
    fund_id: Optional[uuid.UUID] = None
    fund_name: Optional[str] = None
```

Add to `ExpenseUpdate` (after `category_id`):
```python
    fund_id: Optional[uuid.UUID] = None
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/fund.py backend/app/schemas/expense.py
git commit -m "feat: add fund schemas, add fund_id to expense schemas"
```

---

### Task 3: Backend API — Fund CRUD

**Files:**
- Create: `backend/app/api/v1/funds.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Create fund CRUD endpoints**

Create `backend/app/api/v1/funds.py`:

```python
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, MemberRole, User
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.schemas.fund import (
    FundCreate,
    FundDetailRead,
    FundRead,
    FundTransactionCreate,
    FundTransactionRead,
    FundUpdate,
    MemberContribution,
)

router = APIRouter(prefix="/groups/{group_id}/funds", tags=["funds"])


async def _get_fund_or_404(db: AsyncSession, group_id: uuid.UUID, fund_id: uuid.UUID) -> Fund:
    result = await db.execute(
        select(Fund).where(Fund.id == fund_id, Fund.group_id == group_id)
    )
    fund = result.scalars().first()
    if not fund:
        raise NotFound("Fund not found")
    return fund


async def _compute_balance(db: AsyncSession, fund_id: uuid.UUID) -> Decimal:
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    func.case(
                        (FundTransaction.type == FundTransactionType.contribute, FundTransaction.amount),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            )
            - func.coalesce(
                func.sum(
                    func.case(
                        (
                            FundTransaction.type.in_([FundTransactionType.withdraw, FundTransactionType.expense]),
                            FundTransaction.amount,
                        ),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            )
        ).where(FundTransaction.fund_id == fund_id)
    )
    return result.scalar() or Decimal("0")


async def _build_fund_read(db: AsyncSession, fund: Fund) -> FundRead:
    # Get holder name
    holder_result = await db.execute(
        select(GroupMember.display_name).where(GroupMember.id == fund.holder_id)
    )
    holder_name = holder_result.scalar()

    balance = await _compute_balance(db, fund.id)

    # Transaction count
    count_result = await db.execute(
        select(func.count()).where(FundTransaction.fund_id == fund.id)
    )
    tx_count = count_result.scalar() or 0

    return FundRead(
        id=fund.id,
        group_id=fund.group_id,
        name=fund.name,
        description=fund.description,
        holder_id=fund.holder_id,
        holder_name=holder_name,
        created_by=fund.created_by,
        is_active=fund.is_active,
        balance=balance,
        transaction_count=tx_count,
        created_at=fund.created_at,
        updated_at=fund.updated_at,
    )


@router.post("", response_model=FundRead)
async def create_fund(
    group_id: uuid.UUID,
    data: FundCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)

    holder_id = data.holder_id or current.id

    # Validate holder is an active member
    holder_result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == holder_id,
            GroupMember.group_id == group_id,
            GroupMember.is_active == True,
        )
    )
    if not holder_result.scalars().first():
        raise BadRequest("Holder must be an active group member")

    fund = Fund(
        group_id=group_id,
        name=data.name,
        description=data.description,
        holder_id=holder_id,
        created_by=current.id,
    )
    db.add(fund)
    await db.commit()
    await db.refresh(fund)

    return await _build_fund_read(db, fund)


@router.get("", response_model=list[FundRead])
async def list_funds(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)

    result = await db.execute(
        select(Fund)
        .where(Fund.group_id == group_id)
        .order_by(Fund.is_active.desc(), Fund.created_at.desc())
    )
    funds = result.scalars().all()
    return [await _build_fund_read(db, f) for f in funds]


@router.get("/{fund_id}", response_model=FundDetailRead)
async def get_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    base = await _build_fund_read(db, fund)

    # Contributions by member
    contrib_result = await db.execute(
        select(
            FundTransaction.member_id,
            GroupMember.display_name,
            func.sum(FundTransaction.amount),
        )
        .join(GroupMember, GroupMember.id == FundTransaction.member_id)
        .where(
            FundTransaction.fund_id == fund_id,
            FundTransaction.type == FundTransactionType.contribute,
        )
        .group_by(FundTransaction.member_id, GroupMember.display_name)
    )
    contributions = [
        MemberContribution(member_id=row[0], member_name=row[1], total=row[2])
        for row in contrib_result.all()
    ]

    return FundDetailRead(
        **base.model_dump(),
        contributions_by_member=contributions,
    )


@router.patch("/{fund_id}", response_model=FundRead)
async def update_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    data: FundUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    if data.name is not None:
        fund.name = data.name
    if data.description is not None:
        fund.description = data.description
    if data.is_active is not None:
        # Only admin/owner can close/reopen
        require_role(current, MemberRole.owner, MemberRole.admin)
        fund.is_active = data.is_active

    if data.holder_id is not None and data.holder_id != fund.holder_id:
        # Only admin/owner or current holder can change holder
        if current.id != fund.holder_id:
            require_role(current, MemberRole.owner, MemberRole.admin)

        # Validate new holder
        holder_result = await db.execute(
            select(GroupMember).where(
                GroupMember.id == data.holder_id,
                GroupMember.group_id == group_id,
                GroupMember.is_active == True,
            )
        )
        if not holder_result.scalars().first():
            raise BadRequest("New holder must be an active group member")

        fund.holder_id = data.holder_id

        # Log holder change
        tx = FundTransaction(
            fund_id=fund.id,
            type=FundTransactionType.holder_change,
            amount=Decimal("0"),
            member_id=data.holder_id,
            note=f"Holder changed to {(await db.execute(select(GroupMember.display_name).where(GroupMember.id == data.holder_id))).scalar()}",
            created_by=current.id,
        )
        db.add(tx)

    await db.commit()
    await db.refresh(fund)
    return await _build_fund_read(db, fund)


@router.delete("/{fund_id}")
async def close_fund(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    fund.is_active = False
    await db.commit()
    return {"detail": "Fund closed"}
```

- [ ] **Step 2: Register router**

In `backend/app/api/v1/router.py`, add at the bottom:

```python
from app.api.v1.funds import router as funds_router
api_router.include_router(funds_router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/funds.py backend/app/api/v1/router.py
git commit -m "feat: add fund CRUD API endpoints"
```

---

### Task 4: Backend API — Fund Transactions

**Files:**
- Modify: `backend/app/api/v1/funds.py`

- [ ] **Step 1: Add transaction endpoints to funds.py**

Append to `backend/app/api/v1/funds.py`:

```python
@router.post("/{fund_id}/transactions", response_model=FundTransactionRead)
async def create_fund_transaction(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    data: FundTransactionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    fund = await _get_fund_or_404(db, group_id, fund_id)

    if not fund.is_active:
        raise BadRequest("Cannot add transactions to a closed fund")

    if data.type not in (FundTransactionType.contribute, FundTransactionType.withdraw):
        raise BadRequest("Only contribute and withdraw transactions can be created directly")

    if data.amount <= 0:
        raise BadRequest("Amount must be positive")

    # Validate member is active in group
    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == data.member_id,
            GroupMember.group_id == group_id,
            GroupMember.is_active == True,
        )
    )
    member = member_result.scalars().first()
    if not member:
        raise BadRequest("Member not found or inactive")

    tx = FundTransaction(
        fund_id=fund_id,
        type=data.type,
        amount=data.amount,
        member_id=data.member_id,
        note=data.note,
        created_by=current.id,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)

    return FundTransactionRead(
        id=tx.id,
        fund_id=tx.fund_id,
        type=tx.type,
        amount=tx.amount,
        member_id=tx.member_id,
        member_name=member.display_name,
        expense_id=None,
        note=tx.note,
        created_by=tx.created_by,
        created_by_name=current.display_name,
        created_at=tx.created_at,
    )


@router.get("/{fund_id}/transactions", response_model=list[FundTransactionRead])
async def list_fund_transactions(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    limit: int = Query(50, le=100),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    await _get_fund_or_404(db, group_id, fund_id)

    result = await db.execute(
        select(FundTransaction)
        .where(FundTransaction.fund_id == fund_id)
        .order_by(FundTransaction.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    transactions = result.scalars().all()

    # Batch fetch member names
    member_ids = set()
    for tx in transactions:
        member_ids.add(tx.member_id)
        member_ids.add(tx.created_by)
    members_result = await db.execute(
        select(GroupMember.id, GroupMember.display_name).where(GroupMember.id.in_(member_ids))
    )
    names = {row[0]: row[1] for row in members_result.all()}

    return [
        FundTransactionRead(
            id=tx.id,
            fund_id=tx.fund_id,
            type=tx.type,
            amount=tx.amount,
            member_id=tx.member_id,
            member_name=names.get(tx.member_id),
            expense_id=tx.expense_id,
            note=tx.note,
            created_by=tx.created_by,
            created_by_name=names.get(tx.created_by),
            created_at=tx.created_at,
        )
        for tx in transactions
    ]


@router.delete("/{fund_id}/transactions/{transaction_id}")
async def delete_fund_transaction(
    group_id: uuid.UUID,
    fund_id: uuid.UUID,
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    await _get_fund_or_404(db, group_id, fund_id)

    result = await db.execute(
        select(FundTransaction).where(
            FundTransaction.id == transaction_id,
            FundTransaction.fund_id == fund_id,
        )
    )
    tx = result.scalars().first()
    if not tx:
        raise NotFound("Transaction not found")

    if tx.type == FundTransactionType.expense:
        raise BadRequest("Expense-linked transactions cannot be deleted directly. Delete the expense instead.")

    if tx.type == FundTransactionType.holder_change:
        raise BadRequest("Holder change records cannot be deleted")

    # Permission: own transaction or admin/owner
    if tx.created_by != current.id:
        require_role(current, MemberRole.owner, MemberRole.admin)

    await db.delete(tx)
    await db.commit()
    return {"detail": "Transaction deleted"}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/v1/funds.py
git commit -m "feat: add fund transaction endpoints (create, list, delete)"
```

---

### Task 5: Backend — Expense-Fund Integration

**Files:**
- Modify: `backend/app/api/v1/expenses.py`

- [ ] **Step 1: Update expense creation to handle fund_id**

In `backend/app/api/v1/expenses.py`:

Add import at top:
```python
from app.models.fund import Fund, FundTransaction, FundTransactionType
```

In `create_expense` function, after `group = await get_group_or_404(...)` and `current = await get_current_member(...)` (around line 43), add fund validation:

```python
    # Validate fund if provided
    fund = None
    if data.fund_id:
        fund_result = await db.execute(
            select(Fund).where(
                Fund.id == data.fund_id,
                Fund.group_id == group_id,
                Fund.is_active == True,
            )
        )
        fund = fund_result.scalars().first()
        if not fund:
            raise BadRequest("Fund not found or inactive")
```

When creating the Expense object (around line 78-89), add `fund_id`:
```python
    expense = Expense(
        group_id=group_id,
        paid_by=data.paid_by,
        created_by=current.id,
        description=data.description,
        amount=data.amount,
        currency_code=expense_currency,
        exchange_rate=exchange_rate,
        converted_amount=converted_amount,
        category_id=data.category_id,
        fund_id=data.fund_id,
        date=data.date,
    )
```

After `db.add(expense)` and `await db.flush()` (around line 91), add fund transaction creation:
```python
    # Create fund transaction if expense is linked to a fund
    if data.fund_id:
        fund_tx = FundTransaction(
            fund_id=data.fund_id,
            type=FundTransactionType.expense,
            amount=converted_amount,
            member_id=data.paid_by,
            expense_id=expense.id,
            note=data.description,
            created_by=current.id,
        )
        db.add(fund_tx)
```

- [ ] **Step 2: Update _build_expense_read to include fund info**

In `_build_expense_read` function, add fund_name lookup:

```python
def _build_expense_read(expense: Expense, group_currency: str | None = None) -> ExpenseRead:
    splits = []
    for s in expense.splits:
        sr = SplitRead.model_validate(s)
        sr.member_name = s.member.display_name if s.member else None
        splits.append(sr)
    result = ExpenseRead.model_validate(expense)
    result.splits = splits
    result.payer_name = expense.payer.display_name if expense.payer else None
    result.group_currency = group_currency or expense.group.currency_code if expense.group else None
    result.fund_name = expense.fund.name if expense.fund else None
    return result
```

Add `selectinload(Expense.fund)` to all queries that load expenses:
- In `create_expense` reload query (around line 111-119)
- In `list_expenses` query (around line 136-143)
- In `get_expense` query (around line 166-173)
- In `update_expense` reload query (around line 251-258)

Example for the create_expense reload:
```python
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund),
        )
    )
```

- [ ] **Step 3: Update delete_expense to cascade fund transaction**

In `delete_expense` (around line 264-289), the FundTransaction has `ondelete="CASCADE"` on `expense_id` FK, so deleting the expense will cascade. No code change needed — the DB handles it.

However, verify the FK is set up correctly. If not using DB cascade, add explicit deletion before deleting the expense:

```python
    # Delete linked fund transaction if any
    if expense.fund_id:
        ft_result = await db.execute(
            select(FundTransaction).where(FundTransaction.expense_id == expense_id)
        )
        ft = ft_result.scalars().first()
        if ft:
            await db.delete(ft)
```

- [ ] **Step 4: Update update_expense to handle fund_id changes**

In `update_expense` (around line 181-261), add after the existing field updates:

```python
    if data.fund_id is not None:
        if data.fund_id != expense.fund_id:
            # Remove old fund transaction
            if expense.fund_id:
                old_ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.expense_id == expense.id)
                )
                old_ft = old_ft_result.scalars().first()
                if old_ft:
                    await db.delete(old_ft)

            # Add new fund transaction
            if data.fund_id:
                fund_result = await db.execute(
                    select(Fund).where(
                        Fund.id == data.fund_id,
                        Fund.group_id == group_id,
                        Fund.is_active == True,
                    )
                )
                if not fund_result.scalars().first():
                    raise BadRequest("Fund not found or inactive")

                new_ft = FundTransaction(
                    fund_id=data.fund_id,
                    type=FundTransactionType.expense,
                    amount=expense.converted_amount,
                    member_id=expense.paid_by,
                    expense_id=expense.id,
                    note=expense.description,
                    created_by=current.id,
                )
                db.add(new_ft)

            expense.fund_id = data.fund_id
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/expenses.py
git commit -m "feat: integrate fund_id into expense create/update/delete"
```

---

### Task 6: Backend Tests — Fund API

**Files:**
- Create: `backend/tests/test_funds.py`

- [ ] **Step 1: Write fund API tests**

Create `backend/tests/test_funds.py`:

```python
import pytest
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupMember, MemberRole, User
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.services.auth import hash_password


@pytest.fixture
async def fund_setup(db: AsyncSession, test_user: User):
    """Create a group with 2 members for fund testing."""
    group = Group(name="Tennis Club", currency_code="VND", invite_code="TENNIS123")
    db.add(group)
    await db.flush()

    member1 = GroupMember(
        group_id=group.id, user_id=test_user.id, display_name="Player 1", role=MemberRole.owner
    )
    db.add(member1)
    await db.flush()

    user2 = User(email="player2@test.com", password_hash=hash_password("pass123"), display_name="Player 2", is_verified=True)
    db.add(user2)
    await db.flush()

    member2 = GroupMember(
        group_id=group.id, user_id=user2.id, display_name="Player 2", role=MemberRole.member
    )
    db.add(member2)
    await db.commit()
    await db.refresh(group)
    await db.refresh(member1)
    await db.refresh(member2)

    return {"group": group, "member1": member1, "member2": member2}


@pytest.mark.asyncio
async def test_create_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ tiền phạt"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Quỹ tiền phạt"
    assert data["is_active"] is True
    assert data["balance"] == "0"
    assert data["holder_id"] == str(fund_setup["member1"].id)


@pytest.mark.asyncio
async def test_list_funds(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    # Create a fund first
    await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ 1"},
        headers=auth_headers,
    )
    resp = await client.get(f"/api/v1/groups/{group.id}/funds", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_contribute_to_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    # Create fund
    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    # Contribute
    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "200000", "member_id": str(member1.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["type"] == "contribute"
    assert resp.json()["amount"] == "200000"

    # Check balance
    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert detail_resp.json()["balance"] == "200000"


@pytest.mark.asyncio
async def test_withdraw_from_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    # Create fund and contribute
    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]
    await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "500000", "member_id": str(member1.id)},
        headers=auth_headers,
    )

    # Withdraw
    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "withdraw", "amount": "100000", "member_id": str(member1.id), "note": "Trả lại tiền dư"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Balance should be 400000
    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert detail_resp.json()["balance"] == "400000"


@pytest.mark.asyncio
async def test_close_fund(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ tạm"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    # Close
    resp = await client.delete(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Cannot add transaction to closed fund
    resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "100000", "member_id": str(fund_setup["member1"].id)},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_change_holder(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member2 = fund_setup["member2"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    # Change holder
    resp = await client.patch(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        json={"holder_id": str(member2.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["holder_id"] == str(member2.id)

    # Check holder_change transaction was logged
    tx_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        headers=auth_headers,
    )
    transactions = tx_resp.json()
    assert any(tx["type"] == "holder_change" for tx in transactions)


@pytest.mark.asyncio
async def test_delete_transaction(client: AsyncClient, auth_headers: dict, fund_setup: dict):
    group = fund_setup["group"]
    member1 = fund_setup["member1"]

    fund_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds",
        json={"name": "Quỹ chung"},
        headers=auth_headers,
    )
    fund_id = fund_resp.json()["id"]

    # Contribute
    tx_resp = await client.post(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions",
        json={"type": "contribute", "amount": "100000", "member_id": str(member1.id)},
        headers=auth_headers,
    )
    tx_id = tx_resp.json()["id"]

    # Delete
    resp = await client.delete(
        f"/api/v1/groups/{group.id}/funds/{fund_id}/transactions/{tx_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Balance should be 0
    detail_resp = await client.get(
        f"/api/v1/groups/{group.id}/funds/{fund_id}",
        headers=auth_headers,
    )
    assert detail_resp.json()["balance"] == "0"
```

- [ ] **Step 2: Run tests**

```bash
cd backend
source venv/bin/activate
pytest tests/test_funds.py -v
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_funds.py
git commit -m "test: add fund API tests"
```

---

### Task 7: Frontend Types and API Client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/funds.ts`

- [ ] **Step 1: Add fund types**

In `frontend/src/types/index.ts`, add after the `Settlement` types section:

```typescript
// Fund
export type FundTransactionType = "contribute" | "withdraw" | "expense" | "holder_change";

export interface Fund {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  holder_id: string;
  holder_name: string | null;
  created_by: string;
  is_active: boolean;
  balance: number;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}

export interface FundDetail extends Fund {
  contributions_by_member: MemberContribution[];
}

export interface MemberContribution {
  member_id: string;
  member_name: string;
  total: number;
}

export interface FundCreate {
  name: string;
  description?: string | null;
  holder_id?: string | null;
}

export interface FundUpdate {
  name?: string | null;
  description?: string | null;
  holder_id?: string | null;
  is_active?: boolean | null;
}

export interface FundTransaction {
  id: string;
  fund_id: string;
  type: FundTransactionType;
  amount: number;
  member_id: string;
  member_name: string | null;
  expense_id: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

export interface FundTransactionCreate {
  type: "contribute" | "withdraw";
  amount: number;
  member_id: string;
  note?: string | null;
}
```

Add `fund_id` and `fund_name` to existing `Expense` interface:

```typescript
export interface Expense {
  // ... existing fields ...
  fund_id: string | null;
  fund_name: string | null;
}
```

Add `fund_id` to `ExpenseCreate`:

```typescript
export interface ExpenseCreate {
  // ... existing fields ...
  fund_id?: string | null;
}
```

Add `fund_id` to `ExpenseUpdate`:

```typescript
export interface ExpenseUpdate {
  // ... existing fields ...
  fund_id?: string | null;
}
```

- [ ] **Step 2: Create fund API client**

Create `frontend/src/api/funds.ts`:

```typescript
import type {
  Fund,
  FundCreate,
  FundDetail,
  FundTransaction,
  FundTransactionCreate,
  FundUpdate,
} from "@/types";
import client from "./client";

export async function createFund(groupId: string, data: FundCreate): Promise<Fund> {
  const response = await client.post<Fund>(`/groups/${groupId}/funds`, data);
  return response.data;
}

export async function listFunds(groupId: string): Promise<Fund[]> {
  const response = await client.get<Fund[]>(`/groups/${groupId}/funds`);
  return response.data;
}

export async function getFund(groupId: string, fundId: string): Promise<FundDetail> {
  const response = await client.get<FundDetail>(`/groups/${groupId}/funds/${fundId}`);
  return response.data;
}

export async function updateFund(
  groupId: string,
  fundId: string,
  data: FundUpdate,
): Promise<Fund> {
  const response = await client.patch<Fund>(`/groups/${groupId}/funds/${fundId}`, data);
  return response.data;
}

export async function closeFund(groupId: string, fundId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/funds/${fundId}`);
}

export async function createFundTransaction(
  groupId: string,
  fundId: string,
  data: FundTransactionCreate,
): Promise<FundTransaction> {
  const response = await client.post<FundTransaction>(
    `/groups/${groupId}/funds/${fundId}/transactions`,
    data,
  );
  return response.data;
}

export async function listFundTransactions(
  groupId: string,
  fundId: string,
): Promise<FundTransaction[]> {
  const response = await client.get<FundTransaction[]>(
    `/groups/${groupId}/funds/${fundId}/transactions`,
  );
  return response.data;
}

export async function deleteFundTransaction(
  groupId: string,
  fundId: string,
  transactionId: string,
): Promise<void> {
  await client.delete(`/groups/${groupId}/funds/${fundId}/transactions/${transactionId}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/funds.ts
git commit -m "feat: add fund types and API client"
```

---

### Task 8: Frontend — Funds Tab in GroupView

**Files:**
- Modify: `frontend/src/pages/GroupView.tsx`

- [ ] **Step 1: Add Funds tab and fund list state**

In `frontend/src/pages/GroupView.tsx`:

Update the Tab type:
```typescript
type Tab = "expenses" | "balances" | "settlements" | "funds";
```

Add imports:
```typescript
import { listFunds } from "@/api/funds";
import type { Fund } from "@/types";
```

Add state:
```typescript
const [funds, setFunds] = useState<Fund[]>([]);
```

Add fund loading in the existing data fetch effect (alongside expenses, balances, etc.):
```typescript
listFunds(groupId!).then(setFunds).catch(() => {});
```

Update the tab bar to conditionally include "funds":
```typescript
const availableTabs: Tab[] = funds.length > 0
  ? ["expenses", "balances", "settlements", "funds"]
  : ["expenses", "balances", "settlements"];
```

Replace the hardcoded tab array in the JSX with `availableTabs`.

- [ ] **Step 2: Add fund list UI in the funds tab section**

Add the funds tab content (after the settlements tab section):

```tsx
{tab === "funds" && (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-on-surface">Group Funds</h3>
      <button
        onClick={() => setShowCreateFund(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-on-primary rounded-full text-sm font-medium"
      >
        <Plus size={16} /> New Fund
      </button>
    </div>

    {funds.length === 0 ? (
      <div className="text-center py-12 text-on-surface-variant">
        <p className="text-4xl mb-2">💰</p>
        <p>No funds yet</p>
      </div>
    ) : (
      funds.map((fund) => (
        <Link
          key={fund.id}
          to={`/groups/${groupId}/funds/${fund.id}`}
          className={cn(
            "block border border-outline-variant rounded-xl p-4 transition-shadow hover:shadow-md",
            !fund.is_active && "opacity-50"
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-on-surface">
                {fund.name}
                {!fund.is_active && (
                  <span className="ml-2 text-xs bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">
                    Closed
                  </span>
                )}
              </div>
              <div className="text-xs text-on-surface-variant mt-1">
                Holder: {fund.holder_name} · {fund.transaction_count} transactions
              </div>
            </div>
            <div className="text-right">
              <div className={cn(
                "text-lg font-bold",
                fund.balance > 0 ? "text-green-600" : "text-on-surface-variant"
              )}>
                {formatCurrency(fund.balance, group?.currency_code || "VND")}
              </div>
              <div className="text-xs text-on-surface-variant">Balance</div>
            </div>
          </div>
        </Link>
      ))
    )}
  </div>
)}
```

- [ ] **Step 3: Add create fund modal state and basic modal**

Add state:
```typescript
const [showCreateFund, setShowCreateFund] = useState(false);
const [newFundName, setNewFundName] = useState("");
const [newFundDescription, setNewFundDescription] = useState("");
const [newFundHolder, setNewFundHolder] = useState("");
```

Add the modal JSX (before the closing fragment):

```tsx
{showCreateFund && (
  <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
    <div className="bg-surface rounded-2xl w-full max-w-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-on-surface">New Fund</h3>
        <button onClick={() => setShowCreateFund(false)}>
          <X size={20} className="text-on-surface-variant" />
        </button>
      </div>
      <div>
        <label className="text-sm text-on-surface-variant">Name *</label>
        <input
          value={newFundName}
          onChange={(e) => setNewFundName(e.target.value)}
          placeholder="e.g. Quỹ tiền phạt"
          className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        <label className="text-sm text-on-surface-variant">Description</label>
        <input
          value={newFundDescription}
          onChange={(e) => setNewFundDescription(e.target.value)}
          placeholder="Optional"
          className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        <label className="text-sm text-on-surface-variant">Holder</label>
        <select
          value={newFundHolder}
          onChange={(e) => setNewFundHolder(e.target.value)}
          className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Myself</option>
          {members.filter(m => m.is_active).map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
      </div>
      <button
        onClick={async () => {
          if (!newFundName.trim()) return;
          const { createFund } = await import("@/api/funds");
          await createFund(groupId!, {
            name: newFundName.trim(),
            description: newFundDescription.trim() || null,
            holder_id: newFundHolder || null,
          });
          setShowCreateFund(false);
          setNewFundName("");
          setNewFundDescription("");
          setNewFundHolder("");
          // Refresh funds
          const { listFunds } = await import("@/api/funds");
          listFunds(groupId!).then(setFunds);
        }}
        disabled={!newFundName.trim()}
        className="w-full py-2.5 bg-primary text-on-primary rounded-full font-medium disabled:opacity-50"
      >
        Create Fund
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/GroupView.tsx
git commit -m "feat: add Funds tab to GroupView with fund list and create modal"
```

---

### Task 9: Frontend — Fund Detail Page

**Files:**
- Create: `frontend/src/pages/FundDetail.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create FundDetail page**

Create `frontend/src/pages/FundDetail.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Minus, Pencil, Trash2 } from "lucide-react";
import { getFund, listFundTransactions, createFundTransaction, deleteFundTransaction } from "@/api/funds";
import { listMembers } from "@/api/members";
import { getGroup } from "@/api/groups";
import type { FundDetail as FundDetailType, FundTransaction, GroupMember, Group } from "@/types";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";
import MoneyInput from "@/components/MoneyInput";
import { useAuthStore } from "@/store/authStore";

const TX_TYPE_CONFIG = {
  contribute: { label: "Contribute", color: "text-green-600", icon: "▲" },
  withdraw: { label: "Withdraw", color: "text-red-500", icon: "▼" },
  expense: { label: "Expense", color: "text-red-500", icon: "▼" },
  holder_change: { label: "Holder Changed", color: "text-amber-500", icon: "↔" },
};

export default function FundDetailPage() {
  const { groupId, fundId } = useParams<{ groupId: string; fundId: string }>();
  const { user } = useAuthStore();
  const [fund, setFund] = useState<FundDetailType | null>(null);
  const [transactions, setTransactions] = useState<FundTransaction[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [showContribute, setShowContribute] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [txAmount, setTxAmount] = useState("");
  const [txMemberId, setTxMemberId] = useState("");
  const [txNote, setTxNote] = useState("");

  const loadData = () => {
    if (!groupId || !fundId) return;
    getFund(groupId, fundId).then(setFund);
    listFundTransactions(groupId, fundId).then(setTransactions);
    listMembers(groupId).then(setMembers);
    getGroup(groupId).then(setGroup);
  };

  useEffect(loadData, [groupId, fundId]);

  const handleCreateTransaction = async (type: "contribute" | "withdraw") => {
    if (!groupId || !fundId || !txAmount || !txMemberId) return;
    await createFundTransaction(groupId, fundId, {
      type,
      amount: parseFloat(txAmount),
      member_id: txMemberId,
      note: txNote.trim() || null,
    });
    setShowContribute(false);
    setShowWithdraw(false);
    setTxAmount("");
    setTxMemberId("");
    setTxNote("");
    loadData();
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (!groupId || !fundId) return;
    if (!confirm("Delete this transaction?")) return;
    await deleteFundTransaction(groupId, fundId, txId);
    loadData();
  };

  if (!fund || !group) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currency = group.currency_code;

  const transactionModal = (type: "contribute" | "withdraw", show: boolean, setShow: (v: boolean) => void) =>
    show && (
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
        <div className="bg-surface rounded-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-semibold text-on-surface capitalize">{type}</h3>
          <div>
            <label className="text-sm text-on-surface-variant">Member *</label>
            <select
              value={txMemberId}
              onChange={(e) => setTxMemberId(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select member</option>
              {members.filter((m) => m.is_active).map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-on-surface-variant">Amount *</label>
            <MoneyInput
              value={txAmount}
              onChange={setTxAmount}
              currency={currency}
            />
          </div>
          <div>
            <label className="text-sm text-on-surface-variant">Note</label>
            <input
              value={txNote}
              onChange={(e) => setTxNote(e.target.value)}
              placeholder="Optional"
              className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setShow(false); setTxAmount(""); setTxMemberId(""); setTxNote(""); }}
              className="flex-1 py-2.5 border border-outline-variant rounded-full text-on-surface"
            >
              Cancel
            </button>
            <button
              onClick={() => handleCreateTransaction(type)}
              disabled={!txMemberId || !txAmount}
              className={cn(
                "flex-1 py-2.5 rounded-full font-medium text-white disabled:opacity-50",
                type === "contribute" ? "bg-green-600" : "bg-red-500"
              )}
            >
              {type === "contribute" ? "Add" : "Withdraw"}
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <Link
            to={`/groups/${groupId}`}
            className="text-sm text-primary flex items-center gap-1 mb-3"
          >
            <ArrowLeft size={16} /> Back to group
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-on-surface">{fund.name}</h1>
              {fund.description && (
                <p className="text-sm text-on-surface-variant mt-1">{fund.description}</p>
              )}
              <p className="text-sm text-on-surface-variant mt-1">
                Holder: {fund.holder_name}
              </p>
            </div>
            <div className="text-right">
              <div className={cn(
                "text-2xl font-bold",
                fund.balance > 0 ? "text-green-600" : "text-on-surface-variant"
              )}>
                {formatCurrency(fund.balance, currency)}
              </div>
              <div className="text-xs text-on-surface-variant">Balance</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {fund.is_active && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowContribute(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-full text-sm font-medium"
            >
              <Plus size={16} /> Contribute
            </button>
            <button
              onClick={() => setShowWithdraw(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-full text-sm font-medium"
            >
              <Minus size={16} /> Withdraw
            </button>
          </div>
        )}

        {!fund.is_active && (
          <div className="bg-surface-container rounded-xl p-3 text-center text-sm text-on-surface-variant">
            This fund is closed. No new transactions can be added.
          </div>
        )}

        {/* Contributions by member */}
        {fund.contributions_by_member.length > 0 && (
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Contributions by member</h3>
            <div className="flex flex-wrap gap-3">
              {fund.contributions_by_member.map((c) => (
                <div key={c.member_id} className="flex items-center gap-2 text-sm">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {c.member_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-on-surface">
                    {c.member_name}: {formatCurrency(c.total, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div>
          <h3 className="text-sm font-semibold text-on-surface mb-3">Transaction History</h3>
          {transactions.length === 0 ? (
            <p className="text-center text-on-surface-variant py-8">No transactions yet</p>
          ) : (
            <div className="border border-outline-variant rounded-xl overflow-hidden divide-y divide-outline-variant">
              {transactions.map((tx) => {
                const config = TX_TYPE_CONFIG[tx.type];
                return (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <span className={cn("font-semibold", config.color)}>
                          {config.icon} {config.label}
                        </span>
                        {" · "}
                        {tx.type === "holder_change"
                          ? tx.note || `Changed to ${tx.member_name}`
                          : `${tx.member_name} ${formatCurrency(tx.amount, currency)}`}
                      </div>
                      {tx.note && tx.type !== "holder_change" && (
                        <div className="text-xs text-on-surface-variant truncate">{tx.note}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <div className="text-xs text-on-surface-variant text-right">
                        <div>{new Date(tx.created_at).toLocaleDateString()}</div>
                        <div>by {tx.created_by_name}</div>
                      </div>
                      {tx.type !== "expense" && tx.type !== "holder_change" && (
                        <button
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="p-1 text-on-surface-variant hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {transactionModal("contribute", showContribute, setShowContribute)}
      {transactionModal("withdraw", showWithdraw, setShowWithdraw)}
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

In `frontend/src/App.tsx`:

Add import:
```typescript
import FundDetail from "@/pages/FundDetail";
```

Add route inside the protected routes section (after the GroupView route):
```tsx
<Route path="/groups/:groupId/funds/:fundId" element={<FundDetail />} />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/FundDetail.tsx frontend/src/App.tsx
git commit -m "feat: add FundDetail page with transactions and contribute/withdraw modals"
```

---

### Task 10: Frontend — Fund Selector in Expense Form

**Files:**
- Modify: `frontend/src/pages/AddExpense.tsx`
- Modify: `frontend/src/pages/EditExpense.tsx`

- [ ] **Step 1: Add fund selector to AddExpense**

In `frontend/src/pages/AddExpense.tsx`:

Add imports:
```typescript
import { listFunds } from "@/api/funds";
import type { Fund } from "@/types";
```

Add state:
```typescript
const [funds, setFunds] = useState<Fund[]>([]);
const [selectedFundId, setSelectedFundId] = useState<string>("");
```

Load funds in effect:
```typescript
listFunds(groupId!).then((f) => setFunds(f.filter((fund) => fund.is_active)));
```

Add fund selector in the form (after category selector):
```tsx
{funds.length > 0 && (
  <div>
    <label className="text-sm text-on-surface-variant">Pay from fund</label>
    <select
      value={selectedFundId}
      onChange={(e) => setSelectedFundId(e.target.value)}
      className="w-full mt-1 px-3 py-2 bg-surface-container rounded-lg text-on-surface outline-none focus:ring-2 focus:ring-primary"
    >
      <option value="">No fund (personal)</option>
      {funds.map((f) => (
        <option key={f.id} value={f.id}>{f.name} ({formatCurrency(f.balance, group?.currency_code || "VND")})</option>
      ))}
    </select>
  </div>
)}
```

Include `fund_id` in the submit payload:
```typescript
fund_id: selectedFundId || null,
```

- [ ] **Step 2: Add fund selector to EditExpense**

Apply the same pattern as AddExpense:
- Load active funds
- Pre-select the current expense's fund_id
- Include fund_id in update payload

- [ ] **Step 3: Add fund tag to expense list in GroupView**

In `GroupView.tsx`, where expenses are rendered, show a fund badge if the expense has a `fund_name`:

```tsx
{expense.fund_name && (
  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
    {expense.fund_name}
  </span>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AddExpense.tsx frontend/src/pages/EditExpense.tsx frontend/src/pages/GroupView.tsx
git commit -m "feat: add fund selector to expense forms, show fund tag in expense list"
```

---

### Task 11: Final Integration Test and Cleanup

**Files:**
- Various — run full test suite and fix any issues

- [ ] **Step 1: Run backend tests**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: All existing tests PASS + new fund tests PASS.

- [ ] **Step 2: Run frontend lint**

```bash
cd frontend
npm run lint
```

Expected: No errors.

- [ ] **Step 3: Run frontend build**

```bash
cd frontend
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual smoke test**

Start dev servers and verify:
1. Create a group → no Funds tab visible
2. Create a fund via API or after adding Funds tab → Funds tab appears
3. Contribute to fund → balance updates
4. Create expense from fund → expense shows fund tag, fund balance decreases
5. Delete expense → fund balance restored
6. Withdraw from fund → balance decreases
7. Change holder → holder_change appears in log
8. Close fund → fund shows as closed, cannot add transactions

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration test fixes for group funds feature"
```
