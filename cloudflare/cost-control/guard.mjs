import { collectUsage, evaluateUsage } from './meters.mjs';
import { shutdownAccount, reconcileSuspension } from './shutdown.mjs';
const TRANSIENT=new Set([408,425,429,500,502,503,504,520,521,522,523,524]);
class TransientError extends Error {}
export function cloudflareAPI(token, fetcher=fetch, {retries=2, backoffMs=2000, timeoutMs=30000}={}) {
 if(!token)throw new Error('Missing Cloudflare control credential');
 return async(path,options={})=>{
  const headers={Authorization:`Bearer ${token}`};let body=options.body;
  if(body!==undefined&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const method=options.method||'GET',label=path.split('?')[0];
  // Only reads are retried; GraphQL analytics queries are POST but read-only.
  const idempotent=method==='GET'||label.replace(/^\//,'')==='graphql';
  for(let attempt=0;;attempt++){
   try{
    let r;
    try{r=await fetcher('https://api.cloudflare.com/client/v4/'+path.replace(/^\//,''),{method,headers,body,signal:AbortSignal.timeout(timeoutMs)});}
    catch(error){throw new TransientError(String(error.message));}
    if(!r.ok){const message=`Cloudflare API HTTP ${r.status} (${label})`;throw TRANSIENT.has(r.status)?new TransientError(message):new Error(message);}
    const j=await r.json();if(j.success===false)throw new Error(`Cloudflare API rejected ${label}`);return j;
   }catch(error){
    if(!(error instanceof TransientError)||!idempotent||attempt>=retries)throw new Error(error.message);
    await new Promise(resolve=>setTimeout(resolve,backoffMs*(attempt+1)));
   }
  }
 };
}
const result=j=>j&&Object.hasOwn(j,'result')?j.result:j;
export const DEFAULT_OBSERVATION_GRACE_MINUTES=180;
export async function runGuard(env,store,{api,measure=collectUsage,evaluate=evaluateUsage,halt=shutdownAccount,reconcile=reconcileSuspension,now=new Date()}={}) {
 const state=await store.load()||{};state.version=1;state.checkedAt=now.toISOString();
 if(state.status!=='suspended'){
  try{
   api??=cloudflareAPI(env.CLOUDFLARE_CONTROL_TOKEN);
   const snapshot=await measure(api,{accountId:env.ACCOUNT_ID,now});
   const reasons=evaluate(snapshot);
   state.usage=snapshot;state.observationFailures=0;state.lastSuccessfulObservation=now.toISOString();delete state.observationError;delete state.firstObservationFailureAt;delete state.controlError;
   if(reasons.length){state.status='suspended';state.reasons=reasons;state.suspendedAt=now.toISOString();}
   else state.status='active';
  }catch(error){
   state.observationFailures=(state.observationFailures||0)+1;state.observationError=String(error.message).slice(0,300);
   state.firstObservationFailureAt??=now.toISOString();
   // Transient API outages must not take every app down: stay blind only up to the grace window.
   const grace=Number(env.OBSERVATION_GRACE_MINUTES??DEFAULT_OBSERVATION_GRACE_MINUTES);
   const graceMs=(Number.isFinite(grace)&&grace>=0?grace:DEFAULT_OBSERVATION_GRACE_MINUTES)*60000;
   const blindSince=Date.parse(state.lastSuccessfulObservation||state.firstObservationFailureAt);
   if(state.observationFailures>=3&&now.getTime()-blindSince>=graceMs){state.status='suspended';state.reasons=[`Usage observations unavailable for ${state.observationFailures} consecutive checks since ${new Date(blindSince).toISOString()}`];state.suspendedAt=now.toISOString();}
   else state.status='observation_failed';
  }
 }
 await store.save(state); // Persist suspension latch BEFORE any remote change.
 if(state.status==='suspended'&&state.shutdown?.complete&&(!state.lastReconciledAt||now.getTime()-Date.parse(state.lastReconciledAt)>=3600000)){
  try{
   api??=cloudflareAPI(env.CLOUDFLARE_CONTROL_TOKEN);
   await reconcile({accountId:env.ACCOUNT_ID,api,state:state.shutdown,saveState:async progress=>{state.shutdown=progress;await store.save(state);}});
   state.lastReconciledAt=now.toISOString();delete state.reconciliationError;
  }catch(error){state.reconciliationError=String(error.message).slice(0,300);}
  await store.save(state);
 }
 if(state.status==='suspended'&&!state.shutdown?.complete){
  try{
   api??=cloudflareAPI(env.CLOUDFLARE_CONTROL_TOKEN);
   const wanted=JSON.parse(env.TARGET_WORKERS);if(!Array.isArray(wanted)||!wanted.length)throw Error('No managed targets');
   const root=`/accounts/${env.ACCOUNT_ID}/workers`;
   const [scripts,domains,namespaces]=await Promise.all([api(root+'/scripts'),api(root+'/domains'),api(root+'/durable_objects/namespaces')]);
   for(const response of [scripts,domains,namespaces]) {
    if(!Array.isArray(result(response))||response.result_info?.total_pages>1||response.result_info?.next_page)throw Error('Incomplete resource inventory');
   }
   const workers=result(scripts).filter(w=>wanted.includes(w.id));
   if(workers.length!==wanted.length)throw Error('Managed worker inventory is incomplete');
   state.shutdown??={};
   await halt({accountId:env.ACCOUNT_ID,workers,domains:result(domains),namespaces:result(namespaces),api,state:state.shutdown,env,saveState:async progress=>{state.shutdown=progress;await store.save(state);}});
   delete state.shutdownError;
  }catch(error){state.shutdownError=String(error.message).slice(0,300);}
  await store.save(state);
 }
 return {status:state.status,checkedAt:state.checkedAt,reasons:state.reasons||[],complete:!!state.shutdown?.complete,observationFailures:state.observationFailures||0,shutdownError:state.shutdownError};
}
