# Natural Language Expense Parsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users type natural language on the AddExpense page to pre-fill the expense form via an LLM.

**Architecture:** New `POST /groups/{group_id}/expenses/parse` endpoint calls LiteLLM with group context (members, categories, funds) to extract structured expense data from free text. Frontend adds a text input at the top of AddExpense.tsx that calls this endpoint and populates the form.

**Tech Stack:** LiteLLM (Python), FastAPI, Pydantic, React/TypeScript

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/app/services/llm/__init__.py` | Package marker |
| Create | `backend/app/services/llm/prompts.py` | System prompt templates per parsing level |
| Create | `backend/app/services/llm/provider.py` | LiteLLM wrapper — `parse_expense_text()` |
| Create | `backend/app/schemas/expense_parse.py` | Request/response Pydantic models |
| Create | `backend/app/api/v1/expense_parse.py` | Parse endpoint router |
| Modify | `backend/app/config.py` | Add `llm_model`, `llm_api_key`, `llm_default_parsing_level` |
| Modify | `backend/app/api/v1/router.py` | Register expense_parse router |
| Modify | `backend/requirements.txt` | Add `litellm` |
| Modify | `frontend/src/types/index.ts` | Add `ExpenseParseDraft` type |
| Create | `frontend/src/api/expenseParse.ts` | `parseExpense()` API function |
| Modify | `frontend/src/pages/AddExpense.tsx` | Add NL text input + parse logic |
| Create | `backend/tests/test_expense_parse.py` | Unit tests for prompt building and response mapping |

---

### Task 1: Add LiteLLM dependency and config

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py:3-27`

- [ ] **Step 1: Add litellm to requirements.txt**

Add to the end of `backend/requirements.txt`:

```
litellm>=1.40.0
```

- [ ] **Step 2: Add LLM config vars to Settings**

In `backend/app/config.py`, add three new fields to the `Settings` class, after `sentry_traces_sample_rate` (line 22) and before `model_config` (line 24):

```python
    llm_model: str = "groq/llama-3.1-8b-instant"
    llm_api_key: str | None = None
    llm_default_parsing_level: str = "basic"
```

- [ ] **Step 3: Install the dependency**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && pip install litellm>=1.40.0`
Expected: Successful install

- [ ] **Step 4: Verify config loads**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -c "from app.config import settings; print(settings.llm_model, settings.llm_api_key, settings.llm_default_parsing_level)"`
Expected: `groq/llama-3.1-8b-instant None basic`

- [ ] **Step 5: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/requirements.txt backend/app/config.py
git commit -m "feat: add litellm dependency and LLM config vars"
```

---

### Task 2: Create Pydantic schemas for parse endpoint

**Files:**
- Create: `backend/app/schemas/expense_parse.py`

- [ ] **Step 1: Create the schema file**

Create `backend/app/schemas/expense_parse.py`:

```python
import uuid
from datetime import date as DateType
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.expense import SplitInput


class ParsingLevel(str, Enum):
    basic = "basic"
    smart = "smart"
    full = "full"


class ExpenseParseRequest(BaseModel):
    text: str = Field(..., max_length=500)
    parsing_level: ParsingLevel | None = None  # None → use server default


class FundDeductionDraft(BaseModel):
    fund_id: uuid.UUID
    amount: Decimal


class ExpenseParseDraft(BaseModel):
    description: str | None = None
    amount: Decimal | None = None
    currency_code: str | None = None
    date: DateType | None = None
    paid_by_member_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    split_type: str | None = None  # "equal" | "exact" | "percentage" | "shares"
    splits: list[SplitInput] | None = None
    fund_deductions: list[FundDeductionDraft] | None = None
    confidence: float = 0.0
    raw_extraction: dict[str, Any] = {}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -c "from app.schemas.expense_parse import ExpenseParseRequest, ExpenseParseDraft; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/app/schemas/expense_parse.py
