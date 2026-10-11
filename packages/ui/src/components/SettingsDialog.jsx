import { useEffect, useRef, useState } from 'preact/hooks';
import { Select, modelOptions, effortOptions } from './Select.jsx';
import { PhonePanel } from './PhonePanel.jsx';

export function SettingsDialog({ state, api, dispatch, onClose, mobile = false, onForget }) {
  const s = state.settings;
  const [key, setKey] = useState('');
  const [name, setName] = useState(s.userName);
  const [msg, setMsg] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [startAtLogin, setStartAtLogin] = useState(null);
  const loginTimers = useRef([]);
  const clearLoginTimers = () => { loginTimers.current.forEach(clearTimeout); loginTimers.current = []; };
  useEffect(() => {
    if (['win32', 'darwin'].includes(window.minds?.platform)) window.minds.startup?.status().then(setStartAtLogin).catch((e) => setMsg(e.message));
    return clearLoginTimers;
  }, []);
  useEffect(() => { if (loggingIn && state.auth?.error) { clearLoginTimers(); setLoggingIn(false); setMsg(state.auth.error); } }, [state.auth]);
  const set = (patch) => api.call('settings.set', { patch }).then((r) => dispatch({ type: 'settings', settings: r })).catch((e) => setMsg(e.message));

  const login = async () => {
    clearLoginTimers();
    setLoggingIn(true); setMsg('A browser window opened. Finish signing in there…');
    try { await api.call('auth.login'); } catch (e) { setLoggingIn(false); setMsg(e.message); return; }
    const t = setInterval(async () => {
      const a = await api.call('auth.status').catch(() => null);
      if (a?.signedIn) { clearLoginTimers(); dispatch({ type: 'auth', auth: a }); setLoggingIn(false); setMsg('Signed in.'); }
    }, 2000);
    loginTimers.current = [t, setTimeout(() => { clearLoginTimers(); setLoggingIn(false); setMsg('Sign-in timed out. Try again.'); }, 5 * 60_000)];
  };

  if (mobile) {
    return (
      <div class="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div class="modal">
          <header><h3>This phone</h3><button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
          <section>
            <div class="sec-head"><b>Your computer</b><span class="status ok">{state.conn === 'connected' ? 'Connected' : 'Offline'}</span></div>
            <p class="muted">Connected directly, end to end encrypted. Sign-in, keys and risky settings are managed on the computer.</p>
            <div class="grid"><label>Voice</label><span>{s.openrouterConnected ? 'Ready (uses your computer’s OpenRouter)' : 'Turn on OpenRouter on the computer'}</span></div>
          </section>
          <section><button class="btn danger" onClick={onForget}>Forget this computer</button></section>
        </div>
      </div>
    );
  }
  return (
    <div class="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal">
        <header><h3>Profile & settings</h3><button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>

        <section>
          <div class="sec-head"><b>ChatGPT</b><span class={`status ${state.auth?.signedIn ? 'ok' : ''}`}>{state.auth?.signedIn ? `Connected${state.auth.email ? ` · ${state.auth.email}` : ''}` : 'Not connected'}</span></div>
          <p class="muted">Powers every bot. Uses your ChatGPT sign-in (OAuth), no API key.</p>
          <button class="btn" disabled={loggingIn} onClick={login}>{state.auth?.signedIn ? 'Sign in again' : 'Sign in with ChatGPT'}</button>
        </section>

        <section>
          <div class="sec-head"><b>OpenRouter</b><span class={`status ${s.openrouterConnected ? 'ok' : ''}`}>{s.openrouterConnected ? 'Connected' : 'Not connected'}</span></div>
          <p class="muted">Enables the mic (<code>{state.voice?.model}</code>) and tool-call safety checks (<code>{state.safety?.model}</code>).</p>
          <div class="row">
            <input class="field" type="password" placeholder={s.openrouterConnected ? '•••••••• (saved)' : 'sk-or-…'} value={key} onInput={(e) => setKey(e.target.value)} />
            <button class="btn" disabled={!key.trim()} onClick={() => { set({ openrouterKey: key }); setKey(''); }}>Save</button>
            {s.openrouterConnected && <button class="btn ghost" onClick={() => set({ openrouterKey: '' })}>Remove</button>}
          </div>
        </section>

        <section>
          <b>Preferences</b>
          <div class="grid">
            <label>Your name</label>
            <input class="field" value={name} onInput={(e) => setName(e.target.value)} onBlur={() => name !== s.userName && set({ userName: name })} />
            <label>New bots use</label>
            <div class="row">
              <Select value={s.defaultModel} options={modelOptions(state.models)} onChange={(v) => set({ defaultModel: v })} />
              <Select value={s.defaultEffort} options={effortOptions(state.efforts)} onChange={(v) => set({ defaultEffort: v })} />
            </div>
            <label>New bots start in</label>
            <Select value={s.defaultPermission} onChange={(v) => set({ defaultPermission: v })} options={state.permissions.map((m) => ({ value: m.id, label: m.label, hint: '' }))} />
            <label>Voice</label>
            <label class="check"><input type="checkbox" checked={s.autoSendTranscript} onChange={(e) => set({ autoSendTranscript: e.target.checked })} /> Send transcript right away</label>
            {startAtLogin !== null && <>
              <label>{window.minds?.platform === 'darwin' ? 'Mac startup' : 'Windows startup'}</label>
              <label class="check"><input type="checkbox" checked={startAtLogin} onChange={(e) => window.minds.startup.set(e.target.checked).then(setStartAtLogin).catch((err) => setMsg(err.message))} /> Open Minds when I sign in</label>
            </>}
          </div>
        </section>

        <section><PhonePanel state={state} api={api} dispatch={dispatch} /></section>
        {msg && <p class="muted tiny">{msg}</p>}
        <p class="muted tiny">Bots live in a background host on this computer and keep running when this window is closed.</p>
      </div>
    </div>
  );
}
