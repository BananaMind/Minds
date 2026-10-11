// Transport-agnostic client for the Minds host protocol. Desktop uses a local WebSocket;
// the mobile build swaps `openChannel` for a P2P data channel — everything above is shared.

async function hostInfo() {
  if (window.minds?.hostInfo) return window.minds.hostInfo();
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('port') && h.get('token')) return { port: Number(h.get('port')), token: h.get('token') };
  throw new Error('No Minds host configured');
}

export function createApi() {
  let ws = null, nextId = 1, closed = false, retry = 0;
  const pending = new Map();
  const listeners = new Set();
  const statusListeners = new Set();
  let status = 'connecting';
  const setStatus = (s) => { status = s; statusListeners.forEach((f) => f(s)); };

  async function open() {
    try {
      const info = await hostInfo();
      ws = new WebSocket(`ws://127.0.0.1:${info.port}`);
      // A host that is mid-restart can accept the socket and never answer: give up and retry instead of hanging.
      const stuck = setTimeout(() => { try { ws.close(); } catch {} }, 6000);
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.event) return listeners.forEach((f) => f(m.event, m.data));
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      };
      ws.onopen = async () => {
        try { await call('hello', { token: info.token }); clearTimeout(stuck); retry = 0; setStatus('connected'); listeners.forEach((f) => f('connected', {})); }
        catch { clearTimeout(stuck); ws.close(); }
      };
      ws.onclose = () => { clearTimeout(stuck); pending.forEach((p) => p.reject(new Error('Disconnected'))); pending.clear(); setStatus('offline'); schedule(); };
      ws.onerror = () => {};
    } catch { setStatus('offline'); schedule(); }
  }
  function schedule() { if (closed) return; setTimeout(open, Math.min(1000 * 2 ** retry++, 5000)); }
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error('Not connected to the Minds host'));
      const id = nextId++; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  open();
  return {
    call,
    // The socket can connect before the UI has subscribed (local hello takes milliseconds): replay 'connected' to late
    // subscribers so the app always loads its state instead of waiting forever on "Connecting…".
    on: (f) => { listeners.add(f); if (status === 'connected') queueMicrotask(() => f('connected', {})); return () => listeners.delete(f); },
    onStatus: (f) => { statusListeners.add(f); f(status); return () => statusListeners.delete(f); },
    close: () => { closed = true; ws?.close(); },
  };
}
