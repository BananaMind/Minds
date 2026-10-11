// Node client for the host protocol (used by the CLI and tests).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { hostFile } from './paths.js';
import { readJson } from './store.js';

export function readHostInfo() { return readJson(hostFile()); }

export async function hostAlive(info = readHostInfo()) {
  if (!info) return false;
  try { return (await fetch(`http://127.0.0.1:${info.port}/ping`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

/** Start the daemon detached if it isn't already running. */
export async function ensureHost() {
  if (await hostAlive()) return readHostInfo();
  const bin = fileURLToPath(new URL('../bin/mindsd.js', import.meta.url));
  // ELECTRON_RUN_AS_NODE: when the GUI (Electron) starts the host, run it as plain Node, not a second app.
  const child = spawn(process.execPath, [bin], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  let startError;
  child.on('error', (e) => { startError = e; });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (startError) throw new Error(`Could not start the Minds host: ${startError.message}`);
    await new Promise((r) => setTimeout(r, 150));
    if (await hostAlive()) return readHostInfo();
  }
  throw new Error('Could not start the Minds host.');
}

export class MindsClient {
  constructor() { this.nextId = 1; this.pending = new Map(); this.listeners = new Set(); }

  static async connect({ autostart = true } = {}) {
    const info = autostart ? await ensureHost() : readHostInfo();
    if (!info) throw new Error('Minds host is not running.');
    const c = new MindsClient();
    await c.#open(info);
    return c;
  }

  #open(info) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${info.port}`);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.event) { for (const l of this.listeners) l(m.event, m.data); return; }
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      });
      this.ws.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('Disconnected from host')); this.pending.clear(); this.onclose?.(); });
      this.ws.on('error', reject);
      this.ws.on('open', () => this.call('hello', { token: info.token }).then(resolve, reject));
    });
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  close() { this.ws.close(); }
}
