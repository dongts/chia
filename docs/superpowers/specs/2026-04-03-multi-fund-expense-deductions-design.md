# Multi-Fund Partial Expense Deductions

**Date:** 2026-04-03
**Status:** Approved

## Problem

Currently, an expense can link to at most one fund, and the entire converted amount is deducted from that fund. Users need to:
- Deduct a partial amount from a fund (not necessarily the full expense)
- Deduct from multiple funds on a single expense
- Have the fund deductions reduce the amount split among members

## Design Decisions

- **Fund reduces total before splitting (Option A):** `splittable_amount = converted_amount - sum(fund_deductions)`. Members split only the remainder.
- **Hard block on overdraft:** A deduction cannot exceed the fund's current balance.
- **Funds can cover 100%:** If fund deductions equal the full expense, splits resolve to 0 for all members.

## Data Model

### New table: `expense_fund_deductions`

| Column     | Type           | Constraints                          |
|------------|----------------|--------------------------------------|
| id         | UUID PK        | default uuid4                        |
| expense_id | UUID FK        | → expenses.id, ON DELETE CASCADE     |
| fund_id    | UUID FK        | → funds.id, ON DELETE CASCADE        |
| amount     | Numeric(12,2)  | > 0, in group's main currency        |
| created_by | UUID FK        | → group_members.id                   |
| created_at | DateTime(tz)   | server_default now()                 |

- Unique constraint: `(expense_id, fund_id)` — one deduction per fund per expense.

### Changes to existing tables

- **Expense:** Remove `fund_id` column. Add `fund_deductions` relationship to new table.
- **FundTransaction:** Drop `unique=True` on `expense_id` — one expense can have multiple fund transactions. Add `deduction_id` FK to `expense_fund_deductions.id` for precise linkage.

### FundTransaction linkage

Each `ExpenseFundDeduction` row creates a corresponding `FundTransaction(type=expense)` with:
- `fund_id` = deduction's fund
- `amount` = deduction's amount
- `expense_id` = the expense
- `deduction_id` = the deduction row's id
- `member_id` = expense's `paid_by`
- `note` = expense description

## API Schema

### Request

```python
class FundDeductionInput(BaseModel):
    fund_id: uuid.UUID
    amount: Decimal  # must be > 0

class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    currency_code: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    date: DateType
    paid_by: uuid.UUID
    category_id: uuid.UUID
    fund_deductions: list[FundDeductionInput] = []  # replaces fund_id
    split_type: SplitType
    splits: list[SplitInput]

class ExpenseUpdate(BaseModel):
    # ... existing optional fields ...
    fund_deductions: Optional[list[FundDeductionInput]] = None  # replaces fund_id
```

### Response

```python
class FundDeductionRead(BaseModel):
    id: uuid.UUID
    fund_id: uuid.UUID
    fund_name: str
    amount: Decimal

class ExpenseRead(BaseModel):
    # ... existing fields ...
    fund_deductions: list[FundDeductionRead] = []  # replaces fund_id/fund_name
```

## Validation Rules

On create and update:

1. Each `fund_id` must exist, be active, and belong to the same group
2. No duplicate `fund_id` entries in the list
3. Each deduction `amount > 0`
4. `sum(deduction amounts) <= converted_amount`
5. Each deduction amount must not exceed that fund's current balance (hard block)
   - On update: balance check accounts for the existing deduction being replaced (add back old amount before checking)

## Split Calculation

```
splittable_amount = converted_amount - sum(fund_deduction_amounts)
```

- Splits are calculated against `splittable_amount`
- If `splittable_amount == 0`: splits are still created with `resolved_amount = 0`
- For `exact` split type: frontend and backend validate sum against `splittable_amount`
- For `equal` split type: each member's share = `splittable_amount / num_selected_members`
- For `percentage` split type: percentages still sum to 100, applied to `splittable_amount`
- For `shares` split type: shares applied to `splittable_amount`

## Create Flow

1. Validate group, member, currency, exchange rate (existing)
2. Compute `converted_amount`
3. Validate fund deductions (existence, active, same group, no duplicates, amounts > 0, sum <= converted_amount, each <= fund balance)
4. Compute `splittable_amount = converted_amount - sum(deductions)`
5. Calculate splits against `splittable_amount`
6. Insert `Expense` row (no `fund_id`)
7. Insert `ExpenseFundDeduction` rows
8. Insert `FundTransaction` rows (one per deduction)
9. Insert `ExpenseSplit` rows
10. Notify, commit, reload with relationships

## Update Flow

1. Load expense with existing deductions
2. If `fund_deductions` provided in update:
   a. For each old deduction not in new list: delete deduction + its FundTransaction
   b. For each new deduction: validate fund, check balance (add back old deduction amount if same fund), create deduction + FundTransaction
   c. For changed amounts on same fund: update deduction amount + FundTransaction amount
3. Recalculate `splittable_amount` and re-resolve splits if deductions or amount changed

## Delete Flow

1. Delete expense (CASCADE deletes `expense_fund_deductions` and `expense_splits`)
2. Delete linked `FundTransaction` rows (by `expense_id`)

## Frontend Changes

### AddExpense.tsx / EditExpense.tsx

Replace the single fund dropdown with a repeatable "fund deduction" section:

- State: `fundDeductions: Array<{fundId: string, amount: string}>`
- "+ Add fund" button to append a new row
- Each row: fund dropdown (filtered to exclude already-selected funds) + amount input + remove button
- Fund dropdown shows fund name and current balance
- Real-time validation:
  - Total deductions <= expense amount (show remaining)
  - Individual deduction <= fund balance (show error if exceeded)
- Display "Amount to split: X" showing `amount - sum(deductions)` so users see what members will owe

### TypeScript types

```typescript
interface FundDeductionInput {
  fund_id: string;
  amount: number;
}

interface FundDeductionRead {
  id: string;
  fund_id: string;
  fund_name: string;
  amount: number;
}

interface ExpenseCreate {
  // ... existing fields ...
  fund_deductions: FundDeductionInput[];  // replaces fund_id
}

interface ExpenseRead {
  // ... existing fields ...
  fund_deductions: FundDeductionRead[];  // replaces fund_id/fund_name
}
```

## Migration

Alembic migration:

1. Create `expense_fund_deductions` table
2. Add `deduction_id` column to `fund_transactions` (nullable FK)
3. Drop `unique=True` on `fund_transactions.expense_id`
4. Migrate existing data: for each expense with `fund_id`, create a deduction row + update the existing FundTransaction with the deduction_id
5. Drop `fund_id` from `expenses` table

## Test Coverage

### Backend unit tests

1. **Create expense with no fund deductions** — splits use full converted_amount
2. **Create expense with single fund deduction** — splittable_amount reduced, splits correct
3. **Create expense with multiple fund deductions** — splittable_amount = converted_amount - sum
4. **Fund covers 100%** — all splits resolve to 0
5. **Deduction exceeds fund balance** — returns 400
6. **Deduction sum exceeds expense amount** — returns 400
7. **Duplicate fund_id in deductions** — returns 400
8. **Inactive fund** — returns 400
9. **Fund from different group** — returns 400
10. **Update: add deductions to expense without** — fund balance decreases
11. **Update: remove deductions** — fund balance restored
12. **Update: change deduction amount** — balance adjusted correctly
13. **Delete expense with deductions** — fund balances restored
14. **Split types with fund deductions** — equal, exact, percentage, shares all calculate against splittable_amount
15. **Currency conversion + fund deduction** — deduction is in converted (group) currency, math is correct
