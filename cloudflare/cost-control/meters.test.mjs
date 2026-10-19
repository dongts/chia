import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUsage,evaluateUsage,LIMITS} from './meters.mjs';
const now=new Date('2026-09-18T12:00:00Z');
function fixture(overrides={},billing=[]){return async(path,options)=>{
 if(path.endsWith('/subscriptions'))return {success:true,result:[{rate_plan:{id:'workers_paid'},price:5,current_period_start:'2026-08-22T00:00:00Z',current_period_end:'2026-09-22T00:00:00Z'}]};
 if(path.endsWith('/r2/metrics'))return {success:true,result:{standard:{published:{payloadSize:0,metadataSize:0},uploaded:{payloadSize:0,metadataSize:0}},infrequentAccess:{published:{payloadSize:0,metadataSize:0},uploaded:{payloadSize:0,metadataSize:0}}}};
 if(path.includes('billable-usage'))return {success:true,result:billing};
 assert.equal([...options.body.query].filter(c=>c==='{').length,[...options.body.query].filter(c=>c==='}').length,'balanced GraphQL query');
 const ds=options.body.query.match(/\{([a-z]\w+)\(limit:/)[1];
 return {data:{viewer:{accounts:[{[ds]:Object.hasOwn(overrides,ds)?overrides[ds]:[]}]}},errors:null};
};}
const row=(date,max,dimensions={})=>({dimensions:{date,...dimensions},max});
test('storage counts each resource peak once, AI resets at UTC day',async()=>{
 const s=await collectUsage(fixture({d1StorageAdaptiveGroups:[row('2026-09-17',{databaseSizeBytes:100},{databaseId:'a'}),row('2026-09-18',{databaseSizeBytes:80},{databaseId:'a'}),row('2026-09-18',{databaseSizeBytes:30},{databaseId:'b'})],aiInferenceAdaptiveGroups:[{dimensions:{date:'2026-09-17'},sum:{totalNeurons:99999}},{dimensions:{date:'2026-09-18'},sum:{totalNeurons:3}}]}),{accountId:'a'.repeat(32),now});
 assert.equal(s.metrics.d1StorageBytes,130);assert.equal(s.metrics.aiNeuronsToday,3);assert.deepEqual(evaluateUsage(s),[]);assert.equal(s.billingPeriod.start,'2026-08-22T00:00:00.000Z');
});
test('threshold boundary and charged usage trip deterministically',async()=>{
 const s=await collectUsage(fixture({},[{BilledCost:0.01}]),{accountId:'a'.repeat(32),now});s.metrics.workersRequests=LIMITS.workersRequests;
 assert.deepEqual(evaluateUsage(s),['billedCostUsd: 0.01 > 0','workersRequests: 8000000 >= 8000000']);
});
test('invalid, missing and truncated data fail closed',async()=>{
 for(const rows of [null,[{dimensions:{date:'2026-09-18'},sum:{requests:NaN,cpuTimeUs:0}}],[{dimensions:{date:'2026-09-18'},sum:{requests:-1,cpuTimeUs:0}}],Array(10000).fill({})])await assert.rejects(collectUsage(fixture({workersInvocationsAdaptive:rows}),{accountId:'a'.repeat(32),now}));
});
test('unknown KV actions and R2 infrequent access trip',async()=>{
 const s=await collectUsage(fixture({kvOperationsAdaptiveGroups:[{dimensions:{date:'2026-09-18',actionType:'bulk_read'},sum:{requests:1}}],r2OperationsAdaptiveGroups:[{dimensions:{date:'2026-09-18',actionType:'GetObject',storageClass:'InfrequentAccess',actionStatus:'success'},sum:{requests:1}}]}),{accountId:'a'.repeat(32),now});
 assert.ok(evaluateUsage(s).some(x=>x.includes('kvUnclassifiedRequests')));assert.ok(evaluateUsage(s).some(x=>x.includes('r2InfrequentAccess')));
});
test('rejects GraphQL errors and billing pagination',async()=>{
 const normal=fixture();
 await assert.rejects(collectUsage(async(p,o)=>p==='graphql'?{errors:[{message:'denied'}]}:normal(p,o),{accountId:'a'.repeat(32),now}),/GraphQL failure/);
 await assert.rejects(collectUsage(async(p,o)=>p.includes('billable-usage')?{success:true,result:[],result_info:{total_pages:2}}:normal(p,o),{accountId:'a'.repeat(32),now}),/Truncated/);
});
test('rejects expired billing window and nonfinite evaluation',async()=>{
 await assert.rejects(collectUsage(fixture(),{accountId:'a'.repeat(32),now:new Date('2026-09-23T00:00:00Z')}),/billing period/);
 const s=await collectUsage(fixture(),{accountId:'a'.repeat(32),now});s.metrics.aiNeuronsToday=Infinity;assert.throws(()=>evaluateUsage(s),/Invalid numeric meter/);
});

test('R2 unfinished uploads count toward storage and billing query covers whole cycle',async()=>{
 const base=fixture();let billingPath;
 const api=async(p,o)=>{if(p.includes('billable-usage'))billingPath=p;if(p.endsWith('/r2/metrics'))return {success:true,result:{standard:{published:{payloadSize:10,metadataSize:2},uploaded:{payloadSize:8000000000,metadataSize:1}},infrequentAccess:{published:{payloadSize:0,metadataSize:0},uploaded:{payloadSize:1,metadataSize:0}}}};return base(p,o);};
 const s=await collectUsage(api,{accountId:'a'.repeat(32),now});assert.equal(s.metrics.r2StorageBytes,8000000013);assert.equal(s.metrics.r2InfrequentAccess,1);assert.ok(billingPath.endsWith('to=2026-09-22'));assert.ok(evaluateUsage(s).some(r=>r.startsWith('r2StorageBytes:')));
});
test('malformed account R2 storage fails closed',async()=>{
 const base=fixture();await assert.rejects(collectUsage(async(p,o)=>p.endsWith('/r2/metrics')?{success:true,result:{}}:base(p,o),{accountId:'a'.repeat(32),now}),/R2|numeric/);
});
