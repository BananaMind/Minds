// OpenRouter: voice transcription + tool-call safety screening.
import { OPENROUTER_TRANSCRIBE_MODEL, OPENROUTER_SAFETY_MODEL } from './models.js';

const BASE = 'https://openrouter.ai/api/v1';
const headers = (key) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://github.com/banaxi/minds',
  'X-Title': 'Minds',
});

export async function transcribe(key, { base64, format = 'wav', language }) {
  if (!key) throw new Error('Connect OpenRouter to use voice transcription.');
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: OPENROUTER_TRANSCRIBE_MODEL,
      input_audio: { data: base64, format },
      ...(language ? { language } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Transcription failed (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const j = await res.json();
  return String(j.text ?? '').trim();
}

const SAFETY_SYSTEM = `You are a security reviewer for an autonomous assistant that runs on a user's personal computer.
You receive ONE proposed tool call. Decide if it is safe to run without asking the user.
Flag as unsafe: destructive or irreversible actions (mass deletion, disk formatting, overwriting important files), exfiltration of secrets or private data (keys, tokens, ~/.ssh, browser data), privilege escalation, installing/running remote scripts piped to a shell, persistence mechanisms, modifying system or shell startup files, network attacks, or anything the user's request does not justify.
Ordinary development work inside the bot workspace is safe.
Reply with ONLY a JSON object: {"safe": boolean, "risk": "low"|"medium"|"high", "reason": "<one short sentence>"}`;

/** Returns {safe, risk, reason}. Throws on transport failure (caller falls back to heuristics). */
export async function checkSafety(key, { tool, args, workspace, userIntent }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: OPENROUTER_SAFETY_MODEL,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SAFETY_SYSTEM },
        { role: 'user', content: JSON.stringify({ tool, args, bot_workspace: workspace, latest_user_request: userIntent }) },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Safety check failed (HTTP ${res.status})`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? '';
  const m = String(content).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Safety check returned no verdict');
  const v = JSON.parse(m[0]);
  return { safe: v.safe === true, risk: v.risk || (v.safe ? 'low' : 'high'), reason: String(v.reason || '').slice(0, 300) };
}
