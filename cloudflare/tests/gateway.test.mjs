import test from 'node:test';
import assert from 'node:assert/strict';
import storage from '../src/storage_bridge.mjs';

test('private storage rejects unauthenticated requests without database access', async()=>{
 const response=await storage.fetch(new Request('https://private/_internal/db',{method:'POST',body:'[]'}),{CHIA_CUTOVER_KEY:'secret',DB:{batch(){throw Error('must not run')}}});
 assert.equal(response.status,404);
});
test('all statements are submitted as one atomic D1 batch',async()=>{
 let calls=0;const env={CHIA_CUTOVER_KEY:'secret',DB:{prepare(sql){return {bind(...params){return {sql,params}}}},async batch(statements){calls++;assert.deepEqual(statements,[{sql:'SELECT ?',params:[42]},{sql:'SELECT ?',params:['x']}]);return [{results:[{value:42}]},{results:[{value:'x'}]}]}}};
 const request=new Request('https://private/_internal/db',{method:'POST',headers:{'X-Chia-Cutover-Key':'secret'},body:JSON.stringify([{sql:'SELECT ?',params:[42]},{sql:'SELECT ?',params:['x']}])});
 const r=await storage.fetch(request,env);assert.equal(r.status,200);assert.equal(calls,1);assert.equal((await r.json())[0].results[0].value,42);
});
test('failed batch is never retried and reports a conflict without exposing SQL',async()=>{
 let calls=0;const env={CHIA_CUTOVER_KEY:'secret',DB:{prepare(){return {bind(){return {}}}},async batch(){calls++;throw Error('SQLITE_CONSTRAINT private SQL')}}};
 const r=await storage.fetch(new Request('https://private/_internal/db',{method:'POST',headers:{'X-Chia-Cutover-Key':'secret'},body:'[{"sql":"bad","params":[]}]'}),env);
 assert.equal(r.status,409);assert.equal(calls,1);assert.doesNotMatch(await r.text(),/private SQL/);
});
import gateway from '../src/gateway.mjs';
test('gateway preserves authentication and forwards once to fixed native origin',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async request=>{calls++;assert.equal(request.url,'https://mcp.chia.dongtran.asia/api/v1/users/me');assert.equal(request.headers.get('authorization'),'Bearer old-session');assert.equal(request.headers.get('x-chia-cutover-key'),'secret');return Response.json({id:'unchanged-user'})};
 try{const r=await gateway.fetch(new Request('https://chia.dongtran.asia/api/v1/users/me',{headers:{authorization:'Bearer old-session','X-Chia-Cutover-Key':'untrusted'}}),{CHIA_NATIVE_ORIGIN:'https://mcp.chia.dongtran.asia',CHIA_CUTOVER_KEY:'secret'});assert.equal(r.status,200);assert.equal(calls,1)}finally{globalThis.fetch=original}
});
test('gateway does not expose storage transport or workers.dev API',async()=>{
 const env={CHIA_CUTOVER_KEY:'secret'};
 assert.equal((await gateway.fetch(new Request('https://chia.dongtran.asia/_internal/db'),env)).status,404);
 assert.equal((await gateway.fetch(new Request('https://chia.dongts1201.workers.dev/api/v1/users/me'),env)).status,404);
});
