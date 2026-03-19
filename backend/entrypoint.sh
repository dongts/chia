#!/bin/sh
set -e

# Build DATABASE_URL from individual vars if not set directly
if [ -z "$CHIA_DATABASE_URL" ]; then
  DB_USER="${DB_USER:-chia}"
  DB_PASSWORD="${DB_PASSWORD:-chia}"
  DB_HOST="${DB_HOST:-db}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-chia}"
  export CHIA_DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "Database URL built from DB_* vars → ${DB_HOST}:${DB_PORT}/${DB_NAME}"
else
  echo "Using provided DATABASE_URL"
fi

# Connection pooler setting
if [ "$USE_CONNECTION_POOLER" = "true" ]; then
  export CHIA_USE_CONNECTION_POOLER=true
  echo "Connection pooler mode enabled"
fi

# Run migrations
echo "Running database migrations..."
alembic upgrade head
echo "Migrations complete."

# Start server
echo "Starting Chia API on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
