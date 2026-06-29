from decimal import Decimal

from app.services.balances import settled_threshold


def test_zero_decimal_currency_threshold_is_one():
    # VND/JPY have no minor unit — the smallest settleable amount is 1.
    assert settled_threshold("VND") == Decimal("1")
    assert settled_threshold("JPY") == Decimal("1")
    assert settled_threshold("vnd") == Decimal("1")  # case-insensitive


def test_decimal_currency_threshold_is_one_cent():
    assert settled_threshold("USD") == Decimal("0.01")
    assert settled_threshold("EUR") == Decimal("0.01")


def test_rounding_dust_is_settled_for_vnd_but_not_usd():
    # The reported bug: a member left with 0.02 VND (equal-split rounding dust)
    # could never be deactivated because the guard used a hardcoded 0.01 cent
    # threshold. 0.02 VND is below 1 đồng, so it must count as settled.
    dust = Decimal("0.02")
    assert abs(dust) < settled_threshold("VND")
    assert abs(dust) >= settled_threshold("USD")
