"""MCP server for the Chia expense splitter app."""

import json
import os
from datetime import date

from mcp.server.fastmcp import Context, FastMCP

from .client import ChiaClient
from .client import login as chia_login

_transport = os.environ.get("MCP_TRANSPORT", "stdio")


def _create_mcp() -> FastMCP:
    kwargs: dict = {
        "name": "Chia Expense Splitter",
        "host": "0.0.0.0",
        "port": int(os.environ.get("MCP_PORT", "8001")),
    }

    if _transport == "streamable-http":
        kwargs["instructions"] = (
            "Manage shared expenses, track balances, and settle debts between group members. "
            "You are already authenticated via OAuth. "
            "Use list_groups to find groups, list_members to find member IDs, "
            "and list_categories to find category IDs before creating expenses."
        )
    else:
        kwargs["instructions"] = (
            "Manage shared expenses, track balances, and settle debts between group members. "
            "IMPORTANT: Call the `login` tool first with the user's email and password "
            "before using any other tool. After login, use list_groups to find groups, "
            "list_members to find member IDs, and list_categories to find category IDs "
            "before creating expenses."
        )

    if _transport == "streamable-http":
        from .oauth_provider import ChiaOAuthProvider

        mcp_base_url = os.environ.get(
            "MCP_BASE_URL", f"http://localhost:{kwargs['port']}"
        ).rstrip("/")

        from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions

        kwargs["auth"] = AuthSettings(
            issuer_url=mcp_base_url,
            resource_server_url=f"{mcp_base_url}/mcp",
            client_registration_options=ClientRegistrationOptions(enabled=True),
        )
        kwargs["auth_server_provider"] = ChiaOAuthProvider()

    return FastMCP(**kwargs)


mcp = _create_mcp()

# Register login page routes directly on the MCP app (HTTP mode only)
if _transport == "streamable-http":
    _provider = mcp._auth_server_provider

    @mcp.custom_route("/oauth/login", methods=["GET"])
    async def _login_page(request):
        return await _provider.handle_login_page(request)

    @mcp.custom_route("/oauth/login", methods=["POST"])
    async def _login_submit(request):
        return await _provider.handle_login_submit(request)

    @mcp.custom_route("/oauth/google-callback", methods=["POST"])
    async def _google_callback(request):
        return await _provider.handle_google_callback(request)

    # NOTE: The MCP SDK natively serves all well-known endpoints including
    # path-appended variants (/.well-known/oauth-protected-resource/mcp and
    # /.well-known/oauth-authorization-server). No custom routes needed.


def _serialize(obj: object) -> str:
    return json.dumps(obj, indent=2, default=str)


# ── Auth helper ──────────────────────────────────────────────────────────

# Per-session clients for stdio login tool
_sessions: dict[str, ChiaClient] = {}


def _get_client(ctx: Context) -> ChiaClient:
    # In HTTP mode: get token from OAuth Bearer header
    if _transport == "streamable-http":
        from mcp.server.auth.middleware.auth_context import get_access_token

        token_info = get_access_token()
        if token_info and token_info.token:
            return ChiaClient(token=token_info.token)
        raise RuntimeError("Not authenticated. OAuth token missing.")

    # In stdio mode: get from login tool session
    sid = ctx.request_context.session.session_id
    client = _sessions.get(sid)
    if client is None:
        raise RuntimeError(
            "Not logged in. Call the `login` tool first with your Chia email and password."
        )
    return client


# ── Login tool (stdio only) ──────────────────────────────────────────────

if _transport != "streamable-http":

    @mcp.tool()
    async def login(email: str, password: str, ctx: Context) -> str:
        """Login to Chia with your account. You must call this before using any other tool.

        Args:
            email: Your Chia account email.
            password: Your Chia account password.
        """
        try:
            client = await chia_login(email, password)
        except Exception as e:
            return f"Login failed: {e}"
        sid = ctx.request_context.session.session_id
        old = _sessions.pop(sid, None)
        if old:
            await old.close()
        _sessions[sid] = client
        return f"Logged in successfully as {email}. You can now use all other tools."


# ── Groups ───────────────────────────────────────────────────────────────


@mcp.tool()
async def list_groups(ctx: Context) -> str:
    """List all expense groups the current user belongs to, with their balance in each group."""
    data = await _get_client(ctx).get("/api/v1/groups")
    return _serialize(data)


