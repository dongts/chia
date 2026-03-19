#!/bin/bash
# =============================================================================
# PostgreSQL initialization script
# Runs inside the postgres container on first start (mounted to
# /docker-entrypoint-initdb.d/). Only executes once — when the data
# directory is empty (first docker compose up).
#
# The POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB env vars already
# create the main user + database. This script adds:
#   - UUID extension (for uuid_generate_v4)
#   - A test database (for running pytest against Docker)
# =============================================================================

set -e

echo "=== Chia DB Init ==="

# Enable UUID extension on the main database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "Extensions created on $POSTGRES_DB"

# Create test database (same user, separate db for pytest)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE "${POSTGRES_DB}_test" OWNER "$POSTGRES_USER";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB}_test" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "Test database ${POSTGRES_DB}_test created"
echo "=== Chia DB Init Complete ==="
