import { useEffect, useRef, useState } from 'preact/hooks';
import { BotIcon } from './BotIcon.jsx';

const Icon = {
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
};

const preview = (b) => {
  if (!b.last) return 'No messages yet';
  const t = (b.last.text || '').replace(/\s+/g, ' ');
  return b.last.type === 'user' ? `You: ${t}` : t;
};

export function Sidebar({ state, api, onSelect, onNew, onSettings, onConnectApps, mobile = false }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const input = useRef();
  useEffect(() => { if (searching) input.current?.focus(); }, [searching]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api.call('search', { q }).then((r) => setHits(r.results)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);

  const needle = q.trim().toLowerCase();
  const bots = needle ? state.bots.filter((b) => b.name.toLowerCase().includes(needle)) : state.bots;
  const name = state.settings?.userName || 'You';
  const connected = (state.plugins || []).filter((p) => p.connected).length;

  return (
    <aside class="sidebar">
      <div class="side-top drag">
        {searching ? (
          <div class="searchbox no-drag">
            {Icon.search}
            <input ref={input} value={q} placeholder="Search bots and messages" onInput={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setSearching(false), setQ(''))} />
          </div>
        ) : <span class="spacer" />}
        <button class="roundbtn no-drag" aria-label="Search" onClick={() => { setSearching((v) => !v); setQ(''); }}>{Icon.search}</button>
        <button class="roundbtn no-drag" aria-label="New bot" onClick={onNew}>{Icon.plus}</button>
      </div>

      <div class="botlist">
        {bots.map((b) => (
          <button key={b.id} class={`botrow ${b.id === state.selected ? 'active' : ''}`} onClick={() => onSelect(b.id)}>
            <BotIcon icon={b.icon} size={38} working={b.status === 'working'} badge={b.status !== 'idle' ? (b.status === 'waiting' ? 'wait' : 'work') : null} />
            <span class="botrow-text">
              <b>{b.name}</b>
              <small>{preview(b)}</small>
            </span>
            {b.unread > 0 && b.id !== state.selected && <i class="unread" />}
          </button>
        ))}
        {needle && hits.length > 0 && <div class="hits-title">Messages</div>}
        {needle && hits.map((h) => {
          const b = state.bots.find((x) => x.id === h.botId);
          return b && (
            <button key={h.itemId} class="botrow hit" onClick={() => { onSelect(b.id); setSearching(false); setQ(''); }}>
              <BotIcon icon={b.icon} size={26} working={b.status === 'working'} />
              <span class="botrow-text"><b>{b.name}</b><small>{h.snippet.replace(/\s+/g, ' ')}</small></span>
            </button>
          );
        })}
        {needle && !bots.length && !hits.length && <div class="nohits">No matches</div>}
        {!state.bots.length && <div class="nohits">No bots yet. Press + to make one.</div>}
      </div>

      <div class="side-bottom">
        <button class="avatar" aria-label={mobile ? 'Phone settings' : 'Profile & settings'} title={mobile ? 'Phone settings' : 'Profile & settings'} onClick={onSettings}>{name[0]?.toUpperCase()}</button>
        {!mobile && <button class="connect" onClick={onConnectApps}>
          Connect apps
          {connected > 0 && <span class="chip ok" title={`${connected} apps connected`}>{connected}</span>}
        </button>}
      </div>
    </aside>
  );
}
