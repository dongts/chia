# Repository guidance

Read and follow [CLAUDE.md](CLAUDE.md) for project commands, architecture,
conventions, and gotchas before making changes. It is the shared source of
project guidance for coding agents.

For balance changes, reuse `backend/app/services/balances.py` so the group
view, dashboard, sidebar, and reports agree. Keep monetary calculations in
`Decimal` until the API serialization boundary, and verify both sides of gifts
as well as ordinary repayments.
