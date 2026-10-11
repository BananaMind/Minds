// Pairs and reconnects through the REAL public trackers (needs internet). Run: node scripts/p2p-public-check.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-pub-'));
process.env.MINDS_HOME = path.join(tmp, 'home'); process.env.MINDS_CODEX_AUTH = path.join(tmp, 'none');
const { Host, LocalServer, MobileManager } = await import('../packages/core/src/index.js');
const { PhoneClient, memoryStorage } = await import('../packages/p2p/src/client.js');
const { RTCPeerConnection: RTC } = await import('node-datachannel/polyfill');
const host = new Host(); const server = new LocalServer(host, { port: 0 }); await server.listen();
host.mobile = new MobileManager(host, server); await host.mobile.init(); await host.call('mobile.setEnabled', { enabled: true });
host.on('event', (e, d) => e === 'mobile.pairing' && setTimeout(() => host.call('mobile.pair.respond', { id: d.id, allow: true }), 50));
const t0 = Date.now(); const lap = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${m}`);
const { payload } = await host.call('mobile.pair.start'); lap(`pairing code ready (${payload.length} chars)`);
const phone = new PhoneClient({ RTC, storage: memoryStorage() });
await phone.pair(payload, 'Check Phone', { timeoutMs: 40000 }); lap('paired through public trackers');
const s = await phone.connect({ timeoutMs: 40000 }); lap('reconnected with device key');
lap(`state ok: ${(await s.call('state')).bots.length} bots`);
s.close(); host.mobile.stop(); host.stop(); process.exit(0);
