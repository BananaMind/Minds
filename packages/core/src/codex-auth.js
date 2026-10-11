// ChatGPT / Codex OAuth, same scheme Banana-Code uses: the session lives in
// ~/.codex/auth.json (created by `codex login`) and requests go to the Codex
// backend with a bearer token plus the chatgpt-account-id header.
import fs from 'node:fs';
import spawn from 'cross-spawn';
import { codexAuthFile } from './paths.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';

function readSession() {
  try { return JSON.parse(fs.readFileSync(codexAuthFile(), 'utf8')); } catch { return null; }
}

function jwtExp(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000; } catch { return 0; }
}

function pick(session) {
  const t = session?.tokens || {};
  const accessToken = t.access_token || session?.access_token;
  const accountId = t.account_id || session?.account_id;
  return { accessToken, accountId, refreshToken: t.refresh_token };
}

export function authStatus() {
  const s = readSession();
  const { accessToken, accountId, refreshToken } = pick(s);
  if (!accessToken || !accountId) return { signedIn: false };
  let email = null;
  try { email = JSON.parse(Buffer.from(s.tokens.id_token.split('.')[1], 'base64url').toString()).email || null; } catch {}
  return { signedIn: true, email, canRefresh: Boolean(refreshToken) };
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = readSession();
    const { refreshToken } = pick(session);
    if (!refreshToken) throw new Error('Not signed in to ChatGPT. Open Profile & settings → Sign in with ChatGPT.');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'openid profile email' }),
    });
    if (!res.ok) throw new Error(`ChatGPT session expired (${res.status}). Sign in again from Profile & settings.`);
    const j = await res.json();
    session.tokens = {
      ...session.tokens,
      access_token: j.access_token || session.tokens.access_token,
      id_token: j.id_token || session.tokens.id_token,
      refresh_token: j.refresh_token || session.tokens.refresh_token,
    };
    session.last_refresh = new Date().toISOString();
    const file = codexAuthFile();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(session, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Returns fresh {accessToken, accountId}, refreshing when near expiry (or when forced after a 401). */
export async function getCredentials({ force = false } = {}) {
  let { accessToken, accountId } = pick(readSession());
  if (!accessToken || !accountId) throw new Error('Not signed in to ChatGPT. Open Profile & settings → Sign in with ChatGPT.');
  if (force || jwtExp(accessToken) - Date.now() < 120_000) {
    await refresh();
    ({ accessToken, accountId } = pick(readSession()));
  }
  return { accessToken, accountId };
}

/** Launch the official Codex browser login. Resolves when auth.json appears/changes or times out. */
export function startLogin() {
  const before = fs.existsSync(codexAuthFile()) ? fs.statSync(codexAuthFile()).mtimeMs : 0;
  return new Promise((resolve) => {
    const child = spawn('npx', ['-y', '@openai/codex', 'login'], { stdio: 'ignore', detached: true, windowsHide: true });
    const started = Date.now();
    const timer = setInterval(() => {
      const m = fs.existsSync(codexAuthFile()) ? fs.statSync(codexAuthFile()).mtimeMs : 0;
      if (m > before && authStatus().signedIn) { clearInterval(timer); resolve(authStatus()); }
      else if (Date.now() - started > 5 * 60_000) { clearInterval(timer); resolve(authStatus()); }
    }, 1500);
    child.on('error', () => { clearInterval(timer); resolve({ ...authStatus(), error: 'Could not start sign-in. Install Node.js with npm and make sure npx is on PATH.' }); });
    child.on('exit', (code) => { if (code !== 0 && code !== null) { clearInterval(timer); resolve({ ...authStatus(), error: `Sign-in exited with code ${code}. Run npx -y @openai/codex login in a terminal for details.` }); } });
    child.unref();
  });
}
