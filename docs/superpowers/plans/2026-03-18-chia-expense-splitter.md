# Chia Expense Splitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tricount-like group expense splitting web app with FastAPI backend and React frontend.

**Architecture:** Monorepo with separate `backend/` (FastAPI REST API) and `frontend/` (React SPA via Vite). PostgreSQL database via SQLAlchemy 2.0 + Alembic. JWT auth with guest/registered user support. Docker Compose for local dev.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 16, React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, React Router v6, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-chia-expense-splitter-design.md`

---

## File Structure

```
chia/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                          # FastAPI app, CORS, router includes
│   │   ├── config.py                        # Pydantic Settings (DB URL, JWT secret, etc.)
│   │   ├── database.py                      # Engine, async sessionmaker, get_db dependency
│   │   ├── models/
│   │   │   ├── __init__.py                  # Re-export all models
│   │   │   ├── user.py                      # User, UserOAuth
│   │   │   ├── group.py                     # Group
│   │   │   ├── group_member.py              # GroupMember
│   │   │   ├── category.py                  # Category
│   │   │   ├── expense.py                   # Expense, ExpenseSplit
│   │   │   ├── settlement.py                # Settlement
│   │   │   └── notification.py              # Notification
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                      # Register, Login, Token, GuestAuth
│   │   │   ├── user.py                      # UserRead, UserUpdate
│   │   │   ├── group.py                     # GroupCreate, GroupRead, GroupUpdate
│   │   │   ├── group_member.py              # MemberCreate, MemberRead, MemberUpdate
│   │   │   ├── category.py                  # CategoryCreate, CategoryRead
│   │   │   ├── expense.py                   # ExpenseCreate, ExpenseRead, SplitInput
│   │   │   ├── settlement.py                # SettlementCreate, SettlementRead, SuggestedSettlement
│   │   │   └── notification.py              # NotificationRead
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── router.py                # Aggregate v1 router
│   │   │       ├── auth.py                  # Auth endpoints
│   │   │       ├── users.py                 # User endpoints
│   │   │       ├── groups.py                # Group CRUD endpoints
│   │   │       ├── members.py               # Group member endpoints
│   │   │       ├── expenses.py              # Expense CRUD endpoints
│   │   │       ├── settlements.py           # Settlement + balance endpoints
│   │   │       ├── categories.py            # Category endpoints
│   │   │       └── notifications.py         # Notification endpoints
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                      # Password hashing, JWT create/verify, guest logic
│   │   │   ├── split_calculator.py          # Split computation for all 4 types
│   │   │   ├── debt_simplifier.py           # Min-transfers algorithm
│   │   │   ├── notification.py              # Create notifications for events
│   │   │   └── file_storage.py              # Local/S3 file upload
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── security.py                  # get_current_user dependency, JWT decode
│   │   │   ├── permissions.py               # Role-based permission checks
│   │   │   └── exceptions.py                # Custom HTTP exceptions
│   │   └── utils/
│   │       ├── __init__.py
│   │       └── invite_code.py               # Generate unique invite codes
│   ├── migrations/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/                        # Alembic migration files
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py                      # Fixtures: async client, test DB, factories
│   │   ├── factories.py                     # factory_boy factories for all models
│   │   ├── test_auth.py
│   │   ├── test_groups.py
│   │   ├── test_members.py
│   │   ├── test_expenses.py
│   │   ├── test_settlements.py
│   │   ├── test_split_calculator.py
│   │   ├── test_debt_simplifier.py
│   │   ├── test_categories.py
│   │   └── test_notifications.py
│   ├── requirements.txt
│   ├── alembic.ini
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx                         # React entry point
│   │   ├── App.tsx                          # Router setup
│   │   ├── api/
│   │   │   ├── client.ts                    # Axios instance with interceptors
│   │   │   ├── auth.ts                      # Auth API calls
│   │   │   ├── groups.ts                    # Group API calls
│   │   │   ├── expenses.ts                  # Expense API calls
│   │   │   ├── settlements.ts               # Settlement API calls
│   │   │   ├── categories.ts                # Category API calls
│   │   │   └── notifications.ts             # Notification API calls
│   │   ├── components/
│   │   │   ├── ui/                          # shadcn/ui components (Button, Input, etc.)
│   │   │   ├── layout/
│   │   │   │   ├── AppLayout.tsx            # Authenticated app shell (nav, sidebar)
│   │   │   │   └── PublicLayout.tsx         # Unauthenticated layout
│   │   │   ├── expense/
│   │   │   │   ├── ExpenseCard.tsx          # Single expense display
│   │   │   │   ├── ExpenseForm.tsx          # Add/edit expense form
│   │   │   │   └── SplitMethodTabs.tsx      # Equal/exact/percentage/shares tabs
│   │   │   ├── group/
│   │   │   │   ├── GroupCard.tsx            # Group summary card for dashboard
│   │   │   │   ├── MemberList.tsx           # Member management list
│   │   │   │   └── InviteLink.tsx           # Invite code display + copy
│   │   │   └── settlement/
│   │   │       ├── BalanceList.tsx           # Per-member balances
│   │   │       └── SuggestedSettlements.tsx  # Who pays whom
│   │   ├── hooks/
│   │   │   ├── useAuth.ts                   # Auth state + actions
│   │   │   └── useNotifications.ts          # Notification polling + state
│   │   ├── pages/
│   │   │   ├── Landing.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── GroupView.tsx
│   │   │   ├── AddExpense.tsx
│   │   │   ├── EditExpense.tsx
│   │   │   ├── GroupSettings.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── JoinGroup.tsx
│   │   │   └── NotFound.tsx
│   │   ├── store/
│   │   │   ├── authStore.ts                 # Zustand: user, tokens, login/logout
│   │   │   ├── groupStore.ts                # Zustand: current group, members
│   │   │   └── notificationStore.ts         # Zustand: notifications, unread count
│   │   ├── utils/
│   │   │   ├── currency.ts                  # Format currency amounts
│   │   │   └── deviceId.ts                  # Generate/retrieve device ID
│   │   └── types/
│   │       └── index.ts                     # Shared TypeScript interfaces
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── Dockerfile
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## Task 1: Project Scaffolding & Dev Environment

**Files:**
- Create: `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/config.py`, `backend/app/database.py`
- Create: `backend/requirements.txt`, `backend/alembic.ini`, `backend/Dockerfile`
- Create: `docker-compose.yml`
- Create: All `__init__.py` stubs for backend packages

