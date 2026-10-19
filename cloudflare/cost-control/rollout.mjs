/** Offline upload construction only. This module never calls the Cloudflare API. */
import { readFile } from 'node:fs/promises';
import { generateWrapperEntry } from './admission.mjs';

// Stable mapping: do not reorder when adding another Worker.
export const WORKER_NAMES = Object.freeze([
  'ahaslides-adventures', 'ahaslides-vmm', 'dawn-of-rivers',
  'neon-step', 'sky-salvo', 'zalo-group-bot',
]);
const reservedModules = ['cost-entry.mjs', 'cost-admission.mjs'];

function inferredType(name) {
  if (/\.(m?js)$/i.test(name)) return 'application/javascript+module';
  if (/\.wasm$/i.test(name)) return 'application/wasm';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.txt$/i.test(name)) return 'text/plain';
  if (/\.(bin|data)$/i.test(name)) return 'application/octet-stream';
  throw new Error(`Cannot infer module MIME type: ${name}`);
}

/** Download API omits filenames even on WASM parts. formData() would decode
 * those parts to strings and corrupt binary bytes, so parse framing as bytes.
 */
export function parseDownloadedModules(contentType, sourceBytes) {
  if (!/^multipart\/form-data\b/i.test(contentType || '')) throw new Error('Expected multipart module source');
  const boundary = contentType.match(/\bboundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundary) throw new Error('Missing multipart boundary');
  const marker = Buffer.from('--' + (boundary[1] || boundary[2]));
  const bytes = Buffer.from(sourceBytes);
  if (!bytes.subarray(0, marker.length).equals(marker)) throw new Error('Invalid multipart opening');
  const modules = new Map();
  let cursor = marker.length;
  while (true) {
    if (bytes.subarray(cursor, cursor + 2).toString() === '--') break;
    if (bytes.subarray(cursor, cursor + 2).toString() !== '\r\n') throw new Error('Invalid multipart delimiter');
    const headerEnd = bytes.indexOf('\r\n\r\n', cursor + 2);
    if (headerEnd < 0) throw new Error('Missing multipart headers');
    const headers = bytes.subarray(cursor + 2, headerEnd).toString('utf8');
    const name = headers.match(/content-disposition:[^\r\n]*\bname="([^"\r\n]+)"/i)?.[1];
    if (!name || modules.has(name) || name === 'metadata') throw new Error('Invalid or duplicate module name');
    const next = bytes.indexOf(Buffer.concat([Buffer.from('\r\n'), marker]), headerEnd + 4);
    if (next < 0) throw new Error('Missing multipart closing boundary');
    const type = headers.match(/^content-type:\s*([^\r\n]+)/im)?.[1] || inferredType(name);
    modules.set(name, { bytes: bytes.subarray(headerEnd + 4, next), type });
    cursor = next + 2 + marker.length;
  }
  if (!modules.size) throw new Error('No deployed modules');
  return modules;
}

export async function buildWrappedUpload({ contentType, sourceBytes, settings, name }) {
  const index = WORKER_NAMES.indexOf(name);
  if (index < 0) throw new Error(`Worker not eligible for generic wrapping: ${name}`);
  if (!settings?.compatibility_date || !Array.isArray(settings.bindings)) throw new Error('Complete deployed settings required');
  const modules = parseDownloadedModules(contentType, sourceBytes);
  for (const moduleName of modules.keys()) {
    if (reservedModules.includes(moduleName.replace(/^\.\//, ''))) throw new Error('Admission module collision');
  }
  if (settings.bindings.some(b => ['COST_REQUEST_LIMIT', 'COST_SUSPENDED'].includes(b.name))) throw new Error('Admission binding collision');
  const explicitMain = settings.main_module || settings.entry_point ||
    contentType.match(/\bcf-entrypoint=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
  const candidates = [...modules].filter(([, part]) => /javascript|ecmascript/.test(part.type)).map(([key]) => key);
  const originalMain = explicitMain || (candidates.length === 1 ? candidates[0] : null);
  if (!originalMain) throw new Error('Ambiguous main module; supply deployed main_module');
  if (!modules.has(originalMain) || !candidates.includes(originalMain)) throw new Error('Main module is missing or not JavaScript');
  const metadata = {
    main_module: 'cost-entry.mjs',
    compatibility_date: settings.compatibility_date,
    compatibility_flags: structuredClone(settings.compatibility_flags || []),
    bindings: structuredClone(settings.bindings.filter(b => b.type !== 'secret_text')),
    keep_bindings: ['secret_text'], keep_assets: true,
    limits: { ...settings.limits, cpu_ms: name === 'neon-step' ? 30000 : 5000 },
    observability: { enabled: false }, logpush: false,
  };
  // Omitting migrations retains current classes and migration state. Never
  // replay settings.migration_tag as a migration instruction.
  for (const key of ['placement', 'usage_model', 'tags', 'tail_consumers']) {
    if (settings[key] !== undefined) metadata[key] = structuredClone(settings[key]);
  }
  metadata.bindings.push({ name: 'COST_REQUEST_LIMIT', type: 'ratelimit',
    namespace_id: String(910100 + index), simple: { limit: 600, period: 60 } });
  metadata.bindings.push({ name: 'COST_SUSPENDED', type: 'plain_text', text: 'false' });
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  for (const [moduleName, part] of modules) {
    form.set(moduleName, new Blob([part.bytes], { type: part.type }), moduleName);
  }
  const path = originalMain.startsWith('./') ? originalMain : './' + originalMain;
  form.set('cost-entry.mjs', new Blob([generateWrapperEntry(path)], { type: 'application/javascript+module' }), 'cost-entry.mjs');
  const helper = await readFile(new URL('./admission.mjs', import.meta.url));
  form.set('cost-admission.mjs', new Blob([helper], { type: 'application/javascript+module' }), 'cost-admission.mjs');
  return { form, metadata, originalMain };
}
