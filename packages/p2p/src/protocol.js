// Wire-level messages shared by host and phone. Every signature/MAC covers a labelled,
// delimited string so a signature for one purpose can never be replayed for another.
import { b64u, unb64u, hmac, utf8, text, hex } from './crypto.js';

export const VERSION = 1;
export const PAIR_PREFIX = 'minds://pair/';

export const authMsg = (deviceId, nonceH, nonceP) => `minds/v1/auth|${deviceId}|${nonceH}|${nonceP}`;
export const readyMsg = (deviceId, nonceP, nonceH) => `minds/v1/ready|${deviceId}|${nonceP}|${nonceH}`;
export const pairedMsg = (deviceId, nonceP) => `minds/v1/paired|${deviceId}|${nonceP}`;

/** Proof that the phone saw the QR (knows the one-time secret), bound to both nonces and its keys. */
export async function pairProof(secretB64, nonceH, nonceP, signPub, dhPub) {
  return b64u(await hmac(unb64u(secretB64), `minds/v1/pair|${nonceH}|${nonceP}|${signPub}|${dhPub}`));
}

/**
 * Pairing code. Kept tiny so the QR is chunky and easy to scan: binary [2][expiry s][host id 16][room 16][secret 16]
 * = 53 bytes (~84 chars). The host's public keys are NOT in the code: they arrive over the encrypted channel and are
 * checked against the host id (a hash of them) printed here. Custom relay lists fall back to a JSON form.
 */
export function encodePairing(p) {
  if (p.tr?.length) return PAIR_PREFIX + b64u(utf8(JSON.stringify({ v: 2, id: p.id, r: p.r, s: p.s, t: p.t, tr: p.tr })));
  const out = new Uint8Array(53);
  out[0] = 2; new DataView(out.buffer).setUint32(1, Math.floor(p.t / 1000));
  out.set(unhex(p.id), 5); out.set(unb64u(p.r), 21); out.set(unb64u(p.s), 37);
  return PAIR_PREFIX + b64u(out);
}
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
export function decodePairing(str) {
  const s = String(str || '').trim();
  if (!s.startsWith(PAIR_PREFIX)) throw new Error('That is not a Minds pairing code.');
  let p;
  try {
    const raw = unb64u(s.slice(PAIR_PREFIX.length));
    if (raw[0] === 2 && raw.length === 53) p = { v: 2, t: new DataView(raw.buffer, raw.byteOffset).getUint32(1) * 1000, id: hex(raw.subarray(5, 21)), r: b64u(raw.subarray(21, 37)), s: b64u(raw.subarray(37, 53)) };
    else p = JSON.parse(text(raw));
  } catch { throw new Error('Pairing code is damaged.'); }
  if (p?.v !== 2 || !p.id || !p.r || !p.s || !p.t) throw new Error('Pairing code is not valid for this version.');
  if (Date.now() > p.t) throw new Error('This pairing code has expired. Make a new one on your computer.');
  return p;
}

/** JSON message helper: next message of `type` from a channel, or reject on timeout/close. */
export function nextMessage(ch, type, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); offc(); reject(new Error(`Timed out waiting for ${type}`)); }, ms);
    const off = ch.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === type) { clearTimeout(t); off(); offc(); resolve(m); }
      else if (m.t === 'error' || m.t === 'denied') { clearTimeout(t); off(); offc(); reject(Object.assign(new Error(m.reason || 'Refused'), { fatal: true })); }
    });
    const offc = ch.on('close', () => { clearTimeout(t); off(); offc(); reject(new Error('Connection closed')); });
  });
}
export const sendJson = (ch, obj) => ch.send(JSON.stringify(obj));
