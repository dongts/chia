/** Admission checks for public JS Worker fetch handlers.
 * Native quotas are approximate and per location; the budget watchdog provides
 * the separate shutdown mechanism. Assets served without invoking the Worker
 * remain outside this wrapper.
 */
function reject(request, env, status) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Retry-After': '60',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = request.headers.get('Origin');
  let allowed = [];
  try {
    const configured = env?.COST_CORS_ORIGINS;
    allowed = Array.isArray(configured) ? configured : JSON.parse(configured || '[]');
    if (!Array.isArray(allowed)) allowed = [];
  } catch { /* Malformed allowlist must not grant access. */ }
  if (origin && origin !== 'null' &&
      (origin === new URL(request.url).origin || allowed.includes(origin))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  return new Response(JSON.stringify({ detail: status === 429
    ? 'Too many requests. Please try again shortly.'
    : 'Service temporarily unavailable. Please try again later.' }), { status, headers });
}

export function wrapWorker(original) {
  if (!original || typeof original.fetch !== 'function') {
    throw new TypeError('Admission wrapper requires a Worker object with a fetch handler');
  }
  // Keep other handlers, including inherited ones, attached to their original
  // receiver. A separate proxy target also supports frozen Worker exports.
  const overrides = {
    async fetch(request, env, ctx) {
      if (env?.COST_SUSPENDED === 'true') return reject(request, env, 503);
      const key = request.headers.get('CF-Connecting-IP')?.trim();
      if (!key) return reject(request, env, 503);
      let result;
      try {
        result = await env.COST_REQUEST_LIMIT.limit({ key });
      } catch {
        return reject(request, env, 503);
      }
      if (result?.success === false) return reject(request, env, 429);
      if (result?.success !== true) return reject(request, env, 503);
      return original.fetch.call(original, request, env, ctx);
    },
  };
  if (typeof original.scheduled === 'function') {
    overrides.scheduled = function(event, env, ctx) {
      if (env?.COST_SUSPENDED === 'true') return;
      return original.scheduled.call(original, event, env, ctx);
    };
  }
  return new Proxy(overrides, {
    get(target, name, receiver) {
      if (Object.hasOwn(target, name)) return Reflect.get(target, name, receiver);
      const value = Reflect.get(original, name, original);
      return typeof value === 'function' ? value.bind(original) : value;
    },
    has(target, name) { return name in target || name in original; },
  });
}

/** Upload admission.mjs as cost-admission.mjs alongside this generated entry. */
export function generateWrapperEntry(originalModulePath) {
  if (typeof originalModulePath !== 'string' || !originalModulePath) {
    throw new TypeError('Original module path is required');
  }
  const path = JSON.stringify(originalModulePath);
  return `import original from ${path};\nimport { wrapWorker } from "./cost-admission.mjs";\nexport * from ${path};\nexport default wrapWorker(original);\n`;
}
