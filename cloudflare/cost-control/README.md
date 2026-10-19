# Cloudflare cost controls

Deployed 2026-09-18 to account `71f0645d95a495c65a6261f599afaa2c` at the owner's request: target the $5 Workers subscription and sacrifice app availability before consuming paid overages. This is a best-effort automatic shutdown system, **not a hard billing cap**.

## Live coverage

`cf-budget-guard` has no public URL. A once-per-minute cron calls a single SQLite Durable Object, which reads account-wide usage and billing with a separate scoped API token. Status is copied to KV namespace `961289f6e63142bd8a4937294a96a47d`, key `status`. The authoritative suspension latch and progress remain in the Durable Object. A `rollback` KV copy is written after suspension.

Managed Workers: `chia`, `ahaslides-adventures`, `ahaslides-vmm`, `dawn-of-rivers`, `neon-step`, `sky-salvo`, `zalo-group-bot`, plus the already disabled `chia-runtime-spike` and `chia-storage-bridge`. The assets-only `tinhdiem-tulokho` remains available. R2 buckets are private. Existing databases, uploads and backups are retained.

Chia admission: 300 general requests/minute/IP, 20 authentication requests/minute/IP, 10 upload requests/minute/IP, 10 AI requests/minute/IP. The other six active Workers additionally allow approximately 600 requests/minute/IP. These native limits apply per Cloudflare location and are eventually consistent; they are not exact global counters. Rejections return 429 with Retry-After, or 503 if the limiter is unavailable. CPU caps are 5 seconds for ordinary apps and 30 seconds for Neon Step's audio processing. Worker log ingestion and preview URLs are disabled. Chia's workers.dev URL is disabled; its production custom domains remain active.

The six JavaScript Workers were wrapped from their exact deployed source, preserving binary modules, assets, secrets, bindings and Durable Object namespace identities. Their local source/configuration was also updated so a later normal deployment retains admission limits.

## Shutdown thresholds

Any threshold is sufficient to suspend **all managed apps**. Most are 80% of included usage; Durable Object duration is 50% to reserve more monitoring headroom.

| Meter | Stop at |
| --- | ---: |
| Worker requests | 8 million |
| Worker CPU | 24 million ms |
| Durable Object requests (conservative message count) | 800,000 |
| Durable Object duration | 200,000 GB-seconds |
| DO SQLite rows read / written | 20 billion / 40 million |
| DO SQLite storage | 4 GB |
| Legacy DO reads / writes / deletes | 800,000 each |
| Legacy DO storage | 800 MB |
| D1 rows read / written | 20 billion / 40 million |
| D1 storage | 4 GB |
| R2 Standard Class A / B operations | 800,000 / 8 million |
| R2 Standard storage including unfinished uploads | 8 GB |
| KV reads | 8 million |
| KV writes / deletes / lists | 800,000 each |
| KV storage | 800 MB |
| Workers AI | 8,000 neurons per UTC day |

Monthly observations use the Workers subscription's reported period (currently August 22–September 22, also matching R2). Any positive reported billed usage, R2 Infrequent Access usage/storage, or unclassified KV operation also trips the guard. Failed usage observations trigger suspension only after at least three consecutive failures **and** no successful observation for `OBSERVATION_GRACE_MINUTES` (default 180; `0` restores the original fail-fast behaviour). Read-only API calls (GET and GraphQL) retry twice with backoff on timeouts, network errors, 429 and 5xx; mutations are never retried. Invalid/truncated responses fail validation. The watchdog does not automatically resume at a billing reset.

Suspension first saves original versions/settings, then disables workers.dev/previews, removes custom-domain attachments and clears app crons. It deploys an inert replacement while retaining all resource bindings and DO class identities. This disconnects existing WebSockets; listed DO instances have alarms cancelled. DO enumeration can lag: unlisted objects retain data, and their next alarm runs the inert cancellation handler instead of rescheduling. The watchdog retries partial failures and checks suspended apps hourly for accidental reopening.

## Incident — 2026-09-21 false suspension

