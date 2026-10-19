"""Cheap edge guards run before authentication, D1, R2, or application work.

Native rate limits are approximate and per Cloudflare location. They reduce
abuse; COST_SUSPENDED is the separate budget watchdog's shutdown switch.
"""
import json
from urllib.parse import unquote
from chia_api.common import env_value


def is_dynamic(path):
    return path.startswith(('/api/', '/uploads/', '/oauth/', '/.well-known/oauth-', '/mcp/')) or path in ('/health', '/mcp')


def rejection(request, env, status, detail):
    from workers import Response

    headers = {'content-type': 'application/json', 'retry-after': '60',
               'cache-control': 'no-store', 'vary': 'Origin'}
    origin = request.headers.get('origin')
    try:
        origins = json.loads(env_value(env, 'CHIA_CORS_ORIGINS', '[]'))
    except (ValueError, TypeError):
        origins = []
    if origin and isinstance(origins, list) and origin in origins:
        headers.update({'access-control-allow-origin': origin,
                        'access-control-allow-credentials': 'true',
                        'access-control-expose-headers': 'Retry-After'})
    return Response(json.dumps({'detail': detail}), status=status, headers=headers)


def limit_options(key):
    # Native bindings expect a JS object, not Pyodide's default Map conversion.
    try:
        from js import Object
        from pyodide.ffi import to_js
    except ImportError:
        return {'key': key}  # CPython test/local binding implementations.
    return to_js({'key': key}, dict_converter=Object.fromEntries)


async def guard_request(request, env, path):
    path = unquote(path)  # Match the decoded path seen by ASGI routing.
    if not is_dynamic(path):
        return None
    if env_value(env, 'COST_SUSPENDED') == 'true':
        return rejection(request, env, 503, 'Service temporarily paused. Please try again later.')

    bindings = ['RATE_GENERAL']
    normalized = path.rstrip('/')
    if request.method != 'OPTIONS':
        if normalized.startswith(('/api/v1/auth/', '/oauth/')):
            bindings.append('RATE_AUTH')
        if request.method == 'POST':
            if normalized.endswith(('/receipt', '/qr', '/qr-image', '/avatar')):
                bindings.append('RATE_UPLOAD')
            if normalized.endswith('/expenses/parse'):
                bindings.append('RATE_AI')

    # Cloudflare supplies this header. Never use client-controlled forwarding
    # headers or tokens as keys; clients could rotate them to evade the guard.
    key = request.headers.get('cf-connecting-ip') or 'unknown'
    for name in bindings:
        try:
            result = await env_value(env, name, None).limit(limit_options(key))
            success = result.get('success') if isinstance(result, dict) else result.success
            if success is not True and success is not False:
                raise ValueError('Invalid rate-limit result')
        except Exception:
            return rejection(request, env, 503, 'Service temporarily unavailable. Please try again shortly.')
        if not success:
            return rejection(request, env, 429, 'Too many requests. Please try again shortly.')
    return None
