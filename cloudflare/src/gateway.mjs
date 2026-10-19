import {authorized} from './storage_bridge.mjs';
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(url.hostname.endsWith('.workers.dev')&&!await authorized(request,env))return new Response('Not found',{status:404});
  if(path.startsWith('/_internal/'))return new Response('Not found',{status:404});
  if(path.startsWith('/uploads/')){
   if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
   const key=path.slice('/uploads/'.length);
   if(!key||key.includes('/')||key.includes('..'))return new Response('Not found',{status:404});
   const obj=await env.UPLOADS.get(key);if(!obj)return new Response('Not found',{status:404});
   return new Response(request.method==='HEAD'?null:obj.body,{headers:{'content-type':obj.httpMetadata?.contentType||'application/octet-stream','cache-control':'public, max-age=86400','etag':obj.httpEtag,'x-content-type-options':'nosniff'}});
  }
  if(path.startsWith('/api/')||path==='/health'){
   const target=new URL(path+url.search,env.CHIA_NATIVE_ORIGIN);
   const headers=new Headers(request.headers);headers.set('X-Chia-Cutover-Key',env.CHIA_CUTOVER_KEY);headers.delete('host');
   return fetch(new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}));
  }
  if(path.startsWith('/mcp')||path.startsWith('/oauth/')||path.startsWith('/.well-known/oauth-'))return new Response('MCP integration is unavailable',{status:503});
  return env.ASSETS.fetch(request);
 }
};
