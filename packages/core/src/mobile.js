// Host side of mobile P2P. See packages/p2p for the transport and docs/MOBILE.md for the threat model.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import {
  Signaling, listen, DEFAULT_TRACKERS,
  newIdentity, exportIdentityJwk, importIdentityJwk, exportPub, importSignPub, importDhPub, dhBits, signMsg, verifyMsg,
  fingerprint, pairRoom, deviceRoom, b64u, unb64u, rand, equal, dbg,
} from '@minds/p2p';
import { encodePairing, nextMessage, sendJson, authMsg, readyMsg, pairedMsg, pairProof, VERSION } from '@minds/p2p/protocol';
import { identityFile, devicesFile } from './paths.js';
import { readJson, writeJson, newId } from './store.js';

const PAIR_TTL_MS = 5 * 60_000;
const CONFIRM_TTL_MS = 2 * 60_000;
const PRE_AUTH_MAX_FRAME = 8192;

const cleanName = (s) => String(s || 'Phone').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'Phone';

export class MobileManager {
  constructor(host, server, { trackers, RTC, iceServers } = {}) {
    this.host = host; this.server = server; this.RTC = RTC; this.iceServers = iceServers;
    this.trackers = trackers || (process.env.MINDS_TRACKERS ? process.env.MINDS_TRACKERS.split(',') : null) || DEFAULT_TRACKERS;
    this.devices = readJson(devicesFile(), []);
    this.signaling = null; this.rooms = new Map(); this.sessions = new Map();
    this.pairing = null; this.failures = new Map(); this.confirmations = new Map();
  }

  emit(event, data) { this.host.emit(event, data); }

  async init() {
    const saved = readJson(identityFile());
    if (saved) this.identity = await importIdentityJwk(saved);
    else {
      this.identity = await newIdentity({ extractable: true });
      writeJson(identityFile(), await exportIdentityJwk(this.identity));
    }
    this.signPub = await exportPub(this.identity.sign.publicKey);
    this.dhPub = await exportPub(this.identity.dh.publicKey);
    this.hostId = await fingerprint(this.signPub, this.dhPub);
    if (this.host.settings.get().mobileEnabled) await this.start();
  }

  get enabled() { return Boolean(this.signaling); }

  async start() {
    if (this.signaling) return;
    this.RTC ||= (await import('node-datachannel/polyfill')).RTCPeerConnection;
    this.signaling = new Signaling(this.trackers);
    for (const d of this.devices) await this.#listenDevice(d);
    this.emit('mobile.updated', this.status());
  }

  stop() {
    this.cancelPairing();
    for (const r of this.rooms.values()) r.close();
    this.rooms.clear();
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    this.signaling?.close(); this.signaling = null;
    this.emit('mobile.updated', this.status());
  }

