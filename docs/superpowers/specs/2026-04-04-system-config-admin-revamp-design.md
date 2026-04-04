# System Config & Admin UI Revamp — Design Spec

## Overview

Three connected changes: (1) Replace per-env LLM config with standard provider env vars + a DB-driven system config table, (2) Add admin API for managing system config, (3) Revamp admin UI with its own layout and a system config page.

## 1. LLM API Key Simplification

### Remove from config.py
- `llm_model`
- `llm_api_key`
- `llm_default_parsing_level`

### Standard provider env vars
Pass through docker-compose (both dev and prod):
```yaml
GROQ_API_KEY: ${GROQ_API_KEY:-}
OPENAI_API_KEY: ${OPENAI_API_KEY:-}
GEMINI_API_KEY: ${GEMINI_API_KEY:-}
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
```

LiteLLM auto-reads these based on model prefix. Provider wrapper passes `api_key=None`.

### 503 check
The parse endpoint checks `os.environ` for any of the 4 provider keys. If none are set, returns 503.

## 2. System Config Table

### Model
```python
class SystemConfig(Base):
    __tablename__ = "system_config"
    key: str  # Primary key, e.g. "llm.default_model"
    value: str  # Stored as string (JSON-encoded for complex types)
    updated_at: datetime
```

### Registry
Backend defines known settings in a `CONFIG_REGISTRY` dict:

```python
CONFIG_REGISTRY = {
    "llm.default_model": {
        "type": "string",
        "default": "gemini/gemma-4-31b-it",
        "label": "Default LLM Model",
        "description": "LiteLLM model identifier for expense parsing",
    },
    "llm.default_parsing_level": {
        "type": "string",
        "default": "basic",
        "label": "Default Parsing Level",
        "description": "basic, smart, or full",
    },
}
```

Adding a new setting = add one entry to the registry. No migration needed.

### Service (`backend/app/services/system_config.py`)
- `async get_config(db, key) -> str` — DB value if exists, else registry default. Raises if key not in registry.
- `async set_config(db, key, value)` — Upsert. Validates key exists in registry.
- `async get_all_config(db) -> dict` — All registry keys with current values (DB override or default), plus metadata (type, label, description).

### Admin API endpoints
- `GET /admin/config` — Returns all config entries with current values, types, labels, descriptions.
- `PATCH /admin/config/{key}` — Update a single config value. Body: `{"value": "..."}`.

Both require superadmin.

## 3. LLM Provider Update

`backend/app/services/llm/provider.py` changes:
- Reads model from `await get_config(db, "llm.default_model")` instead of `settings.llm_model`
- Passes `api_key=None` to `litellm.acompletion()` (LiteLLM auto-reads env vars)
- Parse endpoint reads `llm.default_parsing_level` from system config

`backend/app/api/v1/expense_parse.py` changes:
- 503 check: `if not any(os.environ.get(k) for k in ("GROQ_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"))`
- Reads default model and parsing level from system config service

## 4. Admin UI Revamp

### New AdminLayout
`frontend/src/components/layout/AdminLayout.tsx`:
- Own sidebar with admin navigation: Dashboard, Users, Groups, System Config
- Header with "Admin Panel" title and "Back to app" link
- No user-facing navigation (no groups list, no notifications)

### Route changes in App.tsx
`/admin/*` uses `AdminLayout` instead of `AppLayout`:
- `/admin` → AdminDashboard
- `/admin/users` → AdminUsers
- `/admin/groups` → AdminGroups
- `/admin/config` → AdminConfig

### Split Admin.tsx into pages
- `frontend/src/pages/admin/AdminDashboard.tsx` — Stats cards (existing dashboard tab)
- `frontend/src/pages/admin/AdminUsers.tsx` — Users management (existing users tab)
- `frontend/src/pages/admin/AdminGroups.tsx` — Groups management (existing groups tab)
- `frontend/src/pages/admin/AdminConfig.tsx` — New system config page

### AdminConfig page
- Lists all registry settings with current values
- `llm.default_model`: Dropdown with predefined models + "Custom..." option revealing text input
- `llm.default_parsing_level`: Dropdown (basic/smart/full)
- Save button per setting

### Predefined LLM models (frontend constant)
```typescript
const LLM_MODEL_OPTIONS = [
  { value: "gemini/gemma-4-31b-it", label: "Gemma 4 31B (Google)" },
  { value: "gemini/gemini-2.0-flash", label: "Gemini 2.0 Flash (Google)" },
  { value: "groq/llama-3.1-8b-instant", label: "Llama 3.1 8B (Groq)" },
  { value: "groq/llama-3.1-70b-versatile", label: "Llama 3.1 70B (Groq)" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (OpenAI)" },
  { value: "gpt-4o", label: "GPT-4o (OpenAI)" },
  { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku (Anthropic)" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Anthropic)" },
];
```

## Out of Scope

- Per-group LLM model override
- LLM usage tracking/analytics
- API key management in the admin UI (keys stay as env vars for security)
- Non-LLM system config entries (will be added to registry as needed)
