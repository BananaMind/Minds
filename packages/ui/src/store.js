import { useEffect, useReducer, useRef, useMemo } from 'preact/hooks';
import { createApi } from './api.js';

const init = { conn: 'connecting', ready: false, bots: [], settings: null, auth: null, models: [], efforts: [], permissions: [], plugins: [], mobile: null, pairingRequest: null, voice: null, safety: null, selected: null, messages: {}, live: {}, schedules: [] };

function reducer(s, a) {
  switch (a.type) {
    case 'conn': return { ...s, conn: a.conn };
    case 'state': {
      const selected = s.selected && a.state.bots.some((b) => b.id === s.selected) ? s.selected : a.state.bots[0]?.id ?? null;
      return { ...s, ...a.state, ready: true, selected };
    }
    case 'select': return { ...s, selected: a.id };
    case 'history': return { ...s, messages: { ...s.messages, [a.botId]: a.items } };
    case 'bot.upsert': {
      const i = s.bots.findIndex((b) => b.id === a.bot.id);
      const bots = i < 0 ? [a.bot, ...s.bots] : s.bots.map((b) => (b.id === a.bot.id ? a.bot : b));
      return { ...s, bots: bots.sort((x, y) => y.lastActivity - x.lastActivity) };
    }
    case 'bot.deleted': {
      const bots = s.bots.filter((b) => b.id !== a.id);
      return { ...s, bots, selected: s.selected === a.id ? bots[0]?.id ?? null : s.selected };
    }
    case 'msg.add': {
      const list = s.messages[a.botId]; if (!list) return s;
      if (list.some((m) => m.id === a.item.id)) return s;
      const live = { ...s.live }; if (live[a.botId]?.id === a.item.id) delete live[a.botId];
      return { ...s, live, messages: { ...s.messages, [a.botId]: [...list, a.item] } };
    }
    case 'msg.patch': {
      const list = s.messages[a.botId]; if (!list) return s;
      return { ...s, messages: { ...s.messages, [a.botId]: list.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) } };
    }
    case 'live': {
      const cur = s.live[a.botId];
      const text = (cur?.id === a.liveId ? cur.text : '') + a.delta;
      return { ...s, live: { ...s.live, [a.botId]: { id: a.liveId, text } } };
    }
    case 'live.clear': { const live = { ...s.live }; delete live[a.botId]; return { ...s, live }; }
    case 'settings': return { ...s, settings: a.settings };
    case 'auth': return { ...s, auth: a.auth };
    case 'plugins': return { ...s, plugins: a.plugins };
    case 'mobile': return { ...s, mobile: a.mobile };
    case 'pairing.request': return { ...s, pairingRequest: a.req?.cancelled ? null : a.req };
    case 'sched': {
      const rest = s.schedules.filter((x) => x.id !== (a.schedule?.id ?? a.id));
      return { ...s, schedules: a.schedule ? [...rest, a.schedule] : rest };
    }
    default: return s;
  }
}

export function useMinds(injectedApi) {
  const [state, dispatch] = useReducer(reducer, init);
  const api = useMemo(() => injectedApi || createApi(), []);
  const stateRef = useRef(state); stateRef.current = state;

  const loadPlugins = () => api.call('plugins.list').then((r) => dispatch({ type: 'plugins', plugins: r.plugins })).catch(() => {}); // phones aren't allowed to; ignore
  const loadState = () => api.call('state').then((st) => { dispatch({ type: 'state', state: st }); loadPlugins(); }).catch(() => {});
  useEffect(() => {
    const offStatus = api.onStatus((conn) => dispatch({ type: 'conn', conn }));
    const off = api.on((e, d) => {
      switch (e) {
        case 'connected': loadState(); { const id = stateRef.current.selected; if (id) loadHistory(id); } break;
        case 'bot.created': case 'bot.updated': dispatch({ type: 'bot.upsert', bot: d.bot }); break;
        case 'bot.deleted': dispatch({ type: 'bot.deleted', id: d.id }); break;
        case 'message.added': dispatch({ type: 'msg.add', botId: d.botId, item: d.item }); break;
        case 'message.updated': dispatch({ type: 'msg.patch', botId: d.botId, id: d.id, patch: d.patch }); break;
        case 'message.delta': dispatch({ type: 'live', botId: d.botId, liveId: d.liveId, delta: d.delta }); break;
        case 'message.discard': dispatch({ type: 'live.clear', botId: d.botId }); break;
        case 'settings.updated': dispatch({ type: 'settings', settings: d.settings }); loadState(); break;
        case 'auth.updated': dispatch({ type: 'auth', auth: d.auth }); break;
        case 'plugins.updated': loadPlugins(); break;
        case 'mobile.updated': dispatch({ type: 'mobile', mobile: d }); break;
        case 'mobile.pairing': dispatch({ type: 'pairing.request', req: d }); break;
        case 'schedule.updated': dispatch({ type: 'sched', schedule: d.schedule }); break;
        case 'schedule.removed': dispatch({ type: 'sched', id: d.id }); break;
      }
    });
    return () => { off(); offStatus(); };
  }, []);

  const loadHistory = (botId) => api.call('chat.history', { botId, limit: 800 }).then((r) => dispatch({ type: 'history', botId, items: r.items })).catch(() => {});
  useEffect(() => { if (state.selected && state.conn === 'connected') loadHistory(state.selected); }, [state.selected, state.conn]);

  return { state, dispatch, api, loadHistory };
}
