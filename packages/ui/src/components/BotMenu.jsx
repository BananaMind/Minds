import { useEffect, useRef, useState } from 'preact/hooks';
import { Select, modelOptions } from './Select.jsx';
import { AppIcon } from './AppIcon.jsx';

export function BotMenu({ bot, state, api, onClose, mobile = false }) {
  const [name, setName] = useState(bot.name);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const f = (e) => !ref.current?.contains(e.target) && onClose();
    setTimeout(() => addEventListener('mousedown', f));
    return () => removeEventListener('mousedown', f);
  }, []);
  const update = (patch) => api.call('bots.update', { id: bot.id, ...patch }).catch(() => {});
  const scheds = state.schedules.filter((s) => s.botId === bot.id);
  return (
    <div class="menu" ref={ref}>
      <label>Name</label>
      <input class="field" value={name} maxLength={40} onInput={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== bot.name && update({ name })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      <label>Model</label>
      <Select value={bot.model} options={modelOptions(state.models)} onChange={(v) => update({ model: v })} />
      <label>Reasoning effort</label>
      <div class="seg">
        {state.efforts.map((e) => <button key={e} type="button" class={bot.effort === e ? 'on' : ''} onClick={() => update({ effort: e })}>{e}</button>)}
      </div>
      <label>Permissions</label>
      <div class="seg three">
        {state.permissions.map((m) => <button key={m.id} type="button" class={`perm-${m.id} ${bot.permission === m.id ? 'on' : ''}`} onClick={() => update({ permission: m.id })}>{m.id}</button>)}
      </div>
      <p class="muted tiny hint">{state.permissions.find((m) => m.id === bot.permission)?.hint}</p>
      {!mobile && (
        <>
          <label>Apps</label>
          {(state.plugins || []).filter((x) => x.connected).length === 0
            ? <p class="muted tiny">No apps connected. Open Connect apps to add GitHub, Hugging Face, Gmail and more.</p>
            : (state.plugins || []).filter((x) => x.connected).map((x) => (
              <label class="appline" key={x.id}>
                <AppIcon icon={x.icon} size={22} /><span>{x.name}</span>
                <button type="button" class={`switch ${(bot.plugins || []).includes(x.id) ? 'on' : ''}`} aria-label={`Let ${bot.name} use ${x.name}`}
                  onClick={() => api.call('plugins.setBotAccess', { botId: bot.id, id: x.id, enabled: !(bot.plugins || []).includes(x.id) }).catch(() => {})} />
              </label>
            ))}
        </>
      )}
      <label>Schedules</label>
      {scheds.length === 0 ? <p class="muted tiny">None. Ask {bot.name} to schedule something.</p> : scheds.map((s) => (
        <div class="sched" key={s.id}>
          <div><b>{s.name}</b><small>{s.kind === 'cron' ? s.cron : s.kind === 'interval' ? `every ${s.everyMinutes} min` : new Date(s.at).toLocaleString()}</small></div>
          <button class={`switch ${s.enabled ? 'on' : ''}`} aria-label="Toggle" onClick={() => api.call('schedules.setEnabled', { id: s.id, enabled: !s.enabled })} />
          <button class="x" aria-label="Delete schedule" onClick={() => api.call('schedules.delete', { id: s.id })}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
      ))}
      <div class="menu-foot">
        {confirm ? (
          <>
            <span class="muted tiny">Delete {bot.name} and its history?</span>
            <button class="btn" onClick={() => setConfirm(false)}>No</button>
            <button class="btn danger" onClick={() => api.call('bots.delete', { id: bot.id })}>Delete</button>
          </>
        ) : <button class="btn danger ghost" onClick={() => setConfirm(true)}>Delete bot</button>}
      </div>
    </div>
  );
}
