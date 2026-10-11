// WebCrypto helpers shared by the host (Node) and the phone (WebView). No Node-only imports.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s) => enc.encode(s);
export const text = (b) => dec.decode(b);

export function b64u(bytes) {
  let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = str.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Constant-time comparison. */
export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function sha256(data) { return new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? utf8(data) : data)); }

export async function hmac(keyBytes, data) {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, typeof data === 'string' ? utf8(data) : data));
}

export async function hkdf(ikm, salt, info, len = 32) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, k, len * 8));
}

/** AES-256-GCM. Output = iv(12) || ciphertext+tag. `aad` binds the ciphertext to its context. */
export async function seal(keyBytes, plain, aad) {
  const k = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, typeof plain === 'string' ? utf8(plain) : plain));
  return concat(iv, ct);
}
export async function open(keyBytes, blob, aad) {
  const k = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: aad }, k, blob.subarray(12)));
}

// ---- identities: one ECDSA key (signing) + one ECDH key (static key agreement), both P-256 ----
export async function newIdentity({ extractable = false } = {}) {
  const sign = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify']);
  const dh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, extractable, ['deriveBits']);
  return { sign, dh };
}
export const exportPub = async (key) => b64u(await subtle.exportKey('raw', key));
export const importSignPub = (b) => subtle.importKey('raw', unb64u(b), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
export const importDhPub = (b) => subtle.importKey('raw', unb64u(b), { name: 'ECDH', namedCurve: 'P-256' }, true, []);

/** Serialize an extractable identity (host only) to JWKs. */
export async function exportIdentityJwk(id) {
  return {
    sign: { priv: await subtle.exportKey('jwk', id.sign.privateKey), pub: await subtle.exportKey('jwk', id.sign.publicKey) },
    dh: { priv: await subtle.exportKey('jwk', id.dh.privateKey), pub: await subtle.exportKey('jwk', id.dh.publicKey) },
  };
}
export async function importIdentityJwk(j) {
  const S = { name: 'ECDSA', namedCurve: 'P-256' }, D = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    sign: { privateKey: await subtle.importKey('jwk', j.sign.priv, S, true, ['sign']), publicKey: await subtle.importKey('jwk', j.sign.pub, S, true, ['verify']) },
    dh: { privateKey: await subtle.importKey('jwk', j.dh.priv, D, true, ['deriveBits']), publicKey: await subtle.importKey('jwk', j.dh.pub, D, true, []) },
  };
}

export async function signMsg(privateKey, msg) {
  return b64u(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, typeof msg === 'string' ? utf8(msg) : msg));
}
export async function verifyMsg(publicKey, sigB64, msg) {
  try { return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, unb64u(sigB64), typeof msg === 'string' ? utf8(msg) : msg); } catch { return false; }
}
export async function dhBits(privateKey, publicKey) {
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
}

/** Stable short id for an identity (hash of both public keys). */
export async function fingerprint(signPubB64, dhPubB64) {
  return hex((await sha256(concat(unb64u(signPubB64), unb64u(dhPubB64)))).subarray(0, 16));
}

// ---- signaling rooms ----
const binStr = (bytes) => String.fromCharCode(...bytes);
const SDP_MAX_AGE_MS = 5 * 60_000;

/** One-time pairing room: derived from the random room id `r` and the one-time secret `s` from the QR. */
export async function pairRoom(rB64, secretB64) {
  const r = unb64u(rB64);
  return { infoHash: binStr((await sha256(concat(utf8('minds/v1/pair'), r))).subarray(0, 20)), sdpKey: await hkdf(unb64u(secretB64), r, 'minds/v1/sdp/pair') };
}
/** Long-term room for a paired device, keyed by static ECDH (so relays can't read or forge SDP). */
export async function deviceRoom(hostId, deviceId, shared) {
  const salt = await sha256(utf8(`${hostId}|${deviceId}`));
  return { infoHash: binStr((await sha256(concat(utf8('minds/v1/dev'), salt))).subarray(0, 20)), sdpKey: await hkdf(shared, salt, 'minds/v1/sdp/dev') };
}

/** Encrypt an SDP so tracker relays can neither read nor tamper with it (DTLS fingerprints ride inside). */
export async function sealSdp(room, kind, offerId, sdp) {
  const body = JSON.stringify({ sdp, k: kind, ts: Date.now() });
  return b64u(await seal(room.sdpKey, body, utf8(`${room.infoHash}|${offerId}|${kind}`)));
}
export async function openSdp(room, kind, offerId, blob) {
  try {
    const body = JSON.parse(text(await open(room.sdpKey, unb64u(blob), utf8(`${room.infoHash}|${offerId}|${kind}`))));
    if (body.k !== kind || Math.abs(Date.now() - body.ts) > SDP_MAX_AGE_MS) return null;
    return body.sdp;
  } catch { return null; }
}
