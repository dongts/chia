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
