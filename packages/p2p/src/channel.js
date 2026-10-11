// Message channel over an RTCDataChannel: string messages, chunked above 15 KB, with backpressure.
import { Emitter } from './emitter.js';
import { dbg } from './log.js';

const CHUNK = 15000;
const MAX_MESSAGE = 32 * 1024 * 1024;
const HIGH_WATER = 1024 * 1024;

export class Channel extends Emitter {
  /** @param dc RTCDataChannel (browser or node-datachannel polyfill) */
  constructor(dc, pc) {
    super();
    this.dc = dc; this.pc = pc; this.nextId = 1; this.parts = new Map(); this.closed = false;
    this.maxFrame = Infinity; // lowered before authentication to bound what strangers can send
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (ev) => this.#recv(typeof ev.data === 'string' ? ev.data : '');
    dc.onclose = () => this.#closed();
    dc.onerror = () => {};
    // 'disconnected' is often momentary on real networks (Wi-Fi/cellular handoffs): allow time to recover.
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      dbg('connection', st);
      clearTimeout(this.grace);
      if (st === 'failed' || st === 'closed') this.#closed();
      else if (st === 'disconnected') this.grace = setTimeout(() => { if (pc.connectionState === 'disconnected') this.#closed(); }, 20000);
    };
    this.opened = dc.readyState === 'open' ? Promise.resolve() : new Promise((res, rej) => { dc.onopen = () => res(); this.once('close', () => rej(new Error('closed'))); });
  }

  #closed() { if (this.closed) return; this.closed = true; clearTimeout(this.grace); dbg('channel closed'); this.emit('close'); }
  close() { try { this.dc.close(); } catch {} try { this.pc.close(); } catch {} this.#closed(); }

  #recv(frame) {
    if (frame.length > this.maxFrame) return this.close();
    if (frame[0] === '0') return this.emit('message', frame.slice(1));
    if (frame[0] !== '1') return;
    const m = /^1(\d+):(\d+):(\d+):/.exec(frame);
    if (!m) return;
    const [hdr, id, i, n] = [m[0], m[1], +m[2], +m[3]];
    if (n < 1 || n * CHUNK > MAX_MESSAGE || i >= n) return this.close();
    let p = this.parts.get(id);
    if (!p) { if (this.parts.size >= 4) return this.close(); p = { n, got: 0, a: new Array(n) }; this.parts.set(id, p); }
    if (p.a[i] === undefined) { p.a[i] = frame.slice(hdr.length); p.got++; }
    if (p.got === p.n) { this.parts.delete(id); this.emit('message', p.a.join('')); }
  }

  async send(str) {
    if (this.closed) throw new Error('channel closed');
    if (str.length <= CHUNK) return this.#raw('0' + str);
    if (str.length > MAX_MESSAGE) throw new Error('message too large');
    const id = this.nextId++, n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) await this.#raw(`1${id}:${i}:${n}:${str.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }

  async #raw(frame) {
    while (this.dc.bufferedAmount > HIGH_WATER) {
      if (this.closed) throw new Error('channel closed');
      await new Promise((r) => setTimeout(r, 15));
    }
    this.dc.send(frame);
  }
}
