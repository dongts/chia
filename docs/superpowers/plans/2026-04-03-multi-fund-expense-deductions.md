# Multi-Fund Partial Expense Deductions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow expenses to deduct partial amounts from one or more funds, reducing the amount split among members.

**Architecture:** New `expense_fund_deductions` join table replaces the single `Expense.fund_id` FK. Each deduction creates a `FundTransaction(type=expense)`. Splits are calculated on `converted_amount - sum(deductions)`. Balance validation prevents overdraft.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, Alembic, React 19, TypeScript, Tailwind CSS 4

---

## File Structure

**Backend — Create:**
- `backend/app/models/expense_fund_deduction.py` — New SQLAlchemy model
- `backend/tests/test_expense_fund_deductions.py` — Integration tests for the feature

**Backend — Modify:**
- `backend/app/models/__init__.py` — Export new model
- `backend/app/models/expense.py` — Remove `fund_id`, add `fund_deductions` relationship
- `backend/app/models/fund.py` — Drop `unique=True` on `FundTransaction.expense_id`, add `deduction_id` FK
- `backend/app/schemas/expense.py` — Replace `fund_id` with `fund_deductions` in Create/Update/Read
- `backend/app/api/v1/expenses.py` — Rewrite fund logic in create/update/delete, update `_build_expense_read`
- `backend/app/api/v1/funds.py` — Export `_compute_balance` for reuse in expense validation
- `backend/mcp_server/server.py` — Update `create_expense` tool to accept `fund_deductions`
- `backend/migrations/versions/` — New Alembic migration

**Frontend — Modify:**
- `frontend/src/types/index.ts` — Replace `fund_id`/`fund_name` with `fund_deductions` types
- `frontend/src/pages/AddExpense.tsx` — Multi-fund deduction UI
- `frontend/src/pages/EditExpense.tsx` — Multi-fund deduction UI (edit mode)
- `frontend/src/pages/GroupView.tsx` — Display multiple fund names on expense rows

---

### Task 1: Create ExpenseFundDeduction Model

**Files:**
- Create: `backend/app/models/expense_fund_deduction.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/expense.py:34-35,45`
- Modify: `backend/app/models/fund.py:47-49,57`

- [ ] **Step 1: Create the new model file**

Create `backend/app/models/expense_fund_deduction.py`:

```python
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ExpenseFundDeduction(Base):
    __tablename__ = "expense_fund_deductions"
    __table_args__ = (
        UniqueConstraint("expense_id", "fund_id", name="uq_expense_fund_deduction"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"))
    fund_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("funds.id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    expense: Mapped["Expense"] = relationship(back_populates="fund_deductions")
    fund: Mapped["Fund"] = relationship()
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])
```

- [ ] **Step 2: Update Expense model — remove fund_id, add fund_deductions relationship**

In `backend/app/models/expense.py`:

Remove these lines:
```python
    fund_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("funds.id", ondelete="SET NULL"), nullable=True
    )
```
and:
```python
    fund: Mapped["Fund | None"] = relationship()  # noqa: F821
```

Add this relationship (after the `category` relationship):
```python
    fund_deductions: Mapped[list["ExpenseFundDeduction"]] = relationship(  # noqa: F821
        back_populates="expense", cascade="all, delete-orphan"
    )
```

- [ ] **Step 3: Update FundTransaction model — drop unique on expense_id, add deduction_id**

In `backend/app/models/fund.py`, replace:
```python
    expense_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True, unique=True
    )
```
with:
```python
    expense_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True
    )
    deduction_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expense_fund_deductions.id", ondelete="CASCADE"), nullable=True
    )
```

- [ ] **Step 4: Update models/__init__.py**

In `backend/app/models/__init__.py`, add the import:
```python
from app.models.expense_fund_deduction import ExpenseFundDeduction
```

And add `"ExpenseFundDeduction"` to the `__all__` list.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/expense_fund_deduction.py backend/app/models/expense.py backend/app/models/fund.py backend/app/models/__init__.py
git commit -m "feat: add ExpenseFundDeduction model, update Expense and FundTransaction models"
```

---

### Task 2: Create Alembic Migration

**Files:**
- Create: `backend/migrations/versions/<auto>_multi_fund_expense_deductions.py`

- [ ] **Step 1: Generate the migration**

```bash
cd backend
source venv/bin/activate
alembic revision --autogenerate -m "multi fund expense deductions"
```

- [ ] **Step 2: Edit the generated migration to include data migration**

The autogenerated migration will create the new table, add `deduction_id` to `fund_transactions`, and drop `fund_id` from `expenses`. But we need to add a data migration step between creating the table and dropping the column.

Open the generated migration file and ensure `upgrade()` does these steps in order:

1. Create `expense_fund_deductions` table
2. Add `deduction_id` column to `fund_transactions` (nullable)
3. Drop the unique constraint on `fund_transactions.expense_id` (constraint name from the original migration)
4. **Data migration:** For each expense that has a `fund_id`, insert a row into `expense_fund_deductions` and update the linked `FundTransaction` with the new `deduction_id`
5. Drop `fund_id` column from `expenses`

The data migration SQL (insert into upgrade function):

```python
    # Data migration: move existing fund_id references to deduction rows
    op.execute("""
        INSERT INTO expense_fund_deductions (id, expense_id, fund_id, amount, created_by, created_at)
        SELECT gen_random_uuid(), e.id, e.fund_id, e.converted_amount, e.created_by, e.created_at
        FROM expenses e
        WHERE e.fund_id IS NOT NULL
    """)

    # Link existing fund transactions to their deduction rows
    op.execute("""
        UPDATE fund_transactions ft
        SET deduction_id = efd.id
        FROM expense_fund_deductions efd
        WHERE ft.expense_id = efd.expense_id AND ft.fund_id = efd.fund_id
          AND ft.type = 'expense'
    """)
