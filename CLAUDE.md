# Chia — Expense Splitter (Tricount-like)

## Commands

```bash
# Backend (from backend/)
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # Dev server on :8000
alembic upgrade head                   # Run migrations
alembic revision --autogenerate -m ""  # Create migration
pytest tests/ -v                       # Tests (needs chia_test DB)

# Frontend (from frontend/)
npm install
npm run dev       # Vite dev server on :5173
npm run build     # Production build → dist/
npm run lint      # ESLint

# Docker
docker compose up -d                   # Dev (hot-reload)
docker compose -f docker-compose.prod.yml up -d  # Prod (Caddy + HTTPS)
```

## Architecture

```
backend/app/
  api/v1/         # FastAPI route handlers (auth, groups, expenses, settlements, etc.)
  models/         # SQLAlchemy async ORM models (UUID PKs, Mapped[] types)
  schemas/        # Pydantic request/response models
  services/       # Business logic (debt_simplifier, split_calculator, file_storage)
  core/           # Security (JWT), permissions (role-based), exceptions
  config.py       # pydantic-settings, env prefix CHIA_
  database.py     # Async engine + session (asyncpg)
  main.py         # App entry point, lifespan seeds categories

backend/mcp_server/  # MCP server for Claude.ai integration (port 8001)
backend/migrations/  # Alembic versions

frontend/src/
  api/            # Axios client with auto token refresh
  store/          # Zustand stores (auth, notifications)
  pages/          # Route components
  components/     # Reusable UI (layouts, etc.)
  types/          # TypeScript types
```

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async), asyncpg, Alembic
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand
- **Database:** PostgreSQL 16 (UUID PKs, Numeric(12,2) for money)
- **Auth:** JWT (access + refresh tokens), Google OAuth, guest mode (device_id)
- **Deployment:** Docker Compose + Caddy (auto-HTTPS), or Railway/Vercel/Supabase

## Code Conventions

- Backend: async/await everywhere, FastAPI Depends() for DI, snake_case
- Frontend: functional components + hooks, PascalCase components, camelCase vars
- All datetimes UTC (DateTime(timezone=True))
- Amounts as Decimal, never float
- Roles: owner > admin > member (checked via permissions.py)
- Split types: equal, exact, percentage, shares
- 4 custom exceptions: NotFound, Forbidden, BadRequest, Unauthorized

## Key Gotchas

- `entrypoint.sh` auto-runs `alembic upgrade head` — no manual migration step in Docker
- CHIA_CORS_ORIGINS must exactly match frontend domain
- USE_CONNECTION_POOLER=true required for Supabase/PgBouncer (disables prepared statements)
- JWT tokens expire after 1 year; refresh tokens after 365 days
- Guest users tracked by device_id, upgradeable to verified accounts
- System categories auto-seeded on first startup via lifespan hook
- File uploads: local dir by default, Cloudflare R2 if CHIA_R2_BUCKET_NAME is set
- Frontend service worker only registered in production
- No backend linter configured (consider adding ruff)
- Test coverage is minimal (auth, split_calculator, debt_simplifier only)
