import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-uiapi-'));
process.env.MINDS_HOME = path.join(tmp, 'home');
process.env.MINDS_CODEX_AUTH = path.join(tmp, 'none');
const { Host } = await import('../src/host.js');
const { LocalServer } = await import('../src/server.js');

const host = new Host();
const server = new LocalServer(host, { port: 0 });
await server.listen();
const port = server.http.address().port;
globalThis.window = { minds: { hostInfo: async () => ({ port, token: server.token }) } };
const { createApi } = await import('../../ui/src/api.js');
test.after(() => { server.close(); host.stop(); setTimeout(() => process.exit(0), 50); });

test('a UI that subscribes AFTER the socket connected still gets "connected" (no stuck "Connecting…")', async () => {
  const api = createApi();
  await new Promise((resolve) => api.onStatus((s) => s === 'connected' && resolve()));
  await new Promise((r) => setTimeout(r, 50));            // the app subscribes late, like a slow first render
  const got = await new Promise((resolve) => { api.on((e) => e === 'connected' && resolve(true)); setTimeout(() => resolve(false), 1000); });
  assert.equal(got, true);
  const state = await api.call('state');
  assert.ok(Array.isArray(state.bots));
  api.close();
});

test('a UI that subscribes before connecting also gets it exactly once per connection', async () => {
  const api = createApi();
  let n = 0;
  api.on((e) => { if (e === 'connected') n++; });
  await new Promise((resolve) => api.onStatus((s) => s === 'connected' && resolve()));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(n, 1);
  api.close();
});
