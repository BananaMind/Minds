// Small in-memory connection log (no secrets, no IPs): shown in the apps when something fails.
const ring = [];
let sink = null;
export function dbg(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const t = new Date(); const p = (n) => String(n).padStart(2, '0');
  const entry = `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} ${line}`;
  ring.push(entry); if (ring.length > 300) ring.shift();
  sink?.(entry);
  if (globalThis.MINDS_P2P_DEBUG || globalThis.process?.env?.MINDS_P2P_DEBUG) console.log('[p2p]', line);
}
export const recentLog = () => ring.slice();
export const clearLog = () => { ring.length = 0; };
export const setLogSink = (fn) => { sink = fn; };
