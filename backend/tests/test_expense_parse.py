import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.services.llm.prompts import build_system_prompt, build_user_prompt


@pytest.mark.no_db
class TestBuildSystemPrompt:
    def test_basic_level_has_core_fields(self):
        prompt = build_system_prompt("basic")
        assert "description" in prompt
        assert "amount" in prompt
        assert "payer_name" in prompt
        assert "member_names" in prompt
        assert "category_name" not in prompt
        assert "split_type" not in prompt

    def test_smart_level_adds_category_and_date(self):
        prompt = build_system_prompt("smart")
        assert "category_name" in prompt
        assert "date" in prompt
        assert "currency_code" in prompt
        assert "split_type" not in prompt

    def test_full_level_adds_splits_and_funds(self):
        prompt = build_system_prompt("full")
        assert "category_name" in prompt
        assert "split_type" in prompt
        assert "fund_deductions" in prompt


@pytest.mark.no_db
class TestBuildUserPrompt:
    def setup_method(self):
        self.members = [
            {"id": uuid.uuid4(), "display_name": "Alice"},
            {"id": uuid.uuid4(), "display_name": "Bob"},
        ]
        self.categories = [
            {"id": uuid.uuid4(), "name": "Food & Drinks", "icon": "🍔"},
            {"id": uuid.uuid4(), "name": "Transport", "icon": "🚕"},
        ]
        self.funds = [
            {"id": uuid.uuid4(), "name": "Trip Fund"},
        ]

    def test_basic_includes_members_and_currency(self):
        prompt = build_user_prompt(
            text="dinner 45",
            members=self.members,
            group_currency="USD",
            parsing_level="basic",
        )
        assert "Alice" in prompt
        assert "Bob" in prompt
        assert "USD" in prompt
        assert "dinner 45" in prompt
        assert "Categories" not in prompt

    def test_smart_includes_categories_and_date(self):
        prompt = build_user_prompt(
            text="dinner 45",
            members=self.members,
            group_currency="USD",
            parsing_level="smart",
            categories=self.categories,
            today=date(2026, 4, 4),
        )
        assert "Food & Drinks" in prompt
        assert "2026-04-04" in prompt

    def test_full_includes_funds(self):
        prompt = build_user_prompt(
            text="dinner 45",
            members=self.members,
            group_currency="USD",
            parsing_level="full",
            categories=self.categories,
            funds=self.funds,
            today=date(2026, 4, 4),
        )
        assert "Trip Fund" in prompt


@pytest.mark.no_db
class TestMatchMemberName:
    """Test the name matching logic from the endpoint module."""

    def setup_method(self):
        self.members = [
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000001"), "display_name": "Alice"},
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000002"), "display_name": "Bob"},
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000003"), "display_name": "Charlie"},
        ]

    def test_exact_match(self):
        from app.api.v1.expense_parse import _match_member_name
        assert _match_member_name("Alice", self.members) == uuid.UUID("00000000-0000-0000-0000-000000000001")

    def test_case_insensitive(self):
        from app.api.v1.expense_parse import _match_member_name
        assert _match_member_name("alice", self.members) == uuid.UUID("00000000-0000-0000-0000-000000000001")

    def test_prefix_match(self):
        from app.api.v1.expense_parse import _match_member_name
        assert _match_member_name("Ali", self.members) == uuid.UUID("00000000-0000-0000-0000-000000000001")

    def test_no_match(self):
        from app.api.v1.expense_parse import _match_member_name
        assert _match_member_name("Zara", self.members) is None


@pytest.mark.no_db
class TestMatchCategoryName:
    def setup_method(self):
        self.categories = [
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000010"), "name": "Food & Drinks"},
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000020"), "name": "Transport"},
        ]

    def test_exact_match(self):
        from app.api.v1.expense_parse import _match_category_name
        assert _match_category_name("Transport", self.categories) == uuid.UUID("00000000-0000-0000-0000-000000000020")

    def test_partial_match(self):
        from app.api.v1.expense_parse import _match_category_name
        assert _match_category_name("food", self.categories) == uuid.UUID("00000000-0000-0000-0000-000000000010")

    def test_no_match(self):
        from app.api.v1.expense_parse import _match_category_name
        assert _match_category_name("Entertainment", self.categories) is None


@pytest.mark.no_db
class TestMatchFundName:
    def setup_method(self):
        self.funds = [
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000030"), "name": "Trip Fund"},
            {"id": uuid.UUID("00000000-0000-0000-0000-000000000040"), "name": "Emergency Fund"},
        ]

    def test_exact_match(self):
        from app.api.v1.expense_parse import _match_fund_name
        assert _match_fund_name("Trip Fund", self.funds) == uuid.UUID("00000000-0000-0000-0000-000000000030")

    def test_case_insensitive(self):
        from app.api.v1.expense_parse import _match_fund_name
        assert _match_fund_name("trip fund", self.funds) == uuid.UUID("00000000-0000-0000-0000-000000000030")

    def test_partial_match(self):
        from app.api.v1.expense_parse import _match_fund_name
        assert _match_fund_name("emergency", self.funds) == uuid.UUID("00000000-0000-0000-0000-000000000040")

    def test_no_match(self):
        from app.api.v1.expense_parse import _match_fund_name
        assert _match_fund_name("Savings", self.funds) is None