```

- [ ] **Step 3: Run the migration against test DB and verify**

```bash
alembic upgrade head
```

Expected: Migration runs without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/versions/
git commit -m "feat: add migration for multi-fund expense deductions with data migration"
```

---

### Task 3: Update Backend Schemas

**Files:**
- Modify: `backend/app/schemas/expense.py`

- [ ] **Step 1: Replace fund_id with fund_deductions in schemas**

Replace the entire content of `backend/app/schemas/expense.py`:

```python
import uuid
from datetime import date as DateType
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel

from app.models.expense import SplitType


class SplitInput(BaseModel):
    group_member_id: uuid.UUID
    value: Decimal


class FundDeductionInput(BaseModel):
    fund_id: uuid.UUID
    amount: Decimal


class FundDeductionRead(BaseModel):
    id: uuid.UUID
    fund_id: uuid.UUID
    fund_name: str
    amount: Decimal

    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    currency_code: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    date: DateType
    paid_by: uuid.UUID
    category_id: uuid.UUID
    fund_deductions: list[FundDeductionInput] = []
    split_type: SplitType
    splits: list[SplitInput]


class SplitRead(BaseModel):
    id: uuid.UUID
    group_member_id: uuid.UUID
    member_name: Optional[str] = None
    split_type: SplitType
    value: Decimal
    resolved_amount: Decimal

    model_config = {"from_attributes": True}


class ExpenseRead(BaseModel):
    id: uuid.UUID
    description: str
    amount: Decimal
    currency_code: str
    exchange_rate: Decimal
    converted_amount: Decimal
    group_currency: Optional[str] = None
    date: DateType
    paid_by: uuid.UUID
    payer_name: Optional[str] = None
    created_by: uuid.UUID
    category_id: uuid.UUID
    fund_deductions: list[FundDeductionRead] = []
    receipt_url: Optional[str]
    splits: list[SplitRead] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ExpenseUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[Decimal] = None
    currency_code: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    date: Optional[DateType] = None
    paid_by: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    fund_deductions: Optional[list[FundDeductionInput]] = None
    split_type: Optional[SplitType] = None
    splits: Optional[list[SplitInput]] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/expense.py
git commit -m "feat: update expense schemas for multi-fund deductions"
```

---

### Task 4: Update Expense API — Create Endpoint

**Files:**
- Modify: `backend/app/api/v1/expenses.py:24-153`
- Modify: `backend/app/api/v1/funds.py:44-70` (export `_compute_balance`)

- [ ] **Step 1: Make _compute_balance importable from funds.py**

In `backend/app/api/v1/funds.py`, rename `_compute_balance` to `compute_fund_balance` (remove underscore prefix to make it a public function):

Find all occurrences of `_compute_balance` in that file and replace with `compute_fund_balance`.

- [ ] **Step 2: Rewrite _build_expense_read in expenses.py**

Replace the `_build_expense_read` function:

```python
from app.models.expense_fund_deduction import ExpenseFundDeduction
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate, FundDeductionRead, SplitRead


def _build_expense_read(expense: Expense, group_currency: str | None = None) -> ExpenseRead:
    splits = []
    for s in expense.splits:
        sr = SplitRead.model_validate(s)
        sr.member_name = s.member.display_name if s.member else None
        splits.append(sr)

    fund_deductions = []
    for d in expense.fund_deductions:
        fund_deductions.append(FundDeductionRead(
            id=d.id,
            fund_id=d.fund_id,
            fund_name=d.fund.name if d.fund else "Unknown",
            amount=d.amount,
        ))

    result = ExpenseRead.model_validate(expense)
    result.splits = splits
    result.fund_deductions = fund_deductions
    result.payer_name = expense.payer.display_name if expense.payer else None
    result.group_currency = group_currency or expense.group.currency_code if expense.group else None
    return result
```

- [ ] **Step 3: Rewrite create_expense endpoint**

Replace the entire `create_expense` function with:

