"""Group analytics backed by D1 and the authoritative Decimal ledger."""

from collections import defaultdict
from decimal import Decimal
import uuid

from fastapi import APIRouter, Depends

from chia_api.common import Context, auth_context, get_group, require_member
from chia_api.db import Command
from shared.balances import calculate_balances, settlement_balance_effect


router = APIRouter(prefix="/api/v1", tags=["reports"])
ZERO = Decimal("0")
CENT = Decimal("0.01")
BALANCE_ACTIVITY_LIMIT = 100


def _money(value: Decimal) -> float:
    return float(value.quantize(CENT))


async def _report_data(db, group_id: str):
    specifications = [
        ("expenses", "SELECT * FROM expenses WHERE group_id=? ORDER BY date DESC"),
        ("group_members", "SELECT * FROM group_members WHERE group_id=? AND is_active=1"),
        ("categories", "SELECT * FROM categories", ()),
        ("expense_splits", "SELECT s.* FROM expense_splits s JOIN expenses e ON e.id=s.expense_id WHERE e.group_id=?"),
        ("expense_fund_deductions", "SELECT d.* FROM expense_fund_deductions d JOIN expenses e ON e.id=d.expense_id WHERE e.group_id=?"),
        ("settlements", "SELECT * FROM settlements WHERE group_id=?"),
    ]
    commands = [Command(item[1], item[2] if len(item) == 3 else (group_id,)) for item in specifications]
    results = await db.batch(commands)
    return tuple(
        [db.decode(item[0], row) for row in result["results"]]
        for item, result in zip(specifications, results, strict=True)
    )


