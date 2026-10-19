import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "verify-preview.py"
SPEC = importlib.util.spec_from_file_location("verify_preview", MODULE_PATH)
verify_preview = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = verify_preview
SPEC.loader.exec_module(verify_preview)


def snapshot():
    return {
        "tables": {
            "groups": {"rows": [{"id": "g", "is_deleted": False}]},
            "group_members": {"rows": [
                {"id": "a", "group_id": "g", "initial_balance": "5.00", "is_active": True},
                {"id": "b", "group_id": "g", "initial_balance": "-5.00", "is_active": True},
            ]},
            "expenses": {"rows": [{"id": "e", "group_id": "g", "paid_by": "a", "converted_amount": "100.00"}]},
            "expense_splits": {"rows": [
                {"expense_id": "e", "group_member_id": "a", "resolved_amount": "40.00"},
                {"expense_id": "e", "group_member_id": "b", "resolved_amount": "40.00"},
            ]},
            "expense_fund_deductions": {"rows": [{"expense_id": "e", "fund_id": "f", "amount": "20.00"}]},
            "settlements": {"rows": [
                {"group_id": "g", "from_member": "b", "to_member": "a", "type": "settle_up", "amount": "10.00"},
                {"group_id": "g", "from_member": "a", "to_member": "b", "type": "gift", "amount": "15.00"},
            ]},
            "funds": {"rows": [{"id": "f", "group_id": "g"}]},
            "fund_transactions": {"rows": [
                {"fund_id": "f", "type": "contribute", "amount": "30.00"},
                {"fund_id": "f", "type": "expense", "amount": "20.00"},
            ]},
        },
        "balances": {
            "groups": [{"group_id": "g", "members": [
                {"member_id": "a", "balance": "20.00"},
                {"member_id": "b", "balance": "-20.00"},
            ]}],
            "funds": [{"fund_id": "f", "group_id": "g", "balance": "10.00"}],
        },
    }


class OfflineLedgerTests(unittest.TestCase):
    def test_verifies_every_group_and_fund_with_exact_decimal_arithmetic(self):
        self.assertEqual(verify_preview.verify_offline(snapshot()), {"groups": 1, "funds": 1})

    def test_rejects_a_balance_mismatch(self):
        value = snapshot()
        value["balances"]["groups"][0]["members"][0]["balance"] = "20.01"
        with self.assertRaisesRegex(ValueError, "group balance mismatch"):
            verify_preview.verify_offline(value)


if __name__ == "__main__":
    unittest.main()
