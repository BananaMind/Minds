import { ICE_SERVERS, normalizeIceServers, hasTurn } from '@bananamind/minds-p2p';

export function normalizeRelay(input, previous = {}) {
  const provider = input?.provider || 'none';
  if (!['none', 'custom', 'cloudflare'].includes(provider)) throw new Error('Unknown relay provider.');
  if (provider === 'none') return { provider };
  if (provider === 'custom') {
    const urls = Array.isArray(input.urls) ? input.urls : String(input.urls || '').split(/[\s,]+/).filter(Boolean);
    const credential = input.credential === undefined && previous.provider === provider ? previous.credential : input.credential;
    const servers = normalizeIceServers([{ urls, username: String(input.username || '').trim(), credential }]);
    if (!hasTurn(servers)) throw new Error('Add at least one turn: or turns: relay URL.');
    return { provider, ...servers[0] };
  }
  const keyId = String(input.keyId || '').trim();
  const apiToken = input.apiToken === undefined && previous.provider === provider ? previous.apiToken : input.apiToken;
  if (!/^[a-z0-9_-]{1,128}$/i.test(keyId) || typeof apiToken !== 'string' || !apiToken.trim() || apiToken.length > 2048 || /[\r\n]/.test(apiToken)) throw new Error('Cloudflare requires a TURN key ID and its API token.');
  return { provider, keyId, apiToken: apiToken.trim() };
}

export function publicRelay(config) {
  return { provider: config?.provider || 'none', ...(config?.provider === 'custom' ? { urls: config.urls, username: config.username, credentialSaved: Boolean(config.credential) } : {}), ...(config?.provider === 'cloudflare' ? { keyId: config.keyId, tokenSaved: Boolean(config.apiToken) } : {}) };
}

export class RelayManager {
  constructor(settings, { fetch: request = fetch } = {}) { this.settings = settings; this.request = request; this.cached = null; this.pending = null; }
  clear() { this.cached = null; this.pending = null; }
  async get() {
    const config = this.settings.get().mobileRelay || { provider: 'none' };
    if (config.provider === 'none') return { iceServers: ICE_SERVERS };
    if (config.provider === 'custom') return { iceServers: [...ICE_SERVERS, ...normalizeIceServers([config])] };
    if (this.cached?.config === config && this.cached.expiresAt > Date.now() + 5 * 60_000) return this.cached.value;
    if (this.pending?.config === config) return this.pending.promise;
    const promise = (async () => {
      const response = await this.request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.keyId)}/credentials/generate-ice-servers`, {
        method: 'POST', signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }),
      });
      if (!response.ok) throw new Error(`Cloudflare TURN could not issue credentials (HTTP ${response.status}). Check your TURN key and token.`);
      const data = await response.json();
      const servers = normalizeIceServers(data.iceServers).map((s) => ({ ...s, urls: s.urls.filter((url) => !/:53(?:\?|$)/.test(url)) })).filter((s) => s.urls.length);
      if (!hasTurn(servers)) throw new Error('Cloudflare returned no TURN relay servers.');
      const expiresAt = Date.now() + 3600_000;
      const value = { iceServers: [...ICE_SERVERS, ...servers], expiresAt };
      this.cached = { config, expiresAt, value };
      return value;
    })();
    this.pending = { config, promise };
    try { return await promise; } finally { if (this.pending?.promise === promise) this.pending = null; }
  }
}