  status() {
    return {
      enabled: this.enabled, hostId: this.hostId, trackers: this.trackers,
      pairing: this.pairing && !this.pairing.done ? { id: this.pairing.id, expiresAt: this.pairing.expiresAt, active: this.pairing.active } : null,
      devices: this.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen || null, online: this.sessions.has(d.id) })),
    };
  }

  #save() { writeJson(devicesFile(), this.devices); }

  // ---- pairing ----
  async startPairing() {
    if (!this.enabled) throw new Error('Turn on phone access first.');
    this.cancelPairing();
    const r = b64u(rand(16)), s = b64u(rand(16)), expiresAt = Date.now() + PAIR_TTL_MS;
    const session = { id: newId('p_'), r, s, expiresAt, done: false, active: false, bad: 0 };
    const room = await pairRoom(r, s);
    session.listener = listen({ RTC: this.RTC, signaling: this.signaling, room, iceServers: this.iceServers, onChannel: (ch) => this.#onPairChannel(ch, session) });
    session.timer = setTimeout(() => { if (this.pairing === session && !session.active) this.cancelPairing(); }, PAIR_TTL_MS);
    this.pairing = session;
    this.emit('mobile.updated', this.status());
    const custom = this.trackers.join(',') !== DEFAULT_TRACKERS.join(',');
    const payload = encodePairing({ id: this.hostId, r, s, t: expiresAt, tr: custom ? this.trackers : undefined });
    return { id: session.id, payload, expiresAt };
  }

  #hostName() { try { return (process.env.HOSTNAME || fs.readFileSync('/etc/hostname', 'utf8')).trim().slice(0, 40) || 'Computer'; } catch { return 'Computer'; } }

  cancelPairing() {
    const s = this.pairing; if (!s) return;
    clearTimeout(s.timer); s.listener?.close(); this.pairing = null;
    this.confirmations.get(s.id)?.(false);
    this.emit('mobile.updated', this.status());
  }

  /** The person at the computer approves or declines a phone that completed the QR handshake. */
  respond(id, allow) {
    const fn = this.confirmations.get(id);
    if (!fn) throw new Error('That pairing request is no longer pending.');
    fn(Boolean(allow));
  }

  async #onPairChannel(ch, session) {
    ch.maxFrame = PRE_AUTH_MAX_FRAME;
    dbg('pair: a phone connected');
    let claimed = false, dropped = false;
    try {
      if (this.pairing !== session || session.done || Date.now() > session.expiresAt) throw new Error('This pairing code is no longer active. Make a new one on the computer.');
      if (session.active) throw new Error('Another phone is pairing right now.');
      session.active = true; claimed = true;
      this.emit('mobile.updated', this.status());

      const nonceH = b64u(rand(16));
      await sendJson(ch, { t: 'hello', v: VERSION, nonce: nonceH, host: { sign: this.signPub, dh: this.dhPub, name: this.#hostName() } });
      const m = await nextMessage(ch, 'pair');
      const { sign: signPub, dh: dhPub } = m.device || {};
      const want = await pairProof(session.s, nonceH, String(m.nonce), String(signPub), String(dhPub));
      if (typeof m.proof !== 'string' || !equal(unb64u(m.proof), unb64u(want))) {
        if (++session.bad >= 3) this.cancelPairing();
        throw Object.assign(new Error('Invalid pairing proof.'), { final: true });
      }
      await importSignPub(signPub); await importDhPub(dhPub);  // reject malformed keys
      const deviceId = await fingerprint(signPub, dhPub);
      const name = cleanName(m.device.name);
      dbg('pair: proof ok, asking you to approve', name);

      await sendJson(ch, { t: 'pair.wait' });
      this.emit('mobile.pairing', { id: session.id, deviceId, deviceName: name, expiresAt: Date.now() + CONFIRM_TTL_MS });
      const allowed = await new Promise((resolve) => {
        const t = setTimeout(() => { this.confirmations.delete(session.id); resolve(false); }, CONFIRM_TTL_MS);
        this.confirmations.set(session.id, (v) => { clearTimeout(t); this.confirmations.delete(session.id); resolve(v); });
        ch.on('close', () => { dropped = true; clearTimeout(t); this.confirmations.delete(session.id); resolve(false); });
      });
      if (dropped) { dbg('pair: phone disconnected before you decided'); this.emit('mobile.pairing', { id: session.id, cancelled: true }); return; }
      if (!allowed) {
        dbg('pair: declined');
        session.done = true;
        await sendJson(ch, { t: 'denied', reason: 'Declined on the computer.' }).catch(() => {});
        setTimeout(() => ch.close(), 300); this.cancelPairing(); return;
      }

      const device = { id: deviceId, name, sign: signPub, dh: dhPub, createdAt: Date.now(), lastSeen: null };
      this.devices = this.devices.filter((d) => d.id !== deviceId).concat(device);
      this.#save();
      await this.#listenDevice(device);
      session.done = true;
      await sendJson(ch, { t: 'paired', deviceId, sig: await signMsg(this.identity.sign.privateKey, pairedMsg(deviceId, String(m.nonce))) });
      dbg('pair: approved and paired', name);
      this.cancelPairing();
      this.#openSession(ch, device);   // the approved channel is already authenticated: use it right away
    } catch (e) {
      dbg('pair: failed:', e.message);
      try { await sendJson(ch, { t: 'error', reason: e.message }); } catch {}
      setTimeout(() => ch.close(), 300);
    } finally {
      if (claimed && !session.done && this.pairing === session) { session.active = false; this.emit('mobile.updated', this.status()); }
    }
  }

  // ---- paired devices ----
  async #listenDevice(device) {
    if (!this.signaling || this.rooms.has(device.id)) return;
    const shared = await dhBits(this.identity.dh.privateKey, await importDhPub(device.dh));
    const room = await deviceRoom(this.hostId, device.id, shared);
    this.rooms.set(device.id, listen({ RTC: this.RTC, signaling: this.signaling, room, iceServers: this.iceServers, onChannel: (ch) => this.#onDeviceChannel(ch, device.id) }));
  }

  async #onDeviceChannel(ch, deviceId) {
    ch.maxFrame = PRE_AUTH_MAX_FRAME;
    dbg('auth: a paired phone connected');
    const fail = this.failures.get(deviceId) || { n: 0, until: 0 };
    if (Date.now() < fail.until) return ch.close();
    try {
      const device = this.devices.find((d) => d.id === deviceId);
      if (!device) throw new Error('Unknown device.');
      const nonceH = b64u(rand(16));
      await sendJson(ch, { t: 'hello', v: VERSION, nonce: nonceH });
      const m = await nextMessage(ch, 'auth');
      const ok = m.deviceId === device.id && typeof m.nonce === 'string' && await verifyMsg(await importSignPub(device.sign), String(m.sig), authMsg(device.id, nonceH, m.nonce));
      if (!ok) { fail.n++; if (fail.n >= 5) { fail.until = Date.now() + 5 * 60_000; fail.n = 0; } this.failures.set(deviceId, fail); throw new Error('Authentication failed.'); }
      this.failures.delete(deviceId);
      dbg('auth: phone verified', device.name);
      await sendJson(ch, { t: 'ready', sig: await signMsg(this.identity.sign.privateKey, readyMsg(device.id, m.nonce, nonceH)) });

      this.#openSession(ch, device);
    } catch (e) {
      dbg('auth: refused:', e.message);
      try { await sendJson(ch, { t: 'error', reason: 'Refused.' }); } catch {}
      setTimeout(() => ch.close(), 200);
    }
  }

  /** An authenticated channel becomes a mobile-role RPC session (one per device). */
  #openSession(ch, device) {
    const deviceId = device.id;
    ch.maxFrame = Infinity;
    this.sessions.get(deviceId)?.close();
    this.sessions.set(deviceId, ch);
    device.lastSeen = Date.now(); this.#save();
    ch.on('close', () => { if (this.sessions.get(deviceId) === ch) { this.sessions.delete(deviceId); this.emit('mobile.updated', this.status()); } });
    this.server.attach({
      send: (s) => ch.send(s).catch(() => {}),
      on: (ev, fn) => { if (ev === 'message' || ev === 'close') ch.on(ev, fn); },
      close: () => ch.close(),
    }, { authed: true, role: 'mobile', deviceId });
    this.emit('mobile.updated', this.status());
  }

  revoke(deviceId) {
    if (!this.devices.some((d) => d.id === deviceId)) throw new Error('Unknown device.');
    this.devices = this.devices.filter((d) => d.id !== deviceId); this.#save();
    this.rooms.get(deviceId)?.close(); this.rooms.delete(deviceId);
    this.sessions.get(deviceId)?.close(); this.sessions.delete(deviceId);
    this.emit('mobile.updated', this.status());
  }
}
