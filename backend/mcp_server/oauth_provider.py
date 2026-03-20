"""OAuth 2.0 provider for Chia MCP server.

Implements the MCP OAuth flow:
1. MCP client redirects user to /authorize
2. Provider redirects to /oauth/login (our login page)
3. User enters Chia email/password
4. We authenticate against Chia API, get JWT
5. Redirect back to MCP client with authorization code
6. Client exchanges code for access token (the Chia JWT)
7. Client sends Bearer <chia_jwt> with all MCP requests
"""

import os
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from mcp.shared.auth import InvalidRedirectUriError

CHIA_API_URL = os.environ.get("CHIA_API_URL", "http://localhost:8000").rstrip("/")
MCP_BASE_URL = os.environ.get("MCP_BASE_URL", "http://localhost:8001").rstrip("/")


# ── Stored data types ────────────────────────────────────────────────────


@dataclass
class PendingAuth:
    client_id: str
    redirect_uri: str
    redirect_uri_provided_explicitly: bool
    code_challenge: str
    state: str | None
    scopes: list[str]
    created_at: float = field(default_factory=time.time)


@dataclass
class StoredAuthCode:
    """Fields accessed by the MCP SDK's token handler."""

    client_id: str
    code_challenge: str
    redirect_uri: str
    redirect_uri_provided_explicitly: bool
    scopes: list[str]
    chia_token: str
    expires_at: float = field(default_factory=lambda: time.time() + 600)


# ── Login page HTML ──────────────────────────────────────────────────────