```python
@router.post("", response_model=ExpenseRead)
async def create_expense(
    group_id: uuid.UUID,
    data: ExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)

    # Check on-behalf permission
    if data.paid_by != current.id:
        if current.role == MemberRole.member and not group.allow_log_on_behalf:
            raise Forbidden("This group does not allow logging expenses on behalf of others")

    # Determine currency and exchange rate
    expense_currency = (data.currency_code or group.currency_code).upper().strip()
    exchange_rate = Decimal("1")
    if expense_currency != group.currency_code:
        gc_result = await db.execute(
            select(GroupCurrency).where(
                GroupCurrency.group_id == group_id,
                GroupCurrency.currency_code == expense_currency,
            )
        )
        allowed_currency = gc_result.scalars().first()
        if not allowed_currency:
            raise BadRequest(
                f"{expense_currency} is not an allowed currency for this group. "
                f"Add it in group settings first."
            )
        if data.exchange_rate is not None and data.exchange_rate > 0:
            exchange_rate = data.exchange_rate
        else:
            exchange_rate = allowed_currency.exchange_rate
    converted_amount = (data.amount * exchange_rate).quantize(Decimal("0.01"))

    # Validate fund deductions
    total_deductions = Decimal("0")
    validated_funds: list[tuple[Fund, Decimal]] = []  # (fund, amount)

    if data.fund_deductions:
        seen_fund_ids = set()
        for fd in data.fund_deductions:
            if fd.fund_id in seen_fund_ids:
                raise BadRequest("Duplicate fund in deductions")
            seen_fund_ids.add(fd.fund_id)

            if fd.amount <= 0:
                raise BadRequest("Fund deduction amount must be greater than zero")

            fund_result = await db.execute(
                select(Fund).where(
                    Fund.id == fd.fund_id,
                    Fund.group_id == group_id,
                    Fund.is_active == True,
                )
            )
            fund = fund_result.scalars().first()
            if not fund:
                raise BadRequest(f"Fund {fd.fund_id} not found or inactive")

            balance = await compute_fund_balance(db, fund.id)
            if fd.amount > balance:
                raise BadRequest(
                    f"Fund '{fund.name}' has insufficient balance "
                    f"({balance} available, {fd.amount} requested)"
                )

            total_deductions += fd.amount
            validated_funds.append((fund, fd.amount))

        if total_deductions > converted_amount:
            raise BadRequest(
                f"Total fund deductions ({total_deductions}) exceed expense amount ({converted_amount})"
            )

    # Compute splits against splittable amount
    splittable_amount = converted_amount - total_deductions
    members_map = {str(s.group_member_id): s.value for s in data.splits}

    if splittable_amount == 0:
        resolved = {mid: Decimal("0") for mid in members_map}
    else:
        resolved = calculate_splits(splittable_amount, data.split_type.value, members_map)

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
        date=data.date,
    )
    db.add(expense)
    await db.flush()

    # Create fund deductions and corresponding transactions
    for fund, deduction_amount in validated_funds:
        deduction = ExpenseFundDeduction(
            expense_id=expense.id,
            fund_id=fund.id,
            amount=deduction_amount,
            created_by=current.id,
        )
        db.add(deduction)
        await db.flush()

        fund_tx = FundTransaction(
            fund_id=fund.id,
            type=FundTransactionType.expense,
            amount=deduction_amount,
            member_id=data.paid_by,
            expense_id=expense.id,
            deduction_id=deduction.id,
            note=data.description,
            created_by=current.id,
        )
        db.add(fund_tx)

    for s in data.splits:
        split = ExpenseSplit(
            expense_id=expense.id,
            group_member_id=s.group_member_id,
            split_type=data.split_type,
            value=s.value,
            resolved_amount=resolved[str(s.group_member_id)],
        )
        db.add(split)

    await notify_group(
        db, group_id, current_user.id, "expense_added",
        {"description": data.description, "amount": str(data.amount), "payer": current.display_name},
    )

    await db.commit()

    # Reload with relationships
    result = await db.execute(
        select(Expense)
        .where(Expense.id == expense.id)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.member),
            selectinload(Expense.payer),
            selectinload(Expense.group),
            selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund),
        )
    )
    expense = result.scalars().first()
    return _build_expense_read(expense, group.currency_code)
```

- [ ] **Step 4: Update imports at top of expenses.py**

Add these imports:
```python
from app.api.v1.funds import compute_fund_balance
from app.models.expense_fund_deduction import ExpenseFundDeduction
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate, FundDeductionRead, SplitRead
```

Remove `Fund` from the import if it's no longer used directly — actually keep it, it's used in the fund validation query.

