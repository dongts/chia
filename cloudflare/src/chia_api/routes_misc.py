"""Notification and natural-language expense parsing routes."""

from datetime import date
from decimal import Decimal, InvalidOperation
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from chia_api.auth import fetch_json
from chia_api.common import Context, auth_context, env_value, get_group, require_member
from shared.prompts import build_system_prompt, build_user_prompt
from shared.schemas.expense import SplitInput
from shared.schemas.expense_parse import ExpenseParseDraft, ExpenseParseRequest, FundDeductionDraft
from shared.schemas.notification import NotificationRead


router = APIRouter(prefix="/api/v1")
CONFIG_REGISTRY = {
    "llm.default_model": {"type": "string", "default": "gemini/gemma-4-31b-it",
        "label": "Default LLM Model", "description": "LiteLLM model identifier for expense parsing"},
    "llm.default_parsing_level": {"type": "string", "default": "basic",
        "label": "Default Parsing Level", "description": "basic, smart, or full"},
}


async def get_config(db, key: str) -> str:
    if key not in CONFIG_REGISTRY:
        raise KeyError(f"Unknown config key: {key}")
    row = await db.one("system_config", "key = ?", (key,))
    return row["value"] if row else CONFIG_REGISTRY[key]["default"]


@router.get("/notifications", response_model=list[NotificationRead], tags=["notifications"])
async def list_notifications(limit: int = Query(20, le=100), offset: int = Query(0),
                             ctx: Context = Depends(auth_context)):
    return await ctx.db.rows("notifications", "user_id = ?", (ctx.user["id"],),
                             f"created_at DESC LIMIT {int(limit)} OFFSET {int(offset)}")


@router.patch("/notifications/{notification_id}", response_model=NotificationRead, tags=["notifications"])
async def mark_notification_read(notification_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    row = await ctx.db.one("notifications", "id = ? AND user_id = ?",
                           (str(notification_id), ctx.user["id"]))
    if row is None:
        raise HTTPException(404, "Notification not found")
    await ctx.db.batch([ctx.db.update("notifications", {"read": True}, "id = ?", (str(notification_id),))])
    row["read"] = True
    return row


@router.post("/notifications/mark-all-read", tags=["notifications"])
async def mark_all_notifications_read(ctx: Context = Depends(auth_context)):
    await ctx.db.batch([ctx.db.update("notifications", {"read": True},
                                     "user_id = ? AND read = 0", (ctx.user["id"],))])
    return {"detail": "All notifications marked as read"}


def _names(member: dict) -> list[str]:
    values = [member["display_name"].lower()]
    values.extend(value.strip().lower() for value in (member.get("nicknames") or "").split(",") if value.strip())
    return values


def _match(name: str, rows: list[dict]) -> str | None:
    needle = name.strip().lower()
    for row in rows:
        candidates = _names(row) if "display_name" in row else [row["name"].lower()]
        if needle in candidates:
            return row["id"]
    for row in rows:
        candidates = _names(row) if "display_name" in row else [row["name"].lower()]
        if any(needle in candidate for candidate in candidates):
            return row["id"]
    return None


async def _llm_parse(ctx: Context, *, text: str, members: list[dict], currency: str,
                     model: str, level: str, categories, funds) -> dict:
    system = build_system_prompt(level)
    user = build_user_prompt(text=text, members=members, group_currency=currency,
                             parsing_level=level, categories=categories, funds=funds, today=date.today())
    provider, _, model_name = model.partition("/")
    if not model_name:
        provider, model_name = "openai", provider
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    if provider == "gemini":
        key = env_value(ctx.env, "GEMINI_API_KEY")
        if not key:
            raise HTTPException(503, "No LLM API keys configured")
        response = await fetch_json(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}",
            method="POST", headers={"content-type": "application/json"},
            body=json.dumps({"system_instruction": {"parts": [{"text": system}]},
                             "contents": [{"role": "user", "parts": [{"text": user}]}],
                             "generationConfig": {"responseMimeType": "application/json"}}),
        )
        content = response["candidates"][0]["content"]["parts"][0]["text"]
    elif provider == "anthropic":
        key = env_value(ctx.env, "ANTHROPIC_API_KEY")
        if not key:
            raise HTTPException(503, "No LLM API keys configured")
        response = await fetch_json("https://api.anthropic.com/v1/messages", method="POST",
            headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
            body=json.dumps({"model": model_name, "max_tokens": 2048, "system": system,
                             "messages": [{"role": "user", "content": user}]}))
        content = response["content"][0]["text"]
    else:
        key_name = "GROQ_API_KEY" if provider == "groq" else "OPENAI_API_KEY"
        key = env_value(ctx.env, key_name)
        if not key:
            raise HTTPException(503, "No LLM API keys configured")
        endpoint = ("https://api.groq.com/openai/v1/chat/completions" if provider == "groq"
                    else "https://api.openai.com/v1/chat/completions")
        response = await fetch_json(endpoint, method="POST",
            headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
            body=json.dumps({"model": model_name, "messages": messages,
                             "response_format": {"type": "json_object"}}))
        content = response["choices"][0]["message"]["content"]
    return json.loads(content)


