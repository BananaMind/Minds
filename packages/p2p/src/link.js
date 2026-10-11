// Establish a WebRTC data channel between two peers via encrypted SDP over tracker signaling.
import { dbg } from './log.js';
import { Channel } from './channel.js';
import { sealSdp, openSdp, b64u, rand } from './crypto.js';
import { ICE_SERVERS, ICE_REQUEST, normalizeIceServers, hasTurn } from './ice.js';

const cands = (sdp) => { const t = [...String(sdp).matchAll(/ typ (\w+)/g)].map((m) => m[1]); return `${t.length} candidates (${[...new Set(t)].join(',') || 'none'})`; };
const watch = (pc, who) => { pc.addEventListener?.('iceconnectionstatechange', () => dbg(who, 'ice', pc.iceConnectionState)); pc.addEventListener?.('connectionstatechange', () => dbg(who, 'conn', pc.connectionState)); };

/** Wait for ICE candidates: done at 'complete', or shortly after a public (srflx) candidate shows up, or at the cap. */
export function gathered(pc, relay = false, ms = relay ? 12000 : 4500) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let timer;
    const finish = () => { clearInterval(timer); resolve(); };
    const check = () => {
      if (pc.iceGatheringState === 'complete') return finish();
      const elapsed = Date.now() - t0;
      if (((relay ? /typ relay/ : /typ srflx/).test(pc.localDescription?.sdp || '') && elapsed > 500) || elapsed >= ms) finish();
    };
    timer = setInterval(check, 150); check();
  });
}
const newPc = (RTC, iceServers) => new RTC({ iceServers });

/** Fetch relay credentials before WebRTC connects, using the encrypted room only its peers know. */
export async function requestIceServers({ signaling, room, timeoutMs = 12000, signal }) {
  signal?.throwIfAborted();
  const swarm = signaling.swarm(room.infoHash), offerId = b64u(rand(12));
  const blob = await sealSdp(room, 'offer', offerId, ICE_REQUEST);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let done = false, timer, retry;
    const finish = (error, value) => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(retry); off(); signal?.removeEventListener('abort', cancelled); swarm.announce([]);
      error ? reject(error) : resolve(value);
    };
    const cancelled = () => finish(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    const off = swarm.on('answer', async (answer) => {
      if (answer.offerId !== offerId || done) return;
      const text = await openSdp(room, 'answer', offerId, answer.sdp);
      if (!text || text.length > 65536 || done) return;
      try {
        const data = JSON.parse(text);
        if (data.error) return finish(new Error('Relay credentials unavailable. Check relay setup on the computer.'));
        finish(null, { iceServers: normalizeIceServers(data.iceServers), expiresAt: Number(data.expiresAt) || null });
      } catch { finish(new Error('Computer returned invalid relay settings.')); }
    });
    timer = setTimeout(() => finish(Object.assign(new Error('Computer did not answer the relay request.'), { code: 'ICE_BOOTSTRAP_TIMEOUT' })), timeoutMs);
    signal?.addEventListener('abort', cancelled, { once: true });
    const send = () => swarm.announce([{ offer_id: offerId, offer: { type: 'offer', sdp: blob } }]);
    retry = setInterval(send, 2500); send();
    if (signal?.aborted) cancelled();
  });
}

/**
 * Phone side. Resolves with a Channel once the data channel is open.
 * `room` = {infoHash, sdpKey}; `RTC` = RTCPeerConnection constructor.
 */
export async function dial({ RTC, signaling, room, iceServers = ICE_SERVERS, timeoutMs = 45000, signal }) {
  signal?.throwIfAborted();
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
    await gathered(pc, hasTurn(iceServers));
    signal?.throwIfAborted();
    dbg('dial: offer ready,', cands(pc.localDescription.sdp));
    const blob = await sealSdp(room, 'offer', offerId, pc.localDescription.sdp);
    const send = () => swarm.announce([{ offer_id: offerId, offer: { type: 'offer', sdp: blob } }]);
    send(); retry = setInterval(send, 5000);

    const ch = new Channel(dc, pc);
    await Promise.race([
      ch.opened,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(hasTurn(iceServers) ? 'Could not connect through the configured relay. Check its credentials and network access.' : 'Could not reach your computer. Check that it is awake; mobile data may require a TURN relay in Phone settings.')), timeoutMs); }),
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
export function listen({ RTC, signaling, room, iceServers = ICE_SERVERS, getIceServers, onChannel, maxPending = 6 }) {
  const swarm = signaling.swarm(room.infoHash);
  let pending = 0;
  const seen = new Set();
  const configs = new Map(), peers = new Set();
  let closed = false;
  const off = swarm.on('offer', async ({ offerId, sdp: blob, reply }) => {
    if (seen.has(offerId) || pending >= maxPending) return;
    const sdp = await openSdp(room, 'offer', offerId, blob);   // wrong key / tampered / stale -> null, no resources used
    if (closed) return;
    if (sdp === ICE_REQUEST) {
      if (!configs.has(offerId)) {
        const promise = (async () => {
          let data;
          try { data = getIceServers ? await getIceServers() : { iceServers }; }
          catch { dbg('relay: credentials unavailable'); data = { error: 'unavailable' }; }
          return sealSdp(room, 'answer', offerId, JSON.stringify(data));
        })();
        configs.set(offerId, promise);
        if (configs.size > 50) configs.delete(configs.keys().next().value);
      }
      const answer = await configs.get(offerId);
      if (!closed) reply(answer);
      return;
    }
    dbg('listen: offer', sdp ? `ok, ${cands(sdp)}` : 'ignored (cannot decrypt)');
    if (!sdp) return;
    if (seen.has(offerId) || pending >= maxPending) return;
    seen.add(offerId); if (seen.size > 200) seen.delete(seen.values().next().value);
    pending++;
    let config;
    try { config = getIceServers ? await getIceServers() : { iceServers }; }
    catch { pending--; dbg('relay: cannot create connection without credentials'); return; }
    if (closed) { pending--; return; }
    let pc;
    try { pc = newPc(RTC, config.iceServers); } catch { pending--; return; }
    peers.add(pc); watch(pc, 'listen');
    let released = false;
    const release = () => { if (!released) { released = true; pending--; } };
    const giveUp = setTimeout(() => { release(); peers.delete(pc); try { pc.close(); } catch {} }, 45000);
    pc.ondatachannel = (ev) => {
      const ch = new Channel(ev.channel, pc);
      ch.on('close', () => peers.delete(pc));
      ch.opened.then(() => { clearTimeout(giveUp); peers.delete(pc); if (closed) ch.close(); else onChannel(ch); }).catch(() => { clearTimeout(giveUp); }).finally(release);
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc, hasTurn(config.iceServers));
      dbg('listen: answering,', cands(pc.localDescription.sdp));
      if (!closed) reply(await sealSdp(room, 'answer', offerId, pc.localDescription.sdp));
    } catch { clearTimeout(giveUp); release(); peers.delete(pc); try { pc.close(); } catch {} }
  });
  swarm.listen();
  return { close() { closed = true; off(); swarm.stop(); signaling.swarms.delete(room.infoHash); for (const pc of peers) { try { pc.close(); } catch {} } peers.clear(); configs.clear(); } };
}
