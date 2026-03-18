from decimal import Decimal

from app.services.debt_simplifier import simplify_debts


def test_simple_two_person():
    balances = {"alice": Decimal("10.00"), "bob": Decimal("-10.00")}
    result = simplify_debts(balances)
    assert result == [("bob", "alice", Decimal("10.00"))]


def test_three_person_chain():
    balances = {"alice": Decimal("10.00"), "bob": Decimal("-10.00"), "charlie": Decimal("0.00")}
    result = simplify_debts(balances)
    assert result == [("bob", "alice", Decimal("10.00"))]


def test_three_person_triangle():
    balances = {"alice": Decimal("20.00"), "bob": Decimal("-8.00"), "charlie": Decimal("-12.00")}
    result = simplify_debts(balances)
    assert len(result) == 2
    total = sum(t[2] for t in result)
    assert total == Decimal("20.00")


def test_all_settled():
    balances = {"a": Decimal("0.00"), "b": Decimal("0.00")}
    result = simplify_debts(balances)
    assert result == []


def test_many_members():
    balances = {"a": Decimal("30.00"), "b": Decimal("-10.00"), "c": Decimal("-10.00"), "d": Decimal("-10.00")}
    result = simplify_debts(balances)
    assert len(result) == 3
    assert sum(t[2] for t in result) == Decimal("30.00")
