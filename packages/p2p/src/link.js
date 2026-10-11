// Establish a WebRTC data channel between two peers via encrypted SDP over tracker signaling.
import { dbg } from './log.js';
import { Channel } from './channel.js';
import { sealSdp, openSdp, b64u, rand } from './crypto.js';

const cands = (sdp) => { const t = [...String(sdp).matchAll(/ typ (\w+)/g)].map((m) => m[1]); return `${t.length} candidates (${[...new Set(t)].join(',') || 'none'})`; };
const watch = (pc, who) => { pc.addEventListener?.('iceconnectionstatechange', () => dbg(who, 'ice', pc.iceConnectionState)); pc.addEventListener?.('connectionstatechange', () => dbg(who, 'conn', pc.connectionState)); };

export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

/** Wait for ICE candidates: done at 'complete', or shortly after a public (srflx) candidate shows up, or at the cap. */
function gathered(pc, ms = 4500) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let timer;
    const finish = () => { clearInterval(timer); resolve(); };
    const check = () => {
      if (pc.iceGatheringState === 'complete') return finish();
      const elapsed = Date.now() - t0;
      if ((/typ srflx/.test(pc.localDescription?.sdp || '') && elapsed > 500) || elapsed >= ms) finish();
    };
    timer = setInterval(check, 150); check();
  });
}
const newPc = (RTC, iceServers) => new RTC({ iceServers });

/**
 * Phone side. Resolves with a Channel once the data channel is open.
 * `room` = {infoHash, sdpKey}; `RTC` = RTCPeerConnection constructor.
 */
export async function dial({ RTC, signaling, room, iceServers = ICE_SERVERS, timeoutMs = 45000, signal }) {
  timeoutMs ||= 45000;
  const pc = newPc(RTC, iceServers);
  watch(pc, 'dial');
  const dc = pc.createDataChannel('minds', { ordered: true });
  const swarm = signaling.swarm(room.infoHash);
  const offerId = b64u(rand(12));
  let timer, retry;
  const cleanup = () => { clearTimeout(timer); clearInterval(retry); off(); };
  const off = swarm.on('answer', async (a) => {
    if (a.offerId !== offerId) return;
    const sdp = await openSdp(room, 'answer', offerId, a.sdp);
    dbg('dial: answer', sdp ? `ok, ${cands(sdp)}` : 'could not be decrypted');
    if (!sdp) return;
    try { await pc.setRemoteDescription({ type: 'answer', sdp }); } catch {}
  });

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    dbg('dial: offer ready,', cands(pc.localDescription.sdp));
    const blob = await sealSdp(room, 'offer', offerId, pc.localDescription.sdp);
    const send = () => swarm.announce([{ offer_id: offerId, offer: { type: 'offer', sdp: blob } }]);
    send(); retry = setInterval(send, 5000);

    const ch = new Channel(dc, pc);
    await Promise.race([
      ch.opened,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Could not reach your computer. Is it on, with Minds running?')), timeoutMs); }),
      new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('cancelled')), { once: true })),
    ]);
    cleanup(); swarm.announce([]);
    return ch;
  } catch (e) { cleanup(); try { pc.close(); } catch {} throw e; }
}

/**
 * Host side. Answers offers that decrypt under `room`; hands each new Channel to onChannel.
 * Returns {close()}.
 */
export function listen({ RTC, signaling, room, iceServers = ICE_SERVERS, onChannel, maxPending = 6 }) {
  const swarm = signaling.swarm(room.infoHash);
  let pending = 0;
  const seen = new Set();
  const off = swarm.on('offer', async ({ offerId, sdp: blob, reply }) => {
    if (seen.has(offerId) || pending >= maxPending) return;
    const sdp = await openSdp(room, 'offer', offerId, blob);   // wrong key / tampered / stale -> null, no resources used
    dbg('listen: offer', sdp ? `ok, ${cands(sdp)}` : 'ignored (cannot decrypt)');
    if (!sdp) return;
    seen.add(offerId); if (seen.size > 200) seen.delete(seen.values().next().value);
    pending++;
    const pc = newPc(RTC, iceServers); watch(pc, 'listen');
    const giveUp = setTimeout(() => { try { pc.close(); } catch {} }, 30000);
    pc.ondatachannel = (ev) => {
      clearTimeout(giveUp);
      const ch = new Channel(ev.channel, pc);
      ch.opened.then(() => onChannel(ch)).catch(() => {}).finally(() => { pending--; });
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      dbg('listen: answering,', cands(pc.localDescription.sdp));
      reply(await sealSdp(room, 'answer', offerId, pc.localDescription.sdp));
    } catch { clearTimeout(giveUp); pending--; try { pc.close(); } catch {} }
  });
  swarm.listen();
  return { close() { off(); swarm.stop(); signaling.swarms.delete(room.infoHash); } };
}