- [ ] **Step 1: Create backend requirements.txt**

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
sqlalchemy[asyncio]==2.0.36
asyncpg==0.30.0
alembic==1.14.1
pydantic-settings==2.7.1
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.20
httpx==0.28.1
boto3==1.36.7
pillow==11.1.0
factory-boy==3.3.1
pytest==8.3.4
pytest-asyncio==0.25.2
```

- [ ] **Step 2: Create backend/app/config.py**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://chia:chia@localhost:5432/chia"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    upload_dir: str = "./uploads"
    max_upload_size: int = 10 * 1024 * 1024  # 10MB
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"env_prefix": "CHIA_"}


settings = Settings()
```

- [ ] **Step 3: Create backend/app/database.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session
```

- [ ] **Step 4: Create backend/app/main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="Chia", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Create all __init__.py stubs**

Create empty `__init__.py` in: `backend/app/`, `backend/app/models/`, `backend/app/schemas/`, `backend/app/api/`, `backend/app/api/v1/`, `backend/app/services/`, `backend/app/core/`, `backend/app/utils/`, `backend/tests/`

- [ ] **Step 6: Create backend Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 7: Create docker-compose.yml**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: chia
      POSTGRES_PASSWORD: chia
      POSTGRES_DB: chia
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      CHIA_DATABASE_URL: postgresql+asyncpg://chia:chia@db:5432/chia
    depends_on:
      - db
    volumes:
      - ./backend:/app
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 8: Initialize Alembic**

```bash
cd backend
pip install -r requirements.txt
alembic init migrations
```

Then update `backend/alembic.ini` to set `sqlalchemy.url = postgresql+asyncpg://chia:chia@localhost:5432/chia` and update `backend/migrations/env.py` to use async engine and import `app.database.Base`.

- [ ] **Step 9: Verify setup**

```bash
docker compose up -d db
cd backend && uvicorn app.main:app --reload
# In another terminal:
curl http://localhost:8000/health
# Expected: {"status":"ok"}
```

- [ ] **Step 10: Commit**

```bash
git add backend/ docker-compose.yml
git commit -m "feat: project scaffolding with FastAPI, Docker Compose, and Alembic"
```

---

## Task 2: Database Models & Initial Migration

**Files:**
- Create: `backend/app/models/user.py`, `backend/app/models/group.py`, `backend/app/models/group_member.py`, `backend/app/models/category.py`, `backend/app/models/expense.py`, `backend/app/models/settlement.py`, `backend/app/models/notification.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create backend/app/models/user.py**

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(100))
    device_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    oauth_accounts: Mapped[list["UserOAuth"]] = relationship(back_populates="user")


class UserOAuth(Base):
    __tablename__ = "user_oauth"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(50))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="oauth_accounts")

    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)
```

Note: Add missing imports (`ForeignKey`, `UniqueConstraint`) from `sqlalchemy`.

- [ ] **Step 2: Create backend/app/models/group.py**

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    invite_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    require_verified_users: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_log_on_behalf: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    members: Mapped[list["GroupMember"]] = relationship(back_populates="group")
    expenses: Mapped[list["Expense"]] = relationship(back_populates="group")
    settlements: Mapped[list["Settlement"]] = relationship(back_populates="group")
```

- [ ] **Step 3: Create backend/app/models/group_member.py**

```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class GroupMember(Base):
    __tablename__ = "group_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[MemberRole] = mapped_column(Enum(MemberRole), default=MemberRole.member)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group"] = relationship(back_populates="members")
    user: Mapped["User | None"] = relationship()

    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_user"),
    )
```

- [ ] **Step 4: Create backend/app/models/category.py**

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(100))
    icon: Mapped[str] = mapped_column(String(50), default="📦")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 5: Create backend/app/models/expense.py**

```python
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SplitType(str, enum.Enum):
    equal = "equal"
    exact = "exact"
    percentage = "percentage"
    shares = "shares"


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    paid_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    description: Mapped[str] = mapped_column(String(500))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency_code: Mapped[str] = mapped_column(String(3))
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"))
    receipt_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    group: Mapped["Group"] = relationship(back_populates="expenses")
    payer: Mapped["GroupMember"] = relationship(foreign_keys=[paid_by])
    creator: Mapped["GroupMember"] = relationship(foreign_keys=[created_by])
    category: Mapped["Category"] = relationship()
    splits: Mapped[list["ExpenseSplit"]] = relationship(back_populates="expense", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"))
    group_member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    split_type: Mapped[SplitType] = mapped_column(Enum(SplitType))
    value: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    resolved_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    expense: Mapped["Expense"] = relationship(back_populates="splits")
    member: Mapped["GroupMember"] = relationship()
```

- [ ] **Step 6: Create backend/app/models/settlement.py**

```python
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"))
    from_member: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    to_member: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("group_members.id"))
    settled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group"] = relationship(back_populates="settlements")
    payer: Mapped["GroupMember"] = relationship(foreign_keys=[from_member])
    payee: Mapped["GroupMember"] = relationship(foreign_keys=[to_member])
```

- [ ] **Step 7: Create backend/app/models/notification.py**

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    type: Mapped[str] = mapped_column(String(50))
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 8: Update backend/app/models/__init__.py**

```python
from app.models.user import User, UserOAuth
from app.models.group import Group
from app.models.group_member import GroupMember, MemberRole
from app.models.category import Category
from app.models.expense import Expense, ExpenseSplit, SplitType
from app.models.settlement import Settlement
from app.models.notification import Notification

__all__ = [
    "User", "UserOAuth", "Group", "GroupMember", "MemberRole",
    "Category", "Expense", "ExpenseSplit", "SplitType",
    "Settlement", "Notification",
]
```

- [ ] **Step 9: Update Alembic env.py for async and import models**

Update `backend/migrations/env.py`:
- Import `from app.database import Base`
- Import `from app.models import *`  (to register all models)
- Set `target_metadata = Base.metadata`
- Configure async engine for migrations using `run_async_migrations()`

- [ ] **Step 10: Generate and run initial migration**

```bash
cd backend
alembic revision --autogenerate -m "initial tables"
alembic upgrade head
```

- [ ] **Step 11: Create seed script for default categories**

Create `backend/app/utils/seed.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Category

SYSTEM_CATEGORIES = [
    ("General", "📦", True),
    ("Food & Drinks", "🍔", False),
    ("Transport", "🚗", False),
    ("Accommodation", "🏠", False),
    ("Shopping", "🛍️", False),
    ("Entertainment", "🎬", False),
    ("Health", "💊", False),
    ("Utilities", "💡", False),
]


