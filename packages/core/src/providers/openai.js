// Chat Completions adapter for local and hosted OpenAI-compatible servers.
import { randomUUID } from 'node:crypto';

export function normalizeConfig(input, previous = {}) {
  const url = new URL(String(input.baseUrl ?? previous.baseUrl ?? 'http://localhost:11434/v1').trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API base URL without embedded credentials.');
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '') || '/v1';
  const apiKey = input.apiKey === undefined ? (previous.apiKey || '') : String(input.apiKey).trim();
  if (/[\r\n]/.test(apiKey)) throw new Error('Invalid API key.');
  const models = [...new Set((Array.isArray(input.models) ? input.models : String(input.models ?? previous.models?.join('\n') ?? '').split(/[\n,]+/)).map(x => String(x).trim()).filter(Boolean))];
  if (models.length > 200 || models.some(x => !validModel(x))) throw new Error('Use valid model IDs (one per line).');
  return { baseUrl: url.href.replace(/\/$/, ''), apiKey, models, tools: input.tools === undefined ? previous.tools !== false : Boolean(input.tools) };
}
export const validModel = (id) => typeof id === 'string' && Boolean(id.trim()) && id.length <= 200 && !/[\x00-\x1f]/.test(id);
const headers = (config) => ({ 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) });
async function check(response, config) {
  if (response.ok) return;
  let detail = (await response.text()).slice(0, 600);
  if (config.apiKey) detail = detail.split(config.apiKey).join('[redacted]');
  throw new Error(`Compatible API returned HTTP ${response.status}: ${detail}`);
}
export async function listModels(config) {
  const response = await fetch(`${config.baseUrl}/models`, { headers: headers(config), redirect: 'error', signal: AbortSignal.timeout(15000) });
  await check(response, config);
  const data = await response.json();
  if (!Array.isArray(data.data)) throw new Error('The server did not return an OpenAI-compatible model list. Enter model IDs manually.');
  return [...new Set(data.data.map(x => x.id).filter(validModel))].sort();
}
export function chatMessages(instructions, input) {
  const messages = [{ role: 'system', content: instructions }];
  for (const item of input) {
    if (item.type === 'message') messages.push({ role: item.role, content: item.content.map(x => x.text || '').join('\n') });
    else if (item.type === 'function_call') messages.push({ role: 'assistant', content: null, tool_calls: [{ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }] });
    else if (item.type === 'function_call_output') messages.push({ role: 'tool', tool_call_id: item.call_id, content: String(item.output) });
  }
  return messages;
}
export async function respond({ model, instructions, input, tools, signal, onText, config }) {
  const payload = { model, messages: chatMessages(instructions, input), stream: true };
  if (config.tools !== false && tools.length) payload.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: headers(config), redirect: 'error', body: JSON.stringify(payload), signal });
  await check(response, config);
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Compatible API error');
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('The server returned no assistant message.');
    const text = message.content || ''; onText?.(text);
    return { text, toolCalls: (message.tool_calls || []).map(c => ({ id: c.id || randomUUID(), name: c.function.name, arguments: c.function.arguments || '{}' })), usage: data.usage || null };
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', usage = null, finished = false;
  const calls = new Map();
  const consume = (block) => {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { finished = true; return; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(chunk.error.message || 'Compatible API stream error');
    usage = chunk.usage || usage;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const delta = choice?.delta || {};
    if (typeof delta.content === 'string') { text += delta.content; onText?.(delta.content); }
    for (const call of delta.tool_calls || []) {
      const key = call.index ?? 0;
      const current = calls.get(key) || { id: '', name: '', arguments: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
      calls.set(key, current);
    }
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) { consume(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length); }
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!finished) throw new Error('The model stream ended early. Try again.');
  return { text, toolCalls: [...calls.values()].map(c => ({ ...c, id: c.id || randomUUID(), arguments: c.arguments || '{}' })), usage };
}
