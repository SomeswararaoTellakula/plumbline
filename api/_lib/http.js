// Small helpers shared by the serverless functions (Vercel Node runtime, also used by the local dev server).
import { createHash } from 'node:crypto';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req, limitBytes = 4_000_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Best-effort, per-instance rate limit so a busy demo cannot drain the API quota.
const hits = new Map();
export function rateLimited(req, max = 30, windowMs = 10 * 60 * 1000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

// Small in-memory cache: identical requests (e.g. the demo drafts) do not call the model twice.
const cache = new Map();
export function cacheKey(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > 6 * 60 * 60 * 1000) { cache.delete(key); return null; }
  return hit.value;
}
export function cacheSet(key, value) {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

export function methodGuard(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  if (req.method !== 'POST') { send(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }); return true; }
  return false;
}

export function errorResponse(res, err) {
  const status = err.status || 500;
  send(res, status, { error: err.code || 'AI_ERROR', message: err.publicMessage || err.message || 'The AI check failed.' });
}
