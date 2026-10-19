import test from 'node:test';import assert from 'node:assert/strict';
import {shutdownAccount,emergencyMetadata,targetBinding} from './shutdown.mjs';
test('emergency metadata preserves bindings and namespaces without migration changes',()=>{
 const bindings=[{name:'ROOMS',type:'durable_object_namespace',namespace_id:'ns',class_name:'Room'},{name:'PRIVATE',type:'secret_text'},{name:'BUCKET',type:'r2_bucket',bucket_name:'data'}];
 const m=emergencyMetadata({bindings,compatibility_date:'2026-09-18',compatibility_flags:['nodejs_compat'],limits:{cpu_ms:5000}},'s');
 assert.deepEqual(m.bindings.slice(0,2),[bindings[0],bindings[2]]);assert.deepEqual(m.keep_bindings,['secret_text']);assert.equal(m.keep_assets,true);assert.equal(m.migrations,undefined);assert.equal(m.limits.cpu_ms,100);assert.equal(targetBinding('aha-game'),'TARGET_AHA_GAME');
});
test('shutdown persists rollback before mutations and retries without replacing snapshot',async()=>{
 const id='a'.repeat(64);const worker={id:'game'};const ns={id:'ns',script:'game',class:'Room',name:'room'};let saved=false,fail=true,uploaded=false;const changes=[];let state={};
 const api=async(path,options)=>{
  if(options){assert.ok(saved,'snapshot saved first');changes.push([path,options]);if(options.body instanceof FormData)uploaded=true;return{result:{}};}
  if(path.endsWith('/settings'))return{result:{...(uploaded?{limits:{cpu_ms:100},tags:['budget-suspended']}:{}),bindings:[...(uploaded?[{name:'COST_CONTROL_SECRET',type:'secret_text'}]:[]),{name:'ROOMS',type:'durable_object_namespace',namespace_id:'ns',class_name:'Room'}],compatibility_date:'2026-09-18'}};
  if(path.endsWith('/deployments'))return{result:{deployments:[{versions:[{version_id:uploaded?'emergency':'original',percentage:100}]}]}};
  if(path.endsWith('/subdomain'))return{result:{enabled:true,previews_enabled:true}};
  if(path.endsWith('/schedules'))return{result:{schedules:[{cron:'* * * * *'}]}};
  if(path.includes('/objects?'))return{result:path.includes('cursor=')?[]:[{id}],result_info:{cursor:'end'}};
  throw new Error(path);
 };
 const env={COST_CONTROL_SECRET:'secret',TARGET_GAME:{fetch:async()=>{if(fail)throw new Error('temporary');return Response.json({drained:1,failed:[]});}}};
 const params={accountId:'acct',workers:[worker],domains:[],namespaces:[ns],api,state,env,saveState:async s=>{saved=true;state=structuredClone(s);}};
 await assert.rejects(shutdownAccount(params),/temporary/);assert.equal(changes.length,3);assert.equal(state.workers.game.versions[0].version_id,'original');
 fail=false;await shutdownAccount({...params,state});assert.equal(changes.length,3);assert.equal(state.complete,true);assert.equal(state.workers.game.drained['ns:'+id],true);
 const form=changes[2][1].body;assert.ok(form instanceof FormData);assert.match(await form.get('suspended.js').text(),/export class Room extends/);
});
import {verifyEmergencySettings} from './shutdown.mjs';
test('verification rejects namespace reassignment, lost bindings and missing limits',()=>{
 const original={bindings:[{name:'ROOMS',type:'durable_object_namespace',class_name:'Room',namespace_id:'original'}]};
 const actual={tags:['budget-suspended'],limits:{cpu_ms:100},bindings:[...original.bindings,{name:'COST_CONTROL_SECRET',type:'secret_text'}]};
 verifyEmergencySettings(original,actual);
 assert.throws(()=>verifyEmergencySettings(original,{...actual,bindings:[{...actual.bindings[0],namespace_id:'different'},actual.bindings[1]]}),/identity changed/);
 assert.throws(()=>verifyEmergencySettings(original,{...actual,limits:{cpu_ms:1000}}),/CPU/);
 assert.throws(()=>verifyEmergencySettings(original,{...actual,bindings:[actual.bindings[1]]}),/preservation/);
});
test('failed snapshot persistence prevents mutations even when retry uses in-memory state',async()=>{
 const state={};let calls=0,saves=0;
 const api=async(path,options)=>{assert.equal(options,undefined);calls++;if(path.endsWith('/deployments'))return{deployments:[{versions:[{version_id:'original',percentage:100}]}]};return{bindings:[]};};
 const args={accountId:'a',workers:[{id:'x'}],domains:[],namespaces:[],api,state,env:{},secret:'s',saveState:async()=>{saves++;throw new Error('storage unavailable');}};
 await assert.rejects(shutdownAccount(args),/storage unavailable/);await assert.rejects(shutdownAccount(args),/storage unavailable/);assert.equal(saves,2);assert.equal(state.complete,undefined);assert.equal(calls,4);
});
test('failed final persistence cannot leave a false complete flag',async()=>{
 const state={};const args={accountId:'a',workers:[],domains:[],namespaces:[],state,api:()=>assert.fail('no API needed'),env:{},secret:'s',saveState:async s=>{if(s.complete)throw new Error('save failed');}};
 await assert.rejects(shutdownAccount(args),/save failed/);assert.equal(state.complete,undefined);
 const result=await shutdownAccount({...args,saveState:async()=>{}});assert.equal(result.complete,true);
});
import {reconcileSuspension} from './shutdown.mjs';
test('every ingress is cut and later replacements run despite first DO drain failure',async()=>{
 const original={bindings:[{name:'ROOMS',type:'durable_object_namespace',namespace_id:'ns',class_name:'Room'}],compatibility_date:'2026-09-18'};
 const snapshot=(settings,namespaces)=>({settings,versions:[{version_id:'original',percentage:100}],domains:[],namespaces,steps:{},drained:{}});
 const state={accountId:'a',workers:{first:snapshot(original,[{id:'ns',name:'room',script:'first',class:'Room'}]),second:snapshot({bindings:[]},[])}};const events=[];
 const api=async(path,options)=>{
  if(options){events.push(path);return{result:{}};}
  if(path.endsWith('/settings'))return{result:{...(path.includes('/first/')?original:{bindings:[]}),limits:{cpu_ms:100},tags:['budget-suspended'],bindings:[...(path.includes('/first/')?original.bindings:[]),{name:'COST_CONTROL_SECRET',type:'secret_text'}]}};
  if(path.endsWith('/deployments'))return{result:{deployments:[{versions:[{version_id:'emergency',percentage:100}]}]}};
  if(path.includes('/objects?'))return{result:[{id:'a'.repeat(64)}]};throw new Error(path);
 };
 const args={accountId:'a',workers:[{id:'first'},{id:'second'}],domains:[],namespaces:[],api,state,saveState:async()=>{},env:{COST_CONTROL_SECRET:'s',TARGET_FIRST:{fetch:async()=>{events.push('drain');throw new Error('drain outage');}}}};
 await assert.rejects(shutdownAccount(args),/drain outage/);
 assert.ok(events.indexOf('/accounts/a/workers/scripts/second/subdomain')<events.indexOf('drain'));
 assert.ok(events.includes('/accounts/a/workers/scripts/second'));assert.equal(state.workers.second.steps.complete,true);assert.equal(state.complete,undefined);
 assert.equal(state.workers.first.versions[0].version_id,'original');assert.equal(state.workers.second.versions[0].version_id,'original');
});
test('reconciliation catches reopening and retains initial rollback versions and settings',async()=>{
 const original={bindings:[],tags:['original']};const state={accountId:'a',complete:true,workers:{x:{settings:original,versions:[{version_id:'original'}],emergencyVersions:[{version_id:'emergency',percentage:100}],domains:[{id:'old',service:'x'}],steps:{complete:true,replacement:true},drained:{done:true}}}};
 let saved=0;const api=async path=>{
  if(path.endsWith('/deployments'))return{result:{deployments:[{versions:[{version_id:'emergency',percentage:100}]}]}};
  if(path.endsWith('/domains'))return{result:[{id:'reattached',service:'x',hostname:'example.com'}]};
  if(path.endsWith('/settings'))return{result:{limits:{cpu_ms:100},tags:['budget-suspended'],bindings:[{name:'COST_CONTROL_SECRET',type:'secret_text'}]}};
  if(path.endsWith('/subdomain'))return{result:{enabled:true,previews_enabled:false}};
  if(path.endsWith('/schedules'))return{result:{schedules:[]}};throw new Error(path);
 };
 assert.equal(await reconcileSuspension({accountId:'a',api,state,saveState:async()=>saved++}),true);
 assert.equal(state.complete,false);assert.deepEqual(state.workers.x.steps,{});assert.deepEqual(state.workers.x.drained,{});assert.equal(state.workers.x.settings,original);assert.equal(state.workers.x.versions[0].version_id,'original');assert.equal(state.workers.x.domains.length,2);assert.equal(saved,1);
});
test('reconciliation leaves intact suspension unchanged and detects missing marker',async()=>{
 const state={accountId:'a',complete:true,workers:{x:{settings:{bindings:[]},versions:[{version_id:'original'}],emergencyVersions:[{version_id:'emergency',percentage:100}],domains:[],steps:{complete:true},drained:{}}}};let marker=true;
 const api=async path=>({result:path.endsWith('/deployments')?{deployments:[{versions:[{version_id:'emergency',percentage:100}]}]}:path.endsWith('/domains')?[]:path.endsWith('/settings')?{limits:{cpu_ms:100},tags:marker?['budget-suspended']:[],bindings:[{name:'COST_CONTROL_SECRET',type:'secret_text'}]}:path.endsWith('/schedules')?{schedules:[]}:{enabled:false,previews_enabled:false}});
 assert.equal(await reconcileSuspension({accountId:'a',api,state,saveState:async()=>assert.fail('unchanged')}),false);assert.equal(state.complete,true);
 marker=false;assert.equal(await reconcileSuspension({accountId:'a',api,state,saveState:async()=>{}}),true);assert.equal(state.complete,false);
});
test('reconciliation detects redeployed code even when all suspension settings and tags persist',async()=>{
 const state={accountId:'a',complete:true,workers:{x:{settings:{bindings:[]},versions:[{version_id:'original'}],emergencyVersions:[{version_id:'emergency',percentage:100}],domains:[],steps:{replacement:true,complete:true},drained:{old:true}}}};
 const api=async path=>({result:path.endsWith('/deployments')?{deployments:[{versions:[{version_id:'redeployed',percentage:100}]}]}:path.endsWith('/domains')?[]:path.endsWith('/settings')?{limits:{cpu_ms:100},tags:['budget-suspended'],bindings:[{name:'COST_CONTROL_SECRET',type:'secret_text'}]}:path.endsWith('/schedules')?{schedules:[]}:{enabled:false,previews_enabled:false}});
 assert.equal(await reconcileSuspension({accountId:'a',api,state,saveState:async()=>{}}),true);
 assert.equal(state.complete,false);assert.deepEqual(state.workers.x.steps,{});assert.deepEqual(state.workers.x.drained,{});assert.equal(state.workers.x.versions[0].version_id,'original');
});
test('reconciliation compares version traffic independently of array order',async()=>{
 const versions=[{version_id:'b',percentage:25},{version_id:'a',percentage:75}];
 const state={accountId:'a',complete:true,workers:{x:{settings:{bindings:[]},emergencyVersions:versions,domains:[],steps:{complete:true},drained:{}}}};
 const api=async path=>({result:path.endsWith('/deployments')?{deployments:[{versions:[...versions].reverse()}]}:path.endsWith('/domains')?[]:path.endsWith('/settings')?{limits:{cpu_ms:100},tags:['budget-suspended'],bindings:[{name:'COST_CONTROL_SECRET',type:'secret_text'}]}:path.endsWith('/schedules')?{schedules:[]}:{enabled:false,previews_enabled:false}});
 assert.equal(await reconcileSuspension({accountId:'a',api,state,saveState:async()=>assert.fail('unchanged')}),false);
});
