import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace, ModuleType
from fastapi.testclient import TestClient


def test_production_cors_and_health_follow_bindings():
    from chia_api.main import app
    env=SimpleNamespace(DB=None, CHIA_ENV='production', CHIA_CORS_ORIGINS='["https://chia.dongtran.asia"]')
    old=getattr(app.state,'env',None)
    app.state.env=env
    try:
        with TestClient(app) as client:
            response=client.get('/health',headers={'Origin':'https://chia.dongtran.asia'})
            assert response.json()['environment']=='production'
            assert response.headers['access-control-allow-origin']=='https://chia.dongtran.asia'
            response=client.options('/api/v1/users/me',headers={'Origin':'https://chia.dongtran.asia','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
            assert response.status_code==200
            response=client.get('/health',headers={'Origin':'https://untrusted.example'})
            assert 'access-control-allow-origin' not in response.headers
    finally:app.state.env=old


def test_private_bridge_and_read_only_guards(monkeypatch):
    workers=ModuleType('workers')
    workers.WorkerEntrypoint=object
    workers.Response=lambda body,status=200,headers=None: SimpleNamespace(status=status,body=body)
    async def serve(*args):return SimpleNamespace(status=200)
    workers.asgi=SimpleNamespace(fetch=serve)
    monkeypatch.setitem(sys.modules,'workers',workers)
    spec=importlib.util.spec_from_file_location('cutover_entry',Path(__file__).parents[1]/'src/entry.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    worker=module.Default();worker.env=SimpleNamespace(CHIA_ENV='production',CHIA_CUTOVER_KEY='private-test-key',CHIA_READ_ONLY='true');worker.ctx=None
    async def allow(options):return SimpleNamespace(success=True)
    worker.env.RATE_GENERAL=SimpleNamespace(limit=allow)
    worker.env.RATE_AUTH=SimpleNamespace(limit=allow)
    def call(host,path,method='GET',key=None):
        req=SimpleNamespace(url='https://'+host+path,method=method,headers={'x-chia-cutover-key':key} if key else {})
        return asyncio.run(worker.fetch(req)).status
    assert call('chia.dongts1201.workers.dev','/api/v1/users/me')==404
    assert call('chia.dongts1201.workers.dev','/api/v1/users/me',key='wrong')==404
    assert call('chia.dongts1201.workers.dev','/api/v1/users/me',key='private-test-key')==200
    assert call('api.chia.dongtran.asia','/api/v1/users/me')==200
    assert call('api.chia.dongtran.asia','/api/v1/groups','POST')==503
    assert call('api.chia.dongtran.asia','/api/v1/auth/refresh','POST')==200
    worker.env.CHIA_READ_ONLY='false'
    assert call('api.chia.dongtran.asia','/api/v1/groups','POST')==200
