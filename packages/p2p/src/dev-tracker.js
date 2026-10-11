// Minimal WebTorrent-compatible tracker for tests and LAN/offline use: relays offers and answers.
import { WebSocketServer } from 'ws';

export function startDevTracker(port = 0) {
  const swarms = new Map(); // info_hash -> Map(peer_id -> ws)
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    const mine = new Set();
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.action !== 'announce' || typeof m.info_hash !== 'string' || typeof m.peer_id !== 'string') return;
      const sw = swarms.get(m.info_hash) || swarms.set(m.info_hash, new Map()).get(m.info_hash);
      sw.set(m.peer_id, ws); mine.add([m.info_hash, m.peer_id]);
      if (m.answer && m.to_peer_id) { sw.get(m.to_peer_id)?.send(JSON.stringify({ action: 'announce', info_hash: m.info_hash, peer_id: m.peer_id, offer_id: m.offer_id, answer: m.answer })); return; }
      for (const o of m.offers || []) {
        for (const [pid, peer] of sw) if (pid !== m.peer_id) peer.send(JSON.stringify({ action: 'announce', info_hash: m.info_hash, peer_id: m.peer_id, offer_id: o.offer_id, offer: o.offer }));
      }
      ws.send(JSON.stringify({ action: 'announce', info_hash: m.info_hash, interval: 120, complete: 0, incomplete: sw.size }));
    });
    ws.on('close', () => { for (const [h, p] of mine) swarms.get(h)?.delete(p); });
  });
  return new Promise((resolve) => wss.on('listening', () => resolve({ url: `ws://127.0.0.1:${wss.address().port}`, close: () => wss.close() })));
}

/** Minimal MQTT 3.1.1 broker over WebSocket (QoS 0, exact-topic subscriptions) for tests. */
export function startDevBroker(port = 0) {
  const subs = new Map(); // topic -> Set(ws)
  const wss = new WebSocketServer({ port, host: '127.0.0.1', handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const varint = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
  wss.on('connection', (ws) => {
    const mine = new Set();
    ws.on('message', (raw) => {
      let b = new Uint8Array(raw);
      while (b.length >= 2) {
        let len = 0, mul = 1, i = 1, d;
        do { d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        const first = b[0], body = b.subarray(i, i + len); b = b.subarray(i + len);
        const type = first >> 4;
        if (type === 1) ws.send(new Uint8Array([0x20, 2, 0, 0]));
        else if (type === 8) {
          const tl = (body[2] << 8) | body[3]; const topic = dec.decode(body.subarray(4, 4 + tl));
          (subs.get(topic) || subs.set(topic, new Set()).get(topic)).add(ws); mine.add(topic);
          ws.send(new Uint8Array([0x90, 3, body[0], body[1], 0]));
        } else if (type === 3) {
          const tl = (body[0] << 8) | body[1]; const topic = dec.decode(body.subarray(2, 2 + tl));
          const out = new Uint8Array([0x30, ...varint(body.length), ...body]);
          for (const peer of subs.get(topic) || []) if (peer.readyState === 1) peer.send(out);
        } else if (type === 12) ws.send(new Uint8Array([0xd0, 0]));
      }
    });
    ws.on('close', () => { for (const t of mine) subs.get(t)?.delete(ws); });
  });
  void enc;
  return new Promise((resolve) => wss.on('listening', () => resolve({ url: `mqtt+ws://127.0.0.1:${wss.address().port}`, close: () => wss.close() })));
}
