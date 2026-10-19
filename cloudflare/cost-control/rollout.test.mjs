import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWrappedUpload } from './rollout.mjs';
const settings = { compatibility_date:'2026-09-18', compatibility_flags:['nodejs_compat'], bindings:[
 {name:'TOKEN',type:'secret_text'}, {name:'DB',type:'d1',id:'db-id'},
 {name:'ROOM',type:'durable_object_namespace',class_name:'Room',namespace_id:'ns-id'},
 {name:'ASSETS',type:'assets'}, {name:'UPLOAD_RATE',type:'ratelimit',namespace_id:'999',simple:{limit:6,period:60}},
], migration_tag:'v3', limits:{cpu_ms:60000,subrequests:50}, observability:{enabled:true} };
function source(parts) {
 const boundary='test-boundary';
 const sourceBytes=Buffer.concat(parts.flatMap(([name,data])=>[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`),Buffer.from(data),Buffer.from('\r\n')]).concat(Buffer.from(`--${boundary}--\r\n`)));
 return {contentType:`multipart/form-data; boundary=${boundary}`,sourceBytes};
}

test('preserves exact deployed JS/WASM and existing bindings, without overwriting secrets or migrating DOs',async()=>{
 const wasm=Buffer.from([0,97,115,109,255,254,128,0]);
 const original='export class Room {}\nexport default {fetch(){return new Response("ok")}}';
 const before=structuredClone(settings);
 const {form,metadata,originalMain}=await buildWrappedUpload({...source([['worker.js',original],['./binary.wasm',wasm]]),settings,name:'neon-step'});
 assert.equal(originalMain,'worker.js');
 assert.deepEqual(Buffer.from(await form.get('./binary.wasm').arrayBuffer()),wasm);
 assert.equal(form.get('./binary.wasm').type,'application/wasm');
 assert.equal(await form.get('worker.js').text(),original);
 assert.match(await form.get('cost-entry.mjs').text(),/export \* from "\.\/worker.js"/);
 assert.match(await form.get('cost-admission.mjs').text(),/export function wrapWorker/);
 assert.equal(metadata.main_module,'cost-entry.mjs');
 assert.equal(metadata.keep_assets,true);
 assert.deepEqual(metadata.keep_bindings,['secret_text']);
 assert.deepEqual(metadata.bindings.slice(0,4),settings.bindings.slice(1));
 assert.ok(!metadata.bindings.some(b=>b.type==='secret_text'));
 assert.ok(!('migrations' in metadata));
 assert.equal(metadata.limits.cpu_ms,30000);
 assert.equal(metadata.limits.subrequests,50);
 assert.equal(metadata.observability.enabled,false);
 assert.deepEqual(settings,before);
 assert.deepEqual(JSON.parse(form.get('metadata')),metadata);
});

test('stable unique namespaces and normal CPU cap',async()=>{
 const namespaces=[];
 for(const name of ['ahaslides-adventures','ahaslides-vmm','dawn-of-rivers','neon-step','sky-salvo','zalo-group-bot']){
  const {metadata}=await buildWrappedUpload({...source([['worker.js','export default {}']]),settings,name});
  const limit=metadata.bindings.find(b=>b.name==='COST_REQUEST_LIMIT');
  namespaces.push(limit.namespace_id);
  assert.deepEqual(limit.simple,{limit:600,period:60});
  assert.equal(metadata.limits.cpu_ms,name==='neon-step'?30000:5000);
 }
 assert.equal(new Set(namespaces).size,6);
});

test('fails ambiguous main module and excludes special workers',async()=>{
 await assert.rejects(buildWrappedUpload({...source([['a.js','a'],['b.js','b']]),settings,name:'sky-salvo'}),/ambiguous/i);
 for(const name of ['chia','tinhdiem-tulokho','chia-runtime-spike','chia-storage-bridge','unknown']){
  await assert.rejects(buildWrappedUpload({...source([['worker.js','x']]),settings,name}),/not eligible/i);
 }
});

test('honors explicit main module and preserves its relative location',async()=>{
 const {form,originalMain}=await buildWrappedUpload({...source([['lib/worker.js','x'],['lib/helper.js','y']]),settings:{...settings,main_module:'lib/worker.js'},name:'sky-salvo'});
 assert.equal(originalMain,'lib/worker.js');
 assert.match(await form.get('cost-entry.mjs').text(),/"\.\/lib\/worker.js"/);
});

test('fails collisions rather than replacing original modules or bindings',async()=>{
 await assert.rejects(buildWrappedUpload({...source([['worker.js','x'],['cost-admission.mjs','y']]),settings,name:'sky-salvo'}),/collision/i);
 await assert.rejects(buildWrappedUpload({...source([['worker.js','x']]),settings:{...settings,bindings:[{name:'COST_REQUEST_LIMIT',type:'plain_text',text:'x'}]},name:'sky-salvo'}),/collision/i);
});
