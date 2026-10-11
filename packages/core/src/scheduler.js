import { Cron } from 'croner';
import { schedulesFile } from './paths.js';
import { readJson, writeJson, newId } from './store.js';

const TICK_MS = 15_000;

/** Persistent schedules. Fires into the owning bot's runner while the host is running. */
export class Scheduler {
  constructor(onFire, emit) {
    this.onFire = onFire;
    this.emit = emit;
    this.items = readJson(schedulesFile(), []);
    const now = Date.now();
    for (const s of this.items) {
      // Cron doesn't catch up on missed runs; interval/once fire once if overdue.
      if (s.kind === 'cron' || !s.nextRun) this.#computeNext(s, now);
    }
    this.#save();
  }

  start() { this.timer = setInterval(() => this.#tick(), TICK_MS); this.timer.unref?.(); this.#tick(); }
  stop() { clearInterval(this.timer); }

  list(botId) { return this.items.filter((s) => !botId || s.botId === botId); }
  get(id) { return this.items.find((s) => s.id === id); }

  describe(s) {
    if (s.kind === 'cron') return `cron ${s.cron}`;
    if (s.kind === 'interval') return `every ${s.everyMinutes} min`;
    return `once at ${s.at}`;
  }

  create({ botId, name, prompt, cron, everyMinutes, at }) {
    if (!prompt || typeof prompt !== 'string') throw new Error('prompt is required');
    const given = [cron, everyMinutes, at].filter((v) => v !== undefined && v !== null && v !== '');
    if (given.length !== 1) throw new Error('Provide exactly one of cron, every_minutes, at');
    const s = { id: newId('s_'), botId, name: String(name || prompt).slice(0, 60), prompt, enabled: true, createdAt: new Date().toISOString(), lastRun: null };
    if (cron) { new Cron(cron); Object.assign(s, { kind: 'cron', cron }); }
    else if (everyMinutes) {
      const m = Number(everyMinutes);
      if (!(m >= 1)) throw new Error('every_minutes must be at least 1');
      Object.assign(s, { kind: 'interval', everyMinutes: m });
    } else {
      const t = Date.parse(at);
      if (Number.isNaN(t)) throw new Error('at must be an ISO 8601 date-time');
      if (t < Date.now() - 60_000) throw new Error('at is in the past');
      Object.assign(s, { kind: 'once', at: new Date(t).toISOString() });
    }
    this.#computeNext(s, Date.now());
    this.items.push(s); this.#save(); this.emit('schedule.updated', { schedule: s });
    return s;
  }

  setEnabled(id, enabled) {
    const s = this.get(id); if (!s) return null;
    s.enabled = Boolean(enabled);
    if (s.enabled) this.#computeNext(s, Date.now());
    this.#save(); this.emit('schedule.updated', { schedule: s });
    return s;
  }

  remove(id, botId) {
    const i = this.items.findIndex((s) => s.id === id && (!botId || s.botId === botId));
    if (i < 0) return false;
    const [s] = this.items.splice(i, 1);
    this.#save(); this.emit('schedule.removed', { id: s.id, botId: s.botId });
    return true;
  }

  removeForBot(botId) { this.items = this.items.filter((s) => s.botId !== botId); this.#save(); }

  #computeNext(s, from) {
    if (!s.enabled) { s.nextRun = null; return; }
    if (s.kind === 'cron') s.nextRun = new Cron(s.cron).nextRun(new Date(from))?.toISOString() ?? null;
    else if (s.kind === 'interval') s.nextRun = new Date((s.lastRun ? Date.parse(s.lastRun) : Date.parse(s.createdAt)) + s.everyMinutes * 60_000).toISOString();
    else s.nextRun = s.at;
  }

  #tick() {
    const now = Date.now();
    for (const s of this.items) {
      if (!s.enabled || !s.nextRun || Date.parse(s.nextRun) > now) continue;
      s.lastRun = new Date(now).toISOString();
      if (s.kind === 'once') { s.enabled = false; s.nextRun = null; } else this.#computeNext(s, now);
      this.#save(); this.emit('schedule.updated', { schedule: s });
      try { this.onFire(s); } catch (e) { console.error('schedule fire failed', e); }
    }
  }

  #save() { writeJson(schedulesFile(), this.items); }
}
