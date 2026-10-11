import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { hostFile } from './paths.js';
import { readJson, writeJson } from './store.js';
import { authorize, mayReceive } from './rpc-policy.js';

export const DEFAULT_PORT = 47615;

/**
 * Local transport: a WebSocket on 127.0.0.1 guarded by a token in ~/.minds/host.json.
 * Messages are {id, method, params} -> {id, result|error}; the host pushes {event, data}.
 * Other transports (P2P for mobile) carry the same messages through `attach`.
 */
export class LocalServer {
  constructor(host, { port = Number(process.env.MINDS_PORT) || DEFAULT_PORT } = {}) {
    this.host = host; this.port = port;
    this.token = readJson(hostFile())?.token || crypto.randomBytes(24).toString('base64url');
    this.clients = new Set();
  }

  /** Wire any duplex message channel (ws or data channel) to the host. */
  attach(channel, { authed = false, role = 'local', deviceId = null } = {}) {
    const client = { channel, authed, role, deviceId };
    this.clients.add(client);
    const send = (m) => { try { channel.send(JSON.stringify(m)); } catch {} };
    client.send = send;
    channel.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!client.authed) {
        const ok = msg.method === 'hello' && typeof msg.params?.token === 'string' && safeEq(msg.params.token, this.token);
        if (!ok) { send({ id: msg.id, error: 'unauthorized' }); return channel.close?.(); }
        client.authed = true;
        return send({ id: msg.id, result: { ok: true, pid: process.pid } });
      }
      if (!authorize(client.role, msg.method)) return send({ id: msg.id, error: 'This device is not allowed to do that.' });
      try { send({ id: msg.id, result: await this.host.call(msg.method, msg.params || {}, { role: client.role, deviceId: client.deviceId }) }); }
      catch (e) { send({ id: msg.id, error: e?.message || String(e) }); }
    });
    channel.on('close', () => this.clients.delete(client));
    channel.on('error', () => this.clients.delete(client));
  }

  async listen() {
    this.http = http.createServer((req, res) => { res.writeHead(req.url === '/ping' ? 200 : 404); res.end(req.url === '/ping' ? 'minds' : ''); });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    this.http.on('upgrade', (req, socket, head) => {
      // Browsers can reach localhost; only accept our own app origins or non-browser clients.
      const origin = req.headers.origin;
      if (origin && !/^(file:\/\/|null|app:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(origin)) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });
    this.host.on('event', (event, data) => {
      for (const c of this.clients) if (c.authed && mayReceive(c.role, event)) c.send({ event, data });
    });
    await new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, '127.0.0.1', resolve);
    });
    writeJson(hostFile(), { port: this.port, token: this.token, pid: process.pid, startedAt: Date.now() });
  }

  async close() {
    for (const c of this.clients) c.channel.close?.();
    this.http?.close();
    try { if (readJson(hostFile())?.pid === process.pid) fs.rmSync(hostFile()); } catch {}
  }
}

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
