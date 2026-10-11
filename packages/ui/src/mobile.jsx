// Mobile entry: pair with a computer (QR), then run the same app over a P2P connection.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import jsQR from 'jsqr';
import { PhoneClient, createP2pApi, idbStorage, recentLog } from '@minds/p2p/client';
import { App } from './App.jsx';

export const isMobile = () => Boolean(window.Capacitor?.isNativePlatform?.()) || new URLSearchParams(location.search).has('mobile');

const guessName = () => {
  const m = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|[;)])/.exec(navigator.userAgent);
  return m ? m[1].trim() : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'My phone';
};

export function MobileRoot() {
  const phone = useMemo(() => new PhoneClient({ storage: idbStorage('minds') }), []);
  const [stage, setStage] = useState('loading');
  const [api, setApi] = useState(null);

  const start = (session) => { setApi(createP2pApi(phone, session)); setStage('app'); };
  useEffect(() => { phone.host().then((h) => (h ? start(null) : setStage('pair'))).catch(() => setStage('pair')); }, []);
  const forget = async () => { api?.close(); await phone.forget(); setApi(null); setStage('pair'); };

  if (stage === 'loading') return <div class="boot"><div class="boot-msg">Starting…</div></div>;
  if (stage === 'pair') return <PairScreen phone={phone} onPaired={start} />;
  return <App api={api} mobile onForget={forget} />;
}

function PairScreen({ phone, onPaired }) {
  const [phase, setPhase] = useState('idle'); // idle | scanning | pairing
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(guessName());

  const pair = async (text) => {
    setErr(''); setPhase('pairing');
    try { const r = await phone.pair(text.trim(), name.trim() || 'My phone', { timeoutMs: 60000 }); onPaired(r.session); }
    catch (e) { setErr(e.message + (e.stage ? ` (while ${e.stage})` : '')); setPhase('idle'); }
  };

  return (
    <div class="pairscreen">
      <div class="pair-card">
        <svg class="pair-logo" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1d6fe8" /><ellipse cx="24" cy="30" rx="3.4" ry="5.2" fill="#fff" /><ellipse cx="40" cy="30" rx="3.4" ry="5.2" fill="#fff" /></svg>
        <h1>Connect to your computer</h1>
        <ol>
          <li>On your computer, open Minds → <b>Profile & settings</b> → <b>Phone</b></li>
          <li>Turn on <b>Allow phones to connect</b>, then <b>Pair a phone</b></li>
          <li>Scan the code that appears</li>
        </ol>

        {phase === 'scanning' ? (
          <Scanner onCode={(t) => { setPhase('idle'); pair(t); }} onCancel={() => setPhase('idle')} onError={(m) => { setErr(m); setPhase('idle'); }} />
        ) : phase === 'pairing' ? (
          <div class="pairing"><i class="spinner" /><p>Pairing… <b>approve this phone on your computer.</b></p></div>
        ) : (
          <>
            <label class="cap">This phone's name</label>
            <input class="field" value={name} maxLength={60} onInput={(e) => setName(e.target.value)} />
            <button class="btn primary wide" onClick={() => { setErr(''); setPhase('scanning'); }}>Scan QR code</button>
            <details class="paste">
              <summary>Or paste the pairing code</summary>
              <textarea class="field" rows={3} placeholder="minds://pair/…" value={code} onInput={(e) => setCode(e.target.value)} />
              <button class="btn wide" disabled={!code.trim()} onClick={() => pair(code)}>Pair</button>
            </details>
          </>
        )}
        {err && (
          <>
            <p class="error">{err}</p>
            <details class="paste"><summary>Details</summary>
              <pre class="log">{recentLog().slice(-40).join('\n') || 'No details recorded.'}</pre>
              <button class="btn" onClick={() => navigator.clipboard?.writeText(recentLog().join('\n'))}>Copy details</button>
            </details>
          </>
        )}
        <p class="muted tiny">Your phone connects to your computer with end-to-end encryption. For mobile data, configure a relay in Phone settings on the computer.</p>
      </div>
    </div>
  );
}

function Scanner({ onCode, onCancel, onError }) {
  const video = useRef(), canvas = useRef();
  const [hint, setHint] = useState('Point at the code on your computer');
  useEffect(() => {
    let stop = false, stream, timer;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        const track = stream.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
        video.current.srcObject = stream; await video.current.play();
        const native = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const ctx = canvas.current.getContext('2d', { willReadFrequently: true });
        const found = (data) => { if (data?.startsWith('minds://pair/') && !stop) { stop = true; onCode(data); return true; } return false; };
        const tick = async () => {
          if (stop) return;
          const v = video.current;
          if (v.readyState >= 2 && v.videoWidth) {
            try {
              if (native && (await native.detect(v)).some((b) => found(b.rawValue))) return;
              // jsQR on a large frame (small QR modules need pixels); try both polarities
              const scale = Math.min(1, 1280 / v.videoWidth);
              canvas.current.width = Math.round(v.videoWidth * scale); canvas.current.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.current.width, canvas.current.height);
              const img = ctx.getImageData(0, 0, canvas.current.width, canvas.current.height);
              if (found(jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data)) return;
            } catch {}
          }
          timer = setTimeout(tick, 120);
        };
        tick();
        setTimeout(() => !stop && setHint('Hold steady and fill the frame with the code. Brighten your screen if it is dim.'), 6000);
      } catch { onError('Camera not available. You can paste the pairing code instead.'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div class="scanner">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} hidden />
      <div class="reticle" />
      <p class="muted tiny scan-hint">{hint}</p>
      <button class="btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}
