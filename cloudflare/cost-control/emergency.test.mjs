import test from 'node:test';import assert from 'node:assert/strict';
import { dormantClass, emergencySource } from './emergency.mjs';
test('suspension closes sockets and cancels alarms without deleting stored data',async()=>{
 let canceled=0,closed=0;const ctx={storage:{deleteAlarm:async()=>canceled++,deleteAll:()=>assert.fail('must preserve data')},getWebSockets:()=>[{close:(code)=>{assert.equal(code,1001);closed++;}}]};
 class Base{constructor(ctx){this.ctx=ctx;}}const Dormant=dormantClass(Base);const obj=new Dormant(ctx,{});
 assert.equal((await obj.fetch(new Request('https://internal/'))).status,503);await obj.alarm();await obj.webSocketClose();await obj.webSocketMessage();assert.equal(canceled,4);assert.equal(closed,4);
});
test('generated module preserves precisely the named durable classes',()=>{
 const source=emergencySource(['BattleRoom','RaceTracker']);assert.match(source,/export class BattleRoom extends/);assert.match(source,/export class RaceTracker extends/);assert.doesNotMatch(source,/deleteAll|DELETE FROM/);assert.throws(()=>emergencySource(['x; evil()']),/Invalid/);
});
import { drainRequest } from './emergency.mjs';
test('drain rejects unauthorized and oversize requests before accessing objects',async()=>{
 const env={COST_CONTROL_SECRET:'secret',ROOMS:{get:()=>assert.fail('no object access')}};
 const request=(data,auth='Bearer secret')=>new Request('https://internal/__budget/drain',{method:'POST',headers:{Authorization:auth},body:data});
 assert.equal((await drainRequest(request('{}','bad'),env,['ROOMS'])).status,403);
 assert.equal((await drainRequest(request('x'.repeat(8193)),env,['ROOMS'])).status,413);
 assert.equal((await drainRequest(request(JSON.stringify({binding:'OTHER',ids:[]})),env,['ROOMS'])).status,400);
});
test('drain awaits every object and reports failed IDs',async()=>{
 const id='a'.repeat(64);let called=0;const env={COST_CONTROL_SECRET:'secret',ROOMS:{idFromString:x=>x,get:()=>({fetch:async()=>{called++;return new Response(null,{status:503});}})}};
 const response=await drainRequest(new Request('https://internal/__budget/drain',{method:'POST',headers:{Authorization:'Bearer secret'},body:JSON.stringify({binding:'ROOMS',ids:[id]})}),env,['ROOMS']);
 assert.deepEqual(await response.json(),{drained:1,failed:[]});assert.equal(called,1);
});
