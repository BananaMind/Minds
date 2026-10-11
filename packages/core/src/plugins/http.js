// Shared HTTP helper for plugins: timeouts, JSON/form bodies, a size cap, and readable errors
// that never echo credentials.
const MAX_BODY = 8 * 1024 * 1024;

export class PluginError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'PluginError';
    this.status = status;
    this.code = code;
  }
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { try { reader.cancel(); } catch { /* already closed */ } throw new PluginError('Response too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function describeError(status, text) {
  let msg = '';
  try {
    const j = JSON.parse(text);
    msg = j.message || j.error_description || (typeof j.error === 'string' ? j.error : j.error?.message) || j.error?.status || '';
  } catch { /* not JSON */ }
  msg = String(msg || text || '').replace(/\s+/g, ' ').slice(0, 300);
  const hint = status === 401 ? ' (the token looks invalid or expired)' : status === 403 && /rate limit/i.test(msg) ? ' (rate limited; try again later or connect a token)' : status === 404 ? ' (not found, or you do not have access)' : '';
  return `HTTP ${status}${msg ? `: ${msg}` : ''}${hint}`;
}

/**
 * request(url, {method, headers, json, form, body, timeoutMs, signal, raw}) -> parsed JSON, or text.
 * With raw: true returns {res, text} (for callers that need headers).
 */
export async function request(url, { method = 'GET', headers = {}, json, form, body, timeoutMs = 30000, signal, raw = false } = {}) {
  const h = { 'User-Agent': 'Minds/0.1', ...headers };
  let payload = body;
  if (json !== undefined) { payload = JSON.stringify(json); h['Content-Type'] ||= 'application/json'; }
  if (form) { payload = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  let res;
  try { res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.any(signals) }); }
  catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    throw new PluginError(e.name === 'TimeoutError' ? 'The request timed out' : `Network error (${e.cause?.code || e.message})`);
  }
  const text = await readCapped(res);
  if (!res.ok) throw new PluginError(describeError(res.status, text), { status: res.status });
  if (raw) return { res, text };
  if ((res.headers.get('content-type') || '').includes('json')) { try { return JSON.parse(text); } catch { /* return text */ } }
  return text;
}

export const clip = (s, n = 4000) => {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} more characters]` : s;
};

/** Pick only the listed keys (and drop empty values) so tool results stay small and readable. */
export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '').map((k) => [k, obj[k]]));

export const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** Clamp a user/model supplied limit to a sane range. */
export const limit = (n, def = 10, max = 30) => Math.max(1, Math.min(max, Math.floor(Number(n)) || def));
