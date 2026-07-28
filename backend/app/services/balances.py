import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Expense, ExpenseSplit, GroupMember, Settlement
from app.models.expense_fund_deduction import ExpenseFundDeduction
from app.services.debt_simplifier import simplify_debts

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


async def compute_balances(db: AsyncSession, group_id: uuid.UUID) -> dict[uuid.UUID, Decimal]:
    """Net balance per active member in the group's main currency.

    Positive = the member is owed money (creditor); negative = the member owes
    (debtor). Only active members are included — deactivated members are removed
    from the ledger, which is exactly why a member must be settled to zero
    before they can be deactivated (see members.remove_member).
    """
    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
        )
    )
    members = {m.id: m for m in members_result.scalars().all()}
    balances: dict[uuid.UUID, Decimal] = defaultdict(Decimal)

    # Fund-covered portions of expenses: the payer fronted this money but is
    # reimbursed by the fund (a separate ledger), so it must NOT count toward
    # their split balance. Without this, a fund-paid expense double-credits the
    # payer.
    deductions_result = await db.execute(
        select(ExpenseFundDeduction.expense_id, func.sum(ExpenseFundDeduction.amount))
        .join(Expense, Expense.id == ExpenseFundDeduction.expense_id)
        .where(Expense.group_id == group_id)
        .group_by(ExpenseFundDeduction.expense_id)
    )
    deduction_by_expense: dict[uuid.UUID, Decimal] = {
        eid: amt for eid, amt in deductions_result.all()
    }

    # Sum what each member paid (in group's main currency), net of any portion
    # covered by a fund.
    expenses_result = await db.execute(select(Expense).where(Expense.group_id == group_id))
    for expense in expenses_result.scalars().all():
        if expense.paid_by in members:
            balances[expense.paid_by] += (
                expense.converted_amount - deduction_by_expense.get(expense.id, Decimal("0"))
            )

    # Subtract what each member owes
    splits_result = await db.execute(
        select(ExpenseSplit)
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .where(Expense.group_id == group_id)
    )
    for split in splits_result.scalars().all():
        if split.group_member_id in members:
            balances[split.group_member_id] -= split.resolved_amount

    # Factor in settlements
    settlements_result = await db.execute(
        select(Settlement).where(Settlement.group_id == group_id)
    )
    for s in settlements_result.scalars().all():
        sender_effect, recipient_effect = settlement_balance_effect(s.type, s.amount)
        if s.from_member in members:
            balances[s.from_member] += sender_effect
        if s.to_member in members:
            balances[s.to_member] += recipient_effect

    # Add initial balances (for migrated debts from other systems)
    for mid, member in members.items():
        balances[mid] += member.initial_balance

    # Ensure all active members appear
    for mid in members:
        if mid not in balances:
            balances[mid] = members[mid].initial_balance

    return balances


def suggest_settlements_for_member(
    balances: dict[uuid.UUID, Decimal], member_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID, Decimal]]:
    """Minimal transfers (from, to, amount) that involve `member_id`.

    Runs the group-wide debt simplifier, then keeps only the transfers in which
    this member pays or receives — i.e. the payments that would bring them to a
    zero balance.
    """
    str_balances = {str(k): v.quantize(CENT) for k, v in balances.items()}
    transfers = simplify_debts(str_balances)
    return [
        (uuid.UUID(from_id), uuid.UUID(to_id), amount)
        for from_id, to_id, amount in transfers
        if uuid.UUID(from_id) == member_id or uuid.UUID(to_id) == member_id
    ]