git commit -m "feat: add Pydantic schemas for expense parse endpoint"
```

---

### Task 3: Build prompt templates

**Files:**
- Create: `backend/app/services/llm/__init__.py`
- Create: `backend/app/services/llm/prompts.py`

- [ ] **Step 1: Create the package init**

Create `backend/app/services/llm/__init__.py` (empty file):

```python
```

- [ ] **Step 2: Create prompts.py**

Create `backend/app/services/llm/prompts.py`:

```python
from datetime import date


def build_system_prompt(parsing_level: str) -> str:
    base = (
        "You are an expense parser. Extract structured data from the user's natural language "
        "description of an expense. Return valid JSON matching the schema below.\n\n"
        "Output JSON schema:\n"
        "{\n"
        '  "description": string or null,\n'
        '  "amount": number or null,\n'
        '  "payer_name": string or null (exact member name from the provided list),\n'
        '  "member_names": [string] or null (exact member names who share the expense),\n'
        '  "confidence": number between 0 and 1\n'
        "}\n\n"
        "Rules:\n"
        "- Match member names from the provided list. Use fuzzy matching (e.g. 'Al' -> 'Alice').\n"
        "- If the user says 'I paid' or 'me', set payer_name to null (the frontend will default to current user).\n"
        "- If no specific members are mentioned for splitting, set member_names to null (means all members).\n"
        '- For any field you cannot determine, return null.\n'
        "- Return ONLY valid JSON, no other text.\n"
    )

    if parsing_level in ("smart", "full"):
        base += (
            "\nAdditional fields in output:\n"
            '  "category_name": string or null (exact category name from the provided list),\n'
            '  "date": "YYYY-MM-DD" or null,\n'
            '  "currency_code": string or null (3-letter ISO code)\n'
            "\nAdditional rules:\n"
            "- Infer category from the expense description (e.g. 'taxi' -> 'Transport', 'dinner' -> 'Food & Drinks').\n"
            "- Parse relative dates ('yesterday', 'last friday') relative to today's date.\n"
            "- Detect currency if mentioned ('30 EUR'), otherwise return null.\n"
        )

    if parsing_level == "full":
        base += (
            "\nAdditional fields in output:\n"
            '  "split_type": "equal" | "exact" | "percentage" | "shares" or null,\n'
            '  "splits": [{"member_name": string, "value": number}] or null,\n'
            '  "fund_deductions": [{"fund_name": string, "amount": number}] or null\n'
            "\nAdditional rules:\n"
            '- "Bob owes 20" -> split_type "exact", splits with exact amounts.\n'
            '- "split 60/40 with Bob" -> split_type "percentage".\n'
            '- "Bob pays double" -> split_type "shares".\n'
            '- "use trip fund for 10" -> fund_deductions.\n'
            "- If no non-equal split is detected, leave split_type and splits as null.\n"
        )

    return base


def build_user_prompt(
    text: str,
    members: list[dict],
    group_currency: str,
    parsing_level: str,
    categories: list[dict] | None = None,
    funds: list[dict] | None = None,
    today: date | None = None,
) -> str:
    parts = []

    member_list = ", ".join(m["display_name"] for m in members)
    parts.append(f"Members: {member_list}")
    parts.append(f"Group currency: {group_currency}")

    if parsing_level in ("smart", "full") and categories:
        cat_list = ", ".join(f'{c["icon"]} {c["name"]}' for c in categories)
        parts.append(f"Categories: {cat_list}")

    if parsing_level == "full" and funds:
        fund_list = ", ".join(f["name"] for f in funds)
        parts.append(f"Funds: {fund_list}")

    if parsing_level in ("smart", "full") and today:
        parts.append(f"Today: {today.isoformat()}")

    parts.append(f"\nExpense description: {text}")

    return "\n".join(parts)
```

- [ ] **Step 3: Verify import**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -c "from app.services.llm.prompts import build_system_prompt, build_user_prompt; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/app/services/llm/
git commit -m "feat: add LLM prompt templates for expense parsing"
```

---

### Task 4: Build LiteLLM provider wrapper

**Files:**
- Create: `backend/app/services/llm/provider.py`

- [ ] **Step 1: Create provider.py**

