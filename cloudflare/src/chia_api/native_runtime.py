"""Run the same D1 application on CPython while retaining Cloudflare data storage.

No SQL retry: a lost write response must never execute the write twice.
"""
from dataclasses import dataclass
import hmac
import os
import httpx

@dataclass(frozen=True)
class RemoteStatement:
    db: object
    sql: str
    params: tuple = ()
    def bind(self, *params):
        return RemoteStatement(self.db, self.sql, params)
    async def all(self):
        return (await self.db.batch([self]))[0]

class RemoteD1:
    def __init__(self, client): self.client=client
    def prepare(self, sql): return RemoteStatement(self, sql)
    async def batch(self, statements):
        r=await self.client.post('/_internal/db',json=[{'sql':s.sql,'params':s.params} for s in statements])
        if r.status_code==409: raise RuntimeError('constraint conflict')
        r.raise_for_status()
        return r.json()

class RemoteUploads:
    def __init__(self, client): self.client=client
    async def put(self,key,data,options):
        r=await self.client.put('/_internal/uploads/'+key,content=data,
                               headers={'content-type':options['httpMetadata']['contentType']})
        r.raise_for_status()

class PrivateOrigin:
    def __init__(self,app,env): self.app,self.env=app,env
    async def __call__(self,scope,receive,send):
        if scope['type']=='http':
            supplied=dict(scope['headers']).get(b'x-chia-cutover-key',b'')
            expected=self.env.get('CHIA_CUTOVER_KEY','').encode()
            if not expected or not hmac.compare_digest(supplied,expected):
                from starlette.responses import Response
                return await Response('Not found',status_code=404)(scope,receive,send)
            scope['env']=self.env
        await self.app(scope,receive,send)

def create_app():
    from chia_api.main import app
    env=dict(os.environ)
    client=httpx.AsyncClient(base_url=env['CHIA_STORAGE_BRIDGE_URL'],timeout=90,
        headers={'X-Chia-Cutover-Key':env['CHIA_CUTOVER_KEY']},
        limits=httpx.Limits(max_connections=60,max_keepalive_connections=20))
    env.update(DB=RemoteD1(client),UPLOADS=RemoteUploads(client),CHIA_NATIVE_RUNTIME=True)
    return PrivateOrigin(app,env)
