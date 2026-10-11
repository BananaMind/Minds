// Streaming client for the ChatGPT Codex backend (Responses API over SSE).
import { getCredentials } from '../codex-auth.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

/** Minimal SSE parser: yields {event, data} for each event block. */
async function* sse(body, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        let event = 'message'; const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally { try { reader.cancel(); } catch {} }
}

/**
 * One model request. `input` is Responses-API items. Returns {text, toolCalls, usage}.
 * onText(delta) is called for streaming assistant text.
 */
export async function respond({ model, effort, instructions, input, tools, signal, onText, cacheKey }) {
  const payload = {
    model,
    instructions,
    input,
    tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
    tool_choice: 'auto',
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    reasoning: { effort, summary: 'auto' },
    text: { verbosity: 'medium' },
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
  };

  let res;
  let refreshed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { accessToken, accountId } = await getCredentials({ force: refreshed && attempt > 0 && res?.status === 401 });
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'chatgpt-account-id': accountId,
          'OpenAI-Beta': 'responses=experimental',
          originator: 'codex_cli_rs',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (attempt === 4) throw new Error(`Can't reach ChatGPT (${e.cause?.code || e.message}). Check your internet connection.`);
      await sleep(800 * 2 ** attempt, signal); continue;
    }
    if (res.status === 401 && !refreshed) { refreshed = true; continue; }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1000 * 2 ** attempt, signal); continue; }
    break;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Model request failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }

  let text = '';
  const toolCalls = [];
  const open = new Map(); // item_id -> call being assembled
  let usage = null;

  for await (const { event, data } of sse(res.body, signal)) {
    let d; try { d = JSON.parse(data); } catch { continue; }
    switch (event) {
      case 'response.output_text.delta':
        text += d.delta; onText?.(d.delta); break;
      case 'response.output_item.added':
        if (d.item?.type === 'function_call') open.set(d.item.id, { id: d.item.call_id, name: d.item.name, arguments: '' });
        break;
      case 'response.function_call_arguments.delta':
        if (open.has(d.item_id)) open.get(d.item_id).arguments += d.delta;
        break;
      case 'response.output_item.done':
        if (d.item?.type === 'function_call') {
          const c = open.get(d.item.id) || { id: d.item.call_id, name: d.item.name, arguments: '' };
          c.arguments = d.item.arguments ?? c.arguments;
          toolCalls.push(c); open.delete(d.item.id);
        }
        break;
      case 'response.completed':
        usage = d.response?.usage || null; break;
      case 'response.failed':
        throw new Error(d.response?.error?.message || 'Model response failed');
      case 'error':
        throw new Error(d.message || d.error?.message || 'Model stream error');
    }
  }
  return { text, toolCalls, usage };
}
