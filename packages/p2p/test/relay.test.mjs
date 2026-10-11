import test from 'node:test';
import assert from 'node:assert/strict';
import { listen, requestIceServers, gathered } from '../src/link.js';
import { pairRoom, b64u, rand } from '../src/crypto.js';
import { Emitter } from '../src/emitter.js';

test('relay credentials cross the encrypted signaling room without creating a WebRTC connection', async () => {
  const room = await pairRoom(b64u(rand(16)), b64u(rand(16)));
  const host = new Emitter(), phone = new Emitter(), packets = [];
  const signaling = (swarm) => ({ swarms: new Map(), swarm: () => swarm });
  host.listen = () => {}; host.stop = () => {}; phone.stop = () => {};
  phone.announce = (offers) => {
    for (const offer of offers) {
      packets.push(offer.offer.sdp);
      host.emit('offer', { offerId: offer.offer_id, sdp: offer.offer.sdp, reply: (sdp) => { packets.push(sdp); phone.emit('answer', { offerId: offer.offer_id, sdp }); } });
    }
  };
  const expected = { iceServers: [{ urls: ['turns:relay.example.com:443?transport=tcp'], username: 'private-user', credential: 'private-password' }], expiresAt: Date.now() + 3600_000 };
  const listener = listen({ RTC: class { constructor() { assert.fail('Bootstrap should not need WebRTC'); } }, signaling: signaling(host), room, getIceServers: async () => expected });
  try {
    assert.deepEqual(await requestIceServers({ signaling: signaling(phone), room, timeoutMs: 2000 }), expected);
    assert.ok(packets.length >= 2);
    for (const packet of packets) assert.doesNotMatch(packet, /private-user|private-password|relay\.example/);
    await assert.rejects(requestIceServers({ signaling: signaling(phone), room, signal: AbortSignal.abort() }), { name: 'AbortError' });
  } finally { listener.close(); }
});

test('ICE gathering with TURN waits past the first public candidate until a relay candidate arrives', async () => {
  const pc = { iceGatheringState: 'gathering', localDescription: { sdp: 'candidate typ srflx' } };
  let finished = false;
  const pending = gathered(pc, true, 2000).then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(finished, false, 'the first public candidate must not cut off TURN gathering');
  pc.localDescription.sdp += '\ncandidate typ relay';
  await pending;
  assert.equal(finished, true);
});
