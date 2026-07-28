from decimal import Decimal

import pytest

from app.api.v1.settlements import _distribution_amounts
from app.services.balances import settlement_balance_effect


pytestmark = pytest.mark.no_db


def test_gift_has_opposite_effect_to_debt_settlement():
    amount = Decimal("185000")
    assert settlement_balance_effect("gift", amount) == (-amount, amount)
    assert settlement_balance_effect("settle_up", amount) == (amount, -amount)
    assert settlement_balance_effect("transfer", amount) == (amount, -amount)


def test_per_recipient_distribution():
    amounts = _distribution_amounts(Decimal("185000"), 10, "per_recipient", "VND")
    assert amounts == [Decimal("185000")] * 10
    assert sum(amounts) == Decimal("1850000")


def test_total_distribution_respects_zero_decimal_currency():
    amounts = _distribution_amounts(Decimal("10"), 3, "total", "VND")
    assert amounts == [Decimal("4"), Decimal("3"), Decimal("3")]


def test_total_distribution_respects_cent_currency():
    amounts = _distribution_amounts(Decimal("10"), 3, "total", "USD")
    assert amounts == [Decimal("3.34"), Decimal("3.33"), Decimal("3.33")]
