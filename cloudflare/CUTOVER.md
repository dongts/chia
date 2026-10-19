# Production cutover — 2026-09-18

## CURRENT: Workers Paid Python backend

The user enabled Workers Paid on 2026-09-18. Production Worker `chia` again uses
`src/entry.py`, with a 5,000 ms per-request CPU limit. Version:
`30f1f601-3468-4375-abe7-d8be32db5152`. Both custom domains remain on Cloudflare.
D1 and R2 remain authoritative; no database reimport was needed. Original signing
keys and IDs are unchanged. The native Hetzner API container is stopped.

Before switching, a private paid Python Worker passed 320 concurrent reads plus
registration/login, 42-member expense create/edit/delete, gift/repayment balances,
fund restoration, reports, AI parsing, and image conversion/R2 upload/download.
Its latest 200 logged requests had outcome `ok`, no exceptions, and peak CPU
910 ms. A separate earlier run overlapped a D1 export and hit confirmed export
locks; the clean run was repeated after export completion.

On the production deployment, original-server access and refresh tokens passed
on both domains. The saved pre-migration browser session opened the dashboard
with the same access token and no API/JavaScript errors.

After stopping `chia-native-api`, production passed another 320 concurrent reads
and the complete financial/authentication/AI/image write smoke. All 403 captured
requests had outcome `ok` and zero request exceptions. Saved browser storage and
both domains' original access/refresh tokens were checked again with the native
backend stopped. The 67 local Python tests also passed. Cloudflare emitted two
ignored Python ZipFile deallocator warnings; no request failed because of them.
The private paid candidate and its temporary test accounts, groups and images
were removed. The Hetzner host, Caddy relay and frozen PostgreSQL are retained;
the production web/API does not use its native backend.

Recovery supplement: `chia-backups/cutover-20260918T084957Z/paid-recovery.tar.gz.gpg`.
It contains the pre-paid-switch D1 snapshot, current R2 files, deployed Worker,
source/configuration, signing secrets and verification evidence. This supplements
the full original server backup; keep the separately saved recovery passphrase.

Deploy from `cloudflare/` with `node scripts/cf.mjs python deploy`.
The temporary native fallback is retained: start `chia-native-api` on Hetzner,
then deploy `node scripts/cf.mjs deploy --config wrangler.gateway.jsonc`.
The fallback still uses current D1 data. Never reopen the frozen PostgreSQL
copy as production. See [NATIVE_RECOVERY.md](NATIVE_RECOVERY.md).

The following records are historical and describe the Free-plan attempt and
its temporary native recovery, not the current deployment.

## Historical: native backend recovery after Free CPU failures

**Do not shut down Hetzner.** Python Workers exceeded the Free CPU limit under
concurrent requests, followed by Pyodide/GIL errors. The older runtime also
failed extended testing. The successful initial smoke checks did not establish
production reliability. No paid plan was enabled.

Production Worker `chia` now uses `src/gateway.mjs` and serves the frontend and
R2 files. It proxies API requests to the protected native CPython container
`chia-native-api` on Hetzner, through `mcp.chia.dongtran.asia`. Both public
domains still point directly to Cloudflare.

D1 `chia-production-20260918` remains the authoritative database: the native
backend executes each batch atomically through the private JavaScript Worker
`chia-storage-bridge`. Uploads remain in R2. No data was copied back to PostgreSQL;
PostgreSQL remains frozen. Signing keys, IDs and sessions are unchanged.

See [NATIVE_RECOVERY.md](NATIVE_RECOVERY.md) for deployment and recovery details.
The following sections describe the earlier cutover and its verification,
which was superseded by this incident recovery.


The user explicitly chose **Workers Free**. No paid plan was enabled.

The application now uses Worker `chia`, D1 `chia-production-20260918`
(`4e0d3fcc-96fa-453a-983f-124a0f9d3383`, Singapore/APAC) and R2
`chia-production-uploads`. Production signing key and user IDs are preserved.
The old backend/frontend/MCP containers are stopped; PostgreSQL remains frozen
and Caddy currently forwards the existing web/API domains to the Worker.

## DNS handoff — 2026-09-18 09:17 UTC

After the token's zone DNS permission was updated, both original A records were
replaced by Cloudflare-managed Worker custom domains:

- chia.dongtran.asia
- api.chia.dongtran.asia

Public DNS returns Cloudflare addresses. The web domain passes HTTPS, health,
original access/refresh token checks and a browser session check using storage
saved before migration. The API certificate is active and direct HTTPS, D1 health,
original access/refresh tokens and CORS checks all pass on the API domain too.
Caddy stays available for clients with cached Hetzner DNS. Keep the old server
intact during DNS propagation; the direct Cloudflare path no longer depends on
Hetzner. The application and writes are in Cloudflare, not PostgreSQL.

The workers.dev API is private: it requires CHIA_CUTOVER_KEY. Caddy adds this
header only to its upstream request; browsers do not receive it. Public static
assets may still be served at workers.dev, but production API/files are gated.
Once custom domains work directly, retain the relay until cached DNS expires,
then disable workers.dev and retire the relay in a controlled step.

## Recovery and verification

Final write freeze/snapshot: 2026-09-18 08:49 UTC. Snapshot folder:
`~/.local/share/chia-cutover/20260918T084132Z/`.

Encrypted off-site final snapshot:
`chia-backups/cutover-20260918T084957Z/final-recovery.tar.gpg`.
It uses the **same separately saved recovery passphrase** as the full
`chia-backups/20260918T044853Z/` baseline. Final archive was downloaded again and
its SHA-256 matched; decryption/tar validation passed.

- Final PostgreSQL dump restored: 18 tables, 5,956 rows.
- Every imported D1 value matched the frozen PostgreSQL snapshot.
- All 27 group ledgers/four funds matched offline; 20 accessible groups,
  128 member balances and three active funds matched through the live API.
- All 27 uploads matched byte-for-byte.
- Original-server access and refresh tokens worked on Cloudflare unchanged.
- Browser storage saved before cutover opened the production dashboard without
  login, with its old access token unchanged and no API/JavaScript errors.
- Old hashed frontend assets were retained for existing tabs/lazy imports.
- CORS preflight for the existing web origin passes on the existing API hostname.
- Live write smoke passed on Workers Free: registration/login, a 42-member
  expense, edit/delete, fund restoration, gifts/repayments, reports and AI parsing.
- After removing temporary test objects, all 17 user-data tables matched the
  pre-write D1 export exactly (106 users, 27 groups, 578 expenses, 102 settlements).
  The only configuration change is the working AI model
  `groq/openai/gpt-oss-20b`.

The first concurrent smoke attempt received an HTTP 503 and its initial cleanup
received HTTP 500. Cleanup succeeded on retry; the complete repeated smoke
passed, with 62 observed Worker requests reporting `ok` and no logged exceptions.
The initial transient failure was not captured by a tail session, so its cause
is unconfirmed. No billing upgrade or speculative code change was made for it.

Temporary connection failures now preserve frontend credentials and offer retry.
Invalid/expired-rejected credentials still clear normally. Dashboard balance
loading uses six D1 statements in one batch regardless of group count.

**Cloudflare now accepts writes. Do not simply reopen the frozen PostgreSQL
copy as production.** A rollback after this point must preserve/reconcile D1
writes first. The old database has `default_transaction_read_only=on` set.

The separate MCP integration was already failing before migration; it remains
unavailable. No claim of MCP migration is made.
