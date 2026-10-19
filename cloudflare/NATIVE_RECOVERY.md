# Retained fallback: native Python with Cloudflare storage

Python Workers on the Free plan failed during repeated concurrent reads: CPU
termination was followed by Pyodide promising-task/GIL errors. An older runtime
passed 96 reads but failed the extended repetition, so it was not deployed.
The user subsequently enabled Workers Paid and production returned to the Python
Worker. The native container is now stopped. This document describes the retained
fallback; Hetzner must run only if this fallback is reactivated.

## Fallback request path

Browser → Worker `chia` (`src/gateway.mjs`) → protected HTTPS origin
`mcp.chia.dongtran.asia` → `chia-native-api` (native CPython/FastAPI).
The native backend uses `chia-storage-bridge` for D1 batches and R2 uploads.
Frontend/static uploads are served by Cloudflare. D1 remains authoritative;
PostgreSQL remains frozen. Both public domains stay attached to Worker `chia`.

The storage bridge and native origin require `CHIA_CUTOVER_KEY`. Neither accepts
public unauthenticated requests. Do not log or commit this secret. The bridge
passes a complete mutation to one `DB.batch()` and does not retry writes. The
same exact-integer codecs, Decimal ledger and original signing key are used.
The separate MCP integration remains unavailable; its hostname is temporarily
used for the protected origin.

## Deployment

- Gateway: `cd cloudflare && node scripts/cf.mjs deploy --config wrangler.gateway.jsonc`.
- Storage bridge: `node scripts/cf.mjs deploy --config wrangler.storage.jsonc`.
- Backend: `/root/chia-cloudflare-native/src` on `88.99.169.73`, image
  `chia-backend` (retained original production image), container `chia-native-api`.
- Private environment: `/root/chia-cloudflare-native/native.env` (mode 600).
- Docker network: `chia_default`. No native API ports are published.
- Container command: `uvicorn chia_api.native_runtime:create_app --factory
  --host 0.0.0.0 --port 8000 --workers 2 --no-access-log`.
- Mount source at `/runtime/src:ro`, set `PYTHONPATH=/runtime/src`, load the private
  environment file, and retain restart policy `unless-stopped`.
- Caddy `/root/chia/Caddyfile` protects the native origin and retains the previous
  relay for clients with stale public DNS. Prior Caddy files are retained.

Generate shared sources with `python3 cloudflare/scripts/prepare.py` before
packaging the native source. Deploy native API updates separately from gateway
updates; Wrangler does not deploy the native container. **Do not run the Python
Worker deployment as production on Free.**

## Verification and recovery

Native recovery passed the existing Python tests, private transport tests,
42-member expense create/edit/delete, gift/repayment directions, fund restoration,
reports, AI parsing, and original browser-session continuity. Repeated public
concurrency verification passed 160/160 reads after recovery.

Private incident artifacts and encrypted recovery bundles are under
`~/.local/share/chia-cutover/`; off-site backups remain in `chia-backups` on R2.
The original full backup contains the `chia-backend` Docker image. Retain the
separately stored recovery passphrase.

D1 and R2 were not rolled back or reimported during recovery. Do not reopen the
old PostgreSQL copy as production: it does not contain subsequent D1 writes.
Workers Paid is required by the current Python deployment. Do not downgrade to
Free without redesigning and testing the CPU-intensive execution path.
