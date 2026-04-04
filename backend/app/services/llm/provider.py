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
    if not content:
        raise ValueError("LLM returned empty response")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned invalid JSON: {e}") from e

    # Coerce amount to Decimal if present
    if parsed.get("amount") is not None:
        try:
            parsed["amount"] = str(Decimal(str(parsed["amount"])))
        except (InvalidOperation, ValueError):
            parsed["amount"] = None

    return parsed
