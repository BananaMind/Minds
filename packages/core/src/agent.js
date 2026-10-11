import { respond } from './providers/codex.js';
import { TOOLS, toolByName } from './tools/index.js';
import { clip } from './tools/util.js';
import { review } from './safety.js';
import { systemPrompt } from './prompt.js';
import { newId } from './store.js';

const MAX_STEPS = 60;
const INPUT_CHAR_BUDGET = 500_000;
const KEEP_FULL_TOOL_OUTPUTS = 12;

const stamp = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${d.toLocaleDateString('en-US', { weekday: 'short' })}`;
};

/** Rebuild model input (Responses-API items) from the chat log, as groups so pairs never split. */
export function buildInput(items) {
  const groups = [];
  const toolIdxs = [];
  for (const it of items) {
    if (it.type === 'user') groups.push({ chars: it.text.length, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `[${stamp(it.ts)}] ${it.text}` }] }] });
    else if (it.type === 'assistant' && it.text) groups.push({ chars: it.text.length, items: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: it.text }] }] });
    else if (it.type === 'tool') {
      const out = it.status === 'running' ? '[interrupted: host restarted or turn stopped]' : (it.result ?? '');
      toolIdxs.push(groups.length);
      groups.push({ tool: it, chars: out.length + 200, items: [
        { type: 'function_call', call_id: it.callId, name: it.name, arguments: JSON.stringify(it.args ?? {}) },
        { type: 'function_call_output', call_id: it.callId, output: out },
      ] });
    }
  }
  // Older tool outputs shrink to keep the context bounded.
  for (const gi of toolIdxs.slice(0, Math.max(0, toolIdxs.length - KEEP_FULL_TOOL_OUTPUTS))) {
    const g = groups[gi];
    g.items[1].output = clip(g.items[1].output, 1500);
    g.chars = g.items[1].output.length + 200;
  }
  let total = groups.reduce((n, g) => n + g.chars, 0), start = 0;
  while (total > INPUT_CHAR_BUDGET && start < groups.length - 1) total -= groups[start++].chars;
  return groups.slice(start).flatMap((g) => g.items);
}

export class BotRunner {
  constructor(host, bot, { request = respond } = {}) {
    this.host = host; this.bot = bot;
    this.running = false; this.abort = null;
    this.request = request;
    this.toolActive = false; this.restartRequested = false;
    this.waiters = new Map(); // item id -> resolve(answer)
  }

  get log() { return this.host.bots.log(this.bot.id); }
  get status() {
    if (!this.running) return 'idle';
    return this.waiters.size ? 'waiting' : 'working';
  }

  add(item) {
    const full = { id: newId('m_'), ts: Date.now(), ...item };
    this.log.add(full);
    this.host.emit('message.added', { botId: this.bot.id, item: full });
    this.host.touchBot(this.bot.id);
    return full;
  }
  patch(id, patch) {
    const item = this.log.patch(id, patch);
    if (item) this.host.emit('message.updated', { botId: this.bot.id, id, patch });
    return item;
  }

  /** Add a user message (or a hidden/scheduled one) and make sure a turn is running. */
  submit(text, source = 'desktop', extra = {}) {
    this.add({ type: 'user', text, source, ...extra });
    if (this.running) {
      this.restartRequested = true;
      if (!this.toolActive || this.waiters.size) this.#abortTurn();
    } else this.#kick();
  }

  stop() {
    this.restartRequested = false;
    this.#abortTurn();
  }

  #abortTurn() {
    this.abort?.abort();
    for (const [id, resolve] of this.waiters) resolve({ dismissed: true, stopped: true, id });
  }

  /** Called by chat.answer / chat.approve. Returns false if nothing was waiting. */
  resolve(itemId, answer) {
    const r = this.waiters.get(itemId);
    if (!r) return false;
    r(answer);
    return true;
  }

  #kick() {
    if (this.running) return;
    this.restartRequested = false;
    this.running = true;
    this.host.touchBot(this.bot.id);
    this.#turn()
      .catch((e) => {
        if (e?.name === 'AbortError') { if (!this.restartRequested) this.add({ type: 'notice', text: 'Stopped.' }); }
        else this.add({ type: 'notice', level: 'error', text: e?.message || String(e) });
      })
      .finally(() => {
        this.running = false; this.abort = null; this.toolActive = false;
        for (const it of this.log.items) if (it.type === 'tool' && it.status === 'running') this.patch(it.id, { status: 'error', result: '[interrupted]' });
        this.host.touchBot(this.bot.id);
        if (this.restartRequested) this.#kick();
      });
  }

  async #turn() {
    const host = this.host, bot = this.bot;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const checkpoint = () => {
      if (this.restartRequested) this.#abortTurn();
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };

    for (let step = 0; step < MAX_STEPS; step++) {
      checkpoint();
      const settings = host.settings.get();
      const instructions = systemPrompt({ bot, userName: settings.userName, botDir: host.bots.dir(bot.id), workspace: host.bots.workspace(bot.id), apps: host.plugins.promptSection(bot) });
      const pluginTools = await host.plugins.toolsFor(bot);
      checkpoint();
      const seen = this.log.items.length;
      const liveId = newId('m_');
      let live = '';
      const res = await this.request({
        model: bot.model, effort: bot.effort, instructions,
        input: buildInput(this.log.items), tools: [...TOOLS, ...pluginTools], signal, cacheKey: bot.id,
        onText: (d) => { live += d; host.emit('message.delta', { botId: bot.id, liveId, delta: d }); },
      }).catch((e) => { host.emit('message.discard', { botId: bot.id, liveId }); throw e; });
      if (signal.aborted || this.restartRequested) {
        host.emit('message.discard', { botId: bot.id, liveId });
        checkpoint();
      }

      if (process.env.MINDS_DEBUG) console.error(`[debug] ${bot.name} step ${step}: text=${JSON.stringify(res.text.slice(0, 80))} tools=${res.toolCalls.map((t) => t.name)}`);
      const hasTools = res.toolCalls.length > 0;
      if (res.text.trim()) {
        const item = { id: liveId, ts: Date.now(), type: 'assistant', text: res.text, interim: hasTools };
        this.log.add(item);
        host.emit('message.added', { botId: bot.id, item });
        host.touchBot(bot.id);
      } else if (live) host.emit('message.discard', { botId: bot.id, liveId });

      if (!hasTools) {
        if (this.log.items.slice(seen).some((i) => i.type === 'user')) continue; // user spoke while we were answering
        return;
      }
      for (const call of res.toolCalls) {
        checkpoint();
        this.toolActive = true;
        try { await this.#runTool(call, signal); } finally { this.toolActive = false; }
        checkpoint();
      }
    }
    this.add({ type: 'notice', text: `Paused after ${MAX_STEPS} steps. Send a message to continue.` });
  }

  async #runTool(call, signal) {
    const host = this.host, bot = this.bot;
    const tool = toolByName(call.name) || this.host.plugins.find(call.name, bot);
    let args = {};
    let argError = null;
    try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch (e) { argError = `Invalid JSON arguments: ${e.message}`; }

    const entry = this.add({
      type: 'tool', callId: call.id, name: call.name, args, status: 'running',
      summary: tool?.summarize ? safeStr(() => tool.summarize(args)) : '',
      ...(tool?.pluginName ? { plugin: tool.pluginName } : {}),
    });
    const finish = (status, result, extra = {}) => this.patch(entry.id, { status, result: clip(result, 60000), durationMs: Date.now() - entry.ts, ...extra });

    if (!tool) return finish('error', `Unknown tool: ${call.name}`);
    if (argError) return finish('error', argError);

    const ctx = {
      bot, host, signal,
      workspace: host.bots.workspace(bot.id),
      askUser: (q) => this.#ask(q, signal),
    };

    try {
      const intent = [...this.log.items].reverse().find((i) => i.type === 'user' && !i.hidden)?.text ?? '';
      const verdict = await review(ctx, call.name, args, { mode: bot.permission || host.settings.get().defaultPermission, openrouterKey: host.settings.get().openrouterKey, userIntent: intent });
      if (this.restartRequested || signal.aborted) return finish('denied', '[superseded or stopped before execution]');
      if (verdict.safety.source !== 'skipped') this.patch(entry.id, { safety: verdict.safety });
      if (verdict.action === 'ask') {
        const decision = await this.#approve({ tool: call.name, summary: entry.summary, reason: verdict.safety.reason, risk: verdict.safety.risk, callId: call.id });
        if (!decision.allow) return finish('denied', `The user declined this action${decision.stopped ? ' (stopped)' : ''}. Do not retry it; tell the user what you could not do.`);
        this.patch(entry.id, { safety: { ...verdict.safety, approvedByUser: true } });
      }
      if (this.restartRequested || signal.aborted) return finish('denied', '[superseded or stopped before execution]');
      const out = await tool.run(ctx, args);
      finish('ok', typeof out === 'string' ? out : JSON.stringify(out));
    } catch (e) {
      if (signal.aborted) { finish('error', '[stopped by user]'); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
      finish('error', `Error: ${e?.message || e}`);
    }
  }

  #wait(item) {
    return new Promise((resolve) => {
      if (this.restartRequested || this.abort?.signal.aborted) { resolve({ dismissed: true, stopped: true, id: item.id }); return; }
      const done = (v) => { this.waiters.delete(item.id); this.host.touchBot(this.bot.id); resolve(v); };
      this.waiters.set(item.id, done);
      this.host.touchBot(this.bot.id);
    });
  }

  async #ask({ question, detail, options }, signal) {
    const item = this.add({ type: 'question', question, detail: detail || '', options, status: 'pending' });
    const ans = await this.#wait(item);
    if (ans.dismissed) this.patch(item.id, { status: 'dismissed' });
    else this.patch(item.id, { status: 'answered', answer: ans.text });
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return ans;
  }

  async #approve({ tool, summary, reason, risk }) {
    const item = this.add({ type: 'approval', tool, summary, reason, risk, status: 'pending' });
    const ans = await this.#wait(item);
    this.patch(item.id, { status: ans.allow ? 'allowed' : 'denied' });
    return ans.stopped ? { allow: false, stopped: true } : ans;
  }
}

const safeStr = (fn) => { try { return String(fn() ?? '').slice(0, 300); } catch { return ''; } };
