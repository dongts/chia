// Pricing verified 2026-09-18: developers.cloudflare.com/{workers,durable-objects,kv}/platform/pricing/
// Also /r2/pricing/ and /workers-ai/platform/pricing/. These are risk controls, not a billing cap.
export const LIMITS=Object.freeze({workersRequests:8e6,workersCpuMs:24e6,doRequests:8e5,doDurationGbSeconds:20e4,doSqlRowsRead:20e9,doSqlRowsWritten:40e6,doSqlStorageBytes:4e9,doLegacyReads:8e5,doLegacyWrites:8e5,doLegacyDeletes:8e5,doLegacyStorageBytes:8e8,d1RowsRead:20e9,d1RowsWritten:40e6,d1StorageBytes:4e9,r2ClassA:8e5,r2ClassB:8e6,r2StorageBytes:8e9,kvReads:8e6,kvWrites:8e5,kvDeletes:8e5,kvLists:8e5,kvStorageBytes:8e8,aiNeuronsToday:8000});
const SPECS=[
 ['workersInvocationsAdaptive','date','sum','requests cpuTimeUs'],
 ['durableObjectsInvocationsAdaptiveGroups','date','sum','requests'],
 ['durableObjectsPeriodicGroups','date','sum','duration rowsRead rowsWritten storageReadUnits storageWriteUnits storageDeletes inboundWebsocketMsgCount'],
 ['durableObjectsSqlStorageGroups','date namespaceId','max','storedBytes'],
 ['durableObjectsStorageGroups','date namespaceIds','max','storedBytes'],
 ['d1AnalyticsAdaptiveGroups','date','sum','rowsRead rowsWritten'],
 ['d1StorageAdaptiveGroups','date databaseId','max','databaseSizeBytes'],
 ['r2OperationsAdaptiveGroups','date actionType actionStatus storageClass','sum','requests'],
 ['r2StorageAdaptiveGroups','date bucketName storageClass','max','payloadSize metadataSize'],
 ['kvOperationsAdaptiveGroups','date actionType','sum','requests'],
 ['kvStorageAdaptiveGroups','date namespaceId','max','byteCount'],
 ['aiInferenceAdaptiveGroups','date','sum','totalNeurons'],
];
function number(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error(`Invalid numeric meter: ${label}`);return value;}
function envelope(value,label){if(!value||value.success!==true||value.errors?.length||!Array.isArray(value.result))throw new Error(`Invalid API result: ${label}`);const info=value.result_info;if(info&&(info.next_page||info.total_pages>1||info.total_count>value.result.length))throw new Error(`Truncated API result: ${label}`);return value.result;}
function sum(rows,field){return rows.reduce((n,r)=>number(n+r.sum[field],field),0);}
function storage(rows,resource,fields){const maxima=new Map();for(const r of rows){const key=JSON.stringify([r.dimensions[resource],r.dimensions.storageClass||'']);const bytes=fields.reduce((n,f)=>n+r.max[f],0);maxima.set(key,Math.max(maxima.get(key)||0,bytes));}return [...maxima.values()].reduce((a,b)=>number(a+b,'storage aggregate'),0);}
const CLASS_B=new Set('HeadBucket HeadObject GetObject UsageSummary GetBucketEncryption GetBucketLocation GetBucketCors GetBucketLifecycleConfiguration'.split(' '));
const FREE=new Set(['DeleteObject','DeleteBucket','AbortMultipartUpload']);
export async function collectUsage(api,{accountId,now=new Date()}){
 if(!/^[a-f0-9]{32}$/.test(accountId))throw new Error('Invalid account ID');
 now=new Date(now);if(!Number.isFinite(now.getTime()))throw new Error('Invalid collection time');
 const root=`accounts/${accountId}`;
 const subscriptions=envelope(await api(`${root}/subscriptions`),'subscriptions');
 const paid=subscriptions.filter(s=>s.rate_plan?.id==='workers_paid');if(paid.length!==1)throw new Error('Expected one Workers Paid subscription');
 const start=new Date(paid[0].current_period_start),end=new Date(paid[0].current_period_end);
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>now||end<=now||end-start>35*864e5||end<=start)throw new Error('Invalid or unsupported billing period');
 const billing=envelope(await api(`${root}/billable-usage?from=${start.toISOString().slice(0,10)}&to=${end.toISOString().slice(0,10)}`),'billing');
 const billedCostUsd=billing.reduce((v,r)=>number(v+number(r.BilledCost,'BilledCost'),'total billed cost'),0);
 // The future billing-period end was verified accepted by the live v1 API.
 // R2 account metrics separate published bytes from unfinished multipart uploads.
 const r2Response=await api(`${root}/r2/metrics`);
 if(r2Response?.success!==true||r2Response.errors?.length||!r2Response.result)throw new Error('Invalid R2 account metrics');
 const r2AccountStorage={};
 for(const storageClass of ['standard','infrequentAccess']){
  let bytes=0;
  for(const phase of ['published','uploaded'])for(const field of ['payloadSize','metadataSize'])bytes=number(bytes+number(r2Response.result[storageClass]?.[phase]?.[field],`R2.${storageClass}.${phase}.${field}`),'R2 storage sum');
  r2AccountStorage[storageClass]=bytes;
 }
 const datasets={};
 await Promise.all(SPECS.map(async([name,dimensions,aggregation,fields])=>{
 const query=`{viewer{accounts(filter:{accountTag:"${accountId}"}){${name}(limit:10000,filter:{datetime_geq:"${start.toISOString()}",datetime_lt:"${now.toISOString()}"}){dimensions{${dimensions}} ${aggregation}{${fields}}}}}}`;
 const response=await api('graphql',{method:'POST',body:{query}});
 const accounts=response?.data?.viewer?.accounts;
 if(response?.errors?.length||!Array.isArray(accounts)||accounts.length!==1)throw new Error(`GraphQL failure: ${name}`);
 const rows=accounts[0][name];if(!Array.isArray(rows)||rows.length>=10000)throw new Error(`Missing or truncated meter: ${name}`);
 for(const row of rows){if(!row?.dimensions||!row[aggregation])throw new Error(`Missing row fields: ${name}`);for(const f of fields.split(' '))number(row[aggregation][f],`${name}.${f}`);for(const d of dimensions.split(' ')){const value=row.dimensions[d];if(d==='namespaceIds'){if(!Array.isArray(value)&&typeof value!=='string')throw new Error(`Invalid resource dimension: ${name}`);}else if(typeof value!=='string'||!value)throw new Error(`Missing dimension ${name}.${d}`);}const date=row.dimensions.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<start.toISOString().slice(0,10)||date>now.toISOString().slice(0,10))throw new Error(`Invalid metric date: ${name}`);}
 datasets[name]=rows;
 }));
 const d=datasets,m=Object.fromEntries(Object.keys(LIMITS).map(k=>[k,0]));
 m.workersRequests=sum(d.workersInvocationsAdaptive,'requests');m.workersCpuMs=sum(d.workersInvocationsAdaptive,'cpuTimeUs')/1000;
 // Count raw invocations plus incoming non-hibernating WebSocket messages conservatively, without billing's 20:1 discount.
 m.doRequests=sum(d.durableObjectsInvocationsAdaptiveGroups,'requests')+sum(d.durableObjectsPeriodicGroups,'inboundWebsocketMsgCount');
 for(const[key,field]of [['doDurationGbSeconds','duration'],['doSqlRowsRead','rowsRead'],['doSqlRowsWritten','rowsWritten'],['doLegacyReads','storageReadUnits'],['doLegacyWrites','storageWriteUnits'],['doLegacyDeletes','storageDeletes']])m[key]=sum(d.durableObjectsPeriodicGroups,field);
 m.doSqlStorageBytes=storage(d.durableObjectsSqlStorageGroups,'namespaceId',['storedBytes']);m.doLegacyStorageBytes=storage(d.durableObjectsStorageGroups,'namespaceIds',['storedBytes']);
 m.d1RowsRead=sum(d.d1AnalyticsAdaptiveGroups,'rowsRead');m.d1RowsWritten=sum(d.d1AnalyticsAdaptiveGroups,'rowsWritten');m.d1StorageBytes=storage(d.d1StorageAdaptiveGroups,'databaseId',['databaseSizeBytes']);
 m.r2InfrequentAccess=0;
 for(const r of d.r2OperationsAdaptiveGroups){const n=r.sum.requests;if(r.dimensions.storageClass!=='Standard')m.r2InfrequentAccess+=n;if(FREE.has(r.dimensions.actionType))continue;if(CLASS_B.has(r.dimensions.actionType))m.r2ClassB+=n;else m.r2ClassA+=n;}
 m.r2StorageBytes=storage(d.r2StorageAdaptiveGroups.filter(r=>r.dimensions.storageClass==='Standard'),'bucketName',['payloadSize','metadataSize']);m.r2InfrequentAccess+=storage(d.r2StorageAdaptiveGroups.filter(r=>r.dimensions.storageClass!=='Standard'),'bucketName',['payloadSize','metadataSize']);
 m.r2StorageBytes=Math.max(m.r2StorageBytes,r2AccountStorage.standard);m.r2InfrequentAccess=Math.max(m.r2InfrequentAccess,r2AccountStorage.infrequentAccess);
 m.kvUnclassifiedRequests=0;for(const r of d.kvOperationsAdaptiveGroups){const key={read:'kvReads',write:'kvWrites',delete:'kvDeletes',list:'kvLists'}[r.dimensions.actionType];m[key||'kvUnclassifiedRequests']+=r.sum.requests;}
 m.kvStorageBytes=storage(d.kvStorageAdaptiveGroups,'namespaceId',['byteCount']);m.aiNeuronsToday=sum(d.aiInferenceAdaptiveGroups.filter(r=>r.dimensions.date===now.toISOString().slice(0,10)),'totalNeurons');
 return {r2AccountStorage,fetchedAt:now.toISOString(),billingPeriod:{start:start.toISOString(),end:end.toISOString()},billedCostUsd,metrics:m,notes:['Analytics can be sampled or delayed; no freshness/completeness watermark and no guaranteed dollar cap.','Empty datasets are not proof of zero billing; newly active resources may be absent.','Storage uses sum of per-resource period peak bytes, a conservative control rather than GB-month billing.','Workers Logs billing events are unavailable through these datasets; disable ingestion separately.','KV known request types may undercount bulk per-key usage; unknown action types fail closed.','R2 unknown operation types count against the smaller Class A allowance.'],datasets};
}
export function evaluateUsage(snapshot){const reasons=[];number(snapshot?.billedCostUsd,'billedCostUsd');if(snapshot.billedCostUsd>0)reasons.push(`billedCostUsd: ${snapshot.billedCostUsd} > 0`);for(const[key,limit]of Object.entries(LIMITS)){const value=number(snapshot.metrics?.[key],key);if(value>=limit)reasons.push(`${key}: ${value} >= ${limit}`);}for(const key of ['r2InfrequentAccess','kvUnclassifiedRequests']){const value=number(snapshot.metrics?.[key],key);if(value>0)reasons.push(`${key}: ${value} > 0`);}return reasons;}