Replace all `selectinload(Expense.fund)` with `selectinload(Expense.fund_deductions).selectinload(ExpenseFundDeduction.fund)` throughout the file (in `list_expenses`, `get_expense`, `update_expense` reload, `upload_receipt`, `delete_receipt`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/expenses.py backend/app/api/v1/funds.py
git commit -m "feat: rewrite expense create endpoint for multi-fund deductions"
```

---

### Task 5: Update Expense API — Update and Delete Endpoints

**Files:**
- Modify: `backend/app/api/v1/expenses.py:215-369`

- [ ] **Step 1: Rewrite update_expense fund deduction logic**

Replace the fund-related block in `update_expense` (lines 253-287) with the new multi-fund logic. The full updated function:

In the `update_expense` function, after the existing field updates (description, amount, currency, etc.) and before the "Recalculate converted amount" block, replace the fund_id block with:

```python
    # Handle fund deductions update
    if data.fund_deductions is not None:
        # Load existing deductions
        existing_deductions_result = await db.execute(
            select(ExpenseFundDeduction).where(ExpenseFundDeduction.expense_id == expense.id)
        )
        existing_deductions = {d.fund_id: d for d in existing_deductions_result.scalars().all()}

        new_fund_ids = set()
        total_deductions = Decimal("0")

        # Validate all new deductions first
        for fd in data.fund_deductions:
            if fd.fund_id in new_fund_ids:
                raise BadRequest("Duplicate fund in deductions")
            new_fund_ids.add(fd.fund_id)

            if fd.amount <= 0:
                raise BadRequest("Fund deduction amount must be greater than zero")

            fund_result = await db.execute(
                select(Fund).where(
                    Fund.id == fd.fund_id,
                    Fund.group_id == group_id,
                    Fund.is_active == True,
                )
            )
            fund = fund_result.scalars().first()
            if not fund:
                raise BadRequest(f"Fund {fd.fund_id} not found or inactive")

            # Balance check: add back old deduction amount if same fund
            balance = await compute_fund_balance(db, fund.id)
            old_deduction = existing_deductions.get(fd.fund_id)
            available = balance + (old_deduction.amount if old_deduction else Decimal("0"))
            if fd.amount > available:
                raise BadRequest(
                    f"Fund '{fund.name}' has insufficient balance "
                    f"({available} available, {fd.amount} requested)"
                )

            total_deductions += fd.amount

        # Check total doesn't exceed expense amount
        effective_converted = expense.converted_amount
        if data.amount is not None or data.exchange_rate is not None or data.currency_code is not None:
            rate = expense.exchange_rate if expense.currency_code != group.currency_code else Decimal("1")
            effective_converted = (expense.amount * rate).quantize(Decimal("0.01"))

        if total_deductions > effective_converted:
            raise BadRequest(
                f"Total fund deductions ({total_deductions}) exceed expense amount ({effective_converted})"
            )

        # Delete removed deductions and their fund transactions
        for old_fund_id, old_deduction in existing_deductions.items():
            if old_fund_id not in new_fund_ids:
                old_ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.deduction_id == old_deduction.id)
                )
                old_ft = old_ft_result.scalars().first()
                if old_ft:
                    await db.delete(old_ft)
                await db.delete(old_deduction)

        # Upsert deductions
        for fd in data.fund_deductions:
            old_deduction = existing_deductions.get(fd.fund_id)
            if old_deduction:
                # Update existing deduction amount
                old_deduction.amount = fd.amount
                # Update corresponding fund transaction
                ft_result = await db.execute(
                    select(FundTransaction).where(FundTransaction.deduction_id == old_deduction.id)
                )
                ft = ft_result.scalars().first()
                if ft:
                    ft.amount = fd.amount
            else:
                # Create new deduction + transaction
                new_deduction = ExpenseFundDeduction(
                    expense_id=expense.id,
                    fund_id=fd.fund_id,
                    amount=fd.amount,
                    created_by=current.id,
                )
                db.add(new_deduction)
                await db.flush()

                new_ft = FundTransaction(
                    fund_id=fd.fund_id,
                    type=FundTransactionType.expense,
                    amount=fd.amount,
                    member_id=expense.paid_by,
                    expense_id=expense.id,
                    deduction_id=new_deduction.id,
                    note=expense.description,
                    created_by=current.id,
                )
                db.add(new_ft)
```

- [ ] **Step 2: Update split recalculation to use splittable_amount**

In `update_expense`, where splits are recalculated (around the existing lines 294-311), update the split recalculation to account for fund deductions:

```python
    # Recalculate converted amount
    if data.amount is not None or data.exchange_rate is not None or data.currency_code is not None:
        rate = expense.exchange_rate if expense.currency_code != group.currency_code else Decimal("1")
        expense.converted_amount = (expense.amount * rate).quantize(Decimal("0.01"))

    # Recalculate splits if provided
    if data.splits is not None and data.split_type is not None:
        for old_split in expense.splits:
            await db.delete(old_split)
        await db.flush()

        # Compute splittable amount (after fund deductions)
        deductions_result = await db.execute(
            select(func.coalesce(func.sum(ExpenseFundDeduction.amount), Decimal("0")))
            .where(ExpenseFundDeduction.expense_id == expense.id)
        )
        total_deductions = deductions_result.scalar() or Decimal("0")
        splittable_amount = expense.converted_amount - total_deductions

        members_map = {str(s.group_member_id): s.value for s in data.splits}
        if splittable_amount == 0:
            resolved = {mid: Decimal("0") for mid in members_map}
        else:
            resolved = calculate_splits(splittable_amount, data.split_type.value, members_map)

        for s in data.splits:
            split = ExpenseSplit(
                expense_id=expense.id,
                group_member_id=s.group_member_id,
                split_type=data.split_type,
                value=s.value,
                resolved_amount=resolved[str(s.group_member_id)],
            )
            db.add(split)
```

Add `func` to the sqlalchemy import at the top of `expenses.py`:
```python
from sqlalchemy import func, select
```
(The file already imports `select` but not `func`.)

- [ ] **Step 3: Update delete_expense**

Replace the fund transaction deletion block in `delete_expense`:

```python
    # Delete linked fund transactions (via deductions)
    ft_result = await db.execute(
        select(FundTransaction).where(FundTransaction.expense_id == expense_id)
    )
    for ft in ft_result.scalars().all():
        await db.delete(ft)

    await db.delete(expense)
    await db.commit()
    return {"detail": "Expense deleted"}
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/expenses.py
git commit -m "feat: update expense update/delete endpoints for multi-fund deductions"
```

---

### Task 6: Update MCP Server

**Files:**
- Modify: `backend/mcp_server/server.py:270-318`

- [ ] **Step 1: Update create_expense tool signature and body**

In `backend/mcp_server/server.py`, update the `create_expense` function:

Replace the `fund_id` parameter with:
```python
    fund_deductions: list[dict] | None = None,
