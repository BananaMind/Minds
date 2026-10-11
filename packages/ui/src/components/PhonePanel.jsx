import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';

const ago = (ts) => {
  if (!ts) return 'never connected';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(ts).toLocaleDateString();
};

/** Phone access settings (desktop only): enable, pair via QR, list and revoke devices. */
export function PhonePanel({ state, api, dispatch }) {
  const m = state.mobile;
  const s = state.settings;
  const [pair, setPair] = useState(null);
  const [err, setErr] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [log, setLog] = useState(null);
  const run = (p) => p.catch((e) => setErr(e.message));

  // The pairing dialog closes itself when the code is consumed or expires.
  useEffect(() => { if (pair && !m?.pairing) setPair(null); }, [m?.pairing]);

  if (!m) return <p class="muted">Phone access isn't available in this host.</p>;
  return (
    <div>
      <div class="sec-head"><b>Phone</b><span class={`status ${m.enabled ? 'ok' : ''}`}>{m.enabled ? 'On' : 'Off'}</span></div>
      <p class="muted">Control your bots from your phone. Your phone connects <b>directly</b> to this computer, encrypted end to end. There's no Minds server; public relay servers only help the two find each other and can't read anything.</p>
      <label class="check big"><input type="checkbox" checked={m.enabled} onChange={(e) => run(api.call('mobile.setEnabled', { enabled: e.target.checked }))} /> Allow phones to connect</label>

      {m.enabled && (
        <>
          <div class="devices">
            {m.devices.length === 0 && <p class="muted tiny">No phones paired yet.</p>}
            {m.devices.map((d) => (
              <div class="device" key={d.id}>
                <i class={`dot ${d.online ? 'on' : ''}`} />
                <div><b>{d.name}</b><small>{d.online ? 'Connected now' : `Last seen ${ago(d.lastSeen)}`}</small></div>
                {confirmRevoke === d.id
                  ? <><button class="btn" onClick={() => setConfirmRevoke(null)}>Keep</button><button class="btn danger" onClick={() => { run(api.call('mobile.revoke', { deviceId: d.id })); setConfirmRevoke(null); }}>Revoke</button></>
                  : <button class="btn ghost" onClick={() => setConfirmRevoke(d.id)}>Remove</button>}
              </div>
            ))}
          </div>
          <div class="row"><button class="btn primary" onClick={async () => { setErr(''); try { setPair(await api.call('mobile.pair.start')); } catch (e) { setErr(e.message); } }}>Pair a phone</button></div>
          <label class="check"><input type="checkbox" checked={s.mobileCanApprove} onChange={(e) => run(api.call('settings.set', { patch: { mobileCanApprove: e.target.checked } }).then((r) => dispatch({ type: 'settings', settings: r })))} /> Phones can approve risky actions</label>
          <p class="muted tiny">Phones can chat, answer questions and read tool calls. They can't change settings, see keys, delete bots, or switch a bot to bypass mode.</p>
          <button class="btn ghost tiny" onClick={async () => setLog(log ? null : (await api.call('mobile.log')).log)}>{log ? 'Hide connection log' : 'Show connection log'}</button>
          {log && <pre class="log">{log.length ? log.slice(-60).join('\n') : 'Nothing yet. Events appear here while a phone connects.'}</pre>}
        </>
      )}
      {err && <p class="error">{err}</p>}
      {pair && <PairDialog pair={pair} api={api} onClose={() => { api.call('mobile.pair.cancel').catch(() => {}); setPair(null); }} />}
    </div>
  );
}

function PairDialog({ pair, api, onClose }) {
  const [img, setImg] = useState('');
  const [left, setLeft] = useState(Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)));
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(pair.payload, { margin: 4, scale: 10, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(setImg); }, [pair.payload]);
  useEffect(() => { const t = setInterval(() => setLeft(Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000))), 1000); return () => clearInterval(t); }, []);
  return (
    <div class="modal-wrap top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal small center">
        <header><h3>Pair a phone</h3><button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
        <p class="muted">Open Minds on your phone and scan this code. It works once and expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
        <div class="qr">{img ? <img src={img} alt="Pairing QR code" class="qr-img" /> : <div class="qr-ph" />}</div>
        <button class="btn ghost" onClick={() => { navigator.clipboard?.writeText(pair.payload); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy code instead'}</button>
        <p class="muted tiny">You'll be asked to approve the phone here before it's added.</p>
      </div>
    </div>
  );
}

/** Shown whenever a phone has scanned the code and is waiting for you to say yes. */
export function PairingRequest({ req, api, onDone }) {
  const [busy, setBusy] = useState(false);
  const answer = async (allow) => { setBusy(true); try { await api.call('mobile.pair.respond', { id: req.id, allow }); } catch {} onDone(); };
  return (
    <div class="modal-wrap top">
      <div class="modal small center">
        <h3>Pair “{req.deviceName}”?</h3>
        <p class="muted">This phone will be able to chat with your bots and answer their questions and approval requests. Only approve a phone you just scanned the code with.</p>
        <div class="row end center-row">
          <button class="btn" disabled={busy} onClick={() => answer(false)}>Decline</button>
          <button class="btn primary" disabled={busy} onClick={() => answer(true)}>Pair this phone</button>
        </div>
      </div>
    </div>
  );
}
