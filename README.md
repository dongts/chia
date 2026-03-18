# Chia — Group Expense Splitter

Split expenses with friends, family, or any group. No sign-up required.

## Quick Start

```bash
docker compose up
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **API docs:** http://localhost:8000/docs

## Development (without Docker)

### Prerequisites
- Python 3.12+
- Node.js 22+
- PostgreSQL 16

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database

Start just the database with Docker:

```bash
docker compose up -d db
```

### Running Tests

```bash
# Create test database first
docker compose exec db createdb -U chia chia_test

cd backend
source venv/bin/activate
pytest tests/ -v
```

## Features

- **Guest mode** — start splitting expenses with zero sign-up, tied to your device
- **Flexible splitting** — equal, exact amounts, percentages, or shares (weights)
- **Debt simplification** — minimizes number of transfers to settle up
- **Group roles** — owner, admin, member with configurable permissions
- **Invite links** — share a code to let others join your group
- **Categories** — predefined + custom expense categories
- **Receipt uploads** — attach photos to expenses
- **In-app notifications** — stay updated on group activity

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy 2.0, Alembic |
| Database | PostgreSQL 16 |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Auth | JWT (access + refresh tokens) |
