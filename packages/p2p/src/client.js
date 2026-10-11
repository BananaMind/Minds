// Phone-side client: pairs with a host via QR, reconnects with its device key, and exposes the same
// {call, on, onStatus, close} API the UI uses over the local WebSocket.
import { Signaling, DEFAULT_TRACKERS } from './signaling.js';
import { dial, requestIceServers } from './link.js';
import { Emitter } from './emitter.js';
import { dbg } from './log.js';
import {
  newIdentity, exportPub, importSignPub, importDhPub, dhBits, signMsg, verifyMsg, fingerprint, deviceRoom, pairRoom, b64u, rand,
} from './crypto.js';
import { decodePairing, nextMessage, sendJson, authMsg, readyMsg, pairedMsg, pairProof, VERSION } from './protocol.js';

export { DEFAULT_TRACKERS };
export { recentLog } from './log.js';

/** Browser storage that can persist non-extractable CryptoKeys (structured clone). */
export function idbStorage(name = 'minds') {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); }); };
  return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)), del: (k) => tx('readwrite', (s) => s.delete(k)) };
}
export function memoryStorage() { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) }; }

class Session extends Emitter {
  constructor(ch) {
    super(); this.ch = ch; this.nextId = 1; this.pending = new Map();
    this.closed = new Promise((r) => ch.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('Disconnected')); this.pending.clear(); r(); }));
    ch.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.event) return this.emit('event', m.event, m.data);
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++; this.pending.set(id, { resolve, reject });
      sendJson(this.ch, { id, method, params }).catch(reject);
    });
  }
  close() { this.ch.close(); }
}

export class PhoneClient {
  /** @param RTC RTCPeerConnection constructor · storage {get,set,del} */
  constructor({ RTC = globalThis.RTCPeerConnection, storage, iceServers }) { this.RTC = RTC; this.storage = storage; this.iceServers = iceServers; this.sigs = new Map(); }

