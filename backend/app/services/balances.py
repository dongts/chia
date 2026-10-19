import uuid
from collections import defaultdict
from decimal import Decimal

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

CENT = Decimal("0.01")

# Currencies with no minor unit — a balance below 1 of these is rounding dust,
# not a real debt (mirrors the frontend ZERO_DECIMAL_CURRENCIES list).
ZERO_DECIMAL_CURRENCIES = frozenset({
    "VND", "JPY", "KRW", "CLP", "ISK", "UGX", "GNF", "BIF", "DJF",
    "KMF", "MGA", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
})


def settlement_balance_effect(
    settlement_type: str, amount: Decimal
) -> tuple[Decimal, Decimal]:
    """Return (sender effect, recipient effect) for a ledger transfer."""
    if settlement_type == "gift":
        return -amount, amount
    return amount, -amount


def settled_threshold(currency_code: str) -> Decimal:
    """Smallest balance that still counts as owed in this currency.

    Equal-split division leaves sub-unit remainders (e.g. 0.02 VND). Those are
    un-payable dust, so anything below one minor unit must read as settled.
    """
    return Decimal("1") if currency_code.upper() in ZERO_DECIMAL_CURRENCIES else CENT


def calculate_balances(members, expenses, splits, deductions, settlements):
    """Authoritative ledger arithmetic for ORM objects or decoded storage rows.

    Inputs are group-scoped; amounts must already be Decimal. Keep this function
    independent of persistence so the Postgres and D1 APIs use identical rules.
    """
    def field(row, key):
        return row[key] if isinstance(row, dict) else getattr(row, key)

    active = {field(m, "id"): m for m in members if field(m, "is_active")}
    result = {mid: field(member, "initial_balance") for mid, member in active.items()}
    covered = defaultdict(Decimal)
    for deduction in deductions:
        covered[field(deduction, "expense_id")] += field(deduction, "amount")
    for expense in expenses:
        payer = field(expense, "paid_by")
        if payer in active:
            result[payer] += field(expense, "converted_amount") - covered[field(expense, "id")]
    for split in splits:
        member = field(split, "group_member_id")
        if member in active:
            result[member] -= field(split, "resolved_amount")
    for settlement in settlements:
        sender, recipient = settlement_balance_effect(field(settlement, "type"), field(settlement, "amount"))
        from_id, to_id = field(settlement, "from_member"), field(settlement, "to_member")
        if from_id in active:
            result[from_id] += sender
        if to_id in active:
            result[to_id] += recipient
    return result


async def compute_balances(db: "AsyncSession", group_id: uuid.UUID) -> dict[uuid.UUID, Decimal]:
    """Load the group ledger from Postgres and apply the shared Decimal rules."""
    from sqlalchemy import select
    from app.models import Expense, ExpenseSplit, GroupMember, Settlement
    from app.models.expense_fund_deduction import ExpenseFundDeduction

    members = (await db.execute(select(GroupMember).where(
        GroupMember.group_id == group_id, GroupMember.is_active.is_(True)
    ))).scalars().all()
    expenses = (await db.execute(select(Expense).where(Expense.group_id == group_id))).scalars().all()
    deductions = (await db.execute(select(ExpenseFundDeduction).join(
        Expense, Expense.id == ExpenseFundDeduction.expense_id
    ).where(Expense.group_id == group_id))).scalars().all()
    splits = (await db.execute(select(ExpenseSplit).join(
        Expense, Expense.id == ExpenseSplit.expense_id
    ).where(Expense.group_id == group_id))).scalars().all()
    settlements = (await db.execute(select(Settlement).where(Settlement.group_id == group_id))).scalars().all()
    return calculate_balances(members, expenses, splits, deductions, settlements)


def suggest_settlements_for_member(
    balances: dict[uuid.UUID, Decimal], member_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID, Decimal]]:
    """Minimal transfers (from, to, amount) that involve `member_id`.

    Runs the group-wide debt simplifier, then keeps only the transfers in which
    this member pays or receives — i.e. the payments that would bring them to a
    zero balance.
    """
    from .debt_simplifier import simplify_debts

    str_balances = {str(k): v.quantize(CENT) for k, v in balances.items()}
    transfers = simplify_debts(str_balances)
    return [
        (uuid.UUID(from_id), uuid.UUID(to_id), amount)
        for from_id, to_id, amount in transfers
        if uuid.UUID(from_id) == member_id or uuid.UUID(to_id) == member_id
    ]