@mcp.tool()
async def get_group(group_id: str, ctx: Context) -> str:
    """Get details of a specific expense group.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}")
    return _serialize(data)


@mcp.tool()
async def create_group(
    name: str,
    ctx: Context,
    description: str | None = None,
    currency_code: str = "USD",
) -> str:
    """Create a new expense group.

    Args:
        name: Name of the group (e.g. "Trip to Paris", "Roommates").
        description: Optional description.
        currency_code: Default currency code (e.g. "USD", "EUR", "VND"). Defaults to USD.
    """
    payload: dict = {"name": name, "currency_code": currency_code}
    if description:
        payload["description"] = description
    data = await _get_client(ctx).post("/api/v1/groups", json=payload)
    return _serialize(data)


# ── Members ──────────────────────────────────────────────────────────────


@mcp.tool()
async def list_members(group_id: str, ctx: Context) -> str:
    """List all members of a group.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}/members")
    return _serialize(data)


@mcp.tool()
async def add_member(
    group_id: str,
    display_name: str,
    ctx: Context,
    initial_balance: float | None = None,
) -> str:
    """Add a new placeholder member to a group (they can claim their account later via invite link).

    Args:
        group_id: UUID of the group.
        display_name: Name of the member to add.
        initial_balance: Optional starting balance for migration from other systems.
            Positive = the group owes them, negative = they owe the group.
            Not counted as a transaction.
    """
    payload: dict = {"display_name": display_name}
    if initial_balance is not None:
        payload["initial_balance"] = initial_balance
    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/members",
        json=payload,
    )
    return _serialize(data)


@mcp.tool()
async def update_member(
    group_id: str,
    member_id: str,
    ctx: Context,
    display_name: str | None = None,
    initial_balance: float | None = None,
) -> str:
    """Update a group member's name or initial balance.

    Args:
        group_id: UUID of the group.
        member_id: UUID of the member.
        display_name: New display name (optional).
        initial_balance: Set starting balance for migration from other systems.
            Positive = the group owes them, negative = they owe the group.
            Not counted as a transaction. (optional)
    """
    payload: dict = {}
    if display_name is not None:
        payload["display_name"] = display_name
    if initial_balance is not None:
        payload["initial_balance"] = initial_balance
    if not payload:
        return "No fields to update. Provide display_name or initial_balance."
    data = await _get_client(ctx).patch(
        f"/api/v1/groups/{group_id}/members/{member_id}",
        json=payload,
    )
    return _serialize(data)


# ── Categories ───────────────────────────────────────────────────────────


@mcp.tool()
async def list_categories(group_id: str, ctx: Context) -> str:
    """List available expense categories for a group (includes system defaults and custom categories).

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}/categories")
    return _serialize(data)


# ── Expenses ─────────────────────────────────────────────────────────────


@mcp.tool()
async def create_expense(
    group_id: str,
    description: str,
    amount: float,
    paid_by: str,
    category_id: str,
    ctx: Context,
    split_type: str = "equal",
    splits: list[dict] | None = None,
    expense_date: str | None = None,
    currency_code: str | None = None,
    exchange_rate: float | None = None,
    fund_id: str | None = None,
) -> str:
    """Create an expense in a group. For equal splits, pass all member IDs with value=1.

    Args:
        group_id: UUID of the group.
        description: What the expense is for (e.g. "Dinner at restaurant").
        amount: Total amount of the expense.
        paid_by: UUID of the group member who paid.
        category_id: UUID of the expense category.
        split_type: How to split: "equal", "exact", "percentage", or "shares". Defaults to "equal".
        splits: List of split objects. Each has "group_member_id" (UUID str) and "value" (number).
            For equal split: value=1 for each member included.
            For exact: value is the exact amount each person owes.
            For percentage: value is the percentage (must sum to 100).
            For shares: value is the number of shares.
        expense_date: Date of the expense in YYYY-MM-DD format. Defaults to today.
        currency_code: Currency code if different from group default.
        exchange_rate: Exchange rate to group currency if using a different currency.
        fund_id: UUID of a fund to pay from. Creates a linked fund transaction automatically.
    """
    payload: dict = {
        "description": description,
        "amount": amount,
        "paid_by": paid_by,
        "category_id": category_id,
        "split_type": split_type,
        "date": expense_date or date.today().isoformat(),
        "splits": splits or [],
    }
    if currency_code:
        payload["currency_code"] = currency_code
    if exchange_rate:
        payload["exchange_rate"] = exchange_rate
    if fund_id:
        payload["fund_id"] = fund_id

    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/expenses", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def list_expenses(
    group_id: str,
    ctx: Context,
    limit: int = 20,
    offset: int = 0,
    category_id: str | None = None,
    member_id: str | None = None,
) -> str:
    """List expenses in a group with optional filters.

    Args:
        group_id: UUID of the group.
        limit: Maximum number of expenses to return (default 20, max 100).
        offset: Number of expenses to skip for pagination.
        category_id: Filter by category UUID.
        member_id: Filter by member UUID (expenses they paid).
    """
    params: dict = {"limit": limit, "offset": offset}
    if category_id:
        params["category_id"] = category_id
    if member_id:
        params["member_id"] = member_id
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/expenses", params=params
    )
    return _serialize(data)


@mcp.tool()
async def get_expense(group_id: str, expense_id: str, ctx: Context) -> str:
    """Get details of a specific expense including its splits.

    Args:
        group_id: UUID of the group.
        expense_id: UUID of the expense.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/expenses/{expense_id}"
    )
    return _serialize(data)


