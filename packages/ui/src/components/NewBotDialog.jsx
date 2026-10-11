import { useEffect, useRef, useState } from 'preact/hooks';

export function NewBotDialog({ api, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try { onCreated(await api.call('bots.create', { name: name.trim() })); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div class="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form class="modal small" onSubmit={submit}>
        <h3>Name your bot</h3>
        <p class="muted">It gets its own icon, chat, memory and workspace.</p>
        <input ref={ref} class="field" value={name} maxLength={40} placeholder="e.g. Researchy" onInput={(e) => setName(e.target.value)} />
        {err && <p class="error">{err}</p>}
        <div class="row end">
          <button type="button" class="btn" onClick={onClose}>Cancel</button>
          <button class="btn primary" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create bot'}</button>
        </div>
      </form>
    </div>
  );
}
