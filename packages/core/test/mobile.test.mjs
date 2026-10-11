import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-mobile-'));
process.env.MINDS_HOME = path.join(tmp, 'home');
process.env.MINDS_CODEX_AUTH = path.join(tmp, 'no-auth.json');

const { Host } = await import('../src/host.js');
const { LocalServer } = await import('../src/server.js');
const { MobileManager } = await import('../src/mobile.js');
const { PhoneClient, memoryStorage } = await import('@minds/p2p/client');
const { startDevTracker } = await import('@minds/p2p/dev-tracker');
const { encodePairing, decodePairing, nextMessage } = await import('@minds/p2p/protocol');
const { Signaling, dial, pairRoom } = await import('@minds/p2p');
const { RTCPeerConnection: RTC } = await import('node-datachannel/polyfill');

const tracker = await startDevTracker();
const host = new Host();
const server = new LocalServer(host, { port: 0 });
await server.listen();
const mobile = new MobileManager(host, server, { trackers: [tracker.url], iceServers: [] });
host.mobile = mobile;
await mobile.init();

const phone = () => new PhoneClient({ RTC, storage: memoryStorage(), iceServers: [] });
const approve = (allow = true) => {
  const fn = (e, d) => { if (e === 'mobile.pairing') setTimeout(() => host.call('mobile.pair.respond', { id: d.id, allow }), 20); };
  host.on('event', fn); return fn;
};
const cleanups = [];
test.after(() => { mobile.stop(); host.stop(); tracker.close(); server.close(); for (const f of cleanups) f(); setTimeout(() => process.exit(0), 100); });

test('phone access is off by default and pairing needs it enabled', async () => {
  assert.equal(host.settings.get().mobileEnabled, false);
  assert.equal(mobile.enabled, false);
  await assert.rejects(host.call('mobile.pair.start'), /Turn on phone access/);
  await host.call('mobile.setEnabled', { enabled: true });
  assert.equal(mobile.enabled, true);
});

const p1 = phone();
let session;

test('pair via QR with desktop approval, then reconnect with the device key', async () => {
  const off = approve(true);
  const { payload, expiresAt } = await host.call('mobile.pair.start');
  assert.ok(payload.startsWith('minds://pair/') && expiresAt > Date.now());
  const record = await p1.pair(payload, 'Test Phone', { timeoutMs: 15000 });
  assert.equal(record.name.length > 0, true);
  assert.ok(Array.isArray((await record.session.call('state')).bots), 'the pairing channel is a live session right away');
  assert.equal('openrouterKey' in (await record.session.call('state')).settings, false);
  assert.equal(mobile.status().devices.length, 1);
  assert.equal(mobile.status().devices[0].name, 'Test Phone');
  assert.equal(mobile.status().pairing, null, 'pairing code is consumed');
  host.removeListener('event', off);

  session = await p1.connect({ timeoutMs: 15000 });
  const state = await session.call('state');
  assert.ok(Array.isArray(state.bots));
  assert.equal('mobile' in state, false, 'phone does not see pairing/device info');
  assert.equal('openrouterKey' in state.settings, false);
});

test('a paired phone is restricted: no settings, keys, sign-in, shutdown, pairing or deletes', async () => {
  for (const [m, params] of [['settings.set', { patch: { openrouterKey: 'x' } }], ['auth.login', {}], ['host.shutdown', {}], ['mobile.status', {}], ['mobile.pair.start', {}], ['mobile.revoke', { deviceId: 'x' }], ['bots.delete', { id: 'x' }]]) {
    await assert.rejects(session.call(m, params), /not allowed|only be changed on the computer/, m);
  }
  const bot = await session.call('bots.create', { name: 'FromPhone' });
  assert.equal(bot.permission, 'default');
  await assert.rejects(session.call('bots.update', { id: bot.id, permission: 'bypass' }), /only be turned on from the computer/);
  assert.equal((await session.call('bots.update', { id: bot.id, permission: 'ask' })).permission, 'ask');
  const hist = await session.call('chat.history', { botId: bot.id });
  assert.ok(hist.items.length >= 1);
  assert.equal(host.settings.get().openrouterKey, '');
});