At 14:34 UTC on 2026-09-21 three consecutive usage checks timed out (`The operation was aborted due to timeout`) and the guard suspended every managed app, although usage was below 1% of every threshold and billed cost was $0. Apps stayed down until 2026-09-24 ~06:35 UTC. Recovery followed the procedure below: rollback state saved to `rollback-20260921-suspension.json` in the private directory, guard cron disabled, saved versions redeployed, subdomains/custom domains/crons restored (the snapshot had missed `ahaslides-vmm`'s `* * * * *` cron; it was restored from the 09-18 backup) and leftover `budget-suspended` tags cleared. The guard was then redeployed with the retry and grace-window fix under controller `account-budget-20260924`; the old `account-budget` DO keeps the suspension record.

## Limits of the protection

Analytics and billing can be delayed or sampled. A successful empty or stale dataset cannot reliably prove zero usage. Bursts can exceed remaining allowance before detection; rejected Worker requests themselves still count. A Cloudflare outage, revoked control credential or failure of the monitor can prevent shutdown. The monitor also consumes included resources. Retained storage may continue billing if it already exceeds an allowance; no customer data is deleted to reduce that charge. New Workers/products, direct API/storage traffic and later configuration changes need a fresh coverage review. External provider charges (for example AI APIs outside Cloudflare) are outside this guard.

The existing Cloudflare $10 overage email alert is not the shutdown mechanism. This implementation does not pretend that email alerts enforce a spending cap.

## Status and recovery

Use the Cloudflare KV dashboard or authenticated REST API to read the `status` key. Check `checkedAt`, `status`, `reasons`, `observationError`, `shutdownError`, `reconciliationError` and `controlError`; an old timestamp is not healthy monitoring. Authoritative state is `control` in `BudgetController` instance `account-budget` (selected by `CONTROLLER_NAME`). There is deliberately no public reset endpoint.

Before manually restoring service:

1. Resolve the trigger and confirm remaining allowance. If awaiting a new billing cycle, verify the reported period advanced. Save the KV `rollback` state privately.
2. Disable the guard cron and confirm it is disabled before restoring any app. Preserve the old controller state as an audit trail.
3. For each worker in `rollback.shutdown.workers`, restore its saved `versions` with `POST /accounts/{account}/workers/scripts/{name}/deployments`, body `{ "strategy": "percentage", "versions": [...] }`. Verify its original bindings and DO namespaces. If an old version is unavailable, use the privately backed-up source/configuration and existing resource IDs; never replay destructive migrations.
4. Reattach saved custom domains with `PUT /accounts/{account}/workers/domains` using their hostname, zone_id, service and environment. Restore each saved subdomain state and schedule list through the corresponding script endpoints. Custom-domain TLS reattachment may take time. A previously disabled experimental Worker should stay disabled.
5. Change `CONTROLLER_NAME` in the guard config to a new unique name, then deploy the guard with its cron. This starts a fresh latch while preserving the previous rollback record in the old DO. Verify a fresh active status before accepting the restoration as complete. Never clear the latch while usage remains over threshold.
6. Verify Chia login/session continuity, API reads, assets and game connections. Normal reconnections can restart game alarms; cancelled alarm timestamps are not automatically restored by a code rollback. Do not reconnect Chia to the frozen Hetzner database without reconciling newer D1 writes.

Native Hetzner fallback would also require explicitly re-enabling the disabled storage bridge. Chia is currently independent of that bridge.

Private pre-change sources/settings, verification evidence and scoped recovery credentials are in `/home/zuzu/.local/share/cloudflare-cost-controls/` (restricted permissions). Keep secrets out of Git. The existing full migration backups remain intact. An additional encrypted recovery archive is stored at `chia-backups/cost-controls-20260918/20260918-cost-controls.tar.gz.gpg`; its downloaded bytes and decrypted archive were verified. Its passphrase remains in the existing local migration recovery-key directory.

## Verification

52 Node tests cover admission, binary-safe upload construction, metric validation, threshold evaluation, persistent latching, retry, binding preservation and redeployment detection. The Chia suite passed 93 tests. A disposable live Worker/DO drill verified shutdown, alarm cancellation and restoration of the original stored sentinel. Native rate-limit testing returned 429 with Retry-After. Production public app/health checks passed; original Chia access/refresh tokens and a previously saved browser session remained valid. No test Slack or Zalo messages were sent.

Run `node --test cost-control/*.test.mjs` from `cloudflare`. Deploy the watchdog with `node scripts/cf.mjs deploy --config cost-control/wrangler.jsonc`. Supply secrets through Wrangler, never in tracked config.

References: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [rate-limit semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [billing alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).
