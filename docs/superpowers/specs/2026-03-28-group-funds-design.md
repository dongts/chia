# Group Funds (Quỹ cho nhóm)

## Overview

Group funds allow members to pool money for shared purposes — penalty jars, equipment purchases, party budgets, travel pools. Each group can have multiple funds, each managed by a designated holder (thủ quỹ). Funds are completely separate from the existing personal balance/debt system.

**Use cases:**
- Tennis club: losers donate to a penalty fund, money used later for balls or parties
- Travel group: everyone contributes to a shared pool for trip expenses

## Data Model

### Fund

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| group_id | FK → Group | |
| name | String(200) | e.g. "Quỹ tiền phạt" |
| description | Text, nullable | |
| holder_id | FK → GroupMember | Current fund holder |
| created_by | FK → GroupMember | |
| is_active | Boolean, default True | False = closed fund |
| created_at | DateTime(tz) | |
| updated_at | DateTime(tz) | |

### FundTransaction

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| fund_id | FK → Fund | |
| type | Enum: contribute, withdraw, expense, holder_change | |
| amount | Decimal(12,2) | Always positive. 0 for holder_change. |
| member_id | FK → GroupMember | Who contributed/withdrew, or new holder for holder_change |
| expense_id | FK → Expense, nullable, unique | Only when type=expense |
| note | String(500), nullable | |
| created_by | FK → GroupMember | Who recorded this transaction |
| created_at | DateTime(tz) | |

**Fund balance** = SUM(contribute) - SUM(withdraw) - SUM(expense)

### Expense table change

Add one nullable field:

| Field | Type | Notes |
|-------|------|-------|
| fund_id | FK → Fund, nullable | Set when expense is paid from a fund |

## API Endpoints

### Fund CRUD

```
POST   /groups/{group_id}/funds              — Create fund
GET    /groups/{group_id}/funds              — List funds (with computed balance)
GET    /groups/{group_id}/funds/{fund_id}    — Fund detail (balance, holder, contribution summary per member)
PATCH  /groups/{group_id}/funds/{fund_id}    — Update name/description/holder
DELETE /groups/{group_id}/funds/{fund_id}    — Close fund (set is_active=False)
```

### Fund Transactions

```
POST   /groups/{group_id}/funds/{fund_id}/transactions           — Create transaction (contribute/withdraw)
GET    /groups/{group_id}/funds/{fund_id}/transactions           — List transactions (paginated)
DELETE /groups/{group_id}/funds/{fund_id}/transactions/{tx_id}   — Delete transaction (correction)
```

### Expense integration

Existing expense endpoints accept an optional `fund_id`:

```
POST /groups/{group_id}/expenses  { ..., fund_id: "xxx" }
```

- Backend creates the expense AND a FundTransaction (type=expense) linking to it
- Deleting an expense with a fund_id cascades to delete the linked FundTransaction
- Updating an expense's fund_id updates/creates/deletes the linked FundTransaction accordingly

### Holder change

Changing the holder via `PATCH /groups/{group_id}/funds/{fund_id}` with a new `holder_id` creates a FundTransaction (type=holder_change, amount=0, member_id=new_holder).

## Permissions

- Any active group member can: create funds, contribute, withdraw, create fund-linked expenses, view fund details and transactions
- Any active group member can delete transactions they created
- Admin/owner can delete any transaction
- Admin/owner or current holder can change the holder
- Admin/owner can close/reopen a fund

## Frontend UI

### Tab visibility

The "Funds" tab in GroupView only appears when the group has at least one fund (active or closed). When no funds exist, the tab is hidden.

### Fund list view (Funds tab)

- Header with "Group Funds" title + "+ New Fund" button
- Card per fund showing: name, holder, transaction count, balance
- Closed funds displayed with reduced opacity and "Closed" badge
- Click a fund card to navigate to detail view

### Fund detail view

- Back link to fund list
- Header: fund name, description, balance (large), holder name
- Action buttons: Contribute, Withdraw, Edit
- Contribution summary: avatar + total contributed per member
- Transaction history: chronological list with type indicator (color-coded), amount, member, date, created_by

### Expense form integration

- When creating/editing an expense, add optional "Pay from fund" selector
- Only shows active funds in the dropdown
- Expense list shows a tag "From: [Fund name]" on fund-linked expenses

## Core Flows

### 1. Create fund
Member fills in name, description (optional), selects holder (defaults to self). Fund is created, Funds tab appears if first fund.

### 2. Contribute
Member records: amount, note (optional). Transaction created with type=contribute, member_id=contributor, created_by=recorder (can differ — recording on behalf).

### 3. Spend from fund via expense
Member creates expense normally, selects fund from dropdown. Backend creates expense + FundTransaction(type=expense, expense_id=expense.id). Expense list shows fund tag.

### 4. Withdraw (no expense)
For returning surplus, ad-hoc payouts. Transaction created with type=withdraw, member_id=recipient, note explains reason.

### 5. Delete transaction
For corrections (recorded wrong amount). Direct fund transactions can be deleted. Expense-linked transactions are deleted by deleting the expense.

### 6. Change holder
Admin/owner or current holder updates holder_id. System creates FundTransaction(type=holder_change, amount=0, member_id=new_holder) for audit trail.

### 7. Close fund
Admin/owner sets is_active=False. Fund shows as closed, no new transactions allowed. Can be reopened.

## Out of scope (future)

- Notifications on fund activity
- Fund reports/export
- Contribution targets/quotas
- Fund balance going negative prevention
- Currency support per fund (uses group currency)
