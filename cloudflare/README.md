# Cloudflare deployment

> **Current production:** Workers Paid runs the frontend and Python API on
> Worker `chia`, with D1 `chia-production-20260918` and R2
> `chia-production-uploads`. Both original domains and signing keys are preserved.
> The Hetzner native API is stopped. See [CUTOVER.md](CUTOVER.md).
>
> Production deployment: `cd cloudflare && node scripts/cf.mjs python deploy`.
> The preview instructions below are historical; their database, bucket and
> signing-key details do not describe production.

Preview: https://chia.dongts1201.workers.dev

This is an independent copy captured on **2026-09-18 at 04:18 UTC**. Preview
writes do not reach Hetzner, and new Hetzner writes are not replicated here.
The original domains, containers, PostgreSQL database, and uploads remain in
place. No production DNS or application configuration was changed.

## Deployment

| Component | Resource |
| --- | --- |
| React frontend | Static assets on Worker `chia` |
| FastAPI backend | Python Worker, same-origin `/api/v1` |
| Database | D1 `chia-preview`, ID `c0fadf76-4b3d-42ee-b719-0ccab87ae620` |
| Files | R2 `chia-preview-uploads`, served at `/uploads/…` |
| Authentication | Copied bcrypt hashes and Google identities, separate preview JWT key |

The 94 existing REST operations are ported. Shared Pydantic schemas, enums,
split calculation, debt simplification, and balance calculation are generated
from the authoritative backend by `scripts/prepare.py`. The PostgreSQL balance
loader and D1 loader both call `backend/app/services/balances.py`.

D1 stores money as scaled integers (amounts 2, split inputs 4, exchange rates 6
decimal places). Store codecs return `Decimal`; API schemas serialize at the
response boundary. Each financial mutation uses one atomic D1 batch. Guards
abort stale edits/claims/merges, and fund triggers prevent negative balances.
There is no SQLAlchemy session emulation or ineffective commit/rollback shim.

## Verification performed

- Exact comparison of every imported column: **18 tables, 5,956 rows**.
- PostgreSQL dump restored into an isolated PostgreSQL 16 container; all table
  counts matched. Offline ledger checks matched all **27 groups and 4 funds**.
- Live API balance comparison: **20 accessible groups, 128 members, 3 active
  funds**. Deleted/unclaimed groups and the inactive fund are covered by the
  complete row comparison and offline ledger check, not public API traversal.
- **27 original files** downloaded from the preview and compared byte-for-byte.
- Live password registration/login; expense create/edit/delete; fund contribution
  and expense deduction restoration; gift and repayment directions; reports;
  receipt image upload/read; ordinary-user admin denial; superadmin stats and
  configuration; live AI parsing after the preview-only model replacement.
- **60 local tests** covering codecs, API contracts, transaction rollback,
  concurrency guards, accounting, reports, permissions, and merges.
- **23 existing database-free backend tests** passed. Frontend production build
  passed. Browser landing/login checks produced no JavaScript or API errors.

Smoke tests created clearly named test accounts/groups only in the preview;
these are not part of the source snapshot. Test groups may be soft-deleted.
Private snapshots, credentials, raw rows, test identities and logs live outside
Git under `~/.local/share/chia-migration/2026-09-18/`.

## Rebuild and redeploy

Requires Node/npm, Python 3, and `uv`. The helper uses an isolated `uv>=0.12.3`
for the Python Workers tooling. Dependencies are pinned in lockfiles.

From the repository root:

```bash
npm --prefix frontend ci
cd frontend
VITE_API_URL=/api/v1 VITE_DEPLOYMENT=preview npm run build
cd ../cloudflare
npm ci
node scripts/cf.mjs python deploy
```

`cf.mjs` uses `CLOUDFLARE_API_TOKEN`, or the existing
`PERSONAL_CLOUDFLARE_API_TOKEN` from `~/.env` used by the games projects. It does
not print or embed credentials. Worker secrets were provisioned separately:
`CHIA_JWT_SECRET`, `CHIA_GOOGLE_CLIENT_ID`, `CHIA_SUPERADMIN_EMAILS`,
`GROQ_API_KEY`. Do not replace the preview signing key with the production key.

From the repository root, using the existing backend virtualenv:

```bash
python3 cloudflare/scripts/prepare.py
PYTHONPATH=cloudflare/src backend/venv/bin/pytest cloudflare/tests -q
python3 -m unittest discover -s scripts/migration/tests -v
```

In an isolated worktree without its own backend virtualenv, use the main
checkout's interpreter or create an equivalent development environment.

For a **new empty D1 database**, follow `scripts/migration/README.md`: create
schema `0001_initial.sql`, import the private converted data, then apply
`0002_finance_guards.sql`. Historical rows are imported before triggers because
valid historical sequences can have transient negative running totals. These
files were applied using `d1 execute`, so Wrangler's migration history was not
populated; do not blindly run `d1 migrations apply` on this preview. Do not
re-import a snapshot over an in-use database.

## Remaining work before production cutover

1. **Google login:** add `https://chia.dongts1201.workers.dev` to Authorized
   JavaScript origins on the existing Google OAuth web client. Password login
   and fresh guest accounts work. Existing guest identities depend on browser
   localStorage, which does not transfer across domains.
2. **Workers plan:** this account currently has Workers Free and paid R2
   enabled. `default_usage_model=standard` does not mean Workers Paid. Live
   smoke tests succeeded, but do not rely on Free for production bcrypt/image
   processing and larger ledgers. Workers Paid starts at $5/account/month and
   is shared across apps, with usage charges beyond included allowances.
   Upgrade in Cloudflare, then configure a suitable per-request CPU limit.
   No subscription upgrade was made during this migration.
3. **MCP:** the separate MCP server is not migrated. Its Hetzner container was
   already restarting before this work (`mcp` 2.x removed the imported FastMCP
   API). Pin/rework the supported SDK and use durable OAuth state before moving
   this integration. Preview `/mcp` does not advertise a working service.
4. **AI parsing:** the imported `groq/llama-3.3-70b-versatile` returned
   `model_not_found`. Only preview `system_config.llm.default_model` was changed
   to `groq/openai/gpt-oss-20b`. A live basic parsing request then returned the
   expected amount and description. Broader language/quality evaluation remains
   advisable before cutover; production model configuration is unchanged.
5. **Operational readiness:** Python Workers is still beta. Review load/CPU
   metrics, alerts, scheduled exports, recovery, Android API configuration, and
   existing integrations before replacing production. Worker logs are enabled;
   the old server-side Sentry integration is not part of this preview.

A future cutover requires a brief write freeze, a fresh PostgreSQL/files
snapshot, import into a clean target, another full reconciliation, then explicit
production routing changes. Keep Hetzner available for rollback. After new
writes begin on Cloudflare, DNS-only rollback would lose those writes unless
reconciled; there is no automatic reverse replication.

Cloudflare references checked on 2026-09-18:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Python Workers](https://developers.cloudflare.com/workers/languages/python/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Account cost controls

Production admission limits and the private `cf-budget-guard` watchdog were deployed on 2026-09-18. See [cost-control/README.md](cost-control/README.md) for thresholds, coverage, verification and manual recovery. These target included usage but cannot guarantee a hard $5 bill.
