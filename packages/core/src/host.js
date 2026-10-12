import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { MINDS_HOME } from './paths.js';
import { Settings } from './settings.js';
import { BotStore } from './bots.js';
import { BotRunner, supportsImages, botSpeed } from './agent.js';
import { saveImages } from './images.js';
import { Scheduler } from './scheduler.js';
import { listModels, validModel } from './providers/openai.js';
import { authStatus, startLogin } from './codex-auth.js';
import { getUsage, getResets, redeemReset } from './usage.js';
import { unsupportedSpeeds, speedSupported } from './catalog.js';
import { transcribe } from './openrouter.js';
import { MODELS, EFFORTS, isModel, isEffort, OPENROUTER_TRANSCRIBE_MODEL, OPENROUTER_SAFETY_MODEL } from './models.js';
import { TOOLS } from './tools/index.js';
import { PERMISSION_MODES, isPermission } from './permissions.js';
import { recentLog } from '@bananamind/minds-p2p';
import { PluginManager } from './plugins/manager.js';

const VISIBLE = (i) => (i.type === 'assistant' && !i.interim && i.text) || i.type === 'question' || i.type === 'approval' || (i.type === 'user' && !i.hidden) || i.type === 'notice';

/**
 * The Minds host: owns bots, runs agents and schedules, and exposes one RPC
 * surface (`call`) that every client (desktop GUI, CLI, mobile over P2P) uses.
 */
export class Host extends EventEmitter {
  constructor() {
    super();
    fs.mkdirSync(MINDS_HOME, { recursive: true, mode: 0o700 });
    this.settings = new Settings();
    this.bots = new BotStore();
    this.plugins = new PluginManager(this);
    this.runners = new Map();
    this.#recover();
    this.scheduler = new Scheduler((s) => this.#fireSchedule(s), (e, d) => this.emit(e, d));
  }

  emit(event, data) { return super.emit('event', event, data); }
  start() { this.plugins.init().catch((e) => console.error('plugins:', e.message)); this.scheduler.start(); }
  stop() { this.scheduler.stop(); for (const r of this.runners.values()) r.stop(); this.plugins.stop().catch(() => {}); }

  /** Items left pending/running by a previous process can never resume. */
  #recover() {
    for (const bot of this.bots.all()) {
      const log = this.bots.log(bot.id);
      for (const it of log.items) {
        if ((it.type === 'question' || it.type === 'approval') && it.status === 'pending') log.patch(it.id, { status: 'expired' });
        if (it.type === 'tool' && it.status === 'running') log.patch(it.id, { status: 'error', result: '[interrupted: host restarted]' });
      }
    }
  }

  runner(id) {
    const bot = this.bots.get(id);
    if (!bot) throw new Error('Unknown bot');
    if (!this.runners.has(id)) this.runners.set(id, new BotRunner(this, bot));
    return this.runners.get(id);
  }

