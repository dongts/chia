import { emergencySource } from './emergency.mjs';
const unwrap = response => {
  if(response?.success === false) throw new Error('Cloudflare API rejected shutdown operation');
  return response && Object.hasOwn(response,'result') ? response.result : response;
};
const activeVersions = deployments => (Array.isArray(deployments)?deployments[0]:deployments?.deployments?.[0])?.versions;
const versionKey = versions => JSON.stringify((versions||[]).map(v=>({version_id:v.version_id,percentage:v.percentage})).sort((a,b)=>a.version_id.localeCompare(b.version_id)));
export const targetBinding = name => 'TARGET_' + name.replace(/[^a-z0-9]/gi,'_').toUpperCase();
export function emergencyMetadata(settings, secret) {
  if(!secret)throw new Error('Missing emergency drain secret');
  const metadata={main_module:'suspended.js',compatibility_date:settings.compatibility_date,
    compatibility_flags:(settings.compatibility_flags||[]).filter(f=>!f.startsWith('python')),
    bindings:(settings.bindings||[]).filter(b=>b.type!=='secret_text'&&b.name!=='COST_CONTROL_SECRET'),
    keep_bindings:['secret_text'],keep_assets:true,limits:{cpu_ms:100}};
  metadata.bindings.push({name:'COST_CONTROL_SECRET',type:'secret_text',text:secret});
  for(const key of ['placement','usage_model','tags','tail_consumers','logpush','observability'])if(settings[key]!==undefined)metadata[key]=settings[key];
  metadata.tags=[...new Set([...(settings.tags||[]),'budget-suspended'])];
  return metadata;
}
export function verifyEmergencySettings(original, actual) {
  if(actual?.limits?.cpu_ms !== 100)throw new Error('Emergency CPU cap verification failed');
  if(!actual.tags?.includes('budget-suspended'))throw new Error('Emergency marker verification failed');
  const bindings=actual.bindings||[];
  if(!bindings.some(b=>b.name==='COST_CONTROL_SECRET'&&b.type==='secret_text'))throw new Error('Emergency drain secret verification failed');
  for(const old of original.bindings||[]){
    if(old.name==='COST_CONTROL_SECRET')continue;
    const next=bindings.find(b=>b.name===old.name);
    if(!next||next.type!==old.type)throw new Error(`Binding preservation failed: ${old.name}`);
    for(const field of ['namespace_id','class_name','script_name','bucket_name','id','service','environment']){
      if(old[field]!==undefined&&next[field]!==old[field])throw new Error(`Binding identity changed: ${old.name}.${field}`);
    }
    if(old.type==='durable_object_namespace'&&!old.namespace_id)throw new Error(`Original namespace ID missing: ${old.name}`);
  }
  const oldDOs=(original.bindings||[]).filter(b=>b.type==='durable_object_namespace');
  const newDOs=bindings.filter(b=>b.type==='durable_object_namespace');
  if(oldDOs.length!==newDOs.length)throw new Error('Durable Object binding count changed');
}
/** api(path, {method,body}) must accept a FormData body without JSON encoding it.
 * saveState must durably persist before resolving. State contains no plaintext secret.
 */