LOGIN_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chia — Sign In</title>
<script src="https://accounts.google.com/gsi/client" async></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f5f5;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }
  .card {
    background: #fff; border-radius: 12px; padding: 2.5rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    width: 100%; max-width: 400px;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .subtitle { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
  label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.25rem; color: #333; }
  input[type="email"], input[type="password"] {
    width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #ddd;
    border-radius: 8px; font-size: 0.95rem; margin-bottom: 1rem;
  }
  input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
  button[type="submit"] {
    width: 100%; padding: 0.7rem; background: #4f46e5; color: #fff;
    border: none; border-radius: 8px; font-size: 1rem; cursor: pointer;
    font-weight: 500;
  }
  button[type="submit"]:hover { background: #4338ca; }
  .error { background: #fef2f2; color: #dc2626; padding: 0.6rem 0.75rem;
    border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; }
  .divider { display: flex; align-items: center; margin: 1.25rem 0; }
  .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid #e5e5e5; }
  .divider span { padding: 0 1rem; color: #999; font-size: 0.85rem; }
  #google-btn { margin-bottom: 0.5rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Chia</h1>
  <p class="subtitle">Sign in with your Chia account to connect</p>
  {{error}}
  {{google_section}}
  <form method="POST">
    <input type="hidden" name="session" value="{{session_id}}">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>"""


GOOGLE_CLIENT_ID = os.environ.get("CHIA_GOOGLE_CLIENT_ID", "")


def _google_section(session_id: str) -> str:
    if not GOOGLE_CLIENT_ID:
        return ""
    return f"""
  <div id="google-btn"></div>
  <script>
    window.onload = function() {{
      google.accounts.id.initialize({{
        client_id: "{GOOGLE_CLIENT_ID}",
        callback: function(resp) {{
          var form = document.createElement("form");
          form.method = "POST";
          form.action = "/oauth/google-callback";
          var s = document.createElement("input");
          s.type = "hidden"; s.name = "session"; s.value = "{session_id}";
          var c = document.createElement("input");
          c.type = "hidden"; c.name = "credential"; c.value = resp.credential;
          form.appendChild(s); form.appendChild(c);
          document.body.appendChild(form); form.submit();
        }}
      }});
      google.accounts.id.renderButton(
        document.getElementById("google-btn"),
        {{ type: "standard", theme: "outline", size: "large", width: 340, text: "signin_with" }}
      );
    }};
  </script>
  <div class="divider"><span>or</span></div>
"""


def _render_login(session_id: str, error: str = "") -> str:
    error_html = f'<div class="error">{error}</div>' if error else ""
    return (
        LOGIN_PAGE
        .replace("{{session_id}}", session_id)
        .replace("{{error}}", error_html)
        .replace("{{google_section}}", _google_section(session_id))
    )


# ── OAuth Provider ───────────────────────────────────────────────────────


MCP_OAUTH_CLIENT_ID = os.environ.get("MCP_OAUTH_CLIENT_ID", "")
MCP_OAUTH_CLIENT_SECRET = os.environ.get("MCP_OAUTH_CLIENT_SECRET", "")


class _OpenRedirectClient(OAuthClientInformationFull):
    """Client that accepts any redirect_uri (for pre-registered clients)."""

    def validate_redirect_uri(self, redirect_uri):
        if redirect_uri is not None:
            return redirect_uri
        raise InvalidRedirectUriError("redirect_uri is required")


class ChiaOAuthProvider(OAuthAuthorizationServerProvider):
    def __init__(self):
        self._clients: dict[str, OAuthClientInformationFull] = {}
        self._pending: dict[str, PendingAuth] = {}
        self._codes: dict[str, StoredAuthCode] = {}
        self._access_tokens: dict[str, AccessToken] = {}

        self._pre_registered_id = MCP_OAUTH_CLIENT_ID if MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET else None

    # -- Client management --

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        client = self._clients.get(client_id)
        if client:
            return client
        # For the pre-registered client, return an open-redirect client
        # that accepts any redirect_uri (since we don't know Claude.ai's URI ahead of time).
        if client_id == self._pre_registered_id:
            return _OpenRedirectClient(
                client_id=MCP_OAUTH_CLIENT_ID,
                client_secret=MCP_OAUTH_CLIENT_SECRET,
                redirect_uris=["https://placeholder.invalid"],
                grant_types=["authorization_code", "refresh_token"],
                response_types=["code"],
                token_endpoint_auth_method="client_secret_post",
                client_name="chia-mcp",
            )
        return None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        self._clients[client_info.client_id] = client_info

    # -- Authorization --

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        session_id = secrets.token_urlsafe(32)
        self._pending[session_id] = PendingAuth(
            client_id=client.client_id,
            redirect_uri=str(params.redirect_uri),
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            code_challenge=params.code_challenge,
            state=params.state,
            scopes=params.scopes or [],
        )
        return f"{MCP_BASE_URL}/oauth/login?session={session_id}"

    # -- Authorization code --

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> StoredAuthCode | None:
        stored = self._codes.get(authorization_code)
        if not stored:
            return None
        if stored.client_id != client.client_id:
            return None
        if time.time() > stored.expires_at:
            self._codes.pop(authorization_code, None)
            return None
        return stored

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: StoredAuthCode
    ) -> OAuthToken:
        # Remove used code
        self._codes = {
            k: v for k, v in self._codes.items() if v is not authorization_code
        }

        chia_jwt = authorization_code.chia_token

        # Store access token for later validation
        self._access_tokens[chia_jwt] = AccessToken(
            token=chia_jwt,
            client_id=client.client_id,
            scopes=authorization_code.scopes,
            expires_at=None,
        )

        return OAuthToken(
            access_token=chia_jwt,
            token_type="bearer",
        )

    # -- Access token validation --

    async def load_access_token(self, token: str) -> AccessToken | None:
        return self._access_tokens.get(token)

    # -- Refresh tokens (not supported) --

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> None:
        return None

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: object,
        scopes: list[str],
    ) -> OAuthToken:
        raise NotImplementedError("Refresh tokens not supported")

    # -- Revocation --

    async def revoke_token(self, token: AccessToken) -> None:
        if isinstance(token, AccessToken):
            self._access_tokens.pop(token.token, None)

    # ── Login page handlers ──────────────────────────────────────────────

    async def handle_login_page(self, request: Request):
        session_id = request.query_params.get("session", "")
        if session_id not in self._pending:
            return HTMLResponse("Invalid or expired session.", status_code=400)
        return HTMLResponse(_render_login(session_id))

    async def handle_login_submit(self, request: Request):
        form = await request.form()
        session_id = str(form.get("session", ""))
        email = str(form.get("email", ""))
        password = str(form.get("password", ""))

        pending = self._pending.get(session_id)
        if not pending:
            return HTMLResponse("Session expired. Please try again.", status_code=400)

        # Authenticate with Chia API
        async with httpx.AsyncClient(base_url=CHIA_API_URL, timeout=30) as http:
            resp = await http.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )

        if resp.status_code != 200:
            return HTMLResponse(
                _render_login(session_id, "Invalid email or password."),
                status_code=200,
            )

        chia_token = resp.json()["access_token"]
        return self._complete_auth(session_id, chia_token)

    async def handle_google_callback(self, request: Request):
        form = await request.form()
        session_id = str(form.get("session", ""))
        credential = str(form.get("credential", ""))

        pending = self._pending.get(session_id)
        if not pending:
            return HTMLResponse("Session expired. Please try again.", status_code=400)

        # Authenticate via Chia API's Google endpoint
        async with httpx.AsyncClient(base_url=CHIA_API_URL, timeout=30) as http:
            resp = await http.post(
                "/api/v1/auth/google",
                json={"credential": credential},
            )

        if resp.status_code != 200:
            return HTMLResponse(
                _render_login(session_id, "Google sign-in failed."),
                status_code=200,
            )

        chia_token = resp.json()["access_token"]
        return self._complete_auth(session_id, chia_token)

    def _complete_auth(self, session_id: str, chia_token: str):
        """Create auth code and redirect back to MCP client."""
        pending = self._pending.pop(session_id)

        code = secrets.token_urlsafe(48)
        self._codes[code] = StoredAuthCode(
            client_id=pending.client_id,
            code_challenge=pending.code_challenge,
            redirect_uri=pending.redirect_uri,
            redirect_uri_provided_explicitly=pending.redirect_uri_provided_explicitly,
            scopes=pending.scopes,
            chia_token=chia_token,
        )

        params = {"code": code}
        if pending.state:
            params["state"] = pending.state
        redirect_url = f"{pending.redirect_uri}?{urlencode(params)}"
        return RedirectResponse(redirect_url, status_code=302)