```

Update the docstring — replace the `fund_id` line with:
```
        fund_deductions: List of fund deduction objects. Each has "fund_id" (UUID str) and "amount" (number).
            Deducts partial amounts from group funds. Total deductions cannot exceed expense amount.
```

In the payload building, replace:
```python
    if fund_id:
        payload["fund_id"] = fund_id
```
with:
```python
    if fund_deductions:
        payload["fund_deductions"] = fund_deductions
```

- [ ] **Step 2: Commit**

```bash
git add backend/mcp_server/server.py
git commit -m "feat: update MCP server create_expense for multi-fund deductions"
```

---

### Task 7: Write Backend Integration Tests

**Files:**
- Create: `backend/tests/test_expense_fund_deductions.py`

- [ ] **Step 1: Create the test file with fixtures and all tests**

Create `backend/tests/test_expense_fund_deductions.py`:

```python
import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupMember, MemberRole, User, Category
from app.models.fund import Fund, FundTransaction, FundTransactionType
from app.services.auth import hash_password


@pytest_asyncio.fixture
async def expense_fund_setup(db: AsyncSession, test_user: User):
    """Create a group with 3 members, a category, and 2 funded funds."""
    group = Group(name="Trip Group", currency_code="USD", invite_code="TRIP123")
    db.add(group)
    await db.flush()

    member1 = GroupMember(
        group_id=group.id, user_id=test_user.id, display_name="Alice", role=MemberRole.owner
    )
    db.add(member1)
    await db.flush()

    user2 = User(email="bob@test.com", password_hash=hash_password("pass"), display_name="Bob", is_verified=True)
    db.add(user2)
    await db.flush()
    member2 = GroupMember(group_id=group.id, user_id=user2.id, display_name="Bob", role=MemberRole.member)
    db.add(member2)
    await db.flush()

    user3 = User(email="carol@test.com", password_hash=hash_password("pass"), display_name="Carol", is_verified=True)
    db.add(user3)
    await db.flush()
    member3 = GroupMember(group_id=group.id, user_id=user3.id, display_name="Carol", role=MemberRole.member)
    db.add(member3)
    await db.flush()

    category = Category(name="Food", icon="🍕", is_default=True)
    db.add(category)
    await db.flush()

    # Create two funds with balances
    fund_a = Fund(group_id=group.id, name="Party Fund", holder_id=member1.id, created_by=member1.id)
    db.add(fund_a)
    await db.flush()

    tx_a = FundTransaction(
        fund_id=fund_a.id, type=FundTransactionType.contribute,
        amount=Decimal("500.00"), member_id=member1.id, created_by=member1.id,
    )
    db.add(tx_a)

    fund_b = Fund(group_id=group.id, name="Emergency Fund", holder_id=member1.id, created_by=member1.id)
    db.add(fund_b)
    await db.flush()

    tx_b = FundTransaction(
        fund_id=fund_b.id, type=FundTransactionType.contribute,
        amount=Decimal("300.00"), member_id=member1.id, created_by=member1.id,
    )
    db.add(tx_b)

    await db.commit()
    for obj in [group, member1, member2, member3, category, fund_a, fund_b]:
        await db.refresh(obj)

    return {
        "group": group, "member1": member1, "member2": member2, "member3": member3,
        "category": category, "fund_a": fund_a, "fund_b": fund_b,
    }


def _expense_payload(setup: dict, **overrides) -> dict:
    """Build a minimal expense create payload."""
    base = {
        "description": "Dinner",
        "amount": "100.00",
        "date": "2026-04-03",
        "paid_by": str(setup["member1"].id),
        "category_id": str(setup["category"].id),
        "split_type": "equal",
        "splits": [
            {"group_member_id": str(setup["member1"].id), "value": 1},
            {"group_member_id": str(setup["member2"].id), "value": 1},
            {"group_member_id": str(setup["member3"].id), "value": 1},
        ],
        "fund_deductions": [],
    }
    base.update(overrides)
    return base


# ---- Create Tests ----

@pytest.mark.asyncio
async def test_create_expense_no_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Expense with no fund deductions — full amount split among members."""
    setup = expense_fund_setup
    payload = _expense_payload(setup)

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["fund_deductions"] == []
    assert data["converted_amount"] == "100.00"
    # Each member should owe ~33.33/33.33/33.34
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("100.00")


@pytest.mark.asyncio
async def test_create_expense_single_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Single fund deduction reduces the split amount."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["fund_deductions"]) == 1
    assert Decimal(data["fund_deductions"][0]["amount"]) == Decimal("40.00")
    # Splittable = 100 - 40 = 60, split among 3 = 20 each
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("60.00")


@pytest.mark.asyncio
async def test_create_expense_multiple_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Multiple fund deductions from different funds."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "20.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["fund_deductions"]) == 2
    # Splittable = 100 - 30 - 20 = 50
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("50.00")

    # Verify fund balances decreased
    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("470.00")  # 500 - 30

    fb_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_b'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fb_resp.json()["balance"])) == Decimal("280.00")  # 300 - 20


@pytest.mark.asyncio
async def test_create_expense_fund_covers_100_percent(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Fund deductions cover the entire expense — splits are all 0."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "100.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    for s in data["splits"]:
        assert Decimal(s["resolved_amount"]) == Decimal("0")


@pytest.mark.asyncio
async def test_create_expense_deduction_exceeds_fund_balance(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Deduction amount exceeds fund balance — should return 400."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "999.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "insufficient balance" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_deductions_exceed_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Total deductions exceed expense amount — should return 400."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "60.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "50.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "exceed expense amount" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_duplicate_fund_id(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Duplicate fund_id in deductions — should return 400."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "20.00"},
        {"fund_id": str(setup["fund_a"].id), "amount": "10.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "Duplicate fund" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_inactive_fund(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Inactive fund in deductions — should return 400."""
    setup = expense_fund_setup
    # Close fund_a
    await client.delete(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "10.00"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "not found or inactive" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_expense_zero_deduction_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Zero deduction amount — should return 400."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "0"},
    ])

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "greater than zero" in resp.json()["detail"]


