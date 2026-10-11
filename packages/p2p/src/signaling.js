// Signaling for finding each other without a Minds server. Offers/answers are end-to-end encrypted
// blobs relayed through ANY of several public services at once (MQTT brokers and WebTorrent
// trackers); one reachable service is enough. Relays see only opaque ciphertext and a hashed
// room name. Works in Node (global WebSocket) and in browsers/WebViews.
import { dbg } from './log.js';
import { Emitter } from './emitter.js';
import { MqttConn } from './mqtt.js';
import { rand } from './crypto.js';

export const DEFAULT_TRACKERS = [
  'mqtt+wss://broker.emqx.io:8084/mqtt',
  'mqtt+wss://broker.hivemq.com:8884/mqtt',
  'mqtt+wss://test.mosquitto.org:8081',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
];
export const DEFAULT_SIGNALING = DEFAULT_TRACKERS;

const peerId = () => String.fromCharCode(...rand(20));
const toHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => String.fromCharCode(...(h.match(/../g) || []).map((x) => parseInt(x, 16)));

// ---------- WebTorrent tracker transport ----------
class TrackerConn {
  constructor(url, sig) {
    this.url = url; this.sig = sig; this.ws = null; this.retry = 0; this.closed = false; this.open = false; this.queue = [];
    this.connect();
  }
  connect() {
    if (this.closed) return;
    try { this.ws = new WebSocket(this.url); } catch { return this.later(); }
    this.ws.onopen = () => { dbg('tracker open', this.url); this.open = true; this.retry = 0; for (const m of this.queue.splice(0)) this.ws.send(m); this.sig.swarms.forEach((s) => s.announceOn(this)); };
    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
        if (m['failure reason'] || m['warning message']) return dbg('tracker says', this.url, m['failure reason'] || m['warning message']);
        const sw = typeof m.info_hash === 'string' && this.sig.swarms.get(m.info_hash);
        if (!sw) return;
        if (m.offer && m.offer_id && typeof m.offer.sdp === 'string' && m.peer_id) sw.gotOffer(m.offer_id, m.offer.sdp, (sdp) => this.send({ action: 'announce', info_hash: m.info_hash, peer_id: sw.peerId, to_peer_id: m.peer_id, offer_id: m.offer_id, answer: { type: 'answer', sdp } }));
        else if (m.answer && m.offer_id && typeof m.answer.sdp === 'string') sw.gotAnswer(m.offer_id, m.answer.sdp);
      } catch (e) { dbg('tracker msg error', e.message); }
    };
    this.ws.onclose = () => { dbg('tracker closed', this.url); this.open = false; this.later(); };
    this.ws.onerror = () => {};
  }
  later() { if (this.closed) return; setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 30000)); }
  send(obj) { const m = JSON.stringify(obj); if (this.open) this.ws.send(m); else if (this.queue.length < 50) this.queue.push(m); }
  join() {}
  announce(sw, offers) {
    this.send({ action: 'announce', info_hash: sw.infoHash, peer_id: sw.peerId, numwant: Math.max(offers.length, 1), uploaded: 0, downloaded: 0, left: offers.length ? 1 : 0, offers });
  }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}

// ---------- MQTT transport (pub/sub on a hashed topic) ----------
class MqttTransport {
  constructor(url, sig) { this.url = url; this.sig = sig; this.mqtt = new MqttConn(url, (topic, payload) => this.#in(topic, payload)); }
  topic(infoHash) { return `minds/v1/${toHex(infoHash)}`; }
  #in(topic, payload) {
    const m = /^minds\/v1\/([0-9a-f]{40})$/.exec(topic); if (!m) return;
    const sw = this.sig.swarms.get(fromHex(m[1])); if (!sw) return;
    let msg; try { msg = JSON.parse(payload); } catch { return; }
    if (!msg || msg.from === sw.peerId || typeof msg.sdp !== 'string' || typeof msg.id !== 'string') return;
    if (msg.k === 'o') sw.gotOffer(msg.id, msg.sdp, (sdp) => this.mqtt.publish(topic, JSON.stringify({ k: 'a', id: msg.id, from: sw.peerId, to: msg.from, sdp })));
    else if (msg.k === 'a' && (!msg.to || msg.to === sw.peerId)) sw.gotAnswer(msg.id, msg.sdp);
  }
  join(sw) { this.mqtt.subscribe(this.topic(sw.infoHash)); }
  announce(sw, offers) {
    this.join(sw);
    for (const o of offers) this.mqtt.publish(this.topic(sw.infoHash), JSON.stringify({ k: 'o', id: o.offer_id, from: sw.peerId, sdp: o.offer.sdp }));
  }
  close() { this.mqtt.close(); }
}

/** One signaling session: connections to every configured service, shared by any number of rooms. */
export class Signaling {
  constructor(endpoints = DEFAULT_SIGNALING) {
    this.swarms = new Map();
    this.conns = endpoints.map((u) => (u.startsWith('mqtt+') ? new MqttTransport(u, this) : new TrackerConn(u, this)));
    for (const c of this.conns) if (c.mqtt) c.mqtt.onReady = () => this.swarms.forEach((s) => s.announceOn(c));
  }
  /** Join a room. Returns a Swarm: .announce(offers) · .listen() · events 'offer' / 'answer'. */
  swarm(infoHash) {
    if (!this.swarms.has(infoHash)) { const s = new Swarm(this, infoHash); this.swarms.set(infoHash, s); for (const c of this.conns) c.join(s); }
    return this.swarms.get(infoHash);
  }
  close() { this.conns.forEach((c) => c.close()); this.swarms.forEach((s) => s.stop()); this.swarms.clear(); }
}

export class Swarm extends Emitter {
  constructor(sig, infoHash) { super(); this.sig = sig; this.infoHash = infoHash; this.peerId = peerId(); this.pending = []; this.timer = null; }

  announce(offers = []) {
    this.pending = offers;
    dbg('announce', offers.length ? `${offers.length} offer(s)` : 'listen');
    for (const c of this.sig.conns) c.announce(this, offers);
  }
  announceOn(conn) { conn.announce(this, this.pending); }
  /** Stay registered so relays forward incoming offers to us (trackers need periodic announces). */
  listen() { this.announce([]); this.timer = setInterval(() => this.announce([]), 20_000); }
  stop() { clearInterval(this.timer); this.timer = null; }

  gotOffer(offerId, sdp, reply) { dbg('relayed offer'); this.emit('offer', { offerId, sdp, reply }); }
  gotAnswer(offerId, sdp) { dbg('relayed answer'); this.emit('answer', { offerId, sdp }); }
}