async def seed_categories(db: AsyncSession):
    from sqlalchemy import select
    existing = await db.execute(select(Category).where(Category.group_id.is_(None)))
    if existing.scalars().first():
        return
    for name, icon, is_default in SYSTEM_CATEGORIES:
        db.add(Category(name=name, icon=icon, is_default=is_default))
    await db.commit()
```

- [ ] **Step 12: Add startup event to seed categories**

Add to `backend/app/main.py`:

```python
from app.database import async_session
from app.utils.seed import seed_categories

@app.on_event("startup")
async def startup():
    async with async_session() as db:
        await seed_categories(db)
```

- [ ] **Step 13: Commit**

```bash
git add backend/
git commit -m "feat: database models and initial migration with seed categories"
```

---

## Task 3: Auth Service & Endpoints

**Files:**
- Create: `backend/app/services/auth.py`, `backend/app/core/security.py`, `backend/app/core/exceptions.py`
- Create: `backend/app/schemas/auth.py`, `backend/app/schemas/user.py`
- Create: `backend/app/api/v1/auth.py`, `backend/app/api/v1/users.py`, `backend/app/api/v1/router.py`
- Create: `backend/tests/conftest.py`, `backend/tests/test_auth.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create backend/app/core/exceptions.py**

```python
from fastapi import HTTPException, status


class NotFound(HTTPException):
    def __init__(self, detail: str = "Not found"):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class Forbidden(HTTPException):
    def __init__(self, detail: str = "Forbidden"):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class BadRequest(HTTPException):
    def __init__(self, detail: str = "Bad request"):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
```

- [ ] **Step 2: Create backend/app/services/auth.py**

```python
from datetime import datetime, timedelta, timezone

from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "access"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "refresh"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()


async def get_user_by_device_id(db: AsyncSession, device_id: str) -> User | None:
    result = await db.execute(select(User).where(User.device_id == device_id))
    return result.scalars().first()
```

- [ ] **Step 3: Create backend/app/core/security.py**

```python
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.services.auth import decode_token

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
```

- [ ] **Step 4: Create backend/app/schemas/auth.py**

```python
from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GuestAuthRequest(BaseModel):
    device_id: str
    display_name: str = "Guest"


class UpgradeRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str
```

- [ ] **Step 5: Create backend/app/schemas/user.py**

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserRead(BaseModel):
    id: uuid.UUID
    email: EmailStr | None
    display_name: str
    avatar_url: str | None
    is_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    display_name: str | None = None
```

- [ ] **Step 6: Create backend/app/api/v1/auth.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas.auth import (
    GuestAuthRequest, LoginRequest, RefreshRequest,
    RegisterRequest, TokenResponse, UpgradeRequest,
)
from app.services.auth import (
    create_access_token, create_refresh_token, decode_token,
    get_user_by_device_id, get_user_by_email,
    hash_password, verify_password,
)
from app.core.security import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, data.email)
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/guest", response_model=TokenResponse)
async def guest_auth(data: GuestAuthRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_device_id(db, data.device_id)
    if not user:
        user = User(device_id=data.device_id, display_name=data.display_name, is_verified=False)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/upgrade", response_model=TokenResponse)
async def upgrade_guest(
    data: UpgradeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.is_verified:
        raise HTTPException(status_code=400, detail="Already a verified user")
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    current_user.email = data.email
    current_user.password_hash = hash_password(data.password)
    current_user.is_verified = True
    if data.display_name:
        current_user.display_name = data.display_name
    await db.commit()
    return TokenResponse(
        access_token=create_access_token(str(current_user.id)),
        refresh_token=create_refresh_token(str(current_user.id)),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(data: RefreshRequest):
    try:
        payload = decode_token(data.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
```

- [ ] **Step 7: Create backend/app/api/v1/users.py**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.schemas.user import UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.display_name is not None:
        current_user.display_name = data.display_name
    await db.commit()
    await db.refresh(current_user)
    return current_user
```

- [ ] **Step 8: Create backend/app/api/v1/router.py and wire into main.py**

```python
from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(users_router)
```

Add to `main.py`: `from app.api.v1.router import api_router` and `app.include_router(api_router)`.

- [ ] **Step 9: Create backend/tests/conftest.py**

```python
import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.services.auth import create_access_token, hash_password
from app.models import User

TEST_DB_URL = "postgresql+asyncpg://chia:chia@localhost:5432/chia_test"

engine = create_async_engine(TEST_DB_URL)
TestSession = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db():
    async with TestSession() as session:
        yield session


