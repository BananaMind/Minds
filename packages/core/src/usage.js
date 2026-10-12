// ChatGPT plan usage for the signed-in Codex account: rate-limit windows and free rate-limit resets.
// These are the (undocumented) endpoints the official Codex client uses, so failures are reported, never fatal.
import { randomUUID } from 'node:crypto';
import { getCredentials } from './codex-auth.js';

const BASE = 'https://chatgpt.com/backend-api';

/** fetch with retries for network hiccups; the error names the real cause instead of "fetch failed". */
async function send(url, init) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); } catch (e) {
      if (attempt < 2 && e.name !== 'TimeoutError') { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
      const why = e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.cause?.message || e.message;
      throw new Error(`Can't reach ChatGPT (${why}). Check your internet connection and try again.`);
    }
  }
}

/** Authenticated request to the ChatGPT backend as the signed-in Codex account. */
export async function chatgpt(path, { method = 'GET', body } = {}) {
  let res;
  for (const force of [false, true]) {
    const { accessToken, accountId } = await getCredentials({ force });
    res = await send(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`, 'chatgpt-account-id': accountId, originator: 'codex_cli_rs', Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 401) break;
  }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.error?.message || data?.message || text.slice(0, 200);
    throw new Error(`ChatGPT returned HTTP ${res.status}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
  return data;
}

/** "5-hour", "Weekly", or a generic label for windows we don't know yet. */
export function windowLabel(seconds) {
  if (seconds === 18000) return '5-hour';
  if (seconds === 604800) return 'Weekly';
  if (seconds % 86400 === 0) return `${seconds / 86400}-day`;
  if (seconds % 3600 === 0) return `${seconds / 3600}-hour`;
  return `${Math.round(seconds / 60)}-minute`;
}

/** Raw /wham/usage -> {plan, allowed, limitReached, reachedType, windows: [{label, usedPercent, windowSeconds, resetsAt}]}. */
export function normalizeUsage(raw, now = Date.now()) {
  const rl = raw?.rate_limit || {};
  // Plans differ: Plus has a 5-hour and a weekly window; Pro currently only a weekly one (in either slot).
  const windows = [rl.primary_window, rl.secondary_window].filter((w) => w && Number.isFinite(w.limit_window_seconds)).map((w) => ({
    label: windowLabel(w.limit_window_seconds),
    usedPercent: Math.max(0, Math.min(100, Number(w.used_percent) || 0)),
    windowSeconds: w.limit_window_seconds,
    resetsAt: w.reset_at ? w.reset_at * 1000 : now + (Number(w.reset_after_seconds) || 0) * 1000,
  })).sort((a, b) => a.windowSeconds - b.windowSeconds);
  return {
    plan: raw?.plan_type || null,
    allowed: rl.allowed !== false,
    limitReached: Boolean(rl.limit_reached),
    reachedType: raw?.rate_limit_reached_type || null,
    windows,
    resetsAvailable: raw?.rate_limit_reset_credits?.available_count ?? null,
  };
}

/** Raw reset-credit list -> every credit as its own entry. */
export function normalizeResets(raw) {
  return {
    available: raw?.available_count ?? 0,
    credits: (raw?.credits || []).map((c) => ({
      id: c.id, title: c.title || 'Rate limit reset', description: c.description || '', status: c.status || 'unknown',
      supported: c.is_supported_by_plan !== false, grantedAt: c.granted_at || null, expiresAt: c.expires_at || null,
      redeemedAt: c.redeemed_at || null, redeemable: c.status === 'available' && c.is_supported_by_plan !== false,
    })),
  };
}

export async function getUsage() { return normalizeUsage(await chatgpt('/wham/usage')); }
export async function getResets() { return normalizeResets(await chatgpt('/wham/rate-limit-reset-credits')); }

/** Spend one reset credit. Only call after the user explicitly chose this credit. */
export async function redeemReset(creditId) {
  if (typeof creditId !== 'string' || !/^RateLimitResetCredit_[A-Za-z0-9]+$/.test(creditId)) throw new Error('Unknown reset credit.');
  const { credits } = await getResets();
  const credit = credits.find((c) => c.id === creditId);
  if (!credit) throw new Error('That reset is no longer on your account.');
  if (!credit.redeemable) throw new Error(`That reset can't be used (${credit.supported ? credit.status : 'not supported by your plan'}).`);
  const result = await chatgpt('/wham/rate-limit-reset-credits/consume', { method: 'POST', body: { credit_id: creditId, idempotency_key: `consume-rate-limit-reset-${randomUUID()}` } });
  return { result, usage: await getUsage().catch(() => null) };
}
