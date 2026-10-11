import { useEffect, useRef, useState } from 'preact/hooks';
import { startRecording } from '../voice.js';

export function Composer({ bot, state, api }) {
  const [text, setText] = useState('');
  const [rec, setRec] = useState(null);       // active recording
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing
  const [err, setErr] = useState('');
  const ta = useRef();
  const bridge = window.minds;
  const voiceReady = state.settings?.openrouterConnected;
  const working = bot.status !== 'idle';

  useEffect(() => { setText(''); ta.current?.focus(); }, [bot.id]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px'; }, [text]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 5000); return () => clearTimeout(t); }, [err]);

  const send = async (value = text) => {
    value = value.trim(); if (!value) return;
    setText('');
    try { await api.call('chat.send', { botId: bot.id, text: value, source: 'desktop' }); } catch (e) { setErr(e.message); setText(value); }
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
      <div class={`composer ${phase}`}>
        {bridge?.pickFiles && <button class="cbtn plus" aria-label="Attach file path" title="Add a file path" onClick={attach}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>}
        {phase === 'recording' ? (
          <div class="recording"><i class="rec-dot" /> Listening… tap the mic to send</div>
        ) : phase === 'transcribing' ? (
          <div class="recording">Transcribing…</div>
        ) : (
          <textarea ref={ta} rows={1} value={text} placeholder={`Message ${bot.name}`}
            onInput={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cyclePermission(); } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }} />
        )}
        <button class={`cbtn mic ${phase === 'recording' ? 'live' : ''} ${voiceReady ? '' : 'off'}`} aria-label="Transcribe voice"
          title={voiceReady ? 'Talk — sends the transcript' : 'Connect OpenRouter to enable voice'} disabled={phase === 'transcribing'} onClick={mic}>
          <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        {working && !text.trim() ? (
          <button class="cbtn send stop" aria-label="Stop" title="Stop" onClick={() => api.call('chat.stop', { botId: bot.id })}><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg></button>
        ) : (
          <button class="cbtn send" aria-label="Send" title={working ? 'Send after the current tool finishes' : 'Send'} disabled={!text.trim()} onClick={() => send()}><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>
        )}
      </div>
      <button class={`modeline perm-${mode.id}`} title={mode.hint} onClick={cyclePermission}>
        <i /> {mode.label} <span>({matchMedia('(pointer: coarse)').matches ? 'tap to cycle' : 'shift+tab to cycle'})</span>
      </button>
    </div>
  );
}