  #fireSchedule(s) {
    if (!this.bots.get(s.botId)) return this.scheduler.remove(s.id);
    this.runner(s.botId).submit(`[Scheduled: ${s.name}] ${s.prompt}`, 'schedule', { scheduleName: s.name });
  }

  view(bot) {
    const log = this.bots.log(bot.id);
    const runner = this.runners.get(bot.id);
    let last = null, unread = 0;
    for (let i = log.items.length - 1; i >= 0; i--) {
      const it = log.items[i];
      if (!VISIBLE(it)) continue;
      if (!last) last = { type: it.type, text: it.type === 'question' ? it.question : it.type === 'approval' ? `Approval needed: ${it.summary}` : it.text || (it.images?.length ? 'Image' : ''), ts: it.ts };
      if (it.ts <= (bot.lastReadTs || 0)) break;
      if (it.type === 'assistant' || (it.type === 'question' && it.status === 'pending') || (it.type === 'approval' && it.status === 'pending')) unread++;
    }
    return {
      id: bot.id, name: bot.name, icon: bot.icon, model: bot.model, provider: bot.provider || 'codex', effort: bot.effort, speed: botSpeed(bot),
      permission: bot.permission || this.settings.get().defaultPermission,
      plugins: bot.plugins || [],
      createdAt: bot.createdAt, lastActivity: bot.lastActivity,
      status: runner?.status || 'idle', unread, last,
      schedules: this.scheduler.list(bot.id).filter((s) => s.enabled).length,
    };
  }

  touchBot(id) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.lastActivity = Date.now();
    this.bots.save(bot);
    this.emit('bot.updated', { bot: this.view(bot) });
  }

  #greetingFallback(bot) {
    const runner = this.runner(bot.id);
    runner.add({ type: 'assistant', text: `Hi ${this.settings.get().userName}, I'm ${bot.name}. Connect your ChatGPT account (bottom left) and I'll be ready to go.` });
  }

  /** The RPC surface. */
  async call(method, p = {}, ctx = { role: 'local' }) {
    const remote = ctx.role !== 'local';
    if (method.startsWith('mobile.') && remote) throw new Error('Phone settings can only be changed on the computer.');
    if (method.startsWith('plugins.') && remote) throw new Error('Apps can only be managed on the computer.');
    switch (method) {
      case 'state': return {
        bots: this.bots.all().map((b) => this.view(b)), settings: this.settings.public(), auth: authStatus(),
        models: [...MODELS.map(m => ({ ...m, provider: 'codex' })), ...(this.settings.get().openai?.models || []).map(id => ({ id, name: id, provider: 'openai', hint: 'Compatible API' }))], efforts: EFFORTS, permissions: PERMISSION_MODES, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        voice: { model: OPENROUTER_TRANSCRIBE_MODEL }, safety: { model: OPENROUTER_SAFETY_MODEL },
        schedules: this.scheduler.list(),
        ...(remote ? {} : { mobile: this.mobile?.status() ?? null }),
      };

      case 'plugins.list': return { plugins: await this.plugins.list() };
      case 'plugins.connect': return this.plugins.connect(p.id, p.fields);
      case 'plugins.importLocal': return this.plugins.importLocal(p.id);
      case 'plugins.oauthStart': return this.plugins.oauthStart(p.id, p.fields);
      case 'plugins.oauthCancel': return this.plugins.oauthCancel(p.id);
      case 'plugins.disconnect': return this.plugins.disconnect(p.id);
      case 'plugins.configure': return this.plugins.configure(p.id, p.patch);
      case 'plugins.setBotAccess': return this.plugins.setBotAccess(p.botId, p.id, Boolean(p.enabled));
      case 'plugins.registry': return { results: await this.plugins.registrySearch(p.q) };
      case 'plugins.install': return this.plugins.install(p);
      case 'plugins.uninstall': return this.plugins.uninstall(p.id);
      case 'plugins.refresh': return this.plugins.refresh(p.id, p.fields);

      case 'mobile.status': return this.mobile.status();
      case 'mobile.log': return { log: recentLog() };
      case 'mobile.relay.test': return this.mobile.testRelay();
      case 'mobile.setEnabled': {
        this.settings.set({ mobileEnabled: Boolean(p.enabled) });
        if (p.enabled) await this.mobile.start(); else this.mobile.stop();
        this.emit('settings.updated', { settings: this.settings.public() });
        return this.mobile.status();
      }
      case 'mobile.pair.start': return this.mobile.startPairing();
      case 'mobile.pair.cancel': this.mobile.cancelPairing(); return { ok: true };
      case 'mobile.pair.respond': this.mobile.respond(p.id, p.allow); return { ok: true };
      case 'mobile.revoke': this.mobile.revoke(p.deviceId); return { ok: true };

      case 'host.shutdown': setTimeout(() => EventEmitter.prototype.emit.call(this, 'shutdown'), 100); return { ok: true };

      case 'settings.set': {
        const s = this.settings.set(p.patch);
        if (p.patch && 'mobileRelay' in p.patch) this.mobile?.relay.clear();
        this.emit('settings.updated', { settings: s }); return s;
      }
      case 'providers.models': {
        if (remote) throw new Error('Providers can only be configured on the computer.');
        return { models: await listModels(this.settings.get().openai) };
      }
      case 'auth.status': return authStatus();
      case 'models.speeds': return { unsupported: unsupportedSpeeds() };
      case 'usage.get': case 'usage.resets': case 'usage.redeem': {
        if (!authStatus().signedIn) throw new Error('Sign in to ChatGPT to see plan usage.');
        if (method === 'usage.get') return getUsage();
        if (method === 'usage.resets') return getResets();
        return redeemReset(p.creditId);
      }
      case 'auth.login': {
        startLogin().then((auth) => this.emit('auth.updated', { auth }));
        return { started: true };
      }

      case 'bots.create': {
        const s = this.settings.get();
        const provider = p.provider || s.defaultProvider || 'codex';
        if (!['codex', 'openai'].includes(provider)) throw new Error('Unknown model provider');
        const fallback = provider === s.defaultProvider ? s.defaultModel : provider === 'openai' ? s.openai.models[0] : MODELS[0].id;
        const model = p.model || fallback;
        if (!(provider === 'openai' ? validModel(model) : isModel(model))) throw new Error('Choose a model in provider settings first.');
        const bot = this.bots.create({ name: p.name, model, effort: isEffort(p.effort) ? p.effort : s.defaultEffort });
        bot.provider = provider;
        if (remote && s.defaultPermission === 'bypass') bot.permission = 'default'; // a phone never creates a bypass-mode bot
        this.bots.save(bot);
        this.emit('bot.created', { bot: this.view(bot) });
        if (provider === 'openai' || authStatus().signedIn) {
          this.runner(bot.id).submit(
            `[New bot created] You were just created and this is your very first moment with ${s.userName}. Do both of these now, in this one turn: (1) say hi in a single short sentence, saying you are ${bot.name} and are all set up and ready; (2) call the ask_user_question tool (required; do not ask in plain text) to ask what they mainly want help with, offering 4 short, varied options. They can change this later.`,
            'system', { hidden: true });
        } else this.#greetingFallback(bot);
        return this.view(bot);
      }
      case 'bots.update': {
        const bot = this.bots.get(p.id); if (!bot) throw new Error('Unknown bot');
        if (typeof p.name === 'string' && p.name.trim()) bot.name = p.name.trim().slice(0, 40);
        const provider = p.provider || bot.provider || 'codex';
        if (!['codex', 'openai'].includes(provider)) throw new Error('Unknown model provider');
        const model = p.model ?? (p.provider && p.provider !== (bot.provider || 'codex') ? (provider === 'openai' ? this.settings.get().openai.models[0] : MODELS[0].id) : bot.model);
        if (!(provider === 'openai' ? validModel(model) : isModel(model))) throw new Error('Unknown model. Choose a valid model ID.');
        bot.model = model; bot.provider = provider;
        if (p.effort !== undefined) { if (!isEffort(p.effort)) throw new Error('Unknown effort'); bot.effort = p.effort; }
        if (p.fast !== undefined) p.speed ??= p.fast ? 'fast' : 'normal';
        if (p.speed !== undefined) {
          if (!['normal', 'fast', 'ultrafast'].includes(p.speed)) throw new Error('Unknown speed. Use normal, fast or ultrafast.');
          if (provider === 'codex' && !speedSupported(bot.model, p.speed)) throw new Error(`${p.speed === 'ultrafast' ? 'UltraFast' : 'Fast'} isn't available for ${bot.model}.`);
          bot.speed = p.speed; delete bot.fast;
        } else if (p.model !== undefined && provider === 'codex' && !speedSupported(bot.model, botSpeed(bot))) {
          bot.speed = 'normal'; delete bot.fast; // new model lacks the old speed
        }
        if (p.permission !== undefined) {
          if (!isPermission(p.permission)) throw new Error('Unknown permission mode');
          if (remote && p.permission === 'bypass') throw new Error('Bypass permissions can only be turned on from the computer.');
          bot.permission = p.permission;
        }
        this.bots.save(bot);
        const r = this.runners.get(bot.id); if (r) r.bot = bot;
        const v = this.view(bot); this.emit('bot.updated', { bot: v });
        return v;
      }
      case 'bots.delete': {
        this.runners.get(p.id)?.stop(); this.runners.delete(p.id);
        this.scheduler.removeForBot(p.id);
        this.bots.remove(p.id); this.emit('bot.deleted', { id: p.id });
        return { ok: true };
      }

      case 'chat.history': {
        const bot = this.bots.get(p.botId); if (!bot) throw new Error('Unknown bot');
        const items = this.bots.log(bot.id).items;
        return { items: p.all ? items : items.slice(-(p.limit || 500)), status: this.runners.get(bot.id)?.status || 'idle' };
      }
      case 'chat.send': {
        const text = String(p.text ?? '').trim();
        if (!text && !p.images?.length) throw new Error('Empty message');
        const bot = this.bots.get(p.botId); if (!bot) throw new Error('Unknown bot');
        if ((bot.provider || 'codex') === 'codex' && !authStatus().signedIn) throw new Error('Sign in to ChatGPT or select a compatible API in the bot menu.');
        if (p.images?.length && !supportsImages(bot, this.settings.get())) throw new Error('This bot’s model can’t see images. Turn on image input for your compatible API in Settings, or pick another model.');
        const images = saveImages(this.bots.dir(bot.id), p.images);
        this.runner(p.botId).submit(text, p.source || 'desktop', images.length ? { images } : {});
        return { ok: true };
      }
      case 'chat.stop': this.runners.get(p.botId)?.stop(); return { ok: true };
      case 'chat.answer': {
        const runner = this.runner(p.botId);
        const item = this.bots.log(p.botId).get(p.itemId);
        if (!item) throw new Error('Unknown item');
        if (item.type === 'question') {
          if (runner.resolve(p.itemId, p.dismissed ? { dismissed: true } : { text: String(p.text ?? '') })) return { ok: true };
          // The turn that asked is gone (host restarted); deliver the answer as a normal message.
          runner.patch(item.id, p.dismissed ? { status: 'dismissed' } : { status: 'answered', answer: p.text });
          if (!p.dismissed) runner.submit(`(Answering your question "${item.question}") ${p.text}`, p.source || 'desktop');
          return { ok: true };
        }
        if (item.type === 'approval') {
          if (remote && !this.settings.get().mobileCanApprove) throw new Error('Approving actions from a phone is turned off on the computer.');
          if (!runner.resolve(p.itemId, { allow: Boolean(p.allow) })) runner.patch(item.id, { status: 'expired' });
          return { ok: true };
        }
        throw new Error('Item is not answerable');
      }
      case 'chat.markRead': {
        const bot = this.bots.get(p.botId); if (!bot) return { ok: false };
        bot.lastReadTs = Date.now(); this.bots.save(bot);
        this.emit('bot.updated', { bot: this.view(bot) });
        return { ok: true };
      }
      case 'tools.log': {
        const items = this.bots.log(p.botId).items.filter((i) => i.type === 'tool' || (i.type === 'assistant' && i.interim));
        return { items: items.slice(-(p.limit || 300)) };
      }
      case 'search': {
        const q = String(p.q || '').toLowerCase().trim();
        if (!q) return { results: [] };
        const results = [];
        for (const bot of this.bots.all()) {
          for (const it of [...this.bots.log(bot.id).items].reverse()) {
            const text = it.type === 'user' || it.type === 'assistant' ? it.text : null;
            if (!text || it.hidden || it.interim) continue;
            const i = text.toLowerCase().indexOf(q);
            if (i >= 0) { results.push({ botId: bot.id, itemId: it.id, ts: it.ts, snippet: text.slice(Math.max(0, i - 40), i + 100) }); if (results.length >= 40) return { results }; }
          }
        }
        return { results };
      }

      case 'schedules.list': return { schedules: this.scheduler.list(p.botId) };
      case 'schedules.setEnabled': return { schedule: this.scheduler.setEnabled(p.id, p.enabled) };
      case 'schedules.delete': return { ok: this.scheduler.remove(p.id) };

      case 'voice.transcribe': {
        const key = this.settings.get().openrouterKey;
        if (!key) throw new Error('Connect OpenRouter to use voice transcription.');
        return { text: await transcribe(key, { base64: p.base64, format: p.format || 'wav', language: p.language }) };
      }
      default: throw new Error(`Unknown method: ${method}`);
    }
  }
}