@pytest_asyncio.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db: AsyncSession):
    user = User(
        email="test@example.com",
        password_hash=hash_password("testpass123"),
        display_name="Test User",
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(test_user: User):
    token = create_access_token(str(test_user.id))
    return {"Authorization": f"Bearer {token}"}
```

- [ ] **Step 10: Write tests for auth endpoints**

Create `backend/tests/test_auth.py`:

```python
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register", json={
        "email": "new@example.com", "password": "pass123", "display_name": "New User",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/register", json={
        "email": "test@example.com", "password": "pass123", "display_name": "Dup",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/login", json={
        "email": "test@example.com", "password": "testpass123",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_user):
    resp = await client.post("/api/v1/auth/login", json={
        "email": "test@example.com", "password": "wrong",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_guest_auth(client: AsyncClient):
    resp = await client.post("/api/v1/auth/guest", json={
        "device_id": "device-123", "display_name": "Guest User",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_guest_auth_same_device(client: AsyncClient):
    resp1 = await client.post("/api/v1/auth/guest", json={"device_id": "dev-1", "display_name": "G"})
    resp2 = await client.post("/api/v1/auth/guest", json={"device_id": "dev-1", "display_name": "G"})
    assert resp1.status_code == 200
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, auth_headers):
    resp = await client.get("/api/v1/users/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={
        "email": "ref@example.com", "password": "pass123", "display_name": "Ref",
    })
    refresh = reg.json()["refresh_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
```

- [ ] **Step 11: Run tests**

```bash
cd backend
# Create test database first:
docker compose exec db createdb -U chia chia_test
pytest tests/test_auth.py -v
```

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add backend/
git commit -m "feat: auth service with register, login, guest, upgrade, and JWT refresh"
```

---

## Task 4: Groups & Members CRUD

**Files:**
- Create: `backend/app/schemas/group.py`, `backend/app/schemas/group_member.py`
- Create: `backend/app/api/v1/groups.py`, `backend/app/api/v1/members.py`
- Create: `backend/app/core/permissions.py`, `backend/app/utils/invite_code.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/tests/test_groups.py`, `backend/tests/test_members.py`

- [ ] **Step 1: Create backend/app/utils/invite_code.py**

```python
import secrets
import string


def generate_invite_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
```

- [ ] **Step 2: Create backend/app/core/permissions.py**

```python
from app.models import GroupMember, MemberRole
from app.core.exceptions import Forbidden


def require_role(member: GroupMember, *roles: MemberRole):
    if member.role not in roles:
        raise Forbidden(f"Requires role: {', '.join(r.value for r in roles)}")


def require_active(member: GroupMember):
    if not member.is_active:
        raise Forbidden("Member is no longer active in this group")
```

- [ ] **Step 3: Create backend/app/schemas/group.py**

```python
import uuid
from datetime import datetime
from pydantic import BaseModel


class GroupCreate(BaseModel):
    name: str
    description: str | None = None
    currency_code: str = "USD"


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    currency_code: str | None = None
    require_verified_users: bool | None = None
    allow_log_on_behalf: bool | None = None


class GroupRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    currency_code: str
    invite_code: str
    require_verified_users: bool
    allow_log_on_behalf: bool
    created_at: datetime
    member_count: int | None = None

    model_config = {"from_attributes": True}


class GroupListItem(BaseModel):
    id: uuid.UUID
    name: str
    currency_code: str
    member_count: int
    my_balance: float = 0.0

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Create backend/app/schemas/group_member.py**

```python
import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.group_member import MemberRole


class MemberCreate(BaseModel):
    display_name: str


class MemberUpdate(BaseModel):
    role: MemberRole | None = None
    display_name: str | None = None


class MemberRead(BaseModel):
    id: uuid.UUID
    display_name: str
    role: MemberRole
    user_id: uuid.UUID | None
    is_active: bool
    claimed_at: datetime | None
    joined_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 5: Create backend/app/api/v1/groups.py**

```python
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.permissions import require_active, require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Group, GroupMember, MemberRole, User
from app.schemas.group import GroupCreate, GroupListItem, GroupRead, GroupUpdate
from app.utils.invite_code import generate_invite_code

router = APIRouter(prefix="/groups", tags=["groups"])


async def get_group_or_404(db: AsyncSession, group_id: uuid.UUID) -> Group:
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise NotFound("Group not found")
    return group


async def get_current_member(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember:
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,
        )
    )
    member = result.scalars().first()
    if not member:
        raise Forbidden("Not a member of this group")
    return member


@router.post("", response_model=GroupRead)
async def create_group(
    data: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = Group(
        name=data.name,
        description=data.description,
        currency_code=data.currency_code,
        invite_code=generate_invite_code(),
    )
    db.add(group)
    await db.flush()
    member = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        display_name=current_user.display_name,
        role=MemberRole.owner,
        claimed_at=func.now(),
    )
    db.add(member)
    await db.commit()
    await db.refresh(group)
    return group


@router.get("", response_model=list[GroupListItem])
async def list_groups(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group, func.count(GroupMember.id).label("member_count"))
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.is_active == True)
        .where(
            Group.id.in_(
                select(GroupMember.group_id).where(
                    GroupMember.user_id == current_user.id,
                    GroupMember.is_active == True,
                )
            )
        )
        .group_by(Group.id)
    )
    items = []
    for group, member_count in result.all():
        items.append(GroupListItem(
            id=group.id,
            name=group.name,
            currency_code=group.currency_code,
            member_count=member_count,
        ))
    return items


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    count_result = await db.execute(
        select(func.count(GroupMember.id)).where(
            GroupMember.group_id == group_id, GroupMember.is_active == True
        )
    )
    group_dict = GroupRead.model_validate(group)
    group_dict.member_count = count_result.scalar()
    return group_dict


@router.patch("/{group_id}", response_model=GroupRead)
async def update_group(
    group_id: uuid.UUID,
    data: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner, MemberRole.admin)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}")
async def delete_group(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group = await get_group_or_404(db, group_id)
    member = await get_current_member(db, group_id, current_user.id)
    require_role(member, MemberRole.owner)
    await db.delete(group)
    await db.commit()
    return {"detail": "Group deleted"}


@router.post("/join/{invite_code}", response_model=GroupRead)
async def join_group(
    invite_code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).where(Group.invite_code == invite_code))
    group = result.scalars().first()
    if not group:
        raise NotFound("Invalid invite code")

    if group.require_verified_users and not current_user.is_verified:
        raise Forbidden("This group requires verified users")

    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.user_id == current_user.id,
        )
    )
    if existing.scalars().first():
        raise BadRequest("Already a member of this group")

    member = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        display_name=current_user.display_name,
        role=MemberRole.member,
        claimed_at=func.now(),
    )
    db.add(member)
    await db.commit()
    await db.refresh(group)
    return group
```

- [ ] **Step 6: Create backend/app/api/v1/members.py**

```python
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequest, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import GroupMember, MemberRole, User
from app.schemas.group_member import MemberCreate, MemberRead, MemberUpdate
from app.api.v1.groups import get_current_member, get_group_or_404

router = APIRouter(prefix="/groups/{group_id}/members", tags=["members"])


@router.get("", response_model=list[MemberRead])
async def list_members(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active == True,
        )
    )
    return result.scalars().all()


@router.post("", response_model=MemberRead)
async def add_member(
    group_id: uuid.UUID,
    data: MemberCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    await get_current_member(db, group_id, current_user.id)
    member = GroupMember(
        group_id=group_id,
        display_name=data.display_name,
        role=MemberRole.member,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.patch("/{member_id}", response_model=MemberRead)
async def update_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    data: MemberUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")

    if data.role is not None:
        require_role(current, MemberRole.owner)
        if target.id == current.id:
            raise BadRequest("Cannot change own role")
        target.role = data.role

    if data.display_name is not None:
        target.display_name = data.display_name

    await db.commit()
    await db.refresh(target)
    return target


@router.post("/{member_id}/claim", response_model=MemberRead)
async def claim_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
            GroupMember.is_active == True,
        )
    )
    if existing.scalars().first():
        raise BadRequest("You already have a member profile in this group")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == member_id,
            GroupMember.group_id == group_id,
            GroupMember.user_id.is_(None),
        )
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Unclaimed member not found")

    target.user_id = current_user.id
    target.claimed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{member_id}")
async def remove_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")
    if target.role == MemberRole.owner:
        raise BadRequest("Cannot remove the group owner")
    target.is_active = False
    await db.commit()
    return {"detail": "Member removed"}
```

- [ ] **Step 7: Update router.py**

Add to `backend/app/api/v1/router.py`:

```python
from app.api.v1.groups import router as groups_router
from app.api.v1.members import router as members_router

api_router.include_router(groups_router)
api_router.include_router(members_router)
```

- [ ] **Step 8: Write tests for groups and members**

Create `backend/tests/test_groups.py` and `backend/tests/test_members.py` covering:
- Create group → returns group with invite code
- List groups → only shows user's groups
- Join group via invite code
- Join group with require_verified blocks guest
- Update group settings (admin/owner only)
- Delete group (owner only)
- Add placeholder member
- Claim member
- Update member role (owner only)
- Remove member (soft delete)

- [ ] **Step 9: Run tests**

```bash
pytest tests/test_groups.py tests/test_members.py -v
```

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat: group and member CRUD with permissions and invite codes"
```

---

## Task 5: Split Calculator & Debt Simplifier Services

**Files:**
- Create: `backend/app/services/split_calculator.py`, `backend/app/services/debt_simplifier.py`
- Create: `backend/tests/test_split_calculator.py`, `backend/tests/test_debt_simplifier.py`

- [ ] **Step 1: Write failing tests for split calculator**

Create `backend/tests/test_split_calculator.py`:

```python
import pytest
from decimal import Decimal
from app.services.split_calculator import calculate_splits


def test_equal_split_even():
    result = calculate_splits(
        amount=Decimal("30.00"),
        split_type="equal",
        members={"a": None, "b": None, "c": None},
    )
    assert result == {"a": Decimal("10.00"), "b": Decimal("10.00"), "c": Decimal("10.00")}


def test_equal_split_remainder():
    result = calculate_splits(
        amount=Decimal("10.00"),
        split_type="equal",
        members={"a": None, "b": None, "c": None},
    )
    assert result["a"] == Decimal("3.34")
    assert result["b"] == Decimal("3.33")
    assert result["c"] == Decimal("3.33")
    assert sum(result.values()) == Decimal("10.00")


def test_exact_split():
    result = calculate_splits(
        amount=Decimal("100.00"),
        split_type="exact",
        members={"a": Decimal("60.00"), "b": Decimal("40.00")},
    )
    assert result == {"a": Decimal("60.00"), "b": Decimal("40.00")}


def test_exact_split_mismatch():
    with pytest.raises(ValueError, match="must sum to"):
        calculate_splits(
            amount=Decimal("100.00"),
            split_type="exact",
            members={"a": Decimal("50.00"), "b": Decimal("40.00")},
        )


def test_percentage_split():
    result = calculate_splits(
        amount=Decimal("200.00"),
        split_type="percentage",
        members={"a": Decimal("60"), "b": Decimal("40")},
    )
    assert result == {"a": Decimal("120.00"), "b": Decimal("80.00")}


def test_percentage_not_100():
    with pytest.raises(ValueError, match="must sum to 100"):
        calculate_splits(
            amount=Decimal("100.00"),
            split_type="percentage",
            members={"a": Decimal("50"), "b": Decimal("40")},
        )


def test_shares_split():
    result = calculate_splits(
        amount=Decimal("50.00"),
        split_type="shares",
        members={"adult1": Decimal("2"), "adult2": Decimal("2"), "child": Decimal("1")},
    )
    assert result == {"adult1": Decimal("20.00"), "adult2": Decimal("20.00"), "child": Decimal("10.00")}


def test_shares_split_remainder():
    result = calculate_splits(
        amount=Decimal("10.00"),
        split_type="shares",
        members={"a": Decimal("1"), "b": Decimal("1"), "c": Decimal("1")},
    )
    assert sum(result.values()) == Decimal("10.00")
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_split_calculator.py -v
```

Expected: ImportError (module doesn't exist yet).

- [ ] **Step 3: Implement split calculator**

Create `backend/app/services/split_calculator.py`:

```python
from decimal import Decimal, ROUND_DOWN


def calculate_splits(
    amount: Decimal,
    split_type: str,
    members: dict[str, Decimal | None],
) -> dict[str, Decimal]:
    if split_type == "equal":
        return _equal_split(amount, list(members.keys()))
    elif split_type == "exact":
        return _exact_split(amount, members)
    elif split_type == "percentage":
        return _percentage_split(amount, members)
    elif split_type == "shares":
        return _shares_split(amount, members)
    else:
        raise ValueError(f"Unknown split type: {split_type}")


def _equal_split(amount: Decimal, member_ids: list[str]) -> dict[str, Decimal]:
    count = len(member_ids)
    base = (amount / count).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - base * count) * 100)
    result = {}
    for i, mid in enumerate(member_ids):
        result[mid] = base + (Decimal("0.01") if i < remainder_cents else Decimal("0"))
    return result


def _exact_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total = sum(v for v in members.values() if v is not None)
    if total != amount:
        raise ValueError(f"Exact amounts must sum to {amount}, got {total}")
    return {k: v.quantize(Decimal("0.01")) for k, v in members.items()}


def _percentage_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total_pct = sum(v for v in members.values() if v is not None)
    if total_pct != Decimal("100"):
        raise ValueError(f"Percentages must sum to 100, got {total_pct}")
    member_ids = list(members.keys())
    result = {}
    for mid in member_ids:
        result[mid] = (amount * members[mid] / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - sum(result.values())) * 100)
    for i in range(remainder_cents):
        result[member_ids[i]] += Decimal("0.01")
    return result