# ---- Split Type Tests with Fund Deductions ----

@pytest.mark.asyncio
async def test_exact_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Exact split type with fund deduction — split values must sum to splittable amount."""
    setup = expense_fund_setup
    # 100 expense, 40 from fund = 60 splittable
    payload = _expense_payload(setup,
        split_type="exact",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "40.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "20.00"},
            {"group_member_id": str(setup["member2"].id), "value": "20.00"},
            {"group_member_id": str(setup["member3"].id), "value": "20.00"},
        ],
    )

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    total_split = sum(Decimal(s["resolved_amount"]) for s in resp.json()["splits"])
    assert total_split == Decimal("60.00")


@pytest.mark.asyncio
async def test_percentage_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Percentage split with fund deduction — percentages of splittable amount."""
    setup = expense_fund_setup
    # 100 expense, 50 from fund = 50 splittable
    payload = _expense_payload(setup,
        split_type="percentage",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "50.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "50"},
            {"group_member_id": str(setup["member2"].id), "value": "30"},
            {"group_member_id": str(setup["member3"].id), "value": "20"},
        ],
    )

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    splits = resp.json()["splits"]
    amounts = {s["group_member_id"]: Decimal(s["resolved_amount"]) for s in splits}
    assert amounts[str(setup["member1"].id)] == Decimal("25.00")  # 50% of 50
    assert amounts[str(setup["member2"].id)] == Decimal("15.00")  # 30% of 50
    assert amounts[str(setup["member3"].id)] == Decimal("10.00")  # 20% of 50


