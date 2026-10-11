import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-relay-'));
process.env.MINDS_HOME = path.join(tmp, 'home');
process.env.MINDS_CODEX_AUTH = path.join(tmp, 'no-auth');
const { Settings } = await import('../src/settings.js');
const { RelayManager, normalizeRelay } = await import('../src/relay.js');

test('relay settings preserve saved passwords while withholding provider and TURN secrets from clients', () => {
  const settings = new Settings();
  settings.set({ mobileRelay: { provider: 'custom', urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:443?transport=tcp'], username: 'phone', credential: 'private-password' } });
  settings.set({ mobileRelay: { ...settings.public().mobileRelay, username: 'new-phone' } });
  assert.equal(settings.get().mobileRelay.credential, 'private-password');
  assert.equal('credential' in settings.public().mobileRelay, false);
  assert.equal(settings.public().mobileRelay.credentialSaved, true);
  settings.set({ mobileRelay: { provider: 'cloudflare', keyId: 'key-id', apiToken: 'private-api-token' } });
  assert.equal('apiToken' in settings.public().mobileRelay, false);
  assert.equal(settings.public().mobileRelay.tokenSaved, true);
  assert.throws(() => settings.set({ mobileRelay: { provider: 'custom', urls: ['https://relay.example.com'], username: 'phone', credential: 'pass' } }), /STUN\/TURN/);
  assert.equal(settings.get().mobileRelay.provider, 'cloudflare', 'invalid settings leave the saved configuration intact');
  assert.throws(() => normalizeRelay({ provider: 'custom', urls: ['turn:relay.example.com:99999'], username: 'phone', credential: 'pass' }), /port/);
});

test('Cloudflare issues short-lived credentials server-side, caches them and refreshes after configuration changes', async () => {
  const settings = new Settings();
  settings.set({ mobileRelay: { provider: 'cloudflare', keyId: 'cloudflare-key', apiToken: 'server-secret' } });
  let calls = 0;
  const manager = new RelayManager(settings, { fetch: async (url, args) => {
    calls++;
    assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/cloudflare-key/credentials/generate-ice-servers');
    assert.equal(args.headers.Authorization, 'Bearer server-secret');
    assert.equal(JSON.parse(args.body).ttl, 3600);
    return Response.json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password' }] });
  } });
  const [a, b] = await Promise.all([manager.get(), manager.get()]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  assert.ok(a.expiresAt > Date.now());
  assert.equal(JSON.stringify(a).includes('server-secret'), false);
  assert.equal(JSON.stringify(a).includes(':53?'), false);
  await manager.get(); assert.equal(calls, 1);
  manager.clear(); await manager.get(); assert.equal(calls, 2);
  settings.set({ mobileRelay: { provider: 'none' } });
  assert.equal((await manager.get()).expiresAt, undefined);
});