test('phone created bots never inherit bypass as the default', async () => {
  host.settings.set({ defaultPermission: 'bypass' });
  const bot = await session.call('bots.create', { name: 'Escalation' });
  assert.equal(bot.permission, 'default');
  host.settings.set({ defaultPermission: 'default' });
});

test('approvals from a phone can be turned off', async () => {
  const bot = host.bots.all().find((b) => b.name === 'FromPhone');
  const runner = host.runner(bot.id);
  const item = runner.add({ type: 'approval', tool: 'exec_command', summary: 'rm x', status: 'pending' });
  host.settings.set({ mobileCanApprove: false });
  await assert.rejects(session.call('chat.answer', { botId: bot.id, itemId: item.id, allow: true }), /turned off on the computer/);
  host.settings.set({ mobileCanApprove: true });
  await session.call('chat.answer', { botId: bot.id, itemId: item.id, allow: false });
  assert.equal(host.bots.log(bot.id).get(item.id).status, 'expired'); // nothing was waiting; answer accepted
});

test('events reach the phone, but pairing events stay on the computer', async () => {
  const got = [];
  session.on('event', (e) => got.push(e));
  await host.call('bots.create', { name: 'Eventful' });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(got.includes('bot.created'));
  mobile.emit('mobile.updated', mobile.status());
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(got.some((e) => e.startsWith('mobile.')), false);
});

test('large messages are chunked and reassembled', async () => {
  const bot = host.bots.all()[0];
  const runner = host.runner(bot.id);
  for (let i = 0; i < 40; i++) runner.add({ type: 'assistant', text: 'x'.repeat(5000) + i });
  const hist = await session.call('chat.history', { botId: bot.id, all: true });
  assert.ok(hist.items.length >= 40);
  assert.ok(JSON.stringify(hist).length > 200000);
});

test('a dropped attempt does not burn the pairing code, and a retry succeeds', async () => {
  await host.call('mobile.pair.cancel');
  const { payload } = await host.call('mobile.pair.start');
  const p = decodePairing(payload);
  // a flaky phone: connects, hears hello, then the connection drops
  const sig = new Signaling([tracker.url]);
  const ch = await dial({ RTC, signaling: sig, room: await pairRoom(p.r, p.s), iceServers: [], timeoutMs: 15000 });
  await nextMessage(ch, 'hello'); ch.close(); sig.close();
  await new Promise((r) => setTimeout(r, 600));
  const st = mobile.status().pairing;
  assert.ok(st && st.active === false, 'code is still valid and not stuck "active"');
  const off = approve(true);
  const rec = await phone().pair(payload, 'Retry Phone', { timeoutMs: 15000, attempts: 1 });
  host.removeListener('event', off);
  assert.ok(Array.isArray((await rec.session.call('state')).bots));
  assert.equal(mobile.status().devices.some((d) => d.name === 'Retry Phone'), true);
});

test('only one phone can pair at a time', async () => {
  await host.call('mobile.pair.cancel');
  const { payload } = await host.call('mobile.pair.start');
  let request;
  const asked = new Promise((resolve) => { const fn = (e, d) => { if (e === 'mobile.pairing' && !d.cancelled) { request = d; host.removeListener('event', fn); resolve(); } }; host.on('event', fn); });
  const first = phone().pair(payload, 'First Phone', { timeoutMs: 15000, attempts: 1 });
  await asked;
  await assert.rejects(phone().pair(payload, 'Second Phone', { timeoutMs: 15000, attempts: 1 }), /Another phone is pairing/);
  await host.call('mobile.pair.respond', { id: request.id, allow: true });
  const rec = await first;
  assert.ok(rec.session);
  assert.equal(mobile.status().devices.some((d) => d.name === 'Second Phone'), false);
});

