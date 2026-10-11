import { useState } from 'preact/hooks';
import { AppIcon } from './AppIcon.jsx';
import { AppDialog } from './AppDialog.jsx';
import { CommunityDialog } from './CommunityDialog.jsx';

/** "Apps" section of Connect apps: built-in and community plugins, and adding new ones. */
export function AppsPanel({ state, api, dispatch }) {
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const plugins = state.plugins || [];
  const connected = plugins.filter((p) => p.connected).length;
  const subtitle = (p) => (p.needsReauth ? 'Reconnect needed' : p.connected ? p.account || p.detail || 'Connected' : p.error ? 'Needs attention' : p.description);

  return (
    <div>
      <div class="sec-head"><b>Apps</b><span class={`status ${connected ? 'ok' : ''}`}>{connected ? `${connected} connected` : 'None connected'}</span></div>
      <p class="muted">Let bots use GitHub, Hugging Face, Gmail and community apps. Each bot only gets the apps you switch on for it.</p>
      <div class="appgrid">
        {plugins.map((p) => (
          <button key={p.id} class={`appcard ${p.connected ? 'on' : ''} ${p.error || p.needsReauth ? 'warn' : ''}`} onClick={() => setOpenId(p.id)}>
            <AppIcon icon={p.icon} size={38} />
            <span class="appcard-text"><b>{p.name}{p.kind !== 'builtin' && <i class="tag">community</i>}</b><small>{subtitle(p)}</small></span>
            <span class={`chip ${p.connected ? 'ok' : ''}`}>{p.needsReauth ? 'Reconnect' : p.connected ? 'On' : 'Set up'}</span>
          </button>
        ))}
        {!plugins.length && <p class="muted tiny">Loading apps…</p>}
      </div>
      <button class="btn" onClick={() => setAdding(true)}>+ Add a community app</button>
      {openId && <AppDialog id={openId} state={state} api={api} onClose={() => setOpenId(null)} />}
      {adding && <CommunityDialog api={api} onClose={() => setAdding(false)} onInstalled={(p) => { dispatch({ type: 'plugins', plugins: [...plugins.filter((x) => x.id !== p.id), p] }); setAdding(false); setOpenId(p.id); }} />}
    </div>
  );
}
