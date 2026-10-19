// Private transport for the native Python backend. All mutations remain atomic D1 batches.
export async function authorized(request, env) {
  const supplied=request.headers.get('X-Chia-Cutover-Key') || '';
  if(!env.CHIA_CUTOVER_KEY || !supplied)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(supplied)),crypto.subtle.digest('SHA-256',enc.encode(env.CHIA_CUTOVER_KEY))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
export default {
  async fetch(request,env) {
    if(!await authorized(request,env))return new Response('Not found',{status:404});
    const path=new URL(request.url).pathname;
    if(path==='/_internal/db' && request.method==='POST'){
      try {
        const commands=await request.json();
        if(!Array.isArray(commands)||!commands.length||commands.length>1000)return new Response('Invalid batch',{status:400});
        const result=await env.DB.batch(commands.map(c=>env.DB.prepare(c.sql).bind(...c.params)));
        return Response.json(result);
      }catch(e){
        const conflict=/constraint|assertion|insufficient|stale|abort|foreign key/i.test(String(e));
        return Response.json({error:conflict?'constraint conflict':'Database request failed'},{status:conflict?409:503});
      }
    }
    if(path.startsWith('/_internal/uploads/') && request.method==='PUT'){
      const key=path.slice('/_internal/uploads/'.length);
      if(!/^[a-f0-9-]+\.(jpg|pdf)$/.test(key))return new Response('Invalid key',{status:400});
      const body=await request.arrayBuffer();if(body.byteLength>11*1024*1024)return new Response('Too large',{status:413});
      await env.UPLOADS.put(key,body,{httpMetadata:{contentType:request.headers.get('content-type')||'application/octet-stream'}});
      return Response.json({ok:true});
    }
    return new Response('Not found',{status:404});
  }
};
