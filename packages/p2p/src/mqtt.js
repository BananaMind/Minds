import { dbg } from './log.js';
// Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only): just enough to publish/subscribe opaque
// signaling messages through public brokers. Browser- and Node-compatible (global WebSocket).
const enc = new TextEncoder();
const dec = new TextDecoder();

const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const varint = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
const packet = (first, body) => { const b = body instanceof Uint8Array ? body : new Uint8Array(body); const h = [first, ...varint(b.length)]; const out = new Uint8Array(h.length + b.length); out.set(h); out.set(b, h.length); return out; };

export class MqttConn {
  /** @param url 'mqtt+wss://host:port/path' · onMessage(topic, payloadString) */
  constructor(url, onMessage) {
    this.url = url; this.wsUrl = url.replace(/^mqtt\+/, ''); this.onMessage = onMessage;
    this.ws = null; this.ready = false; this.closed = false; this.retry = 0; this.buf = new Uint8Array(0);
    this.topics = new Set(); this.queue = []; this.pid = 1; this.ping = null;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    try { this.ws = new WebSocket(this.wsUrl, 'mqtt'); } catch { return this.later(); }
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      const cid = 'minds-' + [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('');
      this.ws.send(packet(0x10, [...str('MQTT'), 4, 2, 0, 30, ...str(cid)]));
    };
    this.ws.onmessage = (ev) => this.#data(new Uint8Array(ev.data));
    this.ws.onclose = () => { dbg('mqtt closed', this.url); this.ready = false; clearInterval(this.ping); this.later(); };
    this.ws.onerror = () => {};
  }
  later() { if (this.closed) return; setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 30000)); }

  #data(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0, mul = 1, i = 1, d;
      do { if (i >= this.buf.length) return; d = this.buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128 && i < 5);
      if (this.buf.length < i + len) return;
      const first = this.buf[0], body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.#packet(first, body);
    }
  }
  #packet(first, body) {
    const type = first >> 4;
    if (type === 2) { // CONNACK
      if (body[1] !== 0) { dbg('mqtt refused', this.url, body[1]); return this.ws.close(); }
      this.ready = true; this.retry = 0; dbg('mqtt connected', this.url);
      for (const t of this.topics) this.#subscribe(t);
      for (const m of this.queue.splice(0)) this.ws.send(m);
      this.ping = setInterval(() => { try { this.ws.send(new Uint8Array([0xc0, 0])); } catch {} }, 15000);
      this.onReady?.();
    } else if (type === 3) { // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const off = 2 + tl + (((first >> 1) & 3) > 0 ? 2 : 0);
      this.onMessage(topic, dec.decode(body.subarray(off)));
    }
  }
  #subscribe(topic) { this.ws.send(packet(0x82, [this.pid >> 8, this.pid++ & 255, ...str(topic), 0])); }
  subscribe(topic) { this.topics.add(topic); if (this.ready) this.#subscribe(topic); }
  unsubscribe(topic) { this.topics.delete(topic); }
  publish(topic, payload) {
    const p = packet(0x30, [...str(topic), ...enc.encode(payload)]);
    if (this.ready) this.ws.send(p); else if (this.queue.length < 20) this.queue.push(p);
  }
  close() { this.closed = true; clearInterval(this.ping); try { this.ws?.close(); } catch {} }
}
