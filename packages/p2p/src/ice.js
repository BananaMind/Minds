export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
export const ICE_REQUEST = 'minds/ice-config/v1';

export function normalizeIceServers(input) {
  if (!Array.isArray(input) || input.length > 12) throw new Error('Invalid relay server list.');
  return input.map((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    if (!urls.length || urls.length > 12) throw new Error('Invalid relay URLs.');
    for (const url of urls) {
      if (typeof url !== 'string' || url.length > 512 || !/^(?:stun|stuns|turn|turns):(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/i.test(url)) throw new Error('Use STUN/TURN URLs such as turns:relay.example.com:443?transport=tcp.');
      const port = url.match(/(?:\]|[a-z0-9.-]):(\d+)(?:\?|$)/i)?.[1];
      if (port && (+port < 1 || +port > 65535)) throw new Error('Invalid relay port.');
    }
    const turn = urls.some((url) => /^turns?:/i.test(url));
    if (turn && (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential)) throw new Error('TURN needs a username and password.');
    if ((server.username?.length || 0) > 512 || (server.credential?.length || 0) > 2048) throw new Error('Relay credentials are too long.');
    return { urls, ...(turn ? { username: server.username, credential: server.credential } : {}) };
  });
}

export const hasTurn = (servers) => servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((url) => /^turns?:/i.test(url)));
