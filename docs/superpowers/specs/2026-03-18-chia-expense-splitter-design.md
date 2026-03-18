# Chia — Group Expense Splitter

## Overview

Chia is a Tricount-like web application for managing and splitting group expenses. Built for a broad audience with a focus on low-friction onboarding (guest mode) and flexible expense splitting.

**Name:** Chia
**Type:** Web application (mobile planned for future)
**Target audience:** Anyone sharing expenses in groups — trips, shared apartments, events, dinners

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI |
| ORM | SQLAlchemy 2.0 + Alembic |
| Database | PostgreSQL |
| Frontend | React (Vite), TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Routing | React Router v6 |
| Auth | JWT (access + refresh tokens) |
| File Storage | Local (dev), S3-compatible (prod) |
| Dev Environment | Docker Compose |
| Testing | pytest + httpx (BE), Vitest + RTL (FE) |

## Architecture

Monorepo, API-first. FastAPI serves a versioned REST API (`/api/v1/`). React SPA is a fully separate client. Clean separation allows future mobile clients to consume the same API.

```
chia/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── api/v1/
│   │   ├── services/
│   │   ├── core/
│   │   └── utils/
│   ├── migrations/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   └── expense/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── store/
│   │   ├── utils/
│   │   └── types/
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Data Model

### users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| email | VARCHAR(255) | Nullable (guests), unique when set |
| password_hash | VARCHAR(255) | Nullable (guests, social-only) |
| display_name | VARCHAR(100) | Required |
| device_id | VARCHAR(255) | For guest identification |
| avatar_url | VARCHAR(500) | Nullable |
| is_verified | BOOLEAN | False for guests |
| created_at | TIMESTAMP | Default now |
| updated_at | TIMESTAMP | Auto-update |

### user_oauth
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users |
| provider | VARCHAR(50) | google, apple |
| provider_user_id | VARCHAR(255) | |
| created_at | TIMESTAMP | |

Unique constraint on (provider, provider_user_id).

### groups
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(200) | Required |
| description | TEXT | Nullable |
| currency_code | VARCHAR(3) | ISO 4217 (e.g., USD, EUR, VND) |
| invite_code | VARCHAR(20) | Unique, auto-generated |
| default_category_id | UUID | FK → categories, nullable |
| require_verified_users | BOOLEAN | Default false |
| allow_log_on_behalf | BOOLEAN | Default true |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### group_members
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| user_id | UUID | FK → users, nullable (unclaimed placeholders) |
| display_name | VARCHAR(100) | Name shown in group |
| role | ENUM | owner, admin, member |
| claimed_at | TIMESTAMP | Nullable, set when user claims this member |
| is_active | BOOLEAN | Default true, false when removed |
| joined_at | TIMESTAMP | |

Unique constraint on (group_id, user_id) where user_id is not null.

### categories
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups, nullable (null = system default) |
| name | VARCHAR(100) | |
| icon | VARCHAR(50) | Emoji or icon identifier |
| is_default | BOOLEAN | One default per group/system |
| created_at | TIMESTAMP | |

System defaults (group_id = null): General, Food & Drinks, Transport, Accommodation, Shopping, Entertainment, Health, Utilities.

### expenses
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| paid_by | UUID | FK → group_members |
| created_by | UUID | FK → group_members |
| description | VARCHAR(500) | |
| amount | DECIMAL(12,2) | Total expense amount |
| currency_code | VARCHAR(3) | Matches group currency |
| category_id | UUID | FK → categories |
| receipt_url | VARCHAR(500) | Nullable |
| date | DATE | When expense occurred |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### expense_splits
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| expense_id | UUID | FK → expenses |
| group_member_id | UUID | FK → group_members |
| split_type | ENUM | equal, exact, percentage, shares |
| value | DECIMAL(12,4) | The input value (share weight, percentage, or exact amount) |
| resolved_amount | DECIMAL(12,2) | Computed actual amount owed |

`split_type` is stored per row for flexibility but the UI enforces one type per expense.

### settlements
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| from_member | UUID | FK → group_members |
| to_member | UUID | FK → group_members |
| amount | DECIMAL(12,2) | |
| created_by | UUID | FK → group_members |
| settled_at | TIMESTAMP | |

### notifications
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users |
| group_id | UUID | FK → groups, nullable |
| type | VARCHAR(50) | expense_added, expense_updated, expense_deleted, settlement_recorded, member_joined, member_removed, role_changed |
| data | JSONB | Contextual data |
| read | BOOLEAN | Default false |
| created_at | TIMESTAMP | |

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Email + password registration |
| POST | /auth/login | Email + password → JWT |
| POST | /auth/guest | Device ID → JWT (creates guest) |
| POST | /auth/oauth/{provider} | Social login |
| POST | /auth/upgrade | Guest → registered account |
| POST | /auth/refresh | Refresh access token |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | /users/me | Current user profile |
| PATCH | /users/me | Update profile |
| POST | /users/me/avatar | Upload avatar |

### Groups
| Method | Path | Description |
|--------|------|-------------|
| POST | /groups | Create group |
| GET | /groups | List user's groups |
| GET | /groups/{id} | Group detail + balance summary |
| PATCH | /groups/{id} | Update group |
| DELETE | /groups/{id} | Delete group (owner only) |
| POST | /groups/join/{invite_code} | Join via invite code |

### Group Members
| Method | Path | Description |
|--------|------|-------------|
| POST | /groups/{id}/members | Add placeholder member |
| PATCH | /groups/{id}/members/{mid} | Update role, claim member |
| DELETE | /groups/{id}/members/{mid} | Remove member |

### Expenses
| Method | Path | Description |
|--------|------|-------------|
| POST | /groups/{id}/expenses | Create expense |
| GET | /groups/{id}/expenses | List (paginated, filterable) |
| GET | /groups/{id}/expenses/{eid} | Expense detail with splits |
| PATCH | /groups/{id}/expenses/{eid} | Update expense |
| DELETE | /groups/{id}/expenses/{eid} | Delete expense |

### Settlements
| Method | Path | Description |
|--------|------|-------------|
| GET | /groups/{id}/balances | Member balances |
| GET | /groups/{id}/settlements/suggested | Optimized settlement plan |
| POST | /groups/{id}/settlements | Record settlement |
| GET | /groups/{id}/settlements | Settlement history |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | /categories | System defaults |
| GET | /groups/{id}/categories | Group categories |
| POST | /groups/{id}/categories | Add custom category |
| PATCH | /groups/{id}/categories/{cid} | Update |
| DELETE | /groups/{id}/categories/{cid} | Delete |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | /notifications | User notifications (paginated) |
| PATCH | /notifications/{id} | Mark read |
| POST | /notifications/mark-all-read | Mark all read |

## Core Business Logic

### Expense Split Calculation

When creating an expense, the frontend sends the split type and per-member values. The backend computes `resolved_amount` for each split:

- **Equal:** `amount / selected_member_count`. Remainder cents distributed to first N members.
- **Exact:** Values must sum to expense amount. Backend validates.
- **Percentage:** Values must sum to 100. `resolved_amount = amount * percentage / 100`. Remainder cents handled same as equal.
- **Shares:** `resolved_amount = amount * (member_shares / total_shares)`. Remainder cents handled same as equal.

Rounding: always round to 2 decimal places. Any remainder cents (due to rounding) are distributed one cent at a time to members in order until the total matches.

### Debt Simplification

Greedy min-transfers algorithm:
1. Compute net balance per member: `sum(paid) - sum(owed) - sum(settlements_paid) + sum(settlements_received)`
2. Separate into creditors (positive balance) and debtors (negative balance)
3. Sort both by absolute value descending
4. Match largest debtor with largest creditor, transfer `min(|debt|, |credit|)`
5. Update balances, repeat until all zero

This minimizes number of transfers. O(n log n) complexity.

### Member Removal

Removing a member is a **soft-delete** — the group_member row is retained (with an `is_active = false` flag) so that historical expenses and splits remain valid. Removed members no longer appear in active member lists, cannot be selected as payers, and are excluded from new expense splits. Their existing expense history remains visible.

### On-Behalf Expenses

"On behalf" means `paid_by != created_by` — someone logs an expense and attributes payment to a different group member. The `allow_log_on_behalf` group setting gates this: when false, `paid_by` must equal `created_by` for regular members. Owners and admins can always log on behalf regardless of the setting.

### Permissions

| Action | Owner | Admin | Member |
|--------|-------|-------|--------|
| Update group settings | Yes | Yes | No |
| Manage roles (set admin) | Yes | No | No |
| Delete group | Yes | No | No |
| Add placeholder members | Yes | Yes | Yes |
| Remove members | Yes | Yes | No |
| Add expense | Yes | Yes | Yes |
| Add expense on behalf | Yes | Yes | Per setting |
| Edit/delete own expense | Yes | Yes | Yes |
| Edit/delete others' expense | Yes | Yes | No |
| Record settlement | Yes | Yes | Yes |
| Manage categories | Yes | Yes | No |

## Authentication

- JWT-based: access token (15min TTL), refresh token (7 days TTL)
- Access token in Authorization header, refresh token in httpOnly cookie
- Guest flow: client sends device_id → backend creates guest user → returns JWT
- Guest upgrade: POST /auth/upgrade with email + password → same user record updated, is_verified = true, all data preserved
- Social login: OAuth2 authorization code flow with Google and Apple. Backend exchanges code for user info, creates/links account, returns JWT.

## File Storage

- Receipts and avatars uploaded via multipart form
- Dev: local filesystem (`./uploads/`)
- Prod: S3-compatible (configurable via env vars)
- Max size: 10MB
- Accepted types: image/jpeg, image/png, image/webp
- Files stored with UUID filenames to prevent collisions

## Notifications

In-app only. Created by backend services when events occur:
- `expense_added` — when someone adds an expense in your group
- `expense_updated` / `expense_deleted`
- `settlement_recorded` — when someone records a settlement
- `member_joined` — when someone joins your group
- `role_changed` — when your role changes

Delivered via polling (GET /notifications). WebSocket upgrade planned for future.

## Frontend Pages

1. **Landing** — hero section, feature highlights, CTA to sign up or try as guest
2. **Dashboard** — group cards with name, member count, your net balance per group
3. **Group View** — expense list (sorted by date desc), balance summary bar, FAB to add expense, tabs for expenses/balances/settlements
4. **Add/Edit Expense** — form: description, amount, date, payer dropdown, split method tabs (equal/exact/percentage/shares), member selector with value inputs, category dropdown, receipt upload
5. **Balances** — per-member balance list, suggested settlements with "Mark as paid" button
6. **Group Settings** — edit name/description/currency, invite link display + copy, member list with role management, toggle settings (require verified, allow on-behalf)
7. **Profile** — display name, avatar, email (or "upgrade account" for guests), linked social accounts
8. **Notifications** — chronological list, unread badge in nav

## Dev Environment

Docker Compose with three services:
- `db`: PostgreSQL 16, port 5432
- `backend`: FastAPI + uvicorn with hot reload, port 8000
- `frontend`: Vite dev server, port 5173

Backend CORS configured to allow `http://localhost:5173` in dev.

## Testing Strategy

**Backend:**
- pytest with async support (pytest-asyncio)
- httpx AsyncClient for API tests
- factory_boy for test data generation
- Focus areas: split calculations, debt simplification, permissions, auth flows

**Frontend:**
- Vitest for unit/component tests
- React Testing Library for component behavior
- MSW (Mock Service Worker) for API mocking

## Future Considerations (Not in v1)

- Multi-currency with exchange rates
- Push notifications (mobile)
- Email notifications
- Receipt OCR
- Recurring expenses
- Export to CSV/PDF
- Payment integration (Stripe, PayPal)
- WebSocket for real-time updates