@router.post("/groups/{group_id}/expenses/parse", response_model=ExpenseParseDraft, tags=["expenses"])
async def parse_expense(group_id: uuid.UUID, data: ExpenseParseRequest,
                        ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    current = await require_member(ctx, group_id)
    model = await get_config(ctx.db, "llm.default_model")
    level = data.parsing_level.value if data.parsing_level else await get_config(ctx.db, "llm.default_parsing_level")
    members = await ctx.db.rows("group_members", "group_id = ? AND is_active = 1", (str(group_id),), "joined_at")
    categories = None
    if level in {"smart", "full"}:
        categories = await ctx.db.rows("categories", "group_id = ? OR group_id IS NULL", (str(group_id),))
    funds = await ctx.db.rows("funds", "group_id = ? AND is_active = 1", (str(group_id),)) if level == "full" else None
    member_data = [{"id": row["id"], "display_name": row["display_name"], "nicknames": row["nicknames"]} for row in members]
    category_data = ([{"id": row["id"], "name": row["name"], "icon": row["icon"]}
                      for row in categories] if categories is not None else None)
    fund_data = ([{"id": row["id"], "name": row["name"]} for row in funds] if funds is not None else None)
    try:
        raw = await _llm_parse(ctx, text=data.text, members=member_data,
                               currency=group["currency_code"], model=model, level=level,
                               categories=category_data, funds=fund_data)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(422, "Could not parse expense text. Please fill the form manually.") from error
    payer = raw.get("payer_name")
    paid_by = current["id"] if payer == "__self__" else _match(payer, member_data) if payer else None
    splits = None
    names = raw.get("member_names")
    if isinstance(names, list):
        matched = [current["id"] if name == "__self__" else _match(name, member_data) for name in names]
        splits = [SplitInput(group_member_id=value, value=Decimal("1")) for value in matched if value]
    split_type = raw.get("split_type")
    if split_type and isinstance(raw.get("splits"), list):
        mapped = []
        for split in raw["splits"]:
            member = _match(split.get("member_name", ""), member_data)
            if member:
                try: value = Decimal(str(split.get("value", 0)))
                except (InvalidOperation, ValueError): value = Decimal("0")
                mapped.append(SplitInput(group_member_id=member, value=value))
        if mapped: splits = mapped
    fund_deductions = []
    if fund_data and isinstance(raw.get("fund_deductions"), list):
        for item in raw["fund_deductions"]:
            fund = _match(item.get("fund_name", ""), fund_data)
            if fund:
                try: fund_deductions.append(FundDeductionDraft(fund_id=fund, amount=Decimal(str(item.get("amount", 0)))))
                except (InvalidOperation, ValueError): pass
    try: amount = Decimal(str(raw["amount"])) if raw.get("amount") is not None else None
    except (InvalidOperation, ValueError): amount = None
    try: parsed_date = date.fromisoformat(raw["date"]) if raw.get("date") else None
    except (ValueError, TypeError): parsed_date = None
    return ExpenseParseDraft(description=raw.get("description"), amount=amount,
        currency_code=raw.get("currency_code"), date=parsed_date, paid_by_member_id=paid_by,
        category_id=_match(raw["category_name"], category_data) if raw.get("category_name") and category_data else None,
        split_type=split_type, splits=splits, fund_deductions=fund_deductions or None,
        confidence=float(raw.get("confidence", 0)), raw_extraction=raw)
