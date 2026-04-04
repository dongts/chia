import json
import logging
from datetime import date
from decimal import Decimal, InvalidOperation

import litellm

from app.services.llm.prompts import build_system_prompt, build_user_prompt

logger = logging.getLogger(__name__)

litellm.suppress_debug_info = True


async def parse_expense_text(
    text: str,
    members: list[dict],
    group_currency: str,
    model: str,
    parsing_level: str = "basic",
    categories: list[dict] | None = None,
    funds: list[dict] | None = None,
    today: date | None = None,
) -> dict:
    """Call LLM to parse natural language expense text into structured data."""
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
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        timeout=30,
    )

    content = response.choices[0].message.content
    if not content:
        raise ValueError("LLM returned empty response")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned invalid JSON: {e}") from e

    if parsed.get("amount") is not None:
        try:
            parsed["amount"] = str(Decimal(str(parsed["amount"])))
        except (InvalidOperation, ValueError):
            parsed["amount"] = None

    return parsed
