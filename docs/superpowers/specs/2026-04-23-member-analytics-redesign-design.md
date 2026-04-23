# Member Analytics Redesign

**Date:** 2026-04-23
**Status:** Approved
**Scope:** Frontend (`MemberAnalytics.tsx`) + backend (`/groups/{id}/reports/member/{member_id}`)

## Motivation

The current Member Analytics page surfaces information that isn't useful for answering the questions members actually ask:

- "What is my balance, and what went into it?"
- "What am I spending on?"
- "Which transactions have changed my balance?"
- "Which expenses did I pay for?"

Today the page shows "Total Paid", "Monthly Avg", "Spending by Category" (categories of expenses the member *paid for*, not the ones they're split into), a "Top Expenses Paid" list, and a merged Activity History that shows each expense twice (once as `+paid`, once as `-owed`). This is noisy and answers the wrong questions.

## Design

### Page structure

Top to bottom:

1. **Profile header** — avatar, name, role. Unchanged.
2. **Balance card** — the member's current balance, with a short breakdown.
3. **Category of expense** — donut chart of the categories the member is *split into*.
4. **Transactions** — one section with two tabs.

Everything else on the page today is removed: Total Paid stat, Monthly Avg, Top Expenses Paid list, and the old merged Activity History. Both mobile and desktop layouts follow this same structure.

### Card 1 — Balance

Prominent card. The main number is `net_balance` (already computed by `_compute_balances` = `initial_balance + paid − owed + settlements`).

Beneath it, a 3-line breakdown so the number is self-explanatory:

```
Initial balance        +50.00
Expenses (paid − owed) -12.50
Transfers               +0.00
─────────────────────────────
Net                    +37.50
```

- Lines are always shown in this fixed order for layout stability.
- Zero-value lines are hidden *except* when all three components are zero, in which case we show "Initial balance 0.00" alone so the card isn't empty.
- Colors: positive green (`text-primary`), negative red (`text-error`), zero neutral.

### Card 2 — Category of expense

Donut + legend. Same visual component as today (reuse `DonutChart`). Data changes:

- Source: `owed_by_category` (already returned by the endpoint; currently unused on the page).
- Each slice = the member's *owed share* per category, not the full expense amount.
- Transfers/settlements have no category and are not counted.
- Empty state: show "No expenses yet" if `owed_by_category` is empty.

Label changes from "Spending by Category" → "Category of expense".

### Transactions — 2 tabs

Tab state is local (no URL sync). Tab 1 is the default.

#### Tab 1 — "Affecting balance"

Every transaction that moved this member's balance, sorted by date desc, one row per transaction.

- **Expenses:** included if the member is the payer OR has a split. Amount displayed = the member's **net effect**: `(paid_amount if member is payer else 0) − owed_share`. Example: on a $30 dinner Alice paid where she also owes $10, the row shows `+$20`. On a $30 dinner Bob paid where Alice owes $10, Alice's row shows `-$10`.
- **Settlements (both `transfer` and `settle_up`):** included if the member is `from_member` or `to_member`. Amount displayed: `+amount` for `from_member` (they paid debt down → balance increased), `-amount` for `to_member` (they received money → balance decreased).
- Sign conventions match `_compute_balances` so users can reconcile the list against the balance card.
- Row shows: icon (category icon for expenses, a transfer glyph for settlements), description, category/kind label, date, signed amount.
- Cap: ~100 rows (pagination can be added later if needed).

#### Tab 2 — "Paid by this member"

Expenses where the member is the payer, amount = full expense amount. Transfers excluded.

This is the existing `recent_paid` data — just relocated into a tab. Same row layout as today's "Top Expenses Paid".

## Backend changes

`GET /groups/{group_id}/reports/member/{member_id}` gains one field and drops one:

### Add: `balance_activity`

```json
{
  "balance_activity": [
    {
      "id": "<expense or settlement uuid>",
      "kind": "expense" | "transfer" | "settle_up",
      "description": "Dinner at Luigi's",
      "category_name": "Food" | null,
      "category_icon": "🍝" | null,
      "net_effect": -12.50,
      "date": "2026-04-20T19:30:00Z"
    }
  ]
}
```

- Computed server-side in `report_member_detail` so the client doesn't duplicate balance math.
- `category_name` / `category_icon` are `null` for settlements.
- `kind == "expense"` for all expense rows regardless of role (payer/split). A synthetic combined-role signal isn't needed — the sign of `net_effect` carries it.
- Query: one pass over `paid_expenses`, one pass over `owed_splits` (already loaded), one new fetch of settlements where `from_member == member_id OR to_member == member_id`. Merge into a single list and sort by date desc. Cap at 100.
- A single expense row where the member is both payer and in the split must appear **once** with the combined net effect, not twice.

### Remove: `paid_by_category`

No card uses it anymore. Dropping it reduces the response size and avoids confusion.

### Keep unchanged

`owed_by_category`, `recent_paid`, `recent_owed`, `total_paid`, `total_owed`, `initial_balance`, `net_balance`, `member_name`, `currency_code`.

The frontend no longer uses `total_owed` or `recent_owed`, but they're harmless to keep for API stability and potential other callers. We can prune them in a follow-up once we're sure.

## Frontend changes

- `frontend/src/pages/MemberAnalytics.tsx` — rewrite both the mobile and desktop sections per this spec. Drop `paid_by_category` references, drop the `allActivity` merge logic, drop "Top Expenses Paid" and "Monthly Avg".
- New types for `balance_activity` entries.
- New `Tabs` component local to the page (two buttons + panels) — no need to add a shared tabs component unless other pages need it.
- `frontend/src/i18n/locales/{en,vi}/reports.json` — new keys:
  - `balance_breakdown_initial`, `balance_breakdown_expenses`, `balance_breakdown_transfers`, `balance_breakdown_net`
  - `category_of_expense` (replaces `spending_by_category`/`category_spending`)
  - `tab_affecting_balance`, `tab_paid_by_member`
  - `no_expenses_yet`, `no_transactions`
  - Obsolete keys to remove after verifying no other page uses them: `total_paid`, `monthly_avg`, `top_expenses_paid`, `no_expenses_paid`, `across_all_expenses`, `per_month`, `activity_history`, `paid`, `owed`

## Testing

No backend unit tests today cover `report_member_detail`. I'll add a lightweight one that verifies `balance_activity` sums to `net_balance − initial_balance` for a group with expenses and settlements — that's the invariant that catches sign-convention bugs.

Frontend is manually verified in dev (no component tests exist for analytics pages today).

## Out of scope

- Pagination of `balance_activity` beyond the 100-row cap.
- Currency conversion controls on this page (we display group currency only, same as today).
- Editing transactions from this page.
- A "Transfers only" tab — deferred until someone asks.
