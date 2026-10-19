"""Ledger parity: changing either side of gifts or fund reimbursement fails these tests."""
from pathlib import Path
from decimal import Decimal as D
import sys
import subprocess

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def test_pure_ledger_preserves_gifts_repayments_and_fund_reimbursement():
    from app.services import balances
    assert hasattr(balances, "calculate_balances"), "The ledger needs a storage-independent entry point"
    members = [dict(id="a", is_active=True, initial_balance=D("5")),
               dict(id="b", is_active=True, initial_balance=D("-5")),
               dict(id="inactive", is_active=False, initial_balance=D("100"))]
    result = balances.calculate_balances(
        members,
        [dict(id="e", paid_by="a", converted_amount=D("100"))],
        [dict(group_member_id="a", resolved_amount=D("40")),
         dict(group_member_id="b", resolved_amount=D("40"))],
        [dict(expense_id="e", amount=D("20"))],
        [dict(from_member="b", to_member="a", type="settle_up", amount=D("10")),
         dict(from_member="a", to_member="b", type="gift", amount=D("15"))],
    )
    assert result == {"a": D("20"), "b": D("-20")}
    assert all(isinstance(value, D) for value in result.values())


def test_ledger_can_import_without_sqlalchemy():
    # -S removes site-packages: importing the pure service needs only the stdlib.
    path = ROOT / "backend/app/services/balances.py"
    result = subprocess.run([sys.executable, "-I", "-S", "-c",
        "import runpy,sys; runpy.run_path(sys.argv[1])", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_pure_ledger_accepts_orm_shaped_objects_and_uuid_keys():
    import uuid
    from types import SimpleNamespace as Row
    from app.services.balances import calculate_balances
    a, b, expense_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    result = calculate_balances(
        [Row(id=a, is_active=True, initial_balance=D('0')), Row(id=b, is_active=True, initial_balance=D('0'))],
        [Row(id=expense_id, paid_by=a, converted_amount=D('10'))],
        [Row(group_member_id=a, resolved_amount=D('5')), Row(group_member_id=b, resolved_amount=D('5'))],
        [], [],
    )
    assert result == {a: D('5'), b: D('-5')}
