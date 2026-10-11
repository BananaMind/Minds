import { useEffect, useState } from 'preact/hooks';
import { AppIcon } from './AppIcon.jsx';
import { Select } from './Select.jsx';

const Toggle = ({ on, onChange, label, disabled }) => <button type="button" class={`switch ${on ? 'on' : ''}`} aria-label={label} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)} />;

/** Set up, manage and give bots access to one app. */
export function AppDialog({ id, state, api, onClose }) {
  const p = (state.plugins || []).find((x) => x.id === id);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signing, setSigning] = useState(null);   // {url} while a browser sign-in is open
  const [showSteps, setShowSteps] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => { if (p) setValues(Object.fromEntries((p.setup?.fields || []).filter((f) => f.default !== undefined).map((f) => [f.key, f.default]))); }, [id]);
  useEffect(() => { if (signing && !p?.signingIn && (p?.connected || p?.error)) { setSigning(null); if (p.error && !p.connected) setErr(p.error); } }, [p?.connected, p?.error, p?.signingIn]);
  useEffect(() => { if (p?.connected) setShowSteps(false); }, [p?.connected]);
  if (!p) return null;

  const call = async (method, params) => {
    setBusy(true); setErr('');
    try { return await api.call(method, { id, ...params }); } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  const fields = p.setup?.fields || [];
  const missing = fields.some((f) => f.required && !String(values[f.key] ?? '').trim()) && !(p.connected || p.needsReauth);
  const tools = p.tools || [];
  const hasWrites = tools.some((t) => t.access === 'write');
  const setDisabled = (name, enabled) => {
    const set = new Set(p.config.disabledTools); enabled ? set.delete(name) : set.add(name);
    call('plugins.configure', { patch: { disabledTools: [...set] } });
  };
  const startOauth = async () => {
    const r = await call('plugins.oauthStart', { fields: values });
    if (r?.url) setSigning({ url: r.url });
  };

  return (
    <div class="modal-wrap top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal app-dialog">
        <header>
          <div class="apphead"><AppIcon icon={p.icon} size={44} /><div><h3>{p.name}</h3><span class={`status ${p.connected ? 'ok' : ''}`}>{p.needsReauth ? 'Reconnect needed' : p.connected ? (p.detail || 'Connected') : 'Not connected'}</span></div></div>
          <button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <p class="muted">{p.description}</p>
        {p.source && <p class="muted tiny mono">{p.source.command || p.source.url}</p>}
        {(err || p.error) && <p class="error">{err || p.error}</p>}

        {(!p.connected || p.needsReauth) && p.kind !== 'mcp' && (
          <section>
            {p.setup?.summary && <p class="muted">{p.setup.summary}</p>}
            {p.setup?.steps?.length > 0 && (
              <>
                <button class="btn ghost tiny" onClick={() => setShowSteps(!showSteps)}>{showSteps ? 'Hide' : 'Show'} setup steps</button>
                {showSteps && (
                  <ol class="steps">
                    {p.setup.steps.map((s, i) => <li key={i}>{s.text}{s.link && <> <a href={s.link} target="_blank" rel="noreferrer">Open ↗</a></>}</li>)}
                  </ol>
                )}
              </>
            )}
            {fields.map((f) => (
              <div class="fieldrow" key={f.key}>
                <label>{f.label}{f.required ? '' : ' (optional)'}</label>
                {f.type === 'select'
                  ? <Select value={values[f.key] ?? f.default} options={f.options} onChange={(v) => setValues({ ...values, [f.key]: v })} />
                  : <input class="field" type={f.secret ? 'password' : 'text'} placeholder={p.needsReauth && f.secret ? '•••••••• (saved)' : f.placeholder || ''} value={values[f.key] ?? ''} autocomplete="off" onInput={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
              </div>
            ))}
            {signing ? (
              <div class="signing"><i class="spinner" /> <span>Finish signing in in your browser… <a href={signing.url} target="_blank" rel="noreferrer">Open the sign-in page again ↗</a></span><button class="btn ghost" onClick={() => { call('plugins.oauthCancel'); setSigning(null); }}>Cancel</button></div>
            ) : (
              <div class="row wrap">
                {p.setup?.oauth
                  ? <button class="btn primary" disabled={busy || (missing && !p.needsReauth)} onClick={startOauth}>{p.needsReauth ? 'Reconnect' : (p.setup.oauth.label || 'Sign in')}</button>
                  : <button class="btn primary" disabled={busy || missing} onClick={() => call('plugins.connect', { fields: values })}>{p.setup?.publicOk && !String(values.token || '').trim() ? 'Use without signing in' : 'Connect'}</button>}
                {p.setup?.local?.available && <button class="btn" disabled={busy} onClick={() => call('plugins.importLocal')}>{p.setup.local.label}</button>}
              </div>
            )}
          </section>
        )}

        {p.connected && (
          <>
            <section>
              <b>Available to bots</b>
              <p class="muted tiny">A bot can only use this app if you switch it on for that bot.</p>
              <div class="botaccess">
                {state.bots.map((b) => {
                  const on = (b.plugins || []).includes(id);
                  return (
                    <label class="accessrow" key={b.id}>
                      <span>{b.name}</span>
                      <Toggle on={on} disabled={busy} label={`Allow ${b.name}`} onChange={(v) => call('plugins.setBotAccess', { botId: b.id, enabled: v })} />
                    </label>
                  );
                })}
                {!state.bots.length && <p class="muted tiny">Create a bot first.</p>}
              </div>
            </section>

            {hasWrites && (
              <section>
                <label class="accessrow">
                  <span><b>Allow changes without asking</b><small class="muted block">Off (recommended): the bot asks before it sends, posts, creates or deletes. Bots in “ask for permission” mode always ask.</small></span>
                  <Toggle on={p.config.autoApproveWrites} disabled={busy} label="Allow changes without asking" onChange={(v) => call('plugins.configure', { patch: { autoApproveWrites: v } })} />
                </label>
              </section>
            )}

            <section>
              <b>What it can do</b>
              <div class="toollist">
                {tools.map((t) => (
                  <div class="toolrow" key={t.name}>
                    <div><span>{t.title}</span><small class="muted">{t.description}</small></div>
                    <span class={`badge-access ${t.access}`}>{t.access === 'write' ? 'changes things' : 'read only'}</span>
                    <Toggle on={t.enabled} disabled={busy} label={`Enable ${t.title}`} onChange={(v) => setDisabled(t.name, v)} />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {p.kind === 'mcp' && fields.length > 0 && <section>
          <b>Connection credentials</b>
          <p class="muted tiny">Leave a field empty to keep its saved value. Paste a replacement token when it expires, then reconnect.</p>
          {fields.map((f) => <div class="fieldrow" key={f.key}>
            <label>{f.label}</label><input class="field" type="password" placeholder="•••••••• (saved)" value={values[f.key] ?? ''} autocomplete="off" onInput={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          </div>)}
        </section>}

        <section class="row wrap">
          {p.kind === 'mcp' && <button class="btn" disabled={busy} onClick={async () => { const r = await call('plugins.refresh', { fields: values }); if (r && !r.error) setValues({}); }}>Reconnect & refresh tools</button>}
          {p.connected && <button class="btn" disabled={busy} onClick={() => call('plugins.disconnect')}>Disconnect</button>}
          {p.kind !== 'builtin' && (confirmRemove
            ? <><span class="muted tiny">Remove {p.name}?</span><button class="btn" onClick={() => setConfirmRemove(false)}>No</button><button class="btn danger" onClick={async () => { if (await call('plugins.uninstall')) onClose(); }}>Remove</button></>
            : <button class="btn danger ghost" onClick={() => setConfirmRemove(true)}>Remove app</button>)}
        </section>
      </div>
    </div>
  );
}
