import { useEffect, useState } from 'preact/hooks';
import { useMinds } from './store.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Chat } from './components/Chat.jsx';
import { ToolPanel } from './components/ToolPanel.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { AppsDialog } from './components/AppsDialog.jsx';
import { NewBotDialog } from './components/NewBotDialog.jsx';
import { PairingRequest } from './components/PhonePanel.jsx';

export function App({ api: injected, mobile = false, onForget }) {
  const { state, dispatch, api } = useMinds(injected);
  const [dialog, setDialog] = useState(null); // 'settings' | 'apps' | 'new'
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bot = state.bots.find((b) => b.id === state.selected);
  const bridge = window.minds;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setDialog(null); setSidebarOpen(false); } };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, []);

  // Desktop notifications for bots that message you while the window is in the background.
  useEffect(() => api.on((e, d) => {
    if (e !== 'message.added' || !bridge?.notify || document.hasFocus()) return;
    const it = d.item, b = state.bots.find((x) => x.id === d.botId);
    if ((it.type === 'assistant' && !it.interim) || (it.type === 'question' && it.status === 'pending') || it.type === 'approval')
      bridge.notify({ title: b?.name || 'Minds', body: it.text || it.question || `Approval needed: ${it.summary}`, botId: d.botId });
  }), [state.bots]);
  useEffect(() => bridge?.onOpenBot?.((id) => dispatch({ type: 'select', id })), []);

  if (!state.ready) {
    return (
      <div class="boot">
        <WindowBar bridge={bridge} />
        <div class="boot-msg">
          {mobile ? (
            <>
              <div>{state.conn === 'offline' ? 'Your computer isn’t reachable' : 'Looking for your computer…'}</div>
              {state.conn === 'offline' && <small class="muted">{api.lastError?.() || 'Make sure it’s on and Minds is running.'}</small>}
              <div class="row center-row"><button class="btn" onClick={() => api.retryNow?.()}>Try again</button><button class="btn ghost" onClick={onForget}>Forget this computer</button></div>
            </>
          ) : (state.conn === 'offline' ? 'Starting the Minds host…' : 'Connecting…')}
        </div>
      </div>
    );
  }

  return (
    <div class={`app ${sidebarOpen ? 'sidebar-open' : ''} ${toolsOpen ? 'tools-open' : ''}`}>
      <Sidebar
        state={state} api={api}
        onSelect={(id) => { dispatch({ type: 'select', id }); setSidebarOpen(false); }}
        onNew={() => setDialog('new')} onSettings={() => setDialog('settings')}
        onConnectApps={() => setDialog('apps')} mobile={mobile}
      />
      <main class="main">
        <WindowBar bridge={bridge} />
        {bot ? (
          <Chat key={bot.id} bot={bot} state={state} api={api} dispatch={dispatch}
            toolsOpen={toolsOpen} onTools={() => setToolsOpen((v) => !v)} onMenu={() => setSidebarOpen((v) => !v)} />
        ) : (
          <div class="empty">
            <h2>Welcome to Minds</h2>
            <p>Create your first bot. It keeps working on this computer whenever it's on.</p>
            <button class="btn primary" onClick={() => setDialog('new')}>New bot</button>
          </div>
        )}
        {state.conn !== 'connected' && <div class="offline">Reconnecting to the host…</div>}
      </main>
      {toolsOpen && bot && <ToolPanel bot={bot} items={state.messages[bot.id] || []} onClose={() => setToolsOpen(false)} />}
      {sidebarOpen && <div class="scrim" onClick={() => setSidebarOpen(false)} />}
      {dialog === 'settings' && <SettingsDialog state={state} api={api} dispatch={dispatch} mobile={mobile} onForget={onForget} onClose={() => setDialog(null)} />}
      {dialog === 'apps' && !mobile && <AppsDialog state={state} api={api} dispatch={dispatch} onClose={() => setDialog(null)} />}
      {state.pairingRequest && <PairingRequest req={state.pairingRequest} api={api} onDone={() => dispatch({ type: 'pairing.request', req: null })} />}
      {dialog === 'new' && <NewBotDialog api={api} onClose={() => setDialog(null)} onCreated={(b) => { dispatch({ type: 'bot.upsert', bot: b }); dispatch({ type: 'select', id: b.id }); setDialog(null); }} />}
    </div>
  );
}

function WindowBar({ bridge }) {
  if (!bridge?.window || bridge.platform === 'darwin') return <div class="winbar drag" />;
  return (
    <div class="winbar drag">
      <div class="wincontrols">
        <button aria-label="Minimize" onClick={() => bridge.window.minimize()}><svg viewBox="0 0 12 12"><path d="M2 6h8" /></svg></button>
        <button aria-label="Maximize" onClick={() => bridge.window.maximize()}><svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg></button>
        <button aria-label="Close" onClick={() => bridge.window.close()}><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>
      </div>
    </div>
  );
}
