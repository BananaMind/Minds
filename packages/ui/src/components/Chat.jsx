import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BotIcon } from './BotIcon.jsx';
import { Markdown } from '../markdown.jsx';
import { QuestionCard, ApprovalCard } from './Cards.jsx';
import { BotMenu } from './BotMenu.jsx';
import { Composer } from './Composer.jsx';

const isVisible = (m) =>
  (m.type === 'user' && !m.hidden) || (m.type === 'assistant' && !m.interim && m.text) || m.type === 'question' || m.type === 'approval' || m.type === 'notice';

function stampLabel(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - day) / 864e5);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function Chat({ bot, state, api, dispatch, toolsOpen, onTools, onMenu }) {
  const items = (state.messages[bot.id] || []).filter(isVisible);
  const loaded = state.messages[bot.id] !== undefined;
  const live = state.live[bot.id];
  const [menu, setMenu] = useState(false);
  const scroller = useRef();
  const stick = useRef(true);

  useLayoutEffect(() => { if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
  const onScroll = () => { const el = scroller.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  useEffect(() => { stick.current = true; }, [bot.id]);
  useEffect(() => { if (document.hasFocus() && bot.unread) api.call('chat.markRead', { botId: bot.id }).catch(() => {}); }, [bot.unread, items.length]);
  useEffect(() => { const f = () => bot.unread && api.call('chat.markRead', { botId: bot.id }).catch(() => {}); addEventListener('focus', f); return () => removeEventListener('focus', f); }, [bot.unread]);

  const nodes = [];
  let prev = 0;
  for (const m of items) {
    if (m.ts - prev > 60 * 60 * 1000) nodes.push(<div class="stamp" key={`s${m.id}`}>{stampLabel(m.ts)}</div>);
    prev = m.ts;
    nodes.push(<Message key={m.id} m={m} bot={bot} api={api} />);
  }

  return (
    <div class="chat">
      <header class="chat-head">
        <button class="menubtn" aria-label="Bots" onClick={onMenu}><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        <div class="pillwrap">
          <button class="pill" onClick={() => setMenu((v) => !v)}>
            <BotIcon icon={bot.icon} size={22} working={bot.status === 'working'} /> <span>{bot.name}</span>
          </button>
          {menu && <BotMenu bot={bot} state={state} api={api} mobile={Boolean(window.Capacitor?.isNativePlatform?.()) || new URLSearchParams(location.search).has('mobile')} onClose={() => setMenu(false)} />}
        </div>
        <button class={`toolsbtn ${toolsOpen ? 'on' : ''}`} onClick={onTools} title="All tool calls" aria-label="Show tool calls">
          <svg viewBox="0 0 24 24"><path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14" /></svg>
          <span>Tool calls</span>
        </button>
      </header>

      <div class="scroll" ref={scroller} onScroll={onScroll}>
        <div class="thread">
          {loaded && !items.length && !live && <div class="hint">Say hi to {bot.name}.</div>}
          {nodes}
          {live?.text && <div class="msg bot live"><div class="bubble"><Markdown text={live.text} /></div></div>}
          {bot.status === 'working' && !live?.text && <div class="msg bot"><div class="bubble typing"><i /><i /><i /></div></div>}
        </div>
      </div>

      <Composer bot={bot} state={state} api={api} />
    </div>
  );
}

function Message({ m, bot, api }) {
  if (m.type === 'user') {
    if (m.source === 'schedule') return <div class="chip"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>Scheduled: {m.scheduleName || 'task'}</div>;
    return <div class="msg me"><div class="bubble">{m.text}</div></div>;
  }
  if (m.type === 'assistant') return <div class="msg bot"><div class="bubble"><Markdown text={m.text} /></div></div>;
  if (m.type === 'question') return <div class="msg bot wide"><QuestionCard q={m} bot={bot} api={api} /></div>;
  if (m.type === 'approval') return <div class="msg bot wide"><ApprovalCard a={m} bot={bot} api={api} /></div>;
  if (m.type === 'notice') return <div class={`notice ${m.level === 'error' ? 'err' : ''}`}>{m.text}</div>;
  return null;
}
