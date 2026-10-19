import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapWorker, generateWrapperEntry } from './admission.mjs';

function setup({ allowed = true, error = false } = {}) {
  const calls = [];
  const keys = [];
  const original = {
    marker: 'original',
    fetch(request, env, ctx) {
      calls.push([this, request, env, ctx]);
      return new Response(this.marker);
    },
    scheduled(event, env, ctx) { calls.push([this, event, env, ctx]); },
    queue(batch) { calls.push([this, batch]); },
  };
  const env = { COST_REQUEST_LIMIT: { async limit(options) {
    keys.push(options.key);
    if (error) throw new Error('offline');
    return { success: allowed };
  } } };
  const request = new Request('https://app.example/api/items', {
    headers: { 'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': 'spoofed' },
  });
  return { original, wrapped: wrapWorker(original), env, request, calls, keys };
}

test('passes original fetch arguments and receiver after trusted IP admission', async () => {
  const s = setup(); const ctx = {};
  assert.equal(await (await s.wrapped.fetch(s.request, s.env, ctx)).text(), 'original');
  assert.deepEqual(s.keys, ['192.0.2.1']);
  assert.deepEqual(s.calls, [[s.original, s.request, s.env, ctx]]);
});

for (const reason of ['suspended', 'limited', 'limiter failure', 'missing binding', 'missing env', 'missing IP', 'malformed result']) {
  test(`rejects ${reason} before calling original`, async () => {
    const s = setup({ allowed: reason === 'limited' ? false : reason === 'malformed result' ? undefined : true, error: reason === 'limiter failure' });
    if (reason === 'suspended') s.env.COST_SUSPENDED = 'true';
    if (reason === 'missing binding') delete s.env.COST_REQUEST_LIMIT;
    if (reason === 'missing env') s.env = undefined;
    if (reason === 'missing IP') s.request.headers.delete('CF-Connecting-IP');
    if (reason === 'malformed result') s.env.COST_REQUEST_LIMIT.limit = async () => ({});
    const response = await s.wrapped.fetch(s.request, s.env, {});
    assert.equal(response.status, reason === 'limited' ? 429 : 503);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok((await response.json()).detail);
    assert.deepEqual(s.calls, []);
    if (reason === 'suspended') assert.deepEqual(s.keys, []);
  });
}

for (const [origin, allowed] of [['https://app.example', true], ['capacitor://localhost', true], ['https://evil.example', false]]) {
  test(`rejection CORS for ${origin}`, async () => {
    const s = setup({ allowed: false });
    s.env.COST_CORS_ORIGINS = '["capacitor://localhost"]';
    s.request.headers.set('Origin', origin);
    const response = await s.wrapped.fetch(s.request, s.env, {});
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowed ? origin : null);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), allowed ? 'true' : null);
    assert.equal(response.headers.get('Vary'), 'Origin');
  });
}

test('static paths still consume admission when worker is invoked', async () => {
  const s = setup({ allowed: false });
  const request = new Request('https://app.example/logo.png', { headers: s.request.headers });
  assert.equal((await s.wrapped.fetch(request, s.env, {})).status, 429);
  assert.deepEqual(s.calls, []);
});

test('scheduled events preserve receiver and arguments unless suspended', async () => {
  const s = setup(); const event = {}; const ctx = {};
  await s.wrapped.scheduled(event, s.env, ctx);
  assert.deepEqual(s.calls, [[s.original, event, s.env, ctx]]);
  s.env.COST_SUSPENDED = 'true';
  await s.wrapped.scheduled(event, s.env, ctx);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.keys, []);
});

test('preserves additional handlers and their original receiver', () => {
  const s = setup(); const batch = {};
  s.wrapped.queue(batch);
  assert.deepEqual(s.calls, [[s.original, batch]]);
});

test('generated entry imports helper and preserves named exports', () => {
  const source = generateWrapperEntry('./original.mjs');
  assert.match(source, /import original from "\.\/original\.mjs"/);
  assert.match(source, /export \* from "\.\/original\.mjs"/);
  assert.match(source, /import \{ wrapWorker \} from "\.\/cost-admission\.mjs"/);
  assert.match(source, /export default wrapWorker\(original\)/);
});

test('supports frozen exports and inherited handlers', async () => {
  const calls = [];
  const prototype = { queue(batch) { calls.push([this, batch]); } };
  const original = Object.freeze(Object.assign(Object.create(prototype), {
    fetch() { assert.equal(this, original); return new Response('ok'); },
  }));
  const wrapped = wrapWorker(original);
  const batch = {};
  wrapped.queue(batch);
  assert.deepEqual(calls, [[original, batch]]);
  const s = setup();
  assert.equal((await wrapped.fetch(s.request, s.env, {})).status, 200);
  assert.equal(wrapped.scheduled, undefined);
});

test('malformed and wildcard allowlists do not grant cross-origin credentials', async () => {
  for (const origins of ['["*"]', 'broken', '{}']) {
    const s = setup({ allowed: false });
    s.env.COST_CORS_ORIGINS = origins;
    s.request.headers.set('Origin', 'https://evil.example');
    const response = await s.wrapped.fetch(s.request, s.env, {});
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  }
});
