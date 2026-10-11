// Google OAuth 2.0 for installed apps: authorization code + PKCE with a one-shot loopback redirect.
// The user brings their own OAuth client (Google Cloud Console), so Minds ships no Google credentials.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { request, PluginError } from './http.js';
import { powerShellArgs } from '../windows.js';

export const AUTH_URL = () => process.env.MINDS_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = () => process.env.MINDS_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;background:#0b0b0b;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px;text-align:center"><h2>${esc(title)}</h2><p style="color:#aaa">${esc(body)}</p></div>`;

/** Open a URL in the user's browser (best effort; the URL is also returned to the UI). */
export function openExternal(url) {
  try {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['powershell.exe', powerShellArgs('Start-Process -FilePath $env:MINDS_BROWSER_URL')] : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, MINDS_BROWSER_URL: url } });
    child.on('error', () => {});
    child.unref();
  } catch { /* the UI shows the link as well */ }
}

/**
 * Start the sign-in. Returns {url, done, cancel}. `done` resolves with
 * {accessToken, refreshToken, expiresAt, scope} after the user approves in the browser.
 */
export async function startLoopbackAuth({ clientId, clientSecret, scopes, openBrowser = openExternal, timeoutMs = 5 * 60_000, loginHint }) {
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));
  let finish, fail, closed = false;
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  done.catch(() => {});

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/oauth2callback') { res.writeHead(404); return res.end(); }
    const reply = (code, title, msg) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(page(title, msg)); };
    if (u.searchParams.get('state') !== state) return reply(400, 'Sign-in failed', 'This sign-in link did not match. Please start again from Minds.');
    const err = u.searchParams.get('error');
    if (err) { reply(400, 'Sign-in cancelled', err === 'access_denied' ? 'You declined access.' : err); return stop(new PluginError(err === 'access_denied' ? 'You declined access in Google.' : `Google sign-in failed: ${err}`)); }
    const code = u.searchParams.get('code');
    if (!code) return reply(400, 'Sign-in failed', 'No authorization code was returned.');
    try {
      const t = await request(TOKEN_URL(), { method: 'POST', form: { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect(), grant_type: 'authorization_code', code_verifier: verifier } });
      if (!t.refresh_token) throw new PluginError('Google did not return a refresh token. Remove Minds from your Google account permissions and try again.');
      reply(200, 'Connected to Minds', 'You can close this tab and go back to Minds.');
      stop(null, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, scope: t.scope });
    } catch (e) { reply(500, 'Sign-in failed', e.message); stop(e); }
  });

  const timer = setTimeout(() => stop(new PluginError('Sign-in timed out. Start again when you are ready.')), timeoutMs);
  function stop(error, value) {
    if (closed) return;
    closed = true; clearTimeout(timer);
    server.close(); server.closeAllConnections?.();
    error ? fail(error) : finish(value);
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = () => `http://127.0.0.1:${server.address().port}/oauth2callback`;

  const url = `${AUTH_URL()}?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirect(), response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', code_challenge: challenge, code_challenge_method: 'S256', state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  })}`;
  openBrowser(url);
  return { url, done, cancel: () => stop(new PluginError('Sign-in cancelled.')) };
}

/** Exchange a refresh token for a new access token. Throws code:'reauth' when Google revoked/expired it. */
export async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  try {
    const t = await request(TOKEN_URL(), { method: 'POST', form: { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' } });
    return { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 };
  } catch (e) {
    if (e.status === 400 || e.status === 401) throw new PluginError('Your Google sign-in expired or was revoked. Reconnect Gmail in Connect apps.', { code: 'reauth' });
    throw e;
  }
}
