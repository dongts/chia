"""Entry point: python -m mcp_server"""

import os

transport = os.environ.get("MCP_TRANSPORT", "stdio")

if transport == "streamable-http":
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Mount, Route

    from .server import _get_oauth_provider, mcp

    provider = _get_oauth_provider()

    app = Starlette(
        routes=[
            Route("/oauth/login", provider.handle_login_page, methods=["GET"]),
            Route("/oauth/login", provider.handle_login_submit, methods=["POST"]),
            Route("/oauth/google-callback", provider.handle_google_callback, methods=["POST"]),
            Mount("/", app=mcp.streamable_http_app()),
        ],
    )

    port = int(os.environ.get("MCP_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)

else:
    from .server import mcp

    mcp.run(transport="stdio")