Create `backend/app/services/llm/provider.py`:

```python
import json
import logging
from datetime import date
from decimal import Decimal, InvalidOperation

import litellm

from app.config import settings
from app.services.llm.prompts import build_system_prompt, build_user_prompt

logger = logging.getLogger(__name__)

# Suppress litellm's verbose logging
litellm.suppress_debug_info = True


async def parse_expense_text(
    text: str,
    members: list[dict],
    group_currency: str,
    parsing_level: str = "basic",
    categories: list[dict] | None = None,
    funds: list[dict] | None = None,
    today: date | None = None,
) -> dict:
    """Call LLM to parse natural language expense text into structured data.

    Returns the raw parsed dict from the LLM. The caller is responsible for
    validating and mapping member/category/fund names to UUIDs.
    """
    system_prompt = build_system_prompt(parsing_level)
    user_prompt = build_user_prompt(
        text=text,
        members=members,
        group_currency=group_currency,
        parsing_level=parsing_level,
        categories=categories,
        funds=funds,
        today=today,
    )

    response = await litellm.acompletion(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        api_key=settings.llm_api_key,
        timeout=10,
    )

    content = response.choices[0].message.content
    parsed = json.loads(content)

    # Coerce amount to Decimal if present
    if parsed.get("amount") is not None:
        try:
            parsed["amount"] = str(Decimal(str(parsed["amount"])))
        except (InvalidOperation, ValueError):
            parsed["amount"] = None

    return parsed
```

- [ ] **Step 2: Verify import**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -c "from app.services.llm.provider import parse_expense_text; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/app/services/llm/provider.py
git commit -m "feat: add LiteLLM provider wrapper for expense parsing"
```

---

### Task 5: Create the parse endpoint

**Files:**
- Create: `backend/app/api/v1/expense_parse.py`
- Modify: `backend/app/api/v1/router.py:34-36`

- [ ] **Step 1: Create the endpoint file**

Create `backend/app/api/v1/expense_parse.py`:

```python
import logging
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
from app.config import settings
from app.core.exceptions import BadRequest
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, User
from app.models.category import Category
from app.models.fund import Fund
from app.schemas.expense import SplitInput
from app.schemas.expense_parse import (
    ExpenseParseDraft,
    ExpenseParseRequest,
    FundDeductionDraft,
    ParsingLevel,
)
from app.services.llm.provider import parse_expense_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


def _match_member_name(name: str, members: list[dict]) -> uuid.UUID | None:
    """Find a member by exact or case-insensitive name match."""
    name_lower = name.strip().lower()
    for m in members:
        if m["display_name"].lower() == name_lower:
            return m["id"]
    # Partial prefix match as fallback
    for m in members:
        if m["display_name"].lower().startswith(name_lower):
            return m["id"]
    return None


def _match_category_name(name: str, categories: list[dict]) -> uuid.UUID | None:
    """Find a category by case-insensitive name match."""
    name_lower = name.strip().lower()
    for c in categories:
        if c["name"].lower() == name_lower:
            return c["id"]
    # Partial match
    for c in categories:
        if name_lower in c["name"].lower():
            return c["id"]
    return None


def _match_fund_name(name: str, funds: list[dict]) -> uuid.UUID | None:
    """Find a fund by case-insensitive name match."""
    name_lower = name.strip().lower()
    for f in funds:
        if f["name"].lower() == name_lower:
            return f["id"]
    for f in funds:
        if name_lower in f["name"].lower():
            return f["id"]
    return None