export async function shutdownAccount({accountId,workers,domains,namespaces,api,state={},saveState,env,secret=env?.COST_CONTROL_SECRET}) {
  if(!saveState||!secret)throw new Error('Durable saveState and secret required');
  const root=`/accounts/${accountId}/workers`;
  const call=async(path,options)=>unwrap(await api(path,options));
  state.workers??={};state.accountId??=accountId;
  if(state.accountId!==accountId)throw new Error('Shutdown snapshot belongs to another account');
  // Capture ALL rollback snapshots before any remote mutation.
  for(const worker of workers){const name=worker.id||worker.name;if(!state.workers[name]){
    const base=`${root}/scripts/${encodeURIComponent(name)}`;
    const settings=await call(base+'/settings');const deployments=await call(base+'/deployments');
    const originalDeployment=Array.isArray(deployments)?deployments[0]:deployments.deployments?.[0];
    if(!originalDeployment?.versions?.length)throw new Error(`No rollback version for ${name}`);
    state.workers[name]={settings,versions:originalDeployment.versions,subdomain:await call(base+'/subdomain'),
      schedules:await call(base+'/schedules'),domains:domains.filter(d=>d.service===name),namespaces:namespaces.filter(n=>n.script===name),steps:{},drained:{}};
    await saveState(state);
  }}
  // Also persist on retry when the caller retains an in-memory snapshot after a failed save.
  await saveState(state);
  const errors=[];
  const step=async(snapshot,key,action)=>{if(snapshot.steps[key])return;await action();snapshot.steps[key]=true;try{await saveState(state);}catch(error){delete snapshot.steps[key];throw error;}};
  // Cut every target's ingress before attempting any replacement or DO drain.
  for(const worker of workers){const name=worker.id||worker.name;const snapshot=state.workers[name];const base=`${root}/scripts/${encodeURIComponent(name)}`;
    const attempt=async(key,action)=>{try{await step(snapshot,key,action);}catch(error){errors.push(new Error(`${name} ${key}: ${error.message}`));}};
    await attempt('subdomain',()=>call(base+'/subdomain',{method:'POST',body:{enabled:false,previews_enabled:false}}));
    await attempt('schedules',()=>call(base+'/schedules',{method:'PUT',body:[]}));
    for(const domain of snapshot.domains)await attempt('domain:'+domain.id,async()=>{
      const current=await call(root+'/domains');
      if(current.some(d=>d.id===domain.id))await call(root+'/domains/'+domain.id,{method:'DELETE'});
    });
  }
  for(const worker of workers){const name=worker.id||worker.name;const snapshot=state.workers[name];const base=`${root}/scripts/${encodeURIComponent(name)}`;
    try {
    await step(snapshot,'replacement',async()=>{
      const bindings=snapshot.settings.bindings.filter(b=>b.type==='durable_object_namespace'&&snapshot.namespaces.some(n=>n.id===b.namespace_id||n.class===b.class_name));
      const source=emergencySource(snapshot.namespaces.map(n=>n.class),bindings.map(b=>b.name));
      const form=new FormData();form.set('metadata',JSON.stringify(emergencyMetadata(snapshot.settings,secret)));
      form.set('suspended.js',new Blob([source],{type:'application/javascript+module'}),'suspended.js');
      await call(base,{method:'PUT',body:form});
      verifyEmergencySettings(snapshot.settings,await call(base+'/settings'));
      const versions=activeVersions(await call(base+'/deployments'));
      if(!versions?.length)throw new Error('Emergency deployment version verification failed');
      snapshot.emergencyVersions=versions;
    });
    for(const namespace of snapshot.namespaces){
      const binding=snapshot.settings.bindings.find(b=>b.type==='durable_object_namespace'&&(b.namespace_id===namespace.id||b.class_name===namespace.class));
      if(!binding)throw new Error(`Missing namespace binding ${namespace.name}`);
      const target=env[targetBinding(name)];if(!target)throw new Error(`Missing ${targetBinding(name)} service binding`);
      let cursor;const seen=new Set();
      do{
        const page=await api(`${root}/durable_objects/namespaces/${namespace.id}/objects?limit=1000${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
        const objects=unwrap(page);if(!Array.isArray(objects))throw new Error('Invalid object list');
        const remaining=objects.map(o=>o.id).filter(id=>!snapshot.drained[namespace.id+':'+id]);
        for(let i=0;i<remaining.length;i+=64){const ids=remaining.slice(i,i+64);
          const response=await target.fetch(new Request('https://internal/__budget/drain',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({binding:binding.name,ids})}));
          const result=await response.json();if(!response.ok||result.drained!==ids.length||result.failed?.length)throw new Error(`Incomplete drain of ${namespace.name}`);
          for(const id of ids)snapshot.drained[namespace.id+':'+id]=true;
          try{await saveState(state);}catch(error){for(const id of ids)delete snapshot.drained[namespace.id+':'+id];throw error;}
        }
        const next=page?.result_info?.cursor;
        if(!objects.length||!next)break;if(seen.has(next))throw new Error('Object pagination cursor repeated');seen.add(next);cursor=next;
      }while(true);
    }
    if(!snapshot.steps.subdomain||!snapshot.steps.schedules||snapshot.domains.some(d=>!snapshot.steps['domain:'+d.id]))throw new Error('Ingress suspension incomplete');
    snapshot.steps.complete=true;try{await saveState(state);}catch(error){delete snapshot.steps.complete;throw error;}
    }catch(error){errors.push(new Error(`${name}: ${error.message}`));}
  }
  if(errors.length){delete state.complete;throw new AggregateError(errors,errors.map(e=>e.message).join('; '));}
  state.complete=true;try{await saveState(state);}catch(error){delete state.complete;throw error;}return state;
}

/** Revalidate the latch without changing initial rollback versions or settings. */
export async function reconcileSuspension({accountId,api,state,saveState}) {
  if(state.accountId!==accountId)throw new Error('Shutdown snapshot belongs to another account');
  const root=`/accounts/${accountId}/workers`;const call=async path=>unwrap(await api(path));
  const domains=await call(root+'/domains');const errors=[];let changed=false;
  for(const [name,snapshot] of Object.entries(state.workers||{})){
    try{
      const base=`${root}/scripts/${encodeURIComponent(name)}`;
      const liveVersions=activeVersions(await call(base+'/deployments'));
      const versionMatches=!!snapshot.emergencyVersions?.length&&!!liveVersions?.length&&versionKey(snapshot.emergencyVersions)===versionKey(liveVersions);
      const settings=await call(base+'/settings');const subdomain=await call(base+'/subdomain');const schedule=await call(base+'/schedules');
      const attached=domains.filter(d=>d.service===name);
      let settingsValid=true;try{verifyEmergencySettings(snapshot.settings,settings);}catch{settingsValid=false;}
      if(subdomain.enabled||subdomain.previews_enabled||(Array.isArray(schedule)?schedule:schedule.schedules||[]).length||attached.length||!settingsValid||!versionMatches){
        for(const domain of attached)if(!snapshot.domains.some(d=>d.id===domain.id))snapshot.domains.push(domain);
        snapshot.steps={};snapshot.drained={};state.complete=false;changed=true;
        await saveState(state);
      }
    }catch(error){errors.push(new Error(`${name}: ${error.message}`));}
  }
  if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));
  return changed;
}
