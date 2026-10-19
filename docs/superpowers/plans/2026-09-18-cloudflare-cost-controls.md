# Cloudflare cost controls implementation plan

> For agentic workers: use superpowers:subagent-driven-development for independent work; execute without further approval because the user approved app shutdown to target $5 total.

Goal: suspend paid application activity before included usage allowances are consumed, with a fallback when any usage overage is reported.
Architecture: account-wide scheduled watchdog queries supported usage APIs, persists a latch, and disables app entrypoints/schedules. Application admission guards limit bursts and stop expensive work. Preserve all durable data and recovery backups.
Tech stack: Cloudflare Workers, REST/GraphQL usage APIs, existing Python/JS apps, node:test and pytest.
Spec: /home/zuzu/.local/share/cloudflare-cost-controls/PLAN.md plus user's approval to stop apps to avoid pay-as-you-go.

## Constraints
- No guaranteed dollar cap claims. Include reporting delay and ongoing storage costs.
- Use actual billing periods and product-specific allowances; $5 means base subscription, no intended overages.
- No extra paid products, deletion of data, or secret exposure. No test messages to Slack/Zalo.
- Preserve Chia's original JWT key, databases, uploads and existing sessions.
- Keep changes reversible and snapshot deployed configuration before mutations.

## Tasks
- [ ] Verify billing API access, units, periods, and early thresholds; save private evidence.
- [ ] Verify reversible shutdown paths for public domains, workers.dev, cron, DO alarms and sockets.
- [ ] Implement/test Chia limiter and suspension guard in entry.py/cost_guard.py; add bindings, retain 5000ms CPU.
- [ ] Implement/test account guard under cloudflare/cost-control: reject missing/invalid usage; latch suspension and never automatically resume; exact supported controls only. Tests must cover below/at thresholds, paid cost, stale/failed observations, retrying partial shutdown and preserving unrelated bindings.
- [ ] Apply conservative resource settings and protect remaining dynamic entrypoints; verify static assets and normal app requests.
- [ ] Deploy watchdog with protected credentials and scheduled execution, force a test shutdown on a disposable probe only, and verify real schedule/usage result.
- [ ] Review final changes, original Chia session, configured resources, gaps; document recovery and watchdog limitations.
