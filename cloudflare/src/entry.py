from urllib.parse import urlsplit
import hmac
from chia_api.common import env_value
from workers import WorkerEntrypoint, Response, asgi
from chia_api.main import app
from cost_guard import guard_request

class Default(WorkerEntrypoint):
    async def fetch(self,request):
        url = urlsplit(request.url)
        path = url.path
        # The original workers.dev address is private during DNS propagation.
        # Only the old origin's bridge and the cutover verifier hold this key.
        if env_value(self.env, 'CHIA_ENV') == 'production' and url.hostname.endswith('.workers.dev'):
            expected = env_value(self.env, 'CHIA_CUTOVER_KEY')
            supplied = request.headers.get('x-chia-cutover-key') or ''
            if not expected or not hmac.compare_digest(supplied, expected):
                return Response('Not found', status=404)
        blocked = await guard_request(request, self.env, path)
        if blocked is not None:
            return blocked
        if env_value(self.env, 'CHIA_READ_ONLY') == 'true' and request.method not in ('GET', 'HEAD', 'OPTIONS') and path != '/api/v1/auth/refresh':
            return Response('{"detail":"Brief maintenance: please try again shortly."}', status=503,
                            headers={'content-type':'application/json','retry-after':'60'})
        if path.startswith('/uploads/'):
            if request.method not in ('GET','HEAD'):return Response('Method not allowed',status=405)
            key=path.removeprefix('/uploads/')
            if not key or '/' in key or '..' in key:return Response('Not found',status=404)
            obj=await self.env.UPLOADS.get(key)
            if obj is None:return Response('Not found',status=404)
            headers={'content-type':obj.httpMetadata.contentType or 'application/octet-stream','cache-control':'public, max-age=86400','etag':obj.httpEtag,'x-content-type-options':'nosniff'}
            return Response(None if request.method=='HEAD' else obj.body,headers=headers)
        if path.startswith(('/api/','/oauth/','/.well-known/oauth-')) or path in ('/health','/mcp'):
            return await asgi.fetch(app,request,self.env,self.ctx)
        return await self.env.ASSETS.fetch(request)
