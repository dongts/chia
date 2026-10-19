import test from 'node:test';import assert from 'node:assert/strict';
import { runGuard, cloudflareAPI } from './guard.mjs';
const at=minutes=>new Date(Date.parse('2026-09-21T14:00:00Z')+minutes*60000);
function harness(){let state={};let halted=0;const env={ACCOUNT_ID:'account',TARGET_WORKERS:'["app"]'};const store={load:async()=>structuredClone(state),save:async x=>{state=structuredClone(x)}};const api=async path=>({success:true,result:path.endsWith('/scripts')?[{id:'app'},{id:'cf-budget-guard'}]:[]});const deps={api,measure:async()=>({metrics:{}}),evaluate:()=>[],halt:async()=>{halted++}};return{env,store,deps,state:()=>state,halted:()=>halted};}
test('healthy usage remains active, shutdown latches and never resumes automatically',async()=>{
 const h=harness();await runGuard(h.env,h.store,h.deps);assert.equal(h.state().status,'active');assert.equal(h.halted(),0);
 h.deps.evaluate=()=>['workers CPU threshold'];await runGuard(h.env,h.store,h.deps);assert.equal(h.state().status,'suspended');assert.equal(h.halted(),1);
 h.deps.evaluate=()=>[];await runGuard(h.env,h.store,h.deps);assert.equal(h.state().status,'suspended');assert.equal(h.halted(),2);
});
test('brief observation outages do not shut down; sustained blindness past the grace window does',async()=>{
 const h=harness();h.deps.measure=async()=>{throw Error('The operation was aborted due to timeout')};
 for(let i=0;i<5;i++){h.deps.now=at(i);await runGuard(h.env,h.store,h.deps);}
 assert.equal(h.halted(),0);assert.equal(h.state().status,'observation_failed');assert.equal(h.state().observationFailures,5);
 h.deps.now=at(179);await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),0);
 h.deps.now=at(180);await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),1);assert.equal(h.state().status,'suspended');assert.match(h.state().reasons[0],/unavailable/);
});
test('grace window is measured from the last successful observation and resets on recovery',async()=>{
 const h=harness();h.deps.now=at(0);await runGuard(h.env,h.store,h.deps);
 const measure=h.deps.measure;h.deps.measure=async()=>{throw Error('timeout')};
 for(const m of [100,150,170]){h.deps.now=at(m);await runGuard(h.env,h.store,h.deps);}
 assert.equal(h.halted(),0);
 h.deps.now=at(181);await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),1);
 const g=harness();g.deps.now=at(0);await runGuard(g.env,g.store,g.deps);g.deps.measure=async()=>{throw Error('timeout')};
 for(const m of [100,150,170]){g.deps.now=at(m);await runGuard(g.env,g.store,g.deps);}
 g.deps.measure=measure;g.deps.now=at(175);await runGuard(g.env,g.store,g.deps);
 assert.equal(g.state().status,'active');assert.equal(g.state().observationFailures,0);assert.equal(g.state().firstObservationFailureAt,undefined);
 g.deps.measure=async()=>{throw Error('timeout')};for(const m of [200,300,354]){g.deps.now=at(m);await runGuard(g.env,g.store,g.deps);}
 assert.equal(g.halted(),0);g.deps.now=at(355);await runGuard(g.env,g.store,g.deps);assert.equal(g.halted(),1);
});
test('OBSERVATION_GRACE_MINUTES is configurable and 0 restores fail-fast after three failures',async()=>{
 const h=harness();h.env.OBSERVATION_GRACE_MINUTES='0';h.deps.measure=async()=>{throw Error('down')};
 for(let i=0;i<2;i++){h.deps.now=at(i);await runGuard(h.env,h.store,h.deps);}assert.equal(h.halted(),0);
 h.deps.now=at(2);await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),1);
});
test('threshold breaches still suspend immediately',async()=>{
 const h=harness();h.deps.now=at(0);h.deps.evaluate=()=>['workersRequests: 9e6 >= 8e6'];await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),1);assert.equal(h.state().status,'suspended');
});
test('partial shutdown is persisted and retried, never recorded as complete',async()=>{
 const h=harness();h.deps.evaluate=()=>['cost'];h.deps.halt=async({state,saveState})=>{state.started=true;await saveState(state);throw Error('failure')};await runGuard(h.env,h.store,h.deps);assert.equal(h.state().status,'suspended');assert.equal(h.state().shutdown.started,true);assert.equal(h.state().shutdown.complete,undefined);
 let attempts=0;h.deps.halt=async({workers,state,saveState})=>{attempts++;assert.deepEqual(workers,[{id:'app'}]);state.complete=true;await saveState(state)};await runGuard(h.env,h.store,h.deps);assert.equal(attempts,1);assert.equal(h.state().shutdown.complete,true);
});
test('fails before remote mutations if suspension state cannot persist',async()=>{
 const h=harness();h.deps.evaluate=()=>['cost'];h.store.save=async()=>{throw Error('storage down')};await assert.rejects(runGuard(h.env,h.store,h.deps),/storage/);assert.equal(h.halted(),0);
});
test('evaluation failures accumulate instead of resetting on each successful fetch',async()=>{
 const h=harness();h.deps.evaluate=()=>{throw Error('invalid metrics')};for(const m of [0,90,180])await(h.deps.now=at(m),runGuard(h.env,h.store,h.deps));assert.equal(h.halted(),1);assert.equal(h.state().observationFailures,3);
});
test('missing or paginated worker inventory cannot produce completed shutdown',async()=>{
 const h=harness();h.deps.evaluate=()=>['cost'];h.deps.api=async path=>({result:[],result_info:{total_pages:2}});await runGuard(h.env,h.store,h.deps);assert.equal(h.halted(),0);assert.match(h.state().shutdownError,/inventory/);
});
test('completed shutdown is reconciled hourly and reopened apps are suspended again',async()=>{
 const h=harness();h.deps.evaluate=()=>['cost'];h.deps.halt=async({state,saveState})=>{state.complete=true;await saveState(state)};await runGuard(h.env,h.store,h.deps);
 let checked=0;h.deps.reconcile=async({state,saveState})=>{checked++;state.complete=false;await saveState(state);return true};h.deps.now=new Date('2026-10-01T00:00:00Z');await runGuard(h.env,h.store,h.deps);assert.equal(checked,1);assert.equal(h.state().shutdown.complete,true);await runGuard(h.env,h.store,h.deps);assert.equal(checked,1);
});
test('missing control credential persists failure instead of leaving healthy status',async()=>{
 const h=harness();const {api,...deps}=h.deps;await runGuard(h.env,h.store,deps);assert.equal(h.state().status,'observation_failed');assert.match(h.state().observationError,/credential/);
});
test('API client retries transient read failures but never retries mutations',async()=>{
 const responses=()=>[()=>new Response('',{status:504}),()=>{throw new Error('The operation was aborted due to timeout')},()=>Response.json({success:true,result:[1]})];
 let queue=responses(),calls=0;const fetcher=async()=>{calls++;return queue.shift()();};
 const api=cloudflareAPI('t',fetcher,{backoffMs:0});
 assert.deepEqual((await api('/accounts/a/subscriptions')).result,[1]);assert.equal(calls,3);
 queue=responses();calls=0;assert.deepEqual((await api('graphql',{method:'POST',body:{query:'{}'}})).result,[1]);assert.equal(calls,3);
 queue=responses();calls=0;await assert.rejects(api('/accounts/a/workers/scripts/x/schedules',{method:'PUT',body:[]}),/504/);assert.equal(calls,1);
 queue=[()=>new Response('',{status:403})];calls=0;await assert.rejects(api('/accounts/a/subscriptions'),/403/);assert.equal(calls,1);
 queue=[504,504,504].map(status=>()=>new Response('',{status}));calls=0;await assert.rejects(api('/accounts/a/subscriptions'),/504/);assert.equal(calls,3);
});
