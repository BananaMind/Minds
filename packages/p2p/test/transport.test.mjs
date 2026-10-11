import test from 'node:test';
import assert from 'node:assert/strict';
import { Signaling, dial, listen, newIdentity, exportPub, dhBits, importDhPub, deviceRoom, pairRoom, b64u, rand, sealSdp, openSdp } from '../src/index.js';
import { startDevTracker, startDevBroker } from '../src/dev-tracker.js';
import { RTCPeerConnection as RTC } from 'node-datachannel/polyfill';

const tracker = await startDevTracker();
const broker = await startDevBroker();
test.after(() => { tracker.close(); broker.close(); setTimeout(() => process.exit(0), 100); });

const room = async () => pairRoom(b64u(rand(16)), b64u(rand(16)));

async function roundTrip(endpoints, label) {
  const r = await room();
  const hostSig = new Signaling(endpoints), phoneSig = new Signaling(endpoints);
  const got = new Promise((resolve) => listen({ RTC, signaling: hostSig, room: r, iceServers: [], onChannel: (ch) => { ch.on('message', (m) => { ch.send('echo:' + m.length); resolve(m); }); } }));
  await new Promise((res) => setTimeout(res, 400));
  const ch = await dial({ RTC, signaling: phoneSig, room: r, iceServers: [], timeoutMs: 15000 });
  const reply = new Promise((res) => ch.on('message', res));
  const big = 'z'.repeat(100_000) + label;
  await ch.send(big);
  assert.equal((await got).length, big.length);
  assert.equal(await reply, `echo:${big.length}`);
  ch.close(); hostSig.close(); phoneSig.close();
}

test('data channel via a WebTorrent tracker, including chunked messages', () => roundTrip([tracker.url], 'tracker'));
test('data channel via an MQTT broker, including chunked messages', () => roundTrip([broker.url], 'mqtt'));
test('works when only one of several relays is reachable', () => roundTrip(['ws://127.0.0.1:1', broker.url, 'mqtt+ws://127.0.0.1:1', tracker.url], 'mixed'));

test('relays see only ciphertext, and tampered or wrong-key SDP is rejected', async () => {
  const r = await room(), other = await room();
  const blob = await sealSdp(r, 'offer', 'id1', 'v=0 secret-sdp');
  assert.ok(!blob.includes('secret'));
  assert.equal(await openSdp(r, 'offer', 'id1', blob), 'v=0 secret-sdp');
  assert.equal(await openSdp(other, 'offer', 'id1', blob), null, 'wrong key');
  assert.equal(await openSdp(r, 'offer', 'id2', blob), null, 'wrong offer id (AAD)');
  assert.equal(await openSdp(r, 'answer', 'id1', blob), null, 'wrong kind (AAD)');
  const flipped = blob.slice(0, -2) + (blob.endsWith('A') ? 'BB' : 'AA');
  assert.equal(await openSdp(r, 'offer', 'id1', flipped), null, 'tampered');
});

test('device rooms depend on both static keys (ECDH): an outsider cannot derive them', async () => {
  const host = await newIdentity({ extractable: true }), dev = await newIdentity({ extractable: true }), eve = await newIdentity({ extractable: true });
  const s1 = await dhBits(dev.dh.privateKey, host.dh.publicKey), s2 = await dhBits(host.dh.privateKey, dev.dh.publicKey);
  const a = await deviceRoom('h', 'd', s1), b = await deviceRoom('h', 'd', s2);
  assert.equal(a.infoHash, b.infoHash);
  const sEve = await dhBits(eve.dh.privateKey, host.dh.publicKey);
  const c = await deviceRoom('h', 'd', sEve);
  assert.notDeepEqual(c.sdpKey, a.sdpKey);
  void exportPub; void importDhPub;
});
