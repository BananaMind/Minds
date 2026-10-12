import { useState } from 'preact/hooks';

export function ProviderSettings({ state, api, dispatch }) {
  const saved = state.settings.openai || {};
  const [baseUrl, setUrl] = useState(saved.baseUrl || 'http://localhost:11434/v1');
  const [key, setKey] = useState('');
  const [models, setModels] = useState((saved.models || []).join('\n'));
  const [tools, setTools] = useState(saved.tools !== false);
  const [images, setImages] = useState(saved.images === true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ids = () => models.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  const save = async (makeDefault = false) => {
    const patch = { openai: { baseUrl, models: ids(), tools, images, ...(key ? { apiKey: key } : {}) } };
    if (makeDefault) {
      if (!ids().length) throw new Error('Enter at least one model ID first.');
      patch.defaultProvider = 'openai'; patch.defaultModel = ids()[0];
    }
    await api.call('settings.set', { patch }); setKey('');
    dispatch({ type: 'state', state: await api.call('state') });
  };
  const run = async (fn) => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };
  return <section>
    <b>OpenAI-compatible API / local models</b>
    <p class="muted">Connect Ollama, LM Studio, llama.cpp, vLLM, or a hosted compatible API. Requests run through this computer.</p>
    <div class="grid">
      <label>API base URL</label><input class="field" value={baseUrl} onInput={e => setUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
      <label>API key (optional)</label><input class="field" type="password" value={key} onInput={e => setKey(e.target.value)} placeholder={saved.keySaved ? 'Saved — leave blank to keep' : 'Leave empty for a local server'} autoComplete="new-password" />
      <label>Model IDs</label><textarea class="field" style={{ height: '90px', padding: '8px 12px' }} value={models} onInput={e => setModels(e.target.value)} placeholder="One model ID per line, exactly as your server expects" />
      <label>Tools</label><label class="check"><input type="checkbox" checked={tools} onChange={e => setTools(e.target.checked)} /> Enable tool calling (requires a model that supports tools)</label>
      <label>Images</label><label class="check"><input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)} /> Model supports image input (lets bots see your screen)</label>
    </div>
    <div class="row">
      <button class="btn" disabled={busy} onClick={() => run(async () => { await save(); setMessage('Saved. Choose this provider in a bot’s menu.'); })}>Save</button>
      <button class="btn" disabled={busy} onClick={() => run(async () => { await save(); const result = await api.call('providers.models'); if (!result.models.length) throw new Error('No models found. Load a model on your server or enter its ID manually.'); setModels(result.models.join('\n')); await api.call('settings.set', { patch: { openai: { models: result.models } } }); dispatch({ type: 'state', state: await api.call('state') }); setMessage(`Found ${result.models.length} models.`); })}>Discover models</button>
      <button class="btn" disabled={busy || !ids().length} onClick={() => run(async () => { await save(true); setMessage('New bots will use this API and the first model in your list.'); })}>Use for new bots</button>
      {saved.keySaved && <button class="btn ghost" disabled={busy} onClick={() => run(async () => { await api.call('settings.set', { patch: { openai: { apiKey: '' } } }); dispatch({ type: 'state', state: await api.call('state') }); setMessage('API key removed.'); })}>Remove key</button>}
    </div>
    {message && <p class="muted tiny">{message}</p>}
  </section>;
}