@router.post("/parse", response_model=ExpenseParseDraft)
async def parse_expense(
    group_id: uuid.UUID,
    data: ExpenseParseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check LLM is configured
    if not settings.llm_api_key:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"detail": "LLM parsing not configured"},
        )

    group = await get_group_or_404(db, group_id)
    current_member = await get_current_member(db, group_id, current_user.id)

    parsing_level = (data.parsing_level or settings.llm_default_parsing_level).value \
        if data.parsing_level else settings.llm_default_parsing_level

    # Load members
    result = await db.execute(
        select(GroupMember)
        .where(GroupMember.group_id == group_id, GroupMember.is_active.is_(True))
        .order_by(GroupMember.joined_at)
    )
    db_members = result.scalars().all()
    members_data = [{"id": m.id, "display_name": m.display_name} for m in db_members]

    # Load categories (for smart/full levels)
    categories_data = None
    if parsing_level in ("smart", "full"):
        result = await db.execute(
            select(Category).where(
                or_(Category.group_id == group_id, Category.group_id.is_(None))
            )
        )
        db_categories = result.scalars().all()
        categories_data = [{"id": c.id, "name": c.name, "icon": c.icon} for c in db_categories]

    # Load funds (for full level)
    funds_data = None
    if parsing_level == "full":
        result = await db.execute(
            select(Fund).where(Fund.group_id == group_id, Fund.is_active.is_(True))
        )
        db_funds = result.scalars().all()
        funds_data = [{"id": f.id, "name": f.name} for f in db_funds]

    # Call LLM
    try:
        raw = await parse_expense_text(
            text=data.text,
            members=members_data,
            group_currency=group.currency_code,
            parsing_level=parsing_level,
            categories=categories_data,
            funds=funds_data,
            today=date.today(),
        )
    except Exception as e:
        logger.warning("LLM parse failed: %s", e)
        raise BadRequest("Could not parse expense text. Please fill the form manually.")

    # Map names to UUIDs
    paid_by_member_id = None
    if raw.get("payer_name"):
        paid_by_member_id = _match_member_name(raw["payer_name"], members_data)
    elif raw.get("payer_name") is None:
        # "I paid" / "me" → default to current user's member
        paid_by_member_id = current_member.id

    # Map split member names
    splits = None
    raw_member_names = raw.get("member_names")
    if raw_member_names and isinstance(raw_member_names, list):
        matched_ids = []
        for name in raw_member_names:
            mid = _match_member_name(name, members_data)
            if mid:
                matched_ids.append(mid)
        if matched_ids:
            splits = [SplitInput(group_member_id=mid, value=Decimal("1")) for mid in matched_ids]

    # Handle full-level splits with values
    split_type = None
    raw_split_type = raw.get("split_type")
    raw_splits = raw.get("splits")
    if raw_split_type and raw_splits and isinstance(raw_splits, list):
        split_type = raw_split_type
        mapped_splits = []
        for s in raw_splits:
            mid = _match_member_name(s.get("member_name", ""), members_data)
            if mid:
                try:
                    val = Decimal(str(s.get("value", 0)))
                except (InvalidOperation, ValueError):
                    val = Decimal("0")
                mapped_splits.append(SplitInput(group_member_id=mid, value=val))
        if mapped_splits:
            splits = mapped_splits

    # Map category
    category_id = None
    if raw.get("category_name") and categories_data:
        category_id = _match_category_name(raw["category_name"], categories_data)

    # Map fund deductions
    fund_deductions = None
    if raw.get("fund_deductions") and funds_data:
        mapped_funds = []
        for fd in raw["fund_deductions"]:
            fid = _match_fund_name(fd.get("fund_name", ""), funds_data)
            if fid:
                try:
                    amt = Decimal(str(fd.get("amount", 0)))
                except (InvalidOperation, ValueError):
                    continue
                mapped_funds.append(FundDeductionDraft(fund_id=fid, amount=amt))
        if mapped_funds:
            fund_deductions = mapped_funds

    # Parse amount
    amount = None
    if raw.get("amount") is not None:
        try:
            amount = Decimal(str(raw["amount"]))
        except (InvalidOperation, ValueError):
            amount = None

    # Parse date
    parsed_date = None
    if raw.get("date"):
        try:
            from datetime import date as date_cls
            parsed_date = date_cls.fromisoformat(raw["date"])
        except (ValueError, TypeError):
            parsed_date = None

    return ExpenseParseDraft(
        description=raw.get("description"),
        amount=amount,
        currency_code=raw.get("currency_code"),
        date=parsed_date,
        paid_by_member_id=paid_by_member_id,
        category_id=category_id,
        split_type=split_type,
        splits=splits,
        fund_deductions=fund_deductions,
        confidence=float(raw.get("confidence", 0)),
        raw_extraction=raw,
    )
