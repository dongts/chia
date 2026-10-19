export function dormantClass(Base) {
  return class extends Base {
    constructor(ctx, env) { super(ctx, env); this.ctx = ctx; }
    async suspend() {
      await this.ctx.storage.deleteAlarm();
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1001, 'Service suspended'); } catch {} }
    }
    async fetch() { await this.suspend(); return new Response('Service suspended', { status: 503 }); }
    async alarm() { await this.suspend(); }
    async webSocketMessage() { await this.suspend(); }
    async webSocketClose() { await this.suspend(); }
    async webSocketError() { await this.suspend(); }
  };
}
export async function drainRequest(request, env, allowedBindings) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/__budget/drain') return new Response('Service suspended', {status:503});
  const supplied = request.headers.get('Authorization') || '';
  const expected = 'Bearer ' + (env.COST_CONTROL_SECRET || '');
  let difference = supplied.length ^ expected.length;
  for (let i = 0; i < Math.max(supplied.length, expected.length); i++) difference |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (!env.COST_CONTROL_SECRET || difference) return new Response('Forbidden', {status:403});
  const reader = request.body?.getReader(); const chunks = []; let size = 0;
  if (!reader) return new Response('Invalid body', {status:400});
  for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 8192) {await reader.cancel();return new Response('Body too large',{status:413});} chunks.push(value); }
  let body;
  try { const bytes = new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}body=JSON.parse(new TextDecoder().decode(bytes)); } catch {return new Response('Invalid JSON',{status:400});}
  if (!allowedBindings.includes(body?.binding) || !Array.isArray(body.ids) || body.ids.length > 64 || body.ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/i.test(id))) return new Response('Invalid batch',{status:400});
  let drained=0; const failed=[];
  for (const id of body.ids) {
    try { const namespace=env[body.binding];const response=await namespace.get(namespace.idFromString(id)).fetch('https://internal/suspend'); if(response.status!==503)throw new Error('Unexpected drain status');drained++; }
    catch {failed.push(id);}
  }
  return Response.json({drained,failed},{status:failed.length?502:200});
}
export function emergencySource(classNames = [], bindingNames = []) {
  for (const name of [...classNames,...bindingNames]) if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Invalid export or binding name');
  if(new Set(classNames).size!==classNames.length)throw new Error('Invalid duplicate class');
  return `import { DurableObject } from "cloudflare:workers";\n${dormantClass.toString()}\n${drainRequest.toString()}\n${classNames.map(name=>`export class ${name} extends dormantClass(DurableObject) {}`).join('\n')}\nexport default { fetch(request,env){return drainRequest(request,env,${JSON.stringify(bindingNames)});}, scheduled(){} };\n`;
}