def _shares_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total_shares = sum(v for v in members.values() if v is not None)
    if total_shares <= 0:
        raise ValueError("Total shares must be positive")
    member_ids = list(members.keys())
    result = {}
    for mid in member_ids:
        result[mid] = (amount * members[mid] / total_shares).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - sum(result.values())) * 100)
    for i in range(remainder_cents):
        result[member_ids[i]] += Decimal("0.01")
    return result
```

- [ ] **Step 4: Run split calculator tests**

```bash
pytest tests/test_split_calculator.py -v
```

Expected: All pass.

- [ ] **Step 5: Write failing tests for debt simplifier**

Create `backend/tests/test_debt_simplifier.py`:

```python
from decimal import Decimal
from app.services.debt_simplifier import simplify_debts


def test_simple_two_person():
    balances = {"alice": Decimal("10.00"), "bob": Decimal("-10.00")}
    result = simplify_debts(balances)
    assert result == [("bob", "alice", Decimal("10.00"))]


def test_three_person_chain():
    balances = {"alice": Decimal("10.00"), "bob": Decimal("-10.00"), "charlie": Decimal("0.00")}
    result = simplify_debts(balances)
    assert result == [("bob", "alice", Decimal("10.00"))]


def test_three_person_triangle():
    balances = {
        "alice": Decimal("20.00"),
        "bob": Decimal("-8.00"),
        "charlie": Decimal("-12.00"),
    }
    result = simplify_debts(balances)
    assert len(result) == 2
    total = sum(t[2] for t in result)
    assert total == Decimal("20.00")


