import asyncio,json
import httpx
from chia_api.native_runtime import RemoteD1
from chia_api.db import Store

def test_remote_batch_preserves_atomicity_and_exact_integer_values():
    seen=[]
    def handle(request):
        assert request.headers['X-Chia-Cutover-Key']=='secret'
        seen.append(json.loads(request.content))
        return httpx.Response(200,json=[{'results':[{'n':9007199254740991}]},{'results':[]}])
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle),base_url='https://private',headers={'X-Chia-Cutover-Key':'secret'}) as client:
            db=RemoteD1(client)
            result=await db.batch([db.prepare('SELECT ?').bind(9007199254740991),db.prepare('DELETE FROM x WHERE id=?').bind('x')])
            assert result[0]['results'][0]['n']==9007199254740991
    asyncio.run(run())
    assert len(seen)==1 and len(seen[0])==2

def test_remote_batch_conflict_is_not_retried():
    from fastapi import HTTPException
    import pytest
    from chia_api.db import Command
    calls=[]
    def handle(request):
        calls.append(1);return httpx.Response(409,json={'error':'constraint conflict'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle),base_url='https://private') as client:
            with pytest.raises(HTTPException) as exc:
                await Store(RemoteD1(client)).batch([Command('UPDATE x SET n=1')])
            assert exc.value.status_code==409
    asyncio.run(run());assert len(calls)==1

def test_native_origin_requires_private_header_and_preserves_cors():
    from fastapi import FastAPI,Request
    from fastapi.testclient import TestClient
    from chia_api.native_runtime import PrivateOrigin
    app=FastAPI()
    @app.get('/health')
    async def health(request:Request):
        assert request.scope['env']['CHIA_CUTOVER_KEY']=='secret'
        return {'ok':True}
    with TestClient(PrivateOrigin(app,{'CHIA_CUTOVER_KEY':'secret'})) as client:
        assert client.get('/health').status_code==404
        assert client.get('/health',headers={'X-Chia-Cutover-Key':'wrong'}).status_code==404
        assert client.get('/health',headers={'X-Chia-Cutover-Key':'secret'}).json()=={'ok':True}

def test_native_upload_uses_dict_binding_and_preserves_image_conversion():
    import io
    from PIL import Image
    from starlette.datastructures import UploadFile,Headers
    from chia_api.common import Context,upload_file
    writes=[]
    class Uploads:
        async def put(self,key,data,options):writes.append((key,data,options))
    source=io.BytesIO();Image.new('RGB',(3,3),'green').save(source,format='PNG');source.seek(0)
    file=UploadFile(source,filename='test.png',headers=Headers({'content-type':'image/png'}))
    ctx=Context(None,{'CHIA_NATIVE_RUNTIME':True,'UPLOADS':Uploads()})
    url=asyncio.run(upload_file(ctx,file))
    assert url=='/uploads/'+writes[0][0]
    assert Image.open(io.BytesIO(writes[0][1])).format=='JPEG'
    assert writes[0][2]['httpMetadata']['contentType']=='image/jpeg'