@mcp.tool()
async def delete_expense(group_id: str, expense_id: str, ctx: Context) -> str:
    """Delete an expense from a group.

    Args:
        group_id: UUID of the group.
        expense_id: UUID of the expense.
    """
    await _get_client(ctx).delete(f"/api/v1/groups/{group_id}/expenses/{expense_id}")
    return "Expense deleted successfully."


# ── Balances & Settlements ───────────────────────────────────────────────


@mcp.tool()
async def get_balances(group_id: str, ctx: Context) -> str:
    """Get the current balance of each member in a group. Positive = owed money, negative = owes money.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}/balances")
    return _serialize(data)


@mcp.tool()
async def get_suggested_settlements(group_id: str, ctx: Context) -> str:
    """Get optimized settlement suggestions that minimize the number of transfers needed to settle all debts.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/settlements/suggested"
    )
    return _serialize(data)


@mcp.tool()
async def record_settlement(
    group_id: str,
    from_member: str,
    to_member: str,
    amount: float,
    ctx: Context,
    description: str | None = None,
) -> str:
    """Record a settlement payment between two members.

    Args:
        group_id: UUID of the group.
        from_member: UUID of the member who is paying.
        to_member: UUID of the member who is receiving payment.
        amount: Amount being settled.
        description: Optional note about the settlement.
    """
    payload: dict = {
        "from_member": from_member,
        "to_member": to_member,
        "amount": amount,
        "type": "settle_up",
    }
    if description:
        payload["description"] = description
    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/settlements", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def list_settlements(
    group_id: str, ctx: Context, limit: int = 20, offset: int = 0
) -> str:
    """List settlement history for a group.

    Args:
        group_id: UUID of the group.
        limit: Maximum number of settlements to return (default 20).
        offset: Number of settlements to skip for pagination.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/settlements",
        params={"limit": limit, "offset": offset},
    )
    return _serialize(data)


# ── Funds ────────────────────────────────────────────────────────────────


@mcp.tool()
async def list_funds(group_id: str, ctx: Context) -> str:
    """List all funds in a group with their current balance, holder, and transaction count.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}/funds")
    return _serialize(data)