```

- [ ] **Step 2: Register the router**

In `backend/app/api/v1/router.py`, add after line 35 (`api_router.include_router(funds_router)`):

```python
from app.api.v1.expense_parse import router as expense_parse_router
api_router.include_router(expense_parse_router)
```

- [ ] **Step 3: Verify import**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -c "from app.api.v1.expense_parse import router; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/app/api/v1/expense_parse.py backend/app/api/v1/router.py
git commit -m "feat: add POST /groups/{group_id}/expenses/parse endpoint"
```

---

### Task 6: Write backend unit tests

**Files:**
- Create: `backend/tests/test_expense_parse.py`

- [ ] **Step 1: Write tests for prompt building**

Create `backend/tests/test_expense_parse.py`:

```python
import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.services.llm.prompts import build_system_prompt, build_user_prompt


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
```

- [ ] **Step 2: Run the tests**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && python -m pytest tests/test_expense_parse.py -v`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add backend/tests/test_expense_parse.py
git commit -m "test: add unit tests for expense parse prompts and name matching"
```

---

### Task 7: Add frontend TypeScript type and API function

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/expenseParse.ts`

- [ ] **Step 1: Add ExpenseParseDraft type**

In `frontend/src/types/index.ts`, add at the end of the file:

```typescript
export interface FundDeductionDraft {
  fund_id: string;
  amount: number;
}

export interface ExpenseParseDraft {
  description: string | null;
  amount: number | null;
  currency_code: string | null;
  date: string | null;
  paid_by_member_id: string | null;
  category_id: string | null;
  split_type: SplitType | null;
  splits: SplitInput[] | null;
  fund_deductions: FundDeductionDraft[] | null;
  confidence: number;
  raw_extraction: Record<string, unknown>;
}
```

- [ ] **Step 2: Create the API function**

Create `frontend/src/api/expenseParse.ts`:

```typescript
import type { ExpenseParseDraft } from "@/types";
import client from "./client";

export async function parseExpense(
  groupId: string,
  text: string,
  parsingLevel?: string,
): Promise<ExpenseParseDraft> {
  const response = await client.post<ExpenseParseDraft>(
    `/groups/${groupId}/expenses/parse`,
    {
      text,
      parsing_level: parsingLevel ?? undefined,
    },
  );
  return response.data;
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/zuzu/Workspaces/personal/chia/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add frontend/src/types/index.ts frontend/src/api/expenseParse.ts
git commit -m "feat: add ExpenseParseDraft type and parseExpense API function"
```

---

### Task 8: Add natural language input to AddExpense page

**Files:**
- Modify: `frontend/src/pages/AddExpense.tsx`

- [ ] **Step 1: Add import for parseExpense**

In `frontend/src/pages/AddExpense.tsx`, add to the imports (after the existing API imports around line 5):

```typescript
import { parseExpense } from "@/api/expenseParse";
```

- [ ] **Step 2: Add state for NL input**

After the existing state declarations (around line 47, after `const [shareValues, setShareValues] = ...`), add:

```typescript
  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);
  const [nlHidden, setNlHidden] = useState(false);