test('the pairing code is compact (easy to scan) and carries no keys or relay list', async () => {
  await host.call('mobile.pair.cancel');
  const prev = mobile.trackers; mobile.trackers = (await import('@minds/p2p')).DEFAULT_TRACKERS;
  const { payload } = await host.call('mobile.pair.start');
  mobile.trackers = prev;
  assert.ok(payload.length < 100, `payload is ${payload.length} chars`);
  const p = decodePairing(payload);
  assert.equal(p.id, mobile.hostId);
  assert.equal(p.tr, undefined);
  await host.call('mobile.pair.cancel');
});

test('a phone refuses a computer whose keys do not match the code it scanned', async () => {
  await host.call('mobile.pair.cancel');
  const { payload } = await host.call('mobile.pair.start');
  const forged = encodePairing({ ...decodePairing(payload), id: 'a'.repeat(32), tr: [tracker.url] });
  await assert.rejects(phone().pair(forged, 'Careful Phone', { timeoutMs: 3000, attempts: 1 }), /Could not reach|not the computer/);
  // right room, wrong claimed host id: build it properly so the host does answer
  const p = decodePairing(payload);
  const wrongId = encodePairing({ id: 'b'.repeat(32), r: p.r, s: p.s, t: p.t, tr: [tracker.url] });
  await assert.rejects(phone().pair(wrongId, 'Careful Phone', { timeoutMs: 15000, attempts: 1 }), /not the computer/);
  await host.call('mobile.pair.cancel');
});

test('declined pairing is refused and no device is added', async () => {
  const before = mobile.status().devices.length;
  const off = approve(false);
  const { payload } = await host.call('mobile.pair.start');
  await assert.rejects(phone().pair(payload, 'Mallory', { timeoutMs: 15000 }), /Declined/);
  host.removeListener('event', off);
  assert.equal(mobile.status().devices.length, before);
});

test('wrong secret, expired code and reused code all fail', async () => {
  await host.call('mobile.pair.cancel');
  const { payload } = await host.call('mobile.pair.start');
  const p = decodePairing(payload);
  // wrong secret: the host cannot even decrypt the offer, so nothing answers
  const forged = encodePairing({ ...p, s: Buffer.from('0123456789abcdef').toString('base64url') });
  await assert.rejects(phone().pair(forged, 'Forger', { timeoutMs: 3000, attempts: 1 }), /Could not reach/);
  // expired
  assert.throws(() => decodePairing(encodePairing({ ...p, t: Date.now() - 1000 })), /expired/);
  // reuse after a successful pairing
  const off = approve(true);
  await phone().pair(payload, 'Second Phone', { timeoutMs: 15000 });
  host.removeListener('event', off);
  await assert.rejects(phone().pair(payload, 'Replay', { timeoutMs: 3000, attempts: 1 }), /Could not reach/);
});

test('revoking a device cuts its session and blocks reconnects', async () => {
  const dev = mobile.status().devices.find((d) => d.name === 'Test Phone');
  const closed = new Promise((r) => session.closed.then(r));
  await host.call('mobile.revoke', { deviceId: dev.id });
  await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('session not closed')), 5000))]);
  await assert.rejects(p1.connect({ timeoutMs: 3000 }), /Could not reach/);
  assert.equal(mobile.status().devices.some((d) => d.id === dev.id), false);
});

test('a phone that was never paired cannot connect even with a copied host record', async () => {
  const stolen = phone();
  const real = (await p1.host());
  await stolen.storage.set('host', { ...real, deviceId: 'ffffffffffffffffffffffffffffffff' });
  await assert.rejects(stolen.connect({ timeoutMs: 3000 }), /Could not reach/);
});

test('turning phone access off disconnects everything and stops listening', async () => {
  const p2devs = mobile.status().devices;
  assert.ok(p2devs.length >= 1);
  await host.call('mobile.setEnabled', { enabled: false });
  assert.equal(mobile.enabled, false);
  assert.equal(host.settings.get().mobileEnabled, false);
});