@pytest.mark.asyncio
async def test_shares_split_with_fund_deduction(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Shares split with fund deduction."""
    setup = expense_fund_setup
    # 100 expense, 40 from fund = 60 splittable, shares 2:1 = 40:20
    payload = _expense_payload(setup,
        split_type="shares",
        fund_deductions=[{"fund_id": str(setup["fund_a"].id), "amount": "40.00"}],
        splits=[
            {"group_member_id": str(setup["member1"].id), "value": "2"},
            {"group_member_id": str(setup["member2"].id), "value": "1"},
        ],
    )

    resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    assert resp.status_code == 200
    splits = resp.json()["splits"]
    amounts = {s["group_member_id"]: Decimal(s["resolved_amount"]) for s in splits}
    assert amounts[str(setup["member1"].id)] == Decimal("40.00")
    assert amounts[str(setup["member2"].id)] == Decimal("20.00")


# ---- Update Tests ----

@pytest.mark.asyncio
async def test_update_add_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Add fund deductions to an expense that had none."""
    setup = expense_fund_setup
    # Create without deductions
    payload = _expense_payload(setup)
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    # Update with deductions
    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [
                {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
            ],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert len(data["fund_deductions"]) == 1
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("70.00")  # 100 - 30

    # Fund balance should decrease
    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("470.00")


@pytest.mark.asyncio
async def test_update_remove_fund_deductions(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Remove all fund deductions from an expense."""
    setup = expense_fund_setup
    # Create with deduction
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    # Update: remove all deductions
    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["fund_deductions"] == []
    total_split = sum(Decimal(s["resolved_amount"]) for s in data["splits"])
    assert total_split == Decimal("100.00")

    # Fund balance should be restored
    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("500.00")


@pytest.mark.asyncio
async def test_update_change_deduction_amount(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Change the deduction amount on an existing fund."""
    setup = expense_fund_setup
    # Create with 40 deduction
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "40.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    # Update: change to 60
    update_resp = await client.patch(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        json={
            "fund_deductions": [
                {"fund_id": str(setup["fund_a"].id), "amount": "60.00"},
            ],
            "split_type": "equal",
            "splits": [
                {"group_member_id": str(setup["member1"].id), "value": 1},
                {"group_member_id": str(setup["member2"].id), "value": 1},
                {"group_member_id": str(setup["member3"].id), "value": 1},
            ],
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    total_split = sum(Decimal(s["resolved_amount"]) for s in update_resp.json()["splits"])
    assert total_split == Decimal("40.00")  # 100 - 60

    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("440.00")  # 500 - 60


# ---- Delete Tests ----

@pytest.mark.asyncio
async def test_delete_expense_restores_fund_balances(
    client: AsyncClient, auth_headers: dict, expense_fund_setup: dict,
):
    """Deleting an expense with fund deductions restores fund balances."""
    setup = expense_fund_setup
    payload = _expense_payload(setup, fund_deductions=[
        {"fund_id": str(setup["fund_a"].id), "amount": "30.00"},
        {"fund_id": str(setup["fund_b"].id), "amount": "20.00"},
    ])
    create_resp = await client.post(
        f"/api/v1/groups/{setup['group'].id}/expenses",
        json=payload, headers=auth_headers,
    )
    expense_id = create_resp.json()["id"]

    # Delete
    del_resp = await client.delete(
        f"/api/v1/groups/{setup['group'].id}/expenses/{expense_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 200

    # Both fund balances should be restored
    fa_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_a'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fa_resp.json()["balance"])) == Decimal("500.00")

    fb_resp = await client.get(
        f"/api/v1/groups/{setup['group'].id}/funds/{setup['fund_b'].id}",
        headers=auth_headers,
    )
    assert Decimal(str(fb_resp.json()["balance"])) == Decimal("300.00")
```

- [ ] **Step 2: Run the tests to verify they fail (models/schemas exist but API logic not yet wired)**

```bash
cd backend
source venv/bin/activate
pytest tests/test_expense_fund_deductions.py -v
```

Expected: Tests should run but some may fail depending on task ordering. If running after Tasks 1-6, they should pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_expense_fund_deductions.py
git commit -m "test: add integration tests for multi-fund expense deductions"
```

---

### Task 8: Update Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Update TypeScript types**

In `frontend/src/types/index.ts`:

Add new interfaces after `ExpenseSplit`:
```typescript
export interface FundDeductionInput {
  fund_id: string;
  amount: number;
}

export interface FundDeductionRead {
  id: string;
  fund_id: string;
  fund_name: string;
  amount: number;
}
```

In the `Expense` interface, replace:
```typescript
  fund_id: string | null;
  fund_name: string | null;
```
with:
```typescript
  fund_deductions: FundDeductionRead[];
```

In `ExpenseCreate`, replace:
```typescript
  fund_id?: string | null;
```
with:
```typescript
  fund_deductions?: FundDeductionInput[];
```

In `ExpenseUpdate`, replace:
```typescript
  fund_id?: string | null;
```
with:
```typescript
  fund_deductions?: FundDeductionInput[];
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: update TypeScript types for multi-fund deductions"
```

---

### Task 9: Update AddExpense Page

**Files:**
- Modify: `frontend/src/pages/AddExpense.tsx`

- [ ] **Step 1: Replace fund state and add fund deduction UI**

In `frontend/src/pages/AddExpense.tsx`:

Replace:
```typescript
  const [selectedFundId, setSelectedFundId] = useState<string>("");
```
with:
```typescript
  const [fundDeductions, setFundDeductions] = useState<Array<{ fundId: string; amount: string }>>([]);
```

Add helper functions after the state declarations:
```typescript
  function addFundDeduction() {
    setFundDeductions((prev) => [...prev, { fundId: "", amount: "" }]);
  }

  function removeFundDeduction(index: number) {
    setFundDeductions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFundDeduction(index: number, field: "fundId" | "amount", value: string) {
    setFundDeductions((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d))
    );
  }

  const totalFundDeductions = fundDeductions.reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0), 0
  );

  const splittableAmount = Math.max(0, (parseFloat(amount) || 0) - totalFundDeductions);
```

- [ ] **Step 2: Update buildSplits to use splittable amount for exact split validation**

In `buildSplits()`, change the exact split validation from:
```typescript
      const amtNum = parseFloat(amount);
      if (Math.abs(total - amtNum) > 0.01) {
        window.alert(`Exact amounts must sum to ${amount}. Currently: ${formatAmount(total, group?.currency_code)}`);
```
to:
```typescript
      if (Math.abs(total - splittableAmount) > 0.01) {
        window.alert(`Exact amounts must sum to ${formatAmount(splittableAmount, group?.currency_code)}. Currently: ${formatAmount(total, group?.currency_code)}`);
```

- [ ] **Step 3: Update handleSubmit to send fund_deductions**

In `handleSubmit`, replace:
```typescript
        fund_id: selectedFundId || null,
```
with:
```typescript
        fund_deductions: fundDeductions
          .filter((d) => d.fundId && parseFloat(d.amount) > 0)
          .map((d) => ({ fund_id: d.fundId, amount: parseFloat(d.amount) })),
```

- [ ] **Step 4: Replace the fund selector UI section**

Replace the entire Fund Selector block (lines 353-375) with:

```tsx
        {/* Fund Deductions */}
        {funds.length > 0 && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Pay from funds</h2>
              <button
                type="button"
                onClick={addFundDeduction}
                disabled={fundDeductions.length >= funds.length}
                className="text-xs font-semibold text-primary hover:text-primary-dim disabled:opacity-40 transition-colors"
              >
                + Add fund
              </button>
            </div>

            {fundDeductions.length === 0 && (
              <p className="text-xs text-outline">No fund deductions — full amount will be split among members.</p>
            )}

            {fundDeductions.map((d, i) => {
              const selectedIds = fundDeductions.map((dd) => dd.fundId).filter((id) => id && id !== d.fundId);
              const availableFunds = funds.filter((f) => !selectedIds.includes(f.id));
              const selectedFund = funds.find((f) => f.id === d.fundId);
              const deductionExceedsBalance = selectedFund && parseFloat(d.amount) > selectedFund.balance;

              return (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <select
                      value={d.fundId}
                      onChange={(e) => updateFundDeduction(i, "fundId", e.target.value)}
                      className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
                    >
                      <option value="">Select fund...</option>
                      {availableFunds.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} (bal: {formatCurrency(f.balance, group?.currency_code || "VND")})
                        </option>
                      ))}
                    </select>
                    <MoneyInput
                      value={d.amount}
                      onChange={(v) => updateFundDeduction(i, "amount", v)}
                      placeholder="Amount from fund"
                    />
                    {deductionExceedsBalance && (
                      <p className="text-xs text-error">
                        Exceeds fund balance ({formatCurrency(selectedFund.balance, group?.currency_code || "VND")})
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFundDeduction(i)}
                    className="mt-2 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-error hover:bg-error-container/10 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}

            {fundDeductions.length > 0 && amount && (
              <div className="pt-2 border-t border-outline-variant/10">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Total from funds:</span>
                  <span className="font-semibold text-on-surface">
                    {formatCurrency(totalFundDeductions, group?.currency_code || "VND")}
                  </span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-on-surface-variant">Amount to split:</span>
                  <span className={cn("font-semibold", splittableAmount < 0 ? "text-error" : "text-on-surface")}>
                    {formatCurrency(splittableAmount, group?.currency_code || "VND")}
                  </span>
                </div>
                {totalFundDeductions > (parseFloat(amount) || 0) && (
                  <p className="text-xs text-error mt-1">Total fund deductions exceed expense amount!</p>
                )}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AddExpense.tsx
git commit -m "feat: multi-fund deduction UI in AddExpense page"
```

---

### Task 10: Update EditExpense Page

**Files:**
- Modify: `frontend/src/pages/EditExpense.tsx`

- [ ] **Step 1: Replace fund state with fund deductions**

In `frontend/src/pages/EditExpense.tsx`:

Replace:
```typescript
  const [selectedFundId, setSelectedFundId] = useState<string>("");
```
with:
```typescript
  const [fundDeductions, setFundDeductions] = useState<Array<{ fundId: string; amount: string }>>([]);
```

Add the same helper functions as in AddExpense (after state declarations):
```typescript
  function addFundDeduction() {
    setFundDeductions((prev) => [...prev, { fundId: "", amount: "" }]);
  }

  function removeFundDeduction(index: number) {
    setFundDeductions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFundDeduction(index: number, field: "fundId" | "amount", value: string) {
    setFundDeductions((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d))
    );
  }

  const totalFundDeductions = fundDeductions.reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0), 0
  );

  const splittableAmount = Math.max(0, (parseFloat(amount) || 0) - totalFundDeductions);
```

- [ ] **Step 2: Update the pre-fill logic in useEffect**

Replace:
```typescript
        setSelectedFundId(exp.fund_id || "");
```
with:
```typescript
        setFundDeductions(
          (exp.fund_deductions || []).map((d) => ({
            fundId: d.fund_id,
            amount: String(d.amount),
          }))
        );
```

- [ ] **Step 3: Update buildSplits exact validation**

Same change as AddExpense — replace `parseFloat(amount)` with `splittableAmount` in the exact split validation.

- [ ] **Step 4: Update handleSubmit**

Replace:
```typescript
        fund_id: selectedFundId || null,
```
with:
```typescript
        fund_deductions: fundDeductions
          .filter((d) => d.fundId && parseFloat(d.amount) > 0)
          .map((d) => ({ fund_id: d.fundId, amount: parseFloat(d.amount) })),
```

- [ ] **Step 5: Replace the Fund Selector UI block**

Use the exact same fund deductions UI block from Task 9 Step 4 (copy the JSX). The only difference: `X` import — ensure `X` is imported from lucide-react in EditExpense (add to the existing import if not present).

Add `X` to the lucide-react import:
```typescript
import { ArrowLeft, ImagePlus, Trash2, Loader2, X } from "lucide-react";
```

Also ensure `cn`, `formatCurrency`, and `MoneyInput` are imported (they may not be in EditExpense yet):
```typescript
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/utils/currency";
import MoneyInput from "@/components/MoneyInput";
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EditExpense.tsx
git commit -m "feat: multi-fund deduction UI in EditExpense page"
```

---

### Task 11: Update GroupView Fund Display

**Files:**
- Modify: `frontend/src/pages/GroupView.tsx:614-618`

- [ ] **Step 1: Update the fund badge display**

In `frontend/src/pages/GroupView.tsx`, replace:
```tsx
                              {expense.fund_name && (
                                <span className="ml-1.5 text-[10px] bg-primary-container/30 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                  {expense.fund_name}
                                </span>
                              )}
```
with:
```tsx
                              {expense.fund_deductions?.length > 0 && expense.fund_deductions.map((d) => (
                                <span key={d.id} className="ml-1.5 text-[10px] bg-primary-container/30 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                  {d.fund_name}
                                </span>
                              ))}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/GroupView.tsx
git commit -m "feat: display multiple fund badges on expense rows"
```

---

### Task 12: Run All Tests and Verify

- [ ] **Step 1: Run backend tests**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: All tests pass, including the new `test_expense_fund_deductions.py` and existing `test_funds.py`.

- [ ] **Step 2: Run frontend lint**

```bash
cd frontend
npm run lint
```

Expected: No lint errors.

- [ ] **Step 3: Run frontend build**

```bash
npm run build
```

Expected: Build succeeds without type errors.

- [ ] **Step 4: Fix any failures, then commit fixes**

If any tests fail or lint/build errors exist, fix and commit:
```bash
git add -A
git commit -m "fix: resolve test/lint issues from multi-fund deductions"
```