@mcp.tool()
async def get_fund(group_id: str, fund_id: str, ctx: Context) -> str:
    """Get detailed info about a fund including balance, holder, and contributions by member.

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/funds/{fund_id}"
    )
    return _serialize(data)


@mcp.tool()
async def create_fund(
    group_id: str,
    name: str,
    ctx: Context,
    description: str | None = None,
    holder_id: str | None = None,
) -> str:
    """Create a new shared fund in a group.

    Args:
        group_id: UUID of the group.
        name: Name of the fund (e.g. "Quỹ tiền phạt").
        description: Optional description of the fund's purpose.
        holder_id: UUID of the member who holds the fund. Defaults to the creator.
    """
    payload: dict = {"name": name}
    if description:
        payload["description"] = description
    if holder_id:
        payload["holder_id"] = holder_id
    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/funds", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def update_fund(
    group_id: str,
    fund_id: str,
    ctx: Context,
    name: str | None = None,
    description: str | None = None,
    holder_id: str | None = None,
    is_active: bool | None = None,
) -> str:
    """Update a fund's name, description, holder, or active status.

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
        name: New name for the fund.
        description: New description.
        holder_id: UUID of the new holder (logs a holder_change transaction).
        is_active: Set to false to close the fund, true to reopen.
    """
    payload: dict = {}
    if name is not None:
        payload["name"] = name
    if description is not None:
        payload["description"] = description
    if holder_id is not None:
        payload["holder_id"] = holder_id
    if is_active is not None:
        payload["is_active"] = is_active
    if not payload:
        return "No fields to update."
    data = await _get_client(ctx).patch(
        f"/api/v1/groups/{group_id}/funds/{fund_id}", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def close_fund(group_id: str, fund_id: str, ctx: Context) -> str:
    """Close a fund (soft delete). No new transactions can be added to a closed fund.

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
    """
    await _get_client(ctx).delete(f"/api/v1/groups/{group_id}/funds/{fund_id}")
    return "Fund closed successfully."


@mcp.tool()
async def contribute_to_fund(
    group_id: str,
    fund_id: str,
    amount: float,
    member_id: str,
    ctx: Context,
    note: str | None = None,
) -> str:
    """Record a contribution to a fund.

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
        amount: Amount contributed (must be positive).
        member_id: UUID of the member who contributed.
        note: Optional note (e.g. "Tiền phạt thua trận").
    """
    payload: dict = {
        "type": "contribute",
        "amount": amount,
        "member_id": member_id,
    }
    if note:
        payload["note"] = note
    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/funds/{fund_id}/transactions", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def withdraw_from_fund(
    group_id: str,
    fund_id: str,
    amount: float,
    member_id: str,
    ctx: Context,
    note: str | None = None,
) -> str:
    """Record a withdrawal from a fund.

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
        amount: Amount withdrawn (must be positive).
        member_id: UUID of the member who received the withdrawal.
        note: Optional note explaining the withdrawal.
    """
    payload: dict = {
        "type": "withdraw",
        "amount": amount,
        "member_id": member_id,
    }
    if note:
        payload["note"] = note
    data = await _get_client(ctx).post(
        f"/api/v1/groups/{group_id}/funds/{fund_id}/transactions", json=payload
    )
    return _serialize(data)


@mcp.tool()
async def list_fund_transactions(
    group_id: str,
    fund_id: str,
    ctx: Context,
    limit: int = 50,
    offset: int = 0,
) -> str:
    """List transaction history for a fund (contributions, withdrawals, expenses, holder changes).

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
        limit: Maximum number of transactions to return (default 50).
        offset: Number of transactions to skip for pagination.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/funds/{fund_id}/transactions",
        params={"limit": limit, "offset": offset},
    )
    return _serialize(data)


@mcp.tool()
async def delete_fund_transaction(
    group_id: str, fund_id: str, transaction_id: str, ctx: Context
) -> str:
    """Delete a fund transaction (only contribute/withdraw, not expense-linked or holder changes).

    Args:
        group_id: UUID of the group.
        fund_id: UUID of the fund.
        transaction_id: UUID of the transaction to delete.
    """
    await _get_client(ctx).delete(
        f"/api/v1/groups/{group_id}/funds/{fund_id}/transactions/{transaction_id}"
    )
    return "Transaction deleted successfully."


# ── Reports ──────────────────────────────────────────────────────────────


@mcp.tool()
async def get_group_summary(group_id: str, ctx: Context) -> str:
    """Get a spending summary for a group: total spent, per-member totals, and per-category breakdown.

    Args:
        group_id: UUID of the group.
    """
    data = await _get_client(ctx).get(f"/api/v1/groups/{group_id}/reports/summary")
    return _serialize(data)


@mcp.tool()
async def get_member_report(group_id: str, member_id: str, ctx: Context) -> str:
    """Get a detailed spending report for a specific member: what they paid and owe, broken down by category.

    Args:
        group_id: UUID of the group.
        member_id: UUID of the member.
    """
    data = await _get_client(ctx).get(
        f"/api/v1/groups/{group_id}/reports/member/{member_id}"
    )
    return _serialize(data)
