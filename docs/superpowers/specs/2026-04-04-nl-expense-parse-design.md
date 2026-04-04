# Natural Language Expense Parsing — Design Spec

## Overview

Add a natural language input to the AddExpense page that lets users describe expenses in free text (e.g. "dinner 45.50 Alice paid split with Bob"). The backend parses the text via LLM and returns a structured draft that pre-fills the existing expense form for review and submission.

## Architecture

### New Backend Files

- `backend/app/services/llm/provider.py` — LiteLLM wrapper, single `parse_expense_text()` async function
- `backend/app/services/llm/prompts.py` — System prompt templates per parsing level
- `backend/app/schemas/expense_parse.py` — Request/response Pydantic models
- `backend/app/api/v1/expense_parse.py` — New router with the parse endpoint

### New Endpoint

`POST /groups/{group_id}/expenses/parse`

Requires authentication + group membership (reuses existing `get_current_member` dependency).

**Request:**

```json
{
  "text": "dinner 45.50 Alice paid split with Bob",
  "parsing_level": "basic"
}
```

| Field | Type | Required | Default |
|---|---|---|---|
| `text` | `str` (max 500 chars) | yes | — |
| `parsing_level` | `"basic" \| "smart" \| "full"` | no | `"basic"` (or `CHIA_LLM_DEFAULT_PARSING_LEVEL`) |

**Response (`ExpenseParseDraft`):**

```json
{
  "description": "Dinner",
  "amount": 45.50,
  "currency_code": null,
  "date": null,
  "paid_by_member_id": "uuid-of-alice",
  "category_id": "uuid-of-food",
  "split_type": "equal",
  "splits": [
    { "group_member_id": "uuid-of-alice", "value": 1 },
    { "group_member_id": "uuid-of-bob", "value": 1 }
  ],
  "confidence": 0.9,
  "raw_extraction": {}
}
```

| Field | Type | Notes |
|---|---|---|
| `description` | `str \| null` | Cleaned-up expense description |
| `amount` | `Decimal \| null` | Parsed amount |
| `currency_code` | `str \| null` | `null` → use group default |
| `date` | `date \| null` | `null` → today |
| `paid_by_member_id` | `UUID \| null` | Resolved from member name |
| `category_id` | `UUID \| null` | Resolved from description (level B+) |
| `split_type` | `SplitType \| null` | `null` → equal |
| `splits` | `list[SplitInput] \| null` | `null` → equal among mentioned/all members |
| `confidence` | `float` | 0-1 overall confidence |
| `raw_extraction` | `dict` | Raw LLM JSON output, for backend logging/debugging only; frontend ignores this |

**Error responses:**

| Status | Condition |
|---|---|
| 422 | LLM returned unparseable output or timed out |
| 503 | `CHIA_LLM_API_KEY` not configured |

### LLM Integration

Uses **LiteLLM** as the single dependency for provider abstraction. Supports Claude, OpenAI, Groq, and Gemini by changing the model string.

```python
await litellm.acompletion(
    model=settings.LLM_MODEL,
    messages=[system_prompt, user_prompt],
    response_format={"type": "json_object"},
    api_key=settings.LLM_API_KEY,
)
```

**Timeout:** 10 seconds.

### Configuration

New env vars in `backend/app/config.py` (all with `CHIA_` prefix):

| Var | Type | Default | Notes |
|---|---|---|---|
| `CHIA_LLM_MODEL` | `str` | `"groq/llama-3.1-8b-instant"` | LiteLLM model identifier |
| `CHIA_LLM_API_KEY` | `str \| None` | `None` | Provider API key; feature disabled if unset |
| `CHIA_LLM_DEFAULT_PARSING_LEVEL` | `str` | `"basic"` | Default parsing level |

## Parsing Levels

### Level A — Basic (default)

Extracts: description, amount, payer, members to split with.

**Prompt context provided:** Group member names + IDs, group currency.

**Behavior:**
- If payer not identified → `paid_by_member_id: null`
- If no members mentioned → split among all active group members
- Split type always `equal`

### Level B — Smart

Everything in Level A, plus: category inference, date parsing, currency detection.

**Additional prompt context:** Categories (name + icon + ID).

