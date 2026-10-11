import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only chat log. Lines are {t:'add', item} or {t:'patch', id, patch}.
 * Everything a bot did (messages, questions, tool calls) is an item, so the
 * same log feeds both the chat UI and the model context.
 */
export class ChatLog {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.byId = new Map();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.#load();
  }

  #load() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return; }
    let lines = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      lines++;
      try {
        const r = JSON.parse(line);
        if (r.t === 'add') { this.items.push(r.item); this.byId.set(r.item.id, r.item); }
        else if (r.t === 'patch') Object.assign(this.byId.get(r.id) || {}, r.patch);
      } catch { /* torn last line */ }
    }
    if (lines > this.items.length * 3 + 200) this.#compact();
  }

  #compact() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.items.map((item) => JSON.stringify({ t: 'add', item })).join('\n') + '\n');
    fs.renameSync(tmp, this.file);
  }

  add(item) {
    this.items.push(item); this.byId.set(item.id, item);
    fs.appendFileSync(this.file, JSON.stringify({ t: 'add', item }) + '\n');
    return item;
  }

  patch(id, patch) {
    const item = this.byId.get(id);
    if (!item) return null;
    Object.assign(item, patch);
    fs.appendFileSync(this.file, JSON.stringify({ t: 'patch', id, patch }) + '\n');
    return item;
  }

  get(id) { return this.byId.get(id); }
  last() { return this.items[this.items.length - 1]; }
}
