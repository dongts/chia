from decimal import Decimal

import pytest

from app.services.split_calculator import calculate_splits


def test_equal_split_even():
    result = calculate_splits(Decimal("30.00"), "equal", {"a": None, "b": None, "c": None})
    assert result == {"a": Decimal("10.00"), "b": Decimal("10.00"), "c": Decimal("10.00")}


def test_equal_split_remainder():
    result = calculate_splits(Decimal("10.00"), "equal", {"a": None, "b": None, "c": None})
    assert result["a"] == Decimal("3.34")
    assert result["b"] == Decimal("3.33")
    assert result["c"] == Decimal("3.33")
    assert sum(result.values()) == Decimal("10.00")


def test_exact_split():
    result = calculate_splits(Decimal("100.00"), "exact", {"a": Decimal("60.00"), "b": Decimal("40.00")})
    assert result == {"a": Decimal("60.00"), "b": Decimal("40.00")}


def test_exact_split_mismatch():
    with pytest.raises(ValueError, match="must sum to"):
        calculate_splits(Decimal("100.00"), "exact", {"a": Decimal("50.00"), "b": Decimal("40.00")})


def test_percentage_split():
    result = calculate_splits(Decimal("200.00"), "percentage", {"a": Decimal("60"), "b": Decimal("40")})
    assert result == {"a": Decimal("120.00"), "b": Decimal("80.00")}


def test_percentage_not_100():
    with pytest.raises(ValueError, match="must sum to 100"):
        calculate_splits(Decimal("100.00"), "percentage", {"a": Decimal("50"), "b": Decimal("40")})


def test_shares_split():
    result = calculate_splits(
        Decimal("50.00"), "shares",
        {"adult1": Decimal("2"), "adult2": Decimal("2"), "child": Decimal("1")},
    )
    assert result == {"adult1": Decimal("20.00"), "adult2": Decimal("20.00"), "child": Decimal("10.00")}


def test_shares_split_remainder():
    result = calculate_splits(Decimal("10.00"), "shares", {"a": Decimal("1"), "b": Decimal("1"), "c": Decimal("1")})
    assert sum(result.values()) == Decimal("10.00")