**Behavior:**
- Infers category from expense description context (e.g. "taxi" → Transport)
- Parses relative dates ("yesterday", "last Friday") using today's date provided in prompt
- Detects currency if mentioned ("30 EUR"), otherwise defaults to group currency

### Level C — Full

Everything in Level B, plus: non-equal split parsing, fund deductions.

**Additional prompt context:** Fund names + IDs.

**Behavior:**
- "Bob owes 20, I owe the rest" → `split_type: "exact"` with calculated amounts
- "split 60/40 with Bob" → `split_type: "percentage"`
- "Bob pays double" → `split_type: "shares"`
- "use trip fund for 10" → `fund_deductions` populated

## Prompt Design

Each prompt includes:

1. **System message:** Role definition, output JSON schema, parsing level instructions
2. **User message:** The user's free text, prefixed with group context:
   - Member list: `Members: Alice (id: ...), Bob (id: ...), Charlie (id: ...)`
   - Group currency: `Group currency: USD`
   - Categories (level B+): `Categories: 🍔 Food & Drinks (id: ...), 🚕 Transport (id: ...), ...`
   - Funds (level C): `Funds: Trip Fund (id: ...), ...`
   - Today's date (level B+): `Today: 2026-04-04`

The LLM returns JSON matching the structured output schema. Fields it cannot determine are `null`.

## Backend Processing

After receiving the LLM response:

1. **Validate member IDs** — Drop any member IDs not found in the group's active members
2. **Validate category ID** — If returned category doesn't match a real one, set to `null`
3. **Validate fund IDs** (level C) — Drop unknown funds
4. **Build `ExpenseParseDraft`** — Map validated data into response schema
5. **Return** — Frontend handles `null` fields by keeping form defaults

## Frontend Changes

### AddExpense.tsx

A text input area at the top of the form, above existing fields:

```
┌─────────────────────────────────────┐
│ ✨ Describe your expense            │
│ ┌─────────────────────────────────┐ │
│ │ dinner 45.50 Alice paid split   │ │
│ │ with Bob                        │ │
│ └─────────────────────────────────┘ │
│              [Parse]                │
└─────────────────────────────────────┘
│  ↓ form fields below get pre-filled │
```

**Behavior:**
1. User types text, clicks "Parse" or presses Enter
2. Loading spinner on button while request is in flight
3. On success: pre-fill form fields from `ExpenseParseDraft`. `null` fields keep existing defaults.
4. On 422/timeout: toast "Couldn't understand that. Please fill the form manually." Form untouched.
5. On 503 (first time): toast "AI parsing not configured." Hide the text input for the rest of the session.
6. User reviews pre-filled form, adjusts as needed, submits via existing flow.

### API Client

New function in `frontend/src/api/`:

```typescript
parseExpense(groupId: string, text: string, parsingLevel?: string): Promise<ExpenseParseDraft>
```

### New Type

```typescript
interface ExpenseParseDraft {
  description: string | null;
  amount: number | null;
  currency_code: string | null;
  date: string | null;
  paid_by_member_id: string | null;
  category_id: string | null;
  split_type: SplitType | null;
  splits: SplitInput[] | null;
  confidence: number;
  raw_extraction: Record<string, unknown>;
}
```

## Edge Cases

| Case | Handling |
|---|---|
| Ambiguous member name ("Al" → Alice or Alan?) | LLM picks best match; user corrects in form |
| Amount not found | `amount: null` → field stays empty |
| No members mentioned | Equal split among all active group members |
| Multiple currencies ("30 EUR plus 20 USD") | Parse first/primary; user adjusts |
| LLM hallucinated a non-existent member | Backend drops unknown IDs, logs warning |
| Prompt injection attempts | Input truncated to 500 chars; group context is in system prompt |
| LLM API timeout | 10s timeout → 422 response |
| `CHIA_LLM_API_KEY` not set | 503 response → frontend hides input for session |

## Dependencies

**New Python package:** `litellm` (added to `backend/requirements.txt`)

**No new frontend packages.**

## Out of Scope

- Voice input
- Multi-expense parsing from a single message
- Conversation / follow-up clarification ("which Alice?")
- Storing parse history or analytics
- Admin UI for configuring LLM settings (env vars only)
