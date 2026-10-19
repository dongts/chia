"""Entry-level guards must stop requests before application or storage work."""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


class Limiter:
    def __init__(self, allowed=True, error=False):
        self.allowed, self.error, self.keys = allowed, error, []

    async def limit(self, options):
        self.keys.append(options['key'])
        if self.error:
            raise RuntimeError('unavailable')
        return SimpleNamespace(success=self.allowed)


@pytest.fixture
def worker(monkeypatch):
    workers = ModuleType('workers')
    workers.WorkerEntrypoint = object
    workers.Response = lambda body, status=200, headers=None: SimpleNamespace(body=body, status=status, headers=headers or {})
    reached = []
    async def serve(*args):
        reached.append('app')
        return workers.Response('app')
    async def assets(*args):
        reached.append('assets')
        return workers.Response('assets')
    async def uploads(*args):
        reached.append('uploads')
        return None
    workers.asgi = SimpleNamespace(fetch=serve)
    monkeypatch.setitem(sys.modules, 'workers', workers)
    spec = importlib.util.spec_from_file_location('guard_entry', Path(__file__).parents[1] / 'src/entry.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    instance = module.Default()
    instance.env = SimpleNamespace(
        CHIA_ENV='production', COST_SUSPENDED='false',
        CHIA_CORS_ORIGINS='["https://chia.dongtran.asia", "capacitor://localhost"]',
        RATE_GENERAL=Limiter(), RATE_AUTH=Limiter(), RATE_UPLOAD=Limiter(), RATE_AI=Limiter(),
        ASSETS=SimpleNamespace(fetch=assets), UPLOADS=SimpleNamespace(get=uploads),
    )
    instance.ctx = None
    instance.reached = reached
    return instance


def call(worker, path='/api/v1/groups', method='GET', **headers):
    request = SimpleNamespace(url='https://chia.dongtran.asia' + path, method=method,
                              headers={'cf-connecting-ip': '192.0.2.1', **headers})
    return asyncio.run(worker.fetch(request))


@pytest.mark.parametrize('path', ['/api/v1/groups', '/uploads/photo.jpg', '/oauth/token', '/.well-known/oauth-protected-resource', '/health', '/mcp', '/mcp/tools'])
def test_suspension_stops_all_dynamic_work(worker, path):
    worker.env.COST_SUSPENDED = 'true'
    response = call(worker, path)
    assert response.status == 503
    assert response.headers['retry-after'] == '60'
    assert json.loads(response.body)['detail']
    assert worker.reached == []
    assert worker.env.RATE_GENERAL.keys == []


def test_static_assets_still_available_during_suspension(worker):
    worker.env.COST_SUSPENDED = 'true'
    assert call(worker, '/assets/app.js').status == 200
    assert worker.reached == ['assets']


@pytest.mark.parametrize('origin,allowed', [('https://chia.dongtran.asia', True), ('capacitor://localhost', True), ('https://attacker.example', False)])
def test_rejections_have_allowlisted_cors(worker, origin, allowed):
    worker.env.RATE_GENERAL.allowed = False
    response = call(worker, origin=origin)
    assert response.status == 429
    assert response.headers['retry-after'] == '60'
    assert response.headers['vary'] == 'Origin'
    assert (response.headers.get('access-control-allow-origin') == origin) == allowed
    if allowed:
        assert response.headers['access-control-allow-credentials'] == 'true'
        assert response.headers['access-control-expose-headers'] == 'Retry-After'
    assert worker.reached == []


@pytest.mark.parametrize('path,binding', [('/api/v1/auth/guest', 'RATE_AUTH'), ('/oauth/token', 'RATE_AUTH'), ('/api/v1/groups/g/expenses/e/receipt/', 'RATE_UPLOAD'), ('/api/v1/users/me/payment-methods/p/qr', 'RATE_UPLOAD'), ('/api/v1/users/me/payment-methods/p/qr-image', 'RATE_UPLOAD'), ('/api/v1/users/me/avatar', 'RATE_UPLOAD'), ('/api/v1/groups/g/expenses/parse', 'RATE_AI')])
def test_expensive_routes_have_stricter_limit(worker, path, binding):
    getattr(worker.env, binding).allowed = False
    assert call(worker, path, 'POST').status == 429
    assert worker.env.RATE_GENERAL.keys == ['192.0.2.1']
    assert getattr(worker.env, binding).keys == ['192.0.2.1']
    assert worker.reached == []


@pytest.mark.parametrize('failure', ['throws', 'missing', 'malformed'])
def test_limiter_failures_stop_business_logic(worker, failure):
    if failure == 'throws':
        worker.env.RATE_GENERAL.error = True
    elif failure == 'missing':
        del worker.env.RATE_GENERAL
    else:
        worker.env.RATE_GENERAL.allowed = None
    assert call(worker).status == 503
    assert worker.reached == []


def test_allow_uses_trusted_ip_only(worker):
    assert call(worker, **{'x-forwarded-for': 'spoofed', 'x-real-ip': 'spoofed'}).status == 200
    assert worker.env.RATE_GENERAL.keys == ['192.0.2.1']
    assert worker.reached == ['app']


def test_missing_trusted_ip_uses_shared_bucket(worker):
    assert call(worker, **{'cf-connecting-ip': '', 'x-forwarded-for': 'spoofed'}).status == 200
    assert worker.env.RATE_GENERAL.keys == ['unknown']


def test_preflight_avoids_strict_auth_quota(worker):
    assert call(worker, '/api/v1/auth/guest', 'OPTIONS').status == 200
    assert worker.env.RATE_GENERAL.keys == ['192.0.2.1']
    assert worker.env.RATE_AUTH.keys == []


def test_encoded_route_cannot_bypass_auth_limit(worker):
    worker.env.RATE_AUTH.allowed = False
    assert call(worker, '/api/v1/%61uth/guest', 'POST').status == 429
    assert worker.reached == []


def test_native_options_convert_dictionary_to_js_object(monkeypatch):
    from cost_guard import limit_options
    js = ModuleType('js')
    converter = object()
    js.Object = SimpleNamespace(fromEntries=converter)
    ffi = ModuleType('pyodide.ffi')
    calls = []
    result = object()
    def to_js(value, *, dict_converter):
        calls.append((value, dict_converter))
        return result
    ffi.to_js = to_js
    monkeypatch.setitem(sys.modules, 'js', js)
    monkeypatch.setitem(sys.modules, 'pyodide.ffi', ffi)
    assert limit_options('192.0.2.1') is result
    assert calls == [({'key': '192.0.2.1'}, converter)]