  /** Signaling connections are reused across pairing, reconnects and retries (connecting to relays is the slow part). */
  #signaling(trackers) {
    const list = trackers?.length ? trackers : DEFAULT_TRACKERS, key = list.join(',');
    if (!this.sigs.has(key)) this.sigs.set(key, new Signaling(list));
    return this.sigs.get(key);
  }
  close() { for (const s of this.sigs.values()) s.close(); this.sigs.clear(); }

  async identity() {
    let id = await this.storage.get('identity');
    if (!id) { id = await newIdentity({ extractable: false }); await this.storage.set('identity', id); }
    return id;
  }
  host() { return this.storage.get('host'); }
  async forget() { await this.storage.del('host'); this.close(); }

  async #relay(signaling, room, signal) {
    if (this.iceServers !== undefined) return { iceServers: this.iceServers };
    try { return await requestIceServers({ signaling, room, signal }); }
    catch (e) {
      if (e.code !== 'ICE_BOOTSTRAP_TIMEOUT') throw e;
      dbg('relay: computer did not supply settings; trying a direct connection');
      return {};
    }
  }

  #session(ch, config) {
    const session = new Session(ch);
    // Renew short-lived credentials by reconnecting before they expire. Bot work stays on the host.
    if (config.expiresAt) {
      const timer = setTimeout(() => session.close(), Math.max(1000, config.expiresAt - Date.now() - 60_000));
      session.closed.then(() => clearTimeout(timer));
    }
    return session;
  }

  /**
   * Pair using the text from the desktop QR code. Resolves with the stored host record (+ a live session).
   * A dropped connection is retried automatically; a refusal from the computer is final.
   */
  async pair(payload, deviceName = 'Phone', { timeoutMs, attempts = 3 } = {}) {
    const p = decodePairing(payload);
    let last;
    for (let i = 1; i <= attempts; i++) {
      try { return await this.#pairOnce(p, deviceName, timeoutMs, i); }
      catch (e) {
        last = e; dbg('pair attempt', i, 'failed:', e.message);
        if (e.fatal || /expired|not a Minds|damaged|not valid/i.test(e.message)) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    throw last;
  }

  async #pairOnce(p, deviceName, timeoutMs, attempt) {
    let stage = 'finding your computer';
    const fail = (e) => { throw Object.assign(new Error(/Connection closed/.test(e.message) ? 'The connection dropped before pairing finished.' : e.message), { fatal: e.fatal, stage }); };
    const id = await this.identity();
    const signPub = await exportPub(id.sign.publicKey), dhPub = await exportPub(id.dh.publicKey);
    const deviceId = await fingerprint(signPub, dhPub);
    const sig = this.#signaling(p.tr);
    let ch, ok = false;
    dbg('pair: attempt', attempt, 'dialing');
    try {
      const room = await pairRoom(p.r, p.s);
      const config = await this.#relay(sig, room);
      ch = await dial({ RTC: this.RTC, signaling: sig, room, iceServers: config.iceServers, timeoutMs });
      stage = 'greeting your computer'; dbg('pair: connected, waiting for hello');
      const hello = await nextMessage(ch, 'hello');
      if (!hello.host?.sign || !hello.host?.dh || (await fingerprint(hello.host.sign, hello.host.dh)) !== p.id) throw Object.assign(new Error('This is not the computer whose code you scanned. Pairing cancelled.'), { fatal: true });
      const nonceP = b64u(rand(16));
      stage = 'proving the code'; dbg('pair: sending proof');
      await sendJson(ch, { t: 'pair', v: VERSION, nonce: nonceP, device: { name: String(deviceName).slice(0, 60), sign: signPub, dh: dhPub }, proof: await pairProof(p.s, hello.nonce, nonceP, signPub, dhPub) });
      stage = 'waiting for you to approve on the computer'; dbg('pair: waiting for approval');
      const done = await nextMessage(ch, 'paired', 5 * 60_000);
      if (done.deviceId !== deviceId || !(await verifyMsg(await importSignPub(hello.host.sign), done.sig, pairedMsg(deviceId, nonceP)))) throw Object.assign(new Error('The computer could not prove its identity. Pairing cancelled.'), { fatal: true });
      const host = { id: p.id, sign: hello.host.sign, dh: hello.host.dh, name: String(hello.host.name || 'Computer').slice(0, 40), trackers: p.tr || null, deviceId, pairedAt: Date.now() };
      await this.storage.set('host', host);
      ok = true; dbg('pair: done');
      return { ...host, session: this.#session(ch, config) };
    } catch (e) { return fail(e); }
    finally { if (!ok) { try { ch?.close(); } catch {} } }
  }

  /** Open an authenticated session to the paired host. */
  async connect({ signal, timeoutMs } = {}) {
    const host = await this.host();
    if (!host) throw new Error('Not paired with a computer yet.');
    const id = await this.identity();
    const shared = await dhBits(id.dh.privateKey, await importDhPub(host.dh));
    const sig = this.#signaling(host.trackers);
    let ch;
    try {
      const room = await deviceRoom(host.id, host.deviceId, shared);
      const config = await this.#relay(sig, room, signal);
      ch = await dial({ RTC: this.RTC, signaling: sig, room, iceServers: config.iceServers, timeoutMs, signal });
      const hello = await nextMessage(ch, 'hello');
      const nonceP = b64u(rand(16));
      await sendJson(ch, { t: 'auth', deviceId: host.deviceId, nonce: nonceP, sig: await signMsg(id.sign.privateKey, authMsg(host.deviceId, hello.nonce, nonceP)) });
      const ready = await nextMessage(ch, 'ready');
      if (!(await verifyMsg(await importSignPub(host.sign), ready.sig, readyMsg(host.deviceId, nonceP, hello.nonce)))) throw new Error('Host identity check failed.');
      return this.#session(ch, config);
    } catch (e) { try { ch?.close(); } catch {} throw e; }
  }
}

/** UI-facing API with automatic reconnect: same shape as the desktop WebSocket api. */
export function createP2pApi(phone, initialSession = null) {
  const listeners = new Set(), statusListeners = new Set();
  let session = null, status = 'connecting', closed = false, lastError = '', abort = null;
  const setStatus = (s) => { status = s; statusListeners.forEach((f) => f(s)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    let fails = 0;
    while (!closed) {
      setStatus('connecting');
      abort = new AbortController();
      try {
        session = initialSession || await phone.connect({ signal: abort.signal });
        initialSession = null;
        fails = 0; lastError = '';
        session.on('event', (e, d) => listeners.forEach((f) => f(e, d)));
        setStatus('connected'); listeners.forEach((f) => f('connected', {}));
        await session.closed;
      } catch (e) { lastError = e.message; fails++; }
      session = null;
      if (closed) break;
      setStatus('offline');
      await sleep(Math.min(1500 * fails, 10000) + 500);
    }
  })();

  return {
    call: (m, p) => (session ? session.call(m, p) : Promise.reject(new Error('Not connected to your computer'))),
    // A listener that subscribes after the connection is already up still gets 'connected' (so the UI loads its state).
    on: (f) => { listeners.add(f); if (status === 'connected') queueMicrotask(() => f('connected', {})); return () => listeners.delete(f); },
    onStatus: (f) => { statusListeners.add(f); f(status); return () => statusListeners.delete(f); },
    lastError: () => lastError,
    retryNow: () => abort?.abort(),
    close: () => { closed = true; abort?.abort(); session?.close(); phone.close?.(); },
  };
}
