#!/usr/bin/env node
import { Host, LocalServer } from '../src/index.js';
import { hostAlive } from '../src/client.js';
import { MobileManager } from '../src/mobile.js';
import { ScreenOverlay } from '../src/overlay.js';

if (await hostAlive()) { console.log('Minds host already running.'); process.exit(0); }
const host = new Host();
const server = new LocalServer(host);
await server.listen();
host.mobile = new MobileManager(host, server);
await host.mobile.init().catch((e) => console.error('mobile access unavailable:', e.message));
host.start();
const overlay = new ScreenOverlay();
overlay.attach(host);
console.log(`Minds host listening on 127.0.0.1:${server.port} (pid ${process.pid})`);

const bye = async () => { overlay.stop(); host.stop(); host.mobile?.stop(); await server.close(); process.exit(0); };
host.on('shutdown', bye);
process.on('SIGINT', bye); process.on('SIGTERM', bye);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
