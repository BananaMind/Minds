import { useEffect, useRef, useState } from 'preact/hooks';

const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const SPEEDS = [
  { id: 'normal', label: 'Normal', hint: 'Standard speed' },
  { id: 'fast', label: 'Fast', hint: 'About 1.5–2x faster · uses more of your limits' },
  { id: 'ultrafast', label: 'UltraFast', hint: 'Text arrives very fast, but may wait 10s+ to start' },
];
const speedOf = (bot) => bot.speed || 'normal';

const Bolt = () => <svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>;
const Reset = () => <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
const Chevron = () => <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;

/** Dot slider: click, drag or arrow keys pick one of `count` stops. */
function Stops({ count, index, onChange, label }) {
  const ref = useRef();
  const pick = (e) => {
    const r = ref.current.getBoundingClientRect(), pad = 22;
    const f = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / (r.width - pad * 2)));
    const i = Math.round(f * (count - 1));
    if (i !== index) onChange(i);
  };
  const pos = (i) => `calc(22px + (100% - 44px) * ${count > 1 ? i / (count - 1) : 0})`;
  return (
    <div class="ep-track" ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={count - 1} aria-valuenow={index}
      onPointerDown={(e) => { ref.current.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons) pick(e); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(count - 1, index + 1)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, index - 1)); }
      }}>
      <div class="ep-fill" style={{ width: `calc(${pos(index)} + 22px)` }} />
      {Array.from({ length: count }, (_, i) => <i key={i} class="ep-dot" style={{ left: pos(i) }} />)}
      <div class="ep-knob" style={{ left: pos(index) }} />
    </div>
  );
}

/** Effort + speed control next to the message box: a pill that opens a small panel above the composer. */
export function EffortControl({ bot, state, api, onError }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('effort'); // effort | speed | model
  const [effort, setEffort] = useState(bot.effort);
  const [speed, setSpeed] = useState(speedOf(bot));
  const [refused, setRefused] = useState({}); // { modelId: [speeds ChatGPT refused] } from the host
  const ref = useRef();

  useEffect(() => { setEffort(bot.effort); setSpeed(speedOf(bot)); }, [bot.id, bot.effort, bot.speed]);
  useEffect(() => { if (open) api.call('models.speeds').then((r) => setRefused(r.unsupported || {})).catch(() => {}); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', away); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc); };
  }, [open]);

  if ((bot.provider || 'codex') !== 'codex') return null;
  const update = (patch, undo) => api.call('bots.update', { id: bot.id, ...patch }).catch((e) => { undo(); onError?.(e.message); });
  const setEffortTo = (e) => { const prev = effort; setEffort(e); update({ effort: e }, () => setEffort(prev)); };
  const setSpeedTo = (s) => { const prev = speed; setSpeed(s); update({ speed: s }, () => setSpeed(prev)); };

  const efforts = state.efforts;
  const models = state.models.filter((m) => !m.provider || m.provider === 'codex');
  const modelName = models.find((m) => m.id === bot.model)?.name || bot.model;
  // The model's speeds (from the host's model list), minus any ChatGPT has refused.
  const modelSpeeds = models.find((m) => m.id === bot.model)?.speeds;
  const offered = SPEEDS.filter((s) => (!modelSpeeds || modelSpeeds.includes(s.id)) && !(refused[bot.model] || []).includes(s.id));
  const speedInfo = SPEEDS.find((s) => s.id === speed) || SPEEDS[0];
  const missing = SPEEDS.filter((s) => !offered.includes(s)).map((s) => s.label);
  const reset = () => (view === 'speed' ? setSpeedTo('normal') : setEffortTo(state.settings?.defaultEffort || efforts[0]));

  return (
    <div class="effort" ref={ref}>
      <button type="button" class={`effort-pill speed-${speed} ${open ? 'open' : ''}`} title="Reasoning effort and speed" aria-expanded={open}
        onClick={() => { setOpen(!open); setView('effort'); }}>
        <Bolt /><span>{EFFORT_LABEL[effort] || effort}</span>
      </button>
      {open && (
        <div class={`effort-pop view-${view} speed-${speed}`} role="dialog" aria-label="Reasoning effort and speed">
          {view === 'model' ? (
            <>
              <div class="ep-head"><button type="button" class="ep-back" onClick={() => setView('effort')}><Chevron /></button><b class="ep-plain">Model</b><span /></div>
              <div class="ep-models">
                {models.map((m) => (
                  <button type="button" key={m.id} class={m.id === bot.model ? 'on' : ''}
                    onClick={() => { api.call('bots.update', { id: bot.id, model: m.id }).catch((e) => onError?.(e.message)); setView('effort'); }}>
                    <b>{m.name}</b><small>{m.hint}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div class="ep-head">
                <button type="button" class={`ep-icon ep-bolt ${view === 'speed' ? 'active' : ''}`} title={view === 'speed' ? 'Back to reasoning effort' : 'Speed'}
                  aria-pressed={view === 'speed'} onClick={() => setView(view === 'speed' ? 'effort' : 'speed')}><Bolt /></button>
                <div class="ep-title">
                  <b class="ep-value">{view === 'speed' ? speedInfo.label : EFFORT_LABEL[effort] || effort}</b>
                  <button type="button" class="ep-model" onClick={() => setView('model')}>{modelName}<Chevron /></button>
                </div>
                <button type="button" class="ep-icon" title={view === 'speed' ? 'Back to normal speed' : 'Reset to default effort'} onClick={reset}><Reset /></button>
              </div>
              {view === 'speed'
                ? <Stops count={offered.length} index={Math.max(0, offered.findIndex((s) => s.id === speed))} onChange={(i) => setSpeedTo(offered[i].id)} label="Speed" />
                : <Stops count={efforts.length} index={Math.max(0, efforts.indexOf(effort))} onChange={(i) => setEffortTo(efforts[i])} label="Reasoning effort" />}
              {view === 'speed' && <p class="ep-hint">{speedInfo.hint}{missing.length > 0 && <><br />{missing.join(' and ')} isn't available for {modelName}.</>}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