```

- [ ] **Step 3: Add the parse handler function**

Add this function before `handleSubmit` (or wherever the handler functions are defined):

```typescript
  const handleNlParse = async () => {
    if (!groupId || !nlText.trim()) return;
    setNlParsing(true);
    try {
      const draft = await parseExpense(groupId, nlText.trim());
      if (draft.description) setDescription(draft.description);
      if (draft.amount != null) setAmount(String(draft.amount));
      if (draft.date) setDate(draft.date);
      if (draft.paid_by_member_id) setPaidBy(draft.paid_by_member_id);
      if (draft.category_id) setCategoryId(draft.category_id);
      if (draft.currency_code) setCurrencyCode(draft.currency_code);
      if (draft.split_type) setSplitType(draft.split_type as SplitType);

      // Pre-fill equal split checkboxes from returned splits
      if (draft.splits && draft.splits.length > 0) {
        if (!draft.split_type || draft.split_type === "equal") {
          const checked: Record<string, boolean> = {};
          members.forEach((m) => { checked[m.id] = false; });
          draft.splits.forEach((s) => { checked[s.group_member_id] = true; });
          setEqualChecked(checked);
        } else if (draft.split_type === "exact") {
          const exact: Record<string, string> = {};
          members.forEach((m) => { exact[m.id] = ""; });
          draft.splits.forEach((s) => { exact[s.group_member_id] = String(s.value); });
          setExactValues(exact);
        } else if (draft.split_type === "percentage") {
          const pct: Record<string, string> = {};
          members.forEach((m) => { pct[m.id] = ""; });
          draft.splits.forEach((s) => { pct[s.group_member_id] = String(s.value); });
          setPercentValues(pct);
        } else if (draft.split_type === "shares") {
          const shares: Record<string, string> = {};
          members.forEach((m) => { shares[m.id] = "0"; });
          draft.splits.forEach((s) => { shares[s.group_member_id] = String(s.value); });
          setShareValues(shares);
        }
      }

      // Pre-fill fund deductions
      if (draft.fund_deductions && draft.fund_deductions.length > 0) {
        setFundDeductions(
          draft.fund_deductions.map((fd) => ({
            fundId: fd.fund_id,
            amount: String(fd.amount),
          }))
        );
      }

      setNlText("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 503) {
        setNlHidden(true);
      }
      window.alert("Couldn't understand that. Please fill the form manually.");
    } finally {
      setNlParsing(false);
    }
  };
```

- [ ] **Step 4: Add the NL input UI**

In the JSX return, add this block right after the header `<div>` (around line 220, before `<form onSubmit={handleSubmit}>`):

```tsx
      {!nlHidden && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 mb-6">
          <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
            Describe your expense
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleNlParse();
                }
              }}
              placeholder='e.g. "dinner 45.50 Alice paid split with Bob"'
              className="flex-1 bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
              disabled={nlParsing}
            />
            <button
              type="button"
              onClick={handleNlParse}
              disabled={nlParsing || !nlText.trim()}
              className="px-4 py-3 bg-primary text-on-primary rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {nlParsing ? "Parsing..." : "Parse"}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd /home/zuzu/Workspaces/personal/chia/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add frontend/src/pages/AddExpense.tsx
git commit -m "feat: add natural language input to AddExpense page"
```

---

### Task 9: Manual end-to-end smoke test

- [ ] **Step 1: Set environment variable**

Set your LLM API key. For example with Groq (free tier):

```bash
export CHIA_LLM_API_KEY="your-groq-api-key"
export CHIA_LLM_MODEL="groq/llama-3.1-8b-instant"
```

- [ ] **Step 2: Start the backend**

Run: `cd /home/zuzu/Workspaces/personal/chia/backend && uvicorn app.main:app --reload`
Expected: Server starts on port 8000

- [ ] **Step 3: Start the frontend**

Run: `cd /home/zuzu/Workspaces/personal/chia/frontend && npm run dev`
Expected: Vite dev server starts on port 5173

- [ ] **Step 4: Test the flow**

1. Navigate to a group's "Add Expense" page
2. Verify the "Describe your expense" text input appears at the top
3. Type: `dinner 45.50 Alice paid split with Bob`
4. Click "Parse" or press Enter
5. Verify form fields get populated: description = "Dinner" (or similar), amount = 45.50, payer = Alice
6. Verify you can adjust fields and submit normally

- [ ] **Step 5: Test error cases**

1. Stop the backend → frontend should show alert
2. Remove `CHIA_LLM_API_KEY` env var, restart backend → should get 503, input hides
3. Type gibberish → should get alert, form stays untouched

- [ ] **Step 6: Final commit if any tweaks needed**

```bash
cd /home/zuzu/Workspaces/personal/chia
git add -A
git commit -m "fix: address smoke test findings"
```
