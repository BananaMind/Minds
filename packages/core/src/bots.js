import fs from 'node:fs';
import path from 'node:path';
import { botsDir, botDir } from './paths.js';
import { readJson, writeJson, newId } from './store.js';
import { ChatLog } from './chatlog.js';
import { pickIcon } from './icons.js';

export class BotStore {
  constructor() {
    fs.mkdirSync(botsDir(), { recursive: true, mode: 0o700 });
    this.bots = new Map();
    this.logs = new Map();
    for (const d of fs.readdirSync(botsDir())) {
      const bot = readJson(path.join(botDir(d), 'bot.json'));
      if (bot?.id) this.bots.set(bot.id, bot);
    }
  }

  dir(id) { return botDir(id); }
  workspace(id) { return path.join(botDir(id), 'workspace'); }
  log(id) {
    if (!this.logs.has(id)) this.logs.set(id, new ChatLog(path.join(botDir(id), 'log.jsonl')));
    return this.logs.get(id);
  }
  get(id) { return this.bots.get(id); }
  all() { return [...this.bots.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)); }

  create({ name, model, effort }) {
    name = String(name || '').trim().slice(0, 40);
    if (!name) throw new Error('A bot needs a name.');
    const bot = {
      id: newId('b_'), name, model, effort,
      icon: pickIcon([...this.bots.values()].map((b) => b.icon)),
      createdAt: Date.now(), lastActivity: Date.now(), lastReadTs: 0,
    };
    fs.mkdirSync(this.workspace(bot.id), { recursive: true, mode: 0o700 });
    this.bots.set(bot.id, bot);
    this.save(bot);
    return bot;
  }

  save(bot) { writeJson(path.join(botDir(bot.id), 'bot.json'), bot); }

  remove(id) {
    this.bots.delete(id); this.logs.delete(id);
    fs.rmSync(botDir(id), { recursive: true, force: true });
  }
}
