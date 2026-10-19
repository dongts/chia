# Production migration snapshot

`capture-production.sh` streams a migration snapshot from the production
containers over SSH. It does not create remote files or modify the remote
database. The PostgreSQL connection used by `pg_dump` has
`default_transaction_read_only=on`; the JSON exporter explicitly uses one
`REPEATABLE READ, READ ONLY` transaction for the table data, schema metadata,
member balances, and fund balances.

Run from any directory:

```bash
scripts/migration/capture-production.sh
```

The default destination is
`/home/zuzu/.local/share/chia-migration/2026-09-18`. Each completed snapshot is
a mode-700 timestamped directory containing mode-600 files:

- `database.dump`: consistent PostgreSQL custom-format dump.
- `data.json`: all 18 application tables, conversion-oriented schema metadata,
  and balance baselines. PostgreSQL `NUMERIC`/Python `Decimal` values are JSON
  strings.
- `uploads.tar`: streamed contents of `/data/uploads`.
- `manifest.json`: table counts, artifact sizes, hashes, and database snapshot
  metadata.
- `SHA256SUMS`: checksums for all four artifacts above.

The JSON snapshot includes private application data and credentials such as
password hashes. Keep the whole destination private and never paste its
contents into logs or tickets. A failed run leaves a mode-700 `.incomplete`
directory for diagnosis or manual removal.

Useful overrides are available without editing the script:

```bash
scripts/migration/capture-production.sh \
  --host root@chia.dongtran.asia \
  --output-dir /private/path \
  --backend-container chia-backend-1 \
  --database-container chia-db-1
```

Run the local utility tests with:

```bash
python3 -m unittest discover -s scripts/migration/tests -v
```

## D1 conversion

`postgres_to_d1.py` converts `data.json` without using binary floating-point
arithmetic. PostgreSQL numeric values become scaled SQLite integers, booleans
become `0`/`1`, and JSONB values become canonical JSON text. It generates the
row-free D1 schema and Python conversion metadata in the repository while
keeping the SQL containing production rows in the private snapshot directory:

```bash
python3 scripts/migration/postgres_to_d1.py \
  --snapshot /private/snapshot/data.json \
  --schema-output cloudflare/migrations/0001_initial.sql \
  --metadata-output cloudflare/src/chia_api/schema_meta.py \
  --data-output /private/snapshot/d1-import.sql \
  --validate
```

Validation loads the schema and every converted row into an in-memory SQLite
database, checks foreign keys and database integrity, and compares every stored
value with its source conversion. The groups/categories foreign-key cycle is
handled by inserting groups with a null default category and restoring the
reference after categories are loaded.

## Preview verification

`verify-preview.py` first recalculates every group and fund balance offline from
the private snapshot with the shared ledger. It can then compare API-visible
balances and every byte of `uploads.tar` with the workers.dev preview using a
short-lived locally generated access token. The secrets file must be mode 600
and contain a JSON `CHIA_JWT_SECRET`; the script never prints the secret, token,
row values, IDs, or upload names.

```bash
python3 scripts/migration/verify-preview.py \
  --snapshot-dir /private/snapshot \
  --secrets-file /private/preview-secrets.json

# No network access or secret is needed for the full offline ledger check.
python3 scripts/migration/verify-preview.py \
  --snapshot-dir /private/snapshot \
  --offline-only
```

The 2026-09-18 preview verification covered all 18 tables and 5,956 rows via
the D1 comparison. The authenticated API exposed 20 non-deleted groups, 128
member balances, and three active fund balances; all matched. Seven deleted or
unclaimed groups and the fourth, inactive fund are intentionally unavailable
through those API routes, and their rows and balances were covered by the full
row comparison and offline shared-ledger verification. All 27 uploads matched
byte for byte.