def test_all_settled():
    balances = {"a": Decimal("0.00"), "b": Decimal("0.00")}
    result = simplify_debts(balances)
    assert result == []


def test_many_members():
    balances = {
        "a": Decimal("30.00"),
        "b": Decimal("-10.00"),
        "c": Decimal("-10.00"),
        "d": Decimal("-10.00"),
    }
    result = simplify_debts(balances)
    assert len(result) == 3
    assert sum(t[2] for t in result) == Decimal("30.00")
```

- [ ] **Step 6: Implement debt simplifier**

Create `backend/app/services/debt_simplifier.py`:

```python
from decimal import Decimal


def simplify_debts(balances: dict[str, Decimal]) -> list[tuple[str, str, Decimal]]:
    creditors = []
    debtors = []

    for member, balance in balances.items():
        if balance > 0:
            creditors.append([member, balance])
        elif balance < 0:
            debtors.append([member, -balance])

    creditors.sort(key=lambda x: x[1], reverse=True)
    debtors.sort(key=lambda x: x[1], reverse=True)

    transfers = []
    i, j = 0, 0

    while i < len(debtors) and j < len(creditors):
        debtor, debt = debtors[i]
        creditor, credit = creditors[j]
        amount = min(debt, credit)

        transfers.append((debtor, creditor, amount))

        debtors[i][1] -= amount
        creditors[j][1] -= amount

        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1

    return transfers
```

- [ ] **Step 7: Run debt simplifier tests**

```bash
pytest tests/test_debt_simplifier.py -v
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: split calculator and debt simplifier with full test coverage"
```

---

## Task 6: Expenses & Settlements API

**Files:**
- Create: `backend/app/schemas/expense.py`, `backend/app/schemas/settlement.py`, `backend/app/schemas/category.py`
- Create: `backend/app/api/v1/expenses.py`, `backend/app/api/v1/settlements.py`, `backend/app/api/v1/categories.py`
- Create: `backend/tests/test_expenses.py`, `backend/tests/test_settlements.py`, `backend/tests/test_categories.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Create backend/app/schemas/expense.py**

```python
import uuid
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel
from app.models.expense import SplitType


class SplitInput(BaseModel):
    group_member_id: uuid.UUID
    value: Decimal


class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    date: date
    paid_by: uuid.UUID
    category_id: uuid.UUID
    split_type: SplitType
    splits: list[SplitInput]


class SplitRead(BaseModel):
    id: uuid.UUID
    group_member_id: uuid.UUID
    member_name: str | None = None
    split_type: SplitType
    value: Decimal
    resolved_amount: Decimal

    model_config = {"from_attributes": True}


class ExpenseRead(BaseModel):
    id: uuid.UUID
    description: str
    amount: Decimal
    currency_code: str
    date: date
    paid_by: uuid.UUID
    payer_name: str | None = None
    created_by: uuid.UUID
    category_id: uuid.UUID
    receipt_url: str | None
    splits: list[SplitRead] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ExpenseUpdate(BaseModel):
    description: str | None = None
    amount: Decimal | None = None
    date: date | None = None
    paid_by: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    split_type: SplitType | None = None
    splits: list[SplitInput] | None = None
```

- [ ] **Step 2: Create backend/app/schemas/settlement.py**

```python
import uuid
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class SettlementCreate(BaseModel):
    from_member: uuid.UUID
    to_member: uuid.UUID
    amount: Decimal


class SettlementRead(BaseModel):
    id: uuid.UUID
    from_member: uuid.UUID
    from_member_name: str | None = None
    to_member: uuid.UUID
    to_member_name: str | None = None
    amount: Decimal
    settled_at: datetime

    model_config = {"from_attributes": True}


class BalanceRead(BaseModel):
    member_id: uuid.UUID
    member_name: str
    balance: Decimal


class SuggestedSettlement(BaseModel):
    from_member: uuid.UUID
    from_member_name: str
    to_member: uuid.UUID
    to_member_name: str
    amount: Decimal
```

- [ ] **Step 3: Create backend/app/schemas/category.py**

```python
import uuid
from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    icon: str = "📦"
    is_default: bool = False


class CategoryRead(BaseModel):
    id: uuid.UUID
    name: str
    icon: str
    is_default: bool
    group_id: uuid.UUID | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Create backend/app/api/v1/expenses.py**

Full CRUD for expenses including:
- POST: validate splits, calculate resolved_amounts using split_calculator, check on-behalf permission
- GET list: paginated, filterable by category/date/member
- GET detail: include splits with member names
- PATCH: update expense and recalculate splits
- DELETE: permission check (own expense or admin/owner)

- [ ] **Step 5: Create backend/app/api/v1/settlements.py**

Endpoints:
- GET /balances: compute net balance per member from expenses + settlements
- GET /settlements/suggested: call debt_simplifier with current balances
- POST /settlements: record a settlement
- GET /settlements: list settlement history

- [ ] **Step 6: Create backend/app/api/v1/categories.py**

System defaults + group custom categories CRUD.

- [ ] **Step 7: Wire all routers into router.py**

```python
from app.api.v1.expenses import router as expenses_router
from app.api.v1.settlements import router as settlements_router
from app.api.v1.categories import router as categories_router

api_router.include_router(expenses_router)
api_router.include_router(settlements_router)
api_router.include_router(categories_router)
```

- [ ] **Step 8: Write tests**

Test full expense lifecycle:
- Create expense with equal split → verify resolved amounts
- Create expense with exact/percentage/shares splits
- On-behalf permission: member blocked when setting is off
- Update expense → splits recalculated
- Delete own expense vs. others' expense
- Balance calculation with multiple expenses
- Suggested settlements match expected transfers
- Record settlement → balances update

- [ ] **Step 9: Run tests**

```bash
pytest tests/test_expenses.py tests/test_settlements.py tests/test_categories.py -v
```

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat: expenses, settlements, and categories API with split calculation"
```

---

## Task 7: Notifications & File Upload

**Files:**
- Create: `backend/app/schemas/notification.py`
- Create: `backend/app/api/v1/notifications.py`
- Create: `backend/app/services/notification.py`, `backend/app/services/file_storage.py`
- Create: `backend/tests/test_notifications.py`
- Modify: `backend/app/api/v1/router.py`, `backend/app/api/v1/users.py`

