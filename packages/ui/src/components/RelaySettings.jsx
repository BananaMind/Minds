import { useState } from 'preact/hooks';
import { Select } from './Select.jsx';

export function RelaySettings({ settings, api, dispatch }) {
  const saved = settings.mobileRelay || { provider: 'none' };
  const [provider, setProvider] = useState(saved.provider);
  const [urls, setUrls] = useState((saved.urls || []).join('\n'));
  const [username, setUsername] = useState(saved.username || '');
  const [keyId, setKeyId] = useState(saved.keyId || '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const secretSaved = saved.provider === provider && (provider === 'cloudflare' ? saved.tokenSaved : saved.credentialSaved);
  const action = async (fn) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = () => action(async () => {
    const mobileRelay = { provider, ...(provider === 'custom' ? { urls, username, ...(secret ? { credential: secret } : {}) } : {}), ...(provider === 'cloudflare' ? { keyId, ...(secret ? { apiToken: secret } : {}) } : {}) };
    const next = await api.call('settings.set', { patch: { mobileRelay } });
    dispatch({ type: 'settings', settings: next }); setSecret('');
    setMessage(provider === 'none' ? 'Relay disabled.' : 'Relay saved. Updated phones get these settings automatically when they reconnect.');
  });
  return <div class="relay-settings">
    <b>Mobile data & remote connections</b>
    <p class="muted tiny">A relay helps when your carrier or Wi-Fi blocks a direct connection. Your chat stays encrypted. Choose a hosted service or your own TURN server.</p>
    <div class="grid">
      <label>Relay service</label>
      <Select value={provider} onChange={(value) => { setProvider(value); setSecret(''); setMessage(''); }} options={[
        { value: 'none', label: 'Off — direct connection only' },
        { value: 'cloudflare', label: 'Cloudflare TURN — no VPS needed' },
        { value: 'custom', label: 'Custom TURN server' },
      ]} />
      {provider === 'custom' && <>
        <label>TURN URLs</label><textarea class="field" style={{ height: '80px', padding: '8px 12px' }} value={urls} placeholder={'turn:relay.example.com:3478\nturns:relay.example.com:443?transport=tcp'} onInput={(e) => setUrls(e.target.value)} />
        <label>Username</label><input class="field" value={username} onInput={(e) => setUsername(e.target.value)} autoComplete="off" />
      </>}
      {provider === 'cloudflare' && <>
        <label>TURN key ID</label><input class="field" value={keyId} onInput={(e) => setKeyId(e.target.value)} autoComplete="off" />
      </>}
      {provider !== 'none' && <>
        <label>{provider === 'cloudflare' ? 'TURN API token' : 'Password'}</label>
        <input class="field" type="password" value={secret} placeholder={secretSaved ? 'Saved — leave blank to keep' : ''} onInput={(e) => setSecret(e.target.value)} autoComplete="new-password" />
      </>}
    </div>
    {provider === 'cloudflare' && <p class="muted tiny">Create a TURN key in Cloudflare Realtime → TURN. Paste its key ID and API token here. The token stays on this computer; phones receive temporary relay credentials.</p>}
    <div class="row">
      <button class="btn" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Save relay'}</button>
      {saved.provider !== 'none' && <button class="btn ghost" disabled={busy} onClick={() => action(async () => { const result = await api.call('mobile.relay.test'); setMessage(result.message); })}>Test saved relay</button>}
    </div>
    {message && <p class="muted tiny">{message}</p>}
    {error && <p class="error">{error}</p>}
  </div>;
}