@router.get("/groups/{group_id}/reports/summary")
async def report_summary(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    group_key = str(group_id)
    group = await get_group(ctx.db, group_key)
    await require_member(ctx, group_key)
    expenses, member_rows, category_rows, splits, deductions, settlements = await _report_data(ctx.db, group_key)
    members = {row["id"]: row for row in member_rows}
    categories = {row["id"]: row for row in category_rows}
    deduction_by_expense = defaultdict(Decimal)
    for row in deductions:
        deduction_by_expense[row["expense_id"]] += row["amount"]

    paid = defaultdict(Decimal)
    owed = defaultdict(Decimal)
    counts = defaultdict(int)
    for expense in expenses:
        if expense["paid_by"] in members:
            paid[expense["paid_by"]] += expense["converted_amount"] - deduction_by_expense[expense["id"]]
            counts[expense["paid_by"]] += 1
    for split in splits:
        if split["group_member_id"] in members:
            owed[split["group_member_id"]] += split["resolved_amount"]
    ledger = calculate_balances(member_rows, expenses, splits, deductions, settlements)
    per_member = [{
        "member_id": member_id,
        "member_name": member["display_name"],
        "total_paid": _money(paid[member_id]),
        "total_owed": _money(owed[member_id]),
        "initial_balance": _money(member["initial_balance"]),
        "net_balance": _money(ledger.get(member_id, ZERO)),
        "expense_count": counts[member_id],
    } for member_id, member in members.items()]
    per_member.sort(key=lambda item: item["total_paid"], reverse=True)

    total = sum((row["converted_amount"] for row in expenses), ZERO)
    category_totals = defaultdict(Decimal)
    category_counts = defaultdict(int)
    for expense in expenses:
        category_totals[expense["category_id"]] += expense["converted_amount"]
        category_counts[expense["category_id"]] += 1
    per_category = []
    for category_id, amount in category_totals.items():
        category = categories.get(category_id)
        per_category.append({
            "category_id": category_id,
            "category_name": category["name"] if category else "Unknown",
            "category_icon": category["icon"] if category else "📦",
            "total_amount": _money(amount),
            "expense_count": category_counts[category_id],
            "percentage": float((amount / total * 100).quantize(Decimal("0.1"))) if total > 0 else 0,
        })
    per_category.sort(key=lambda item: item["total_amount"], reverse=True)
    return {"currency_code": group["currency_code"], "total_spent": _money(total),
            "expense_count": len(expenses), "per_member": per_member, "per_category": per_category}


@router.get("/groups/{group_id}/reports/member/{member_id}")
async def report_member_detail(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    ctx: Context = Depends(auth_context),
):
    group_key, member_key = str(group_id), str(member_id)
    group = await get_group(ctx.db, group_key)
    await require_member(ctx, group_key)
    member = await ctx.db.one("group_members", "id = ? AND group_id = ?", (member_key, group_key))
    if member is None:
        return {"detail": "Member not found"}
    expenses, member_rows, category_rows, splits, deductions, settlements = await _report_data(ctx.db, group_key)
    categories = {row["id"]: row for row in category_rows}
    paid_expenses = [row for row in expenses if row["paid_by"] == member_key]
    expenses_by_id = {row["id"]: row for row in expenses}
    owed_pairs = [(split, expenses_by_id[split["expense_id"]]) for split in splits
                  if split["group_member_id"] == member_key]
    member_settlements = [row for row in settlements
                          if row["from_member"] == member_key or row["to_member"] == member_key]
    deduction_by_expense = defaultdict(Decimal)
    for row in deductions:
        deduction_by_expense[row["expense_id"]] += row["amount"]

    owed_by_category = defaultdict(Decimal)
    for split, expense in owed_pairs:
        owed_by_category[expense["category_id"]] += split["resolved_amount"]
    owed_categories = [{
        "category_name": categories.get(cid, {}).get("name", "Unknown"),
        "category_icon": categories.get(cid, {}).get("icon", "📦"),
        "total_amount": _money(amount),
    } for cid, amount in owed_by_category.items()]
    owed_categories.sort(key=lambda item: item["total_amount"], reverse=True)

    def category(expense):
        return categories.get(expense["category_id"], {"name": "Unknown", "icon": "📦"})

    recent_paid = [{"id": row["id"], "description": row["description"],
                    "amount": float(row["converted_amount"]), "currency_code": group["currency_code"],
                    "original_amount": float(row["amount"]), "original_currency": row["currency_code"],
                    "category_name": category(row)["name"], "category_icon": category(row)["icon"],
                    "date": row["date"]} for row in paid_expenses[:50]]
    recent_owed = [{"id": expense["id"], "description": expense["description"],
                    "owed_amount": float(split["resolved_amount"]),
                    "total_amount": float(expense["converted_amount"]),
                    "currency_code": group["currency_code"],
                    "category_name": category(expense)["name"], "category_icon": category(expense)["icon"],
                    "date": expense["date"]} for split, expense in owed_pairs[:50]]

    owed_share = defaultdict(Decimal)
    for split, _ in owed_pairs:
        owed_share[split["expense_id"]] += split["resolved_amount"]
    involved = {row["id"]: row for row in paid_expenses}
    involved.update({expense["id"]: expense for _, expense in owed_pairs})
    paid_ids = {row["id"] for row in paid_expenses}
    activity = []
    for expense_id, expense in involved.items():
        effect = ZERO
        if expense_id in paid_ids:
            effect += expense["converted_amount"] - deduction_by_expense[expense_id]
        effect -= owed_share.get(expense_id, ZERO)
        activity.append((expense["date"], {"id": expense_id, "kind": "expense",
            "description": expense["description"], "category_name": category(expense)["name"],
            "category_icon": category(expense)["icon"], "net_effect": _money(effect),
            "date": expense["date"]}))
    for settlement in member_settlements:
        sender, recipient = settlement_balance_effect(settlement["type"], settlement["amount"])
        effect = sender if settlement["from_member"] == member_key else recipient
        activity.append((settlement["settled_at"], {"id": settlement["id"],
            "kind": settlement["type"] or "settle_up", "description": settlement["description"] or "",
            "category_name": None, "category_icon": None, "net_effect": _money(effect),
            "date": settlement["settled_at"]}))
    activity.sort(key=lambda item: item[0], reverse=True)
    ledger = calculate_balances(member_rows, expenses, splits, deductions, settlements)
    total_paid = sum((row["converted_amount"] - deduction_by_expense[row["id"]]
                      for row in paid_expenses), ZERO)
    total_owed = sum((split["resolved_amount"] for split, _ in owed_pairs), ZERO)
    return {"member_id": member_key, "member_name": member["display_name"],
            "currency_code": group["currency_code"], "total_paid": _money(total_paid),
            "total_owed": _money(total_owed), "initial_balance": _money(member["initial_balance"]),
            "net_balance": _money(ledger.get(member_key, ZERO)), "owed_by_category": owed_categories,
            "recent_paid": recent_paid, "recent_owed": recent_owed,
            "balance_activity": [item for _, item in activity[:BALANCE_ACTIVITY_LIMIT]]}