- [ ] **Step 1: Create backend/app/services/notification.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import GroupMember, Notification
import uuid


async def notify_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    exclude_user_id: uuid.UUID | None,
    type: str,
    data: dict,
):
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.is_active == True,
            GroupMember.user_id.is_not(None),
        )
    )
    members = result.scalars().all()
    for member in members:
        if member.user_id == exclude_user_id:
            continue
        db.add(Notification(
            user_id=member.user_id,
            group_id=group_id,
            type=type,
            data=data,
        ))
```

- [ ] **Step 2: Create backend/app/services/file_storage.py**

```python
import os
import uuid

from fastapi import UploadFile

from app.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def save_upload(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_TYPES:
        raise ValueError(f"File type {file.content_type} not allowed")
    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise ValueError("File too large")
    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    path = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return f"/uploads/{filename}"
```

- [ ] **Step 3: Create notification schema and endpoint**

```python
# backend/app/schemas/notification.py
import uuid
from datetime import datetime
from pydantic import BaseModel


class NotificationRead(BaseModel):
    id: uuid.UUID
    type: str
    data: dict
    read: bool
    group_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

Notification API: GET (paginated), PATCH (mark read), POST mark-all-read.

- [ ] **Step 4: Add avatar upload to users endpoint**

Add `POST /users/me/avatar` using `file_storage.save_upload()`.

- [ ] **Step 5: Integrate notifications into expense/settlement creation**

Call `notify_group()` in expense create/update/delete and settlement create endpoints.

- [ ] **Step 6: Wire routers, write tests, run**

```bash
pytest tests/test_notifications.py -v
```

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: notifications, file upload, and avatar support"
```

---

## Task 8: Frontend Scaffolding

**Files:**
- Create: All files under `frontend/`
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Initialize Vite React TypeScript project**

```bash
cd /home/zuzu/Workspaces/personal/chia
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: Install dependencies**

```bash
cd frontend
npm install react-router-dom zustand axios
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind**

Update `frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

Update `frontend/src/index.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 4: Install and initialize shadcn/ui**

```bash
cd frontend
npx shadcn@latest init
# Select: New York style, Zinc color, CSS variables: yes
npx shadcn@latest add button input card dialog dropdown-menu tabs badge toast form label select separator avatar
```

- [ ] **Step 5: Create TypeScript types**

Create `frontend/src/types/index.ts`:

```typescript
export interface User {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  currency_code: string;
  invite_code: string;
  require_verified_users: boolean;
  allow_log_on_behalf: boolean;
  member_count?: number;
  created_at: string;
}

export interface GroupListItem {
  id: string;
  name: string;
  currency_code: string;
  member_count: number;
  my_balance: number;
}

export interface GroupMember {
  id: string;
  display_name: string;
  role: "owner" | "admin" | "member";
  user_id: string | null;
  is_active: boolean;
  claimed_at: string | null;
  joined_at: string;
}

export type SplitType = "equal" | "exact" | "percentage" | "shares";

export interface SplitInput {
  group_member_id: string;
  value: number;
}

export interface ExpenseSplit {
  id: string;
  group_member_id: string;
  member_name?: string;
  split_type: SplitType;
  value: number;
  resolved_amount: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency_code: string;
  date: string;
  paid_by: string;
  payer_name?: string;
  created_by: string;
  category_id: string;
  receipt_url: string | null;
  splits: ExpenseSplit[];
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  is_default: boolean;
  group_id: string | null;
}

export interface Settlement {
  id: string;
  from_member: string;
  from_member_name?: string;
  to_member: string;
  to_member_name?: string;
  amount: number;
  settled_at: string;
}

export interface Balance {
  member_id: string;
  member_name: string;
  balance: number;
}

export interface SuggestedSettlement {
  from_member: string;
  from_member_name: string;
  to_member: string;
  to_member_name: string;
  amount: number;
}

export interface Notification {
  id: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  group_id: string | null;
  created_at: string;
}
```

- [ ] **Step 6: Create API client**

Create `frontend/src/api/client.ts`:

```typescript
import axios from "axios";

const client = axios.create({
  baseURL: "/api/v1",
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const resp = await axios.post("/api/v1/auth/refresh", {
            refresh_token: refreshToken,
          });
          localStorage.setItem("access_token", resp.data.access_token);
          localStorage.setItem("refresh_token", resp.data.refresh_token);
          error.config.headers.Authorization = `Bearer ${resp.data.access_token}`;
          return axios(error.config);
        } catch {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export default client;
```

- [ ] **Step 7: Create API modules**

Create `frontend/src/api/auth.ts`, `groups.ts`, `expenses.ts`, `settlements.ts`, `categories.ts`, `notifications.ts` — each exports functions that call the corresponding backend endpoints using the client.

- [ ] **Step 8: Create Zustand stores**

Create `frontend/src/store/authStore.ts`:

```typescript
import { create } from "zustand";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, isAuthenticated: false });
  },
}));
```

Create `frontend/src/store/notificationStore.ts` similarly.

- [ ] **Step 9: Create utility helpers**

Create `frontend/src/utils/currency.ts`:

```typescript
export function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}
```

Create `frontend/src/utils/deviceId.ts`:

```typescript
export function getDeviceId(): string {
  let id = localStorage.getItem("chia_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("chia_device_id", id);
  }
  return id;
}
```

- [ ] **Step 10: Create frontend Dockerfile**

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev", "--", "--host"]
```

- [ ] **Step 11: Update docker-compose.yml**

Add frontend service:

```yaml
  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    depends_on:
      - backend
```

- [ ] **Step 12: Commit**

```bash
git add frontend/ docker-compose.yml
git commit -m "feat: frontend scaffolding with React, Vite, Tailwind, shadcn/ui, Zustand"
```

---

## Task 9: Frontend Pages — Auth & Layout

