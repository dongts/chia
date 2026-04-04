import logging
import os
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import get_current_member, get_group_or_404
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
from app.services.system_config import get_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


def _get_member_names(m: dict) -> list[str]:
    """Get all searchable names for a member (display_name + nicknames)."""
    names = [m["display_name"].lower()]
    if m.get("nicknames"):
        for nick in m["nicknames"].split(","):
            nick = nick.strip().lower()
            if nick:
                names.append(nick)
    return names


def _match_member_name(name: str, members: list[dict]) -> uuid.UUID | None:
    """Find a member by exact or case-insensitive name/nickname match."""
    name_lower = name.strip().lower()
    # Exact match on display_name or nickname
    for m in members:
        if name_lower in _get_member_names(m):
            return m["id"]
    # Partial prefix match as fallback
    for m in members:
        for mname in _get_member_names(m):
            if mname.startswith(name_lower):
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
    LLM_PROVIDER_KEYS = ("GROQ_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY")
    if not any(os.environ.get(k) for k in LLM_PROVIDER_KEYS):
        raise HTTPException(status_code=503, detail="No LLM API keys configured")

    group = await get_group_or_404(db, group_id)
    current_member = await get_current_member(db, group_id, current_user.id)

    llm_model = await get_config(db, "llm.default_model")
    parsing_level = data.parsing_level.value if data.parsing_level else await get_config(db, "llm.default_parsing_level")

    # Load members
    result = await db.execute(
        select(GroupMember)
        .where(GroupMember.group_id == group_id, GroupMember.is_active.is_(True))
        .order_by(GroupMember.joined_at)
    )
    db_members = result.scalars().all()
    members_data = [{"id": m.id, "display_name": m.display_name, "nicknames": m.nicknames} for m in db_members]

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
            model=llm_model,
            parsing_level=parsing_level,
            categories=categories_data,
            funds=funds_data,
            today=date.today(),
        )
    except Exception as e:
        logger.warning("LLM parse failed: %s", e)
        raise HTTPException(status_code=422, detail="Could not parse expense text. Please fill the form manually.")

    # Map names to UUIDs
    paid_by_member_id = None
    payer_name = raw.get("payer_name")
    if payer_name == "__self__":
        paid_by_member_id = current_member.id
    elif payer_name:
        paid_by_member_id = _match_member_name(payer_name, members_data)

    # Map split member names
    splits = None
    raw_member_names = raw.get("member_names")
    if raw_member_names and isinstance(raw_member_names, list):
        matched_ids = []
        for name in raw_member_names:
            if name == "__self__":
                matched_ids.append(current_member.id)
            else:
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
