import { useEffect, useRef, useState } from 'preact/hooks';
import { startRecording } from '../voice.js';
import { prepareImage } from '../images.js';
import { EffortControl } from './EffortControl.jsx';

const MAX_IMAGES = 4;

export function Composer({ bot, state, api }) {
  const [text, setText] = useState('');
  const [rec, setRec] = useState(null);       // active recording
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing
  const [err, setErr] = useState('');
  const [imgs, setImgs] = useState([]);       // [{data, thumb}] waiting to be sent
  const ta = useRef(), picker = useRef();
  const bridge = window.minds;
  const voiceReady = state.settings?.openrouterConnected;
  const working = bot.status !== 'idle';
  const canSee = bot.provider !== 'openai' || state.settings?.openai?.images === true;

  useEffect(() => { setText(''); setImgs([]); ta.current?.focus(); }, [bot.id]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px'; }, [text]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 5000); return () => clearTimeout(t); }, [err]);

  const send = async (value = text) => {
    value = value.trim(); if (!value && !imgs.length) return;
    const images = imgs;
    setText(''); setImgs([]);
    try { await api.call('chat.send', { botId: bot.id, text: value, source: 'desktop', ...(images.length ? { images } : {}) }); } catch (e) { setErr(e.message); setText(value); setImgs(images); }
  };

  const addImages = async (files) => {
    files = [...files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    if (!canSee) return setErr('This bot’s model can’t see images. Turn on image input in Settings or pick another model.');
    if (imgs.length + files.length > MAX_IMAGES) setErr(`You can attach up to ${MAX_IMAGES} images.`);
    try {
      const ready = await Promise.all(files.slice(0, MAX_IMAGES - imgs.length).map(prepareImage));
      setImgs((x) => [...x, ...ready].slice(0, MAX_IMAGES));
    } catch (e) { setErr(e.message); }
    ta.current?.focus();
  };

  const mic = async () => {
    if (phase === 'recording') {
      setPhase('transcribing');
      try {
        const audio = await rec.stop(); setRec(null);
        const { text: t } = await api.call('voice.transcribe', { base64: audio.base64, format: audio.format });
        if (!t) throw new Error('Could not hear anything. Try again.');
        if (state.settings?.autoSendTranscript) await send(t); else setText((x) => (x ? x + ' ' : '') + t);
      } catch (e) { setErr(e.message); }
      setPhase('idle');
      return;
    }
    if (!voiceReady) return setErr('Connect OpenRouter (bottom left) to use voice.');
    try { setRec(await startRecording()); setPhase('recording'); } catch { setErr('Microphone not available.'); }
  };

  const cyclePermission = () => {
    const modes = state.permissions, i = modes.findIndex((m) => m.id === bot.permission);
    api.call('bots.update', { id: bot.id, permission: modes[(i + 1) % modes.length].id }).catch((e) => setErr(e.message));
  };
  const mode = state.permissions.find((m) => m.id === bot.permission) || state.permissions[0];

  const attach = async () => { const files = await bridge.pickFiles(); if (files?.length) setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${files.join(' ')} `); ta.current?.focus(); };

  return (
    <div class="composer-wrap">
      {err && <div class="toast">{err}</div>}
      {imgs.length > 0 && <div class="attachments">{imgs.map((img, i) => (
        <div class="attachment" key={img.thumb}><img src={img.thumb} alt="" />
          <button aria-label="Remove image" title="Remove" onClick={() => setImgs((x) => x.filter((_, j) => j !== i))}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>))}</div>}
      <div class={`composer ${phase}`} onDragOver={(e) => { if (canSee) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer?.files?.length && canSee) { e.preventDefault(); addImages(e.dataTransfer.files); } }}>
        {bridge?.pickFiles && <button class="cbtn plus" aria-label="Attach file path" title="Add a file path" onClick={attach}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>}
        {canSee && <>
          <button class="cbtn img" aria-label="Attach image" title="Attach image" onClick={() => picker.current?.click()}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg></button>
          <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
        </>}
        {phase === 'recording' ? (
          <div class="recording"><i class="rec-dot" /> Listening… tap the mic to send</div>
        ) : phase === 'transcribing' ? (
          <div class="recording">Transcribing…</div>
        ) : (
          <textarea ref={ta} rows={1} value={text} placeholder={`Message ${bot.name}`}
            onInput={(e) => setText(e.target.value)}
            onPaste={(e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(files); } }}
            onKeyDown={(e) => { if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cyclePermission(); } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }} />
        )}
        <EffortControl bot={bot} state={state} api={api} onError={setErr} />
        <button class={`cbtn mic ${phase === 'recording' ? 'live' : ''} ${voiceReady ? '' : 'off'}`} aria-label="Transcribe voice"
          title={voiceReady ? 'Talk — sends the transcript' : 'Connect OpenRouter to enable voice'} disabled={phase === 'transcribing'} onClick={mic}>
          <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        {working && !text.trim() && !imgs.length ? (
          <button class="cbtn send stop" aria-label="Stop" title="Stop" onClick={() => api.call('chat.stop', { botId: bot.id })}><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg></button>
        ) : (
          <button class="cbtn send" aria-label="Send" title={working ? 'Send after the current tool finishes' : 'Send'} disabled={!text.trim() && !imgs.length} onClick={() => send()}><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>
        )}
      </div>
      <button class={`modeline perm-${mode.id}`} title={mode.hint} onClick={cyclePermission}>
        <i /> {mode.label} <span>({matchMedia('(pointer: coarse)').matches ? 'tap to cycle' : 'shift+tab to cycle'})</span>
      </button>
    </div>
  );
}