**Files:**
- Create: `frontend/src/components/layout/AppLayout.tsx`, `PublicLayout.tsx`
- Create: `frontend/src/pages/Landing.tsx`, `Login.tsx`, `Register.tsx`, `NotFound.tsx`
- Create: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`

- [ ] **Step 1: Create useAuth hook**

Handles init (check token, fetch /users/me), login, register, guest auth, logout.

- [ ] **Step 2: Create PublicLayout**

Simple layout with centered content, no sidebar.

- [ ] **Step 3: Create AppLayout**

Sidebar with: groups list, notification bell with badge, profile link. Main content area.

- [ ] **Step 4: Create Landing page**

Hero section: "Split expenses with friends — no sign-up required"
CTAs: "Try as Guest", "Sign Up", "Log In"

- [ ] **Step 5: Create Login page**

Email + password form using shadcn form components. Link to register. Link to guest mode.

- [ ] **Step 6: Create Register page**

Email, password, display name form. Link to login.

- [ ] **Step 7: Create App.tsx with routing**

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
// ... imports

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/join/:inviteCode" element={<JoinGroup />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/groups/:groupId" element={<GroupView />} />
          <Route path="/groups/:groupId/add-expense" element={<AddExpense />} />
          <Route path="/groups/:groupId/expenses/:expenseId/edit" element={<EditExpense />} />
          <Route path="/groups/:groupId/settings" element={<GroupSettings />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Verify auth flow works end-to-end**

Start docker compose, register a user, verify redirect to dashboard.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat: auth pages, routing, and app layout"
```

---

## Task 10: Frontend Pages — Dashboard & Groups

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`, `JoinGroup.tsx`
- Create: `frontend/src/components/group/GroupCard.tsx`, `InviteLink.tsx`, `MemberList.tsx`
- Create: `frontend/src/pages/GroupView.tsx`, `GroupSettings.tsx`

- [ ] **Step 1: Create GroupCard component**

Shows group name, currency, member count, user's net balance (green for owed, red for owes).

- [ ] **Step 2: Create Dashboard page**

Grid of GroupCards + "Create Group" button/dialog. Create group dialog: name, currency selector, description.

- [ ] **Step 3: Create GroupView page**

Three tabs: Expenses, Balances, Settlements.
- Expenses tab: list of ExpenseCards, FAB to add expense
- Balances tab: BalanceList + SuggestedSettlements
- Settlements tab: settlement history

Header shows group name, member count, invite link.

- [ ] **Step 4: Create InviteLink component**

Shows invite code with copy button. Shows shareable URL.

- [ ] **Step 5: Create MemberList component**

List members with role badges. Owner can promote/demote. Shows "unclaimed" tag for placeholder members.

- [ ] **Step 6: Create GroupSettings page**

Edit group name/description/currency. Toggle settings. Member management. Delete group (owner only).

- [ ] **Step 7: Create JoinGroup page**

Route: `/join/:inviteCode`. Calls join API. Redirects to group view on success.

- [ ] **Step 8: End-to-end test**

Create group, copy invite link, join from another browser/incognito, verify member appears.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat: dashboard, group view, settings, and invite flow"
```

---

## Task 11: Frontend Pages — Expenses

**Files:**
- Create: `frontend/src/pages/AddExpense.tsx`, `EditExpense.tsx`
- Create: `frontend/src/components/expense/ExpenseCard.tsx`, `ExpenseForm.tsx`, `SplitMethodTabs.tsx`

- [ ] **Step 1: Create SplitMethodTabs component**

Four tabs: Equal, Exact, Percentage, Shares.
- Equal: just checkboxes for which members to include
- Exact: number input per member, shows running total vs expense amount
- Percentage: number input per member, shows running total vs 100%
- Shares: number input per member (default 1), shows calculated amounts

- [ ] **Step 2: Create ExpenseForm component**

Fields: description (text), amount (number), date (date picker), payer (member dropdown), category (dropdown with icons), split method tabs, receipt upload (file input with preview).

Validation: amount > 0, description required, splits must be valid for chosen type.

- [ ] **Step 3: Create AddExpense page**

Uses ExpenseForm, calls POST expenses API, redirects to group view on success.

- [ ] **Step 4: Create EditExpense page**

Fetches existing expense, pre-fills ExpenseForm, calls PATCH on save.

- [ ] **Step 5: Create ExpenseCard component**

Shows: description, amount, who paid, date, category icon. Click → expand to show split details.

- [ ] **Step 6: Integrate into GroupView**

Expenses tab shows list of ExpenseCards. "Add Expense" button links to AddExpense page.

- [ ] **Step 7: End-to-end test**

Add expense with each split type, verify it shows in list, edit it, delete it.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: expense creation, editing, and split method UI"
```

---

## Task 12: Frontend Pages — Settlements & Remaining

**Files:**
- Create: `frontend/src/components/settlement/BalanceList.tsx`, `SuggestedSettlements.tsx`
- Create: `frontend/src/pages/Profile.tsx`
- Create: `frontend/src/hooks/useNotifications.ts`

- [ ] **Step 1: Create BalanceList component**

Per-member balance: green positive (is owed), red negative (owes). Shows formatted amounts.

- [ ] **Step 2: Create SuggestedSettlements component**

List of "X pays Y: $Z" with "Mark as Settled" button per item. Clicking opens confirmation dialog, then records settlement.

- [ ] **Step 3: Integrate into GroupView**

Balances tab shows BalanceList + SuggestedSettlements. Settlements tab shows history.

- [ ] **Step 4: Create Profile page**

Display name edit, avatar upload (with preview), email display. Guest upgrade form (email + password) shown for unverified users.

- [ ] **Step 5: Create useNotifications hook**

Polls GET /notifications every 30 seconds. Updates notification store. Shows unread count in AppLayout nav.

- [ ] **Step 6: Create Notifications dropdown**

In AppLayout header: bell icon with badge. Dropdown shows recent notifications. Click marks as read.

- [ ] **Step 7: End-to-end test**

Full flow: create group → add members → add expenses → view balances → settle up → verify balances update.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: settlements, balances, profile, and notifications UI"
```

---

## Task 13: Polish & Final Integration

**Files:**
- Modify: Various files for final integration
- Create: `README.md` (update)

- [ ] **Step 1: Add loading states**

Add skeleton loaders / spinners to all pages during data fetch.

- [ ] **Step 2: Add error handling**

Toast notifications for API errors. Form validation error display.

- [ ] **Step 3: Add empty states**

"No groups yet" on dashboard, "No expenses yet" on group view, etc.

- [ ] **Step 4: Responsive design pass**

Ensure all pages work on mobile viewport (375px+). Sidebar collapses to hamburger menu.

- [ ] **Step 5: Update docker-compose for full stack**

Verify `docker compose up` starts all three services and the app works end-to-end.

- [ ] **Step 6: Update README.md**

```markdown
# Chia — Group Expense Splitter

Split expenses with friends, family, or any group. No sign-up required.

## Quick Start

```bash
docker compose up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Development

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Tech Stack
- **Backend:** Python, FastAPI, SQLAlchemy, PostgreSQL
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
```

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: polish with loading states, error handling, responsive design"
```
