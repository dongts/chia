import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Expense, ExpenseLog, ExpenseSplit
from app.models.expense_fund_deduction import ExpenseFundDeduction

TRACKED_FIELDS = (
    "description",
    "amount",
    "currency_code",
    "exchange_rate",
    "converted_amount",
    "date",
    "paid_by",
    "category_id",
    "receipt_url",
)


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def snapshot_expense(expense: Expense) -> dict[str, Any]:
    """Capture a dict snapshot of an expense for later diffing."""
    snap = {f: _jsonable(getattr(expense, f)) for f in TRACKED_FIELDS}
    snap["splits"] = sorted(
        [
            {
                "member_id": str(s.group_member_id),
                "split_type": s.split_type.value if s.split_type else None,
                "value": _jsonable(s.value),
                "resolved_amount": _jsonable(s.resolved_amount),
            }
            for s in (expense.splits or [])
        ],
        key=lambda s: s["member_id"],
    )
    snap["fund_deductions"] = sorted(
        [
            {"fund_id": str(d.fund_id), "amount": _jsonable(d.amount)}
            for d in (expense.fund_deductions or [])
        ],
        key=lambda d: d["fund_id"],
    )
    return snap


def diff_snapshots(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    for key in set(before.keys()) | set(after.keys()):
        b, a = before.get(key), after.get(key)
        if b != a:
            changes[key] = {"from": b, "to": a}
    return changes


def add_log(
    db: AsyncSession,
    *,
    expense_id: uuid.UUID,
    group_id: uuid.UUID,
    actor_member_id: uuid.UUID | None,
    action: str,
    changes: dict[str, Any] | None = None,
) -> ExpenseLog:
    log = ExpenseLog(
        expense_id=expense_id,
        group_id=group_id,
        actor_member_id=actor_member_id,
        action=action,
        changes=changes or None,
    )
    db.add(log)
    return log
