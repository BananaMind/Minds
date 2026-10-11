import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { c, visLen } from './render.js';

const BG = '\x1b[48;2;30;30;33m';       // input bar / list background
const SEL_BG = '\x1b[48;2;110;168;255m'; // highlighted row
const SEL_FG = '\x1b[38;2;12;12;16m';
const RESET_BG = '\x1b[49m';
const RESET_FG = '\x1b[39m';
const ACCENT = '#6ea8ff';
const POPUP_ROWS = 6;
const LIST_ROWS = 9;

const ellipsis = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);

/**
 * Codex-style input: a filled bar with a › prompt, status lines beneath, a slash-command popup above,
 * and an interactive pick list (select) that temporarily replaces the bar.
 * Events: line(text) · cycle (shift+tab) · escape · sigint · eof
 */
export class Prompt extends EventEmitter {
  /** footer: () => { working?, status, hint, label?, placeholder? } · commands: () => [{name, desc, needsArg?}] */
  constructor({ footer, commands = () => [] }) {
    super();
    this.footer = footer; this.commands = commands;
    this.buf = ''; this.cur = 0;
    this.history = []; this.hIdx = -1; this.draft = '';
    this.row = 0; this.drawn = false; this.paste = false;
    this.waiter = null;
    this.popupIdx = 0; this.popupHidden = false;
    this.sel = null;
  }

  start() {
    const { stdin, stdout } = process;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true); stdin.resume();
    stdout.write('\x1b[?2004h'); // bracketed paste
    this.onKey = (s, k) => this.#key(s, k || {});
    this.onResize = () => this.render();
    stdin.on('keypress', this.onKey); stdout.on('resize', this.onResize);
    this.render();
  }

  stop() {
    const { stdin, stdout } = process;
    this.cancelSelect();
    this.#clear();
    stdout.write('\x1b[?2004l\x1b[?25h');
    stdin.off('keypress', this.onKey); stdout.off('resize', this.onResize);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }

  /** Write output above the footer. */
  print(text = '') {
    this.#clear();
    process.stdout.write(text + '\n');
    this.render();
  }

  /** One-off question using the same bar; resolves with the typed line. */
  ask(label) {
    return new Promise((resolve) => { this.waiter = { label, resolve }; this.render(); });
  }

  /**
   * Interactive pick list. items: [{label, desc?, value, current?}]. Resolves with the chosen value, or null on Esc.
   * Arrow keys move, 1-9 choose directly, Enter confirms.
   */
  select({ title, subtitle, items, initial = 0, hint = 'enter to confirm · esc to go back' }) {
    this.cancelSelect();
    return new Promise((resolve) => {
      const idx = Math.max(0, Math.min(items.length - 1, initial));
      this.sel = { title, subtitle, items, idx, hint, resolve };
      process.stdout.write('\x1b[?25l');
      this.render();
    });
  }
  get selecting() { return Boolean(this.sel); }
  cancelSelect() { if (this.sel) this.#endSelect(null); }
  #endSelect(value) {
    const s = this.sel; this.sel = null;
    process.stdout.write('\x1b[?25h');
    this.render();
    s.resolve(value);
  }

  #clear() {
    if (!this.drawn) return;
    if (this.row > 0) readline.moveCursor(process.stdout, 0, -this.row);
    readline.cursorTo(process.stdout, 0); readline.clearScreenDown(process.stdout);
    this.drawn = false; this.row = 0;
  }

  #layout(width) {
    const rows = ['']; let r = 0, col = 0, cr = 0, cc = 0;
    for (let i = 0; i <= this.buf.length; i++) {
      if (i === this.cur) { cr = r; cc = col; }
      if (i === this.buf.length) break;
      const ch = this.buf[i];
      if (ch === '\n') { rows.push(''); r++; col = 0; continue; }
      if (col >= width) { rows.push(''); r++; col = 0; if (i === this.cur) { cr = r; cc = 0; } }
      rows[r] += ch; col++;
    }
    return { rows, cr, cc };
  }

  // ---- slash-command popup ----
  #popupItems() {
    if (this.sel || this.waiter || this.popupHidden || !this.buf.startsWith('/') || /\s/.test(this.buf)) return [];
    const q = this.buf.slice(1).toLowerCase();
    const all = this.commands();
    return [...all.filter((x) => x.name.startsWith(q)), ...all.filter((x) => !x.name.startsWith(q) && x.name.includes(q))];
  }

  /** Full-width row: highlighted when selected. Pieces are plain text so truncation is exact. */
  #row(cols, marker, strong, rest, selected) {
    const text = ellipsis(`${marker}${strong}${rest}`, cols - 1);
    const pad = ' '.repeat(Math.max(0, cols - text.length));
    if (selected) {
      const head = text.slice(0, marker.length), body = text.slice(marker.length);
      const s = body.slice(0, strong.length), r = body.slice(strong.length);
      return `${SEL_BG}${SEL_FG}${head}\x1b[1m${s}\x1b[22m${r}${pad}${RESET_FG}${RESET_BG}`;
    }
    const head = text.slice(0, marker.length), body = text.slice(marker.length);
    const s = body.slice(0, strong.length), r = body.slice(strong.length);
    return `${BG}${head}${c.bold(s)}${c.gray(r)}${pad}${RESET_BG}`;
  }

  #selectLines(cols) {
    const { title, subtitle, items, idx, hint } = this.sel;
    const lines = [];
    if (title) lines.push(`  ${c.bold(title)}`);
    if (subtitle) lines.push(`  ${c.gray(subtitle)}`);
    const start = Math.max(0, Math.min(idx - Math.floor(LIST_ROWS / 2), items.length - LIST_ROWS));
    const shown = items.slice(start, start + LIST_ROWS);
    const w = Math.min(34, Math.max(...items.map((it) => (it.label + (it.current ? ' (current)' : '')).length)));
    shown.forEach((it, k) => {
      const i = start + k, num = `${i + 1}. `;
      const label = (it.label + (it.current ? ' (current)' : '')).padEnd(w + 2);
      lines.push(this.#row(cols, i === idx ? '› ' : '  ', `${num}${label}`, it.desc || '', i === idx));
    });
    if (items.length > shown.length) lines.push(`  ${c.gray(`${idx + 1}/${items.length}`)}`);
    lines.push(`  ${c.gray(hint)}`);
    return lines;
  }

  render() {
    const out = process.stdout;
    if (!out.isTTY) return;
    this.#clear();
    const cols = Math.max(20, out.columns || 80);

    if (this.sel) {
      const lines = this.#selectLines(cols);
      out.write(lines.join('\n'));
      this.row = lines.length - 1; this.drawn = true;
      return;
    }

    const f = this.footer();
    const label = this.waiter?.label ?? f.label ?? '›';
    const { rows, cr, cc } = this.#layout(cols - 4);
    const bar = (inner) => `${BG}${inner}${' '.repeat(Math.max(0, cols - visLen(inner)))}${RESET_BG}`;
    const lines = [];

    const popup = this.#popupItems();
    if (popup.length) {
      this.popupIdx = Math.min(this.popupIdx, popup.length - 1);
      const start = Math.max(0, Math.min(this.popupIdx - Math.floor(POPUP_ROWS / 2), popup.length - POPUP_ROWS));
      const w = Math.max(...popup.map((x) => x.name.length)) + 3;
      popup.slice(start, start + POPUP_ROWS).forEach((x, k) => {
        lines.push(this.#row(cols, start + k === this.popupIdx ? '› ' : '  ', `/${x.name}`.padEnd(w), x.desc, start + k === this.popupIdx));
      });
      lines.push('');
    }

    if (f.working) lines.push(`  ${c.dim(f.working)}`);
    const barTop = lines.length;
    lines.push(bar(''));
    rows.forEach((text, i) => {
      const shown = !this.buf && i === 0 ? c.dim(f.placeholder || '') : text;
      lines.push(bar(`${i === 0 ? ` ${c.rgb(ACCENT, c.bold(label))} ` : '   '}${shown}`));
    });
    lines.push(bar(''));
    lines.push(`  ${f.status}`);
    if (f.hint) lines.push(`  ${c.gray(f.hint)}`);

    out.write(lines.join('\n'));
    const inputRow = barTop + 1 + cr;
    const up = lines.length - 1 - inputRow;
    if (up > 0) readline.moveCursor(out, 0, -up);
    readline.cursorTo(out, 3 + cc);
    this.row = inputRow; this.drawn = true;
  }

  // ---- editing ----
  #set(buf, cur) {
    if (buf !== this.buf) { this.popupIdx = 0; this.popupHidden = false; }
    this.buf = buf; this.cur = cur; this.render();
  }
  #insert(str) { this.#set(this.buf.slice(0, this.cur) + str + this.buf.slice(this.cur), this.cur + str.length); }
  #wordLeft() { let i = this.cur; while (i > 0 && /\s/.test(this.buf[i - 1])) i--; while (i > 0 && !/\s/.test(this.buf[i - 1])) i--; return i; }
  #wordRight() { let i = this.cur; while (i < this.buf.length && /\s/.test(this.buf[i])) i++; while (i < this.buf.length && !/\s/.test(this.buf[i])) i++; return i; }
  #lineStart(i = this.cur) { return this.buf.lastIndexOf('\n', i - 1) + 1; }
  #lineEnd(i = this.cur) { const e = this.buf.indexOf('\n', i); return e < 0 ? this.buf.length : e; }

  #submit() {
    const text = this.buf;
    this.buf = ''; this.cur = 0; this.hIdx = -1; this.popupIdx = 0; this.popupHidden = false;
    if (this.waiter) { const w = this.waiter; this.waiter = null; this.render(); return w.resolve(text); }
    if (text.trim() && this.history.at(-1) !== text) this.history.push(text);
    this.render();
    this.emit('line', text);
  }

  #history(dir) {
    if (!this.history.length) return;
    if (this.hIdx === -1) { if (dir > 0) return; this.draft = this.buf; this.hIdx = this.history.length; }
    this.hIdx = Math.max(0, Math.min(this.history.length, this.hIdx + dir));
    const v = this.hIdx === this.history.length ? this.draft : this.history[this.hIdx];
    if (this.hIdx === this.history.length) this.hIdx = -1;
    this.#set(v, v.length);
  }

  #selKey(s, k) {
    const sel = this.sel, n = sel.items.length;
    if (k.ctrl && k.name === 'c') return this.#endSelect(null);
    if (k.name === 'up' || (!k.ctrl && s === 'k')) { sel.idx = (sel.idx + n - 1) % n; return this.render(); }
    if (k.name === 'down' || (!k.ctrl && s === 'j')) { sel.idx = (sel.idx + 1) % n; return this.render(); }
    if (k.name === 'home') { sel.idx = 0; return this.render(); }
    if (k.name === 'end') { sel.idx = n - 1; return this.render(); }
    if (k.name === 'return' || k.name === 'enter') return this.#endSelect(sel.items[sel.idx].value);
    if (k.name === 'escape') return this.#endSelect(null);
    if (/^[1-9]$/.test(s || '') && Number(s) <= n) return this.#endSelect(sel.items[Number(s) - 1].value);
  }

  #key(s, k) {
    if (this.sel) return this.#selKey(s, k);
    if (k.name === 'paste-start') { this.paste = true; return; }
    if (k.name === 'paste-end') { this.paste = false; return; }

    const popup = this.#popupItems();
    if (popup.length && !k.ctrl && !this.paste) {
      const cur = popup[Math.min(this.popupIdx, popup.length - 1)];
      if (k.name === 'up') { this.popupIdx = (this.popupIdx + popup.length - 1) % popup.length; return this.render(); }
      if (k.name === 'down') { this.popupIdx = (this.popupIdx + 1) % popup.length; return this.render(); }
      if (k.name === 'escape') { this.popupHidden = true; return this.render(); }
      if (k.name === 'tab' && !k.shift) { const t = `/${cur.name}${cur.needsArg ? ' ' : ''}`; return this.#set(t, t.length); }
      if ((k.name === 'return' || k.name === 'enter') && !k.meta && !k.shift && this.buf.slice(1) !== cur.name) {
        const t = `/${cur.name}${cur.needsArg ? ' ' : ''}`;
        this.buf = t; this.cur = t.length;
        return cur.needsArg ? this.render() : this.#submit();
      }
    }

    if (k.ctrl) {
      switch (k.name) {
        case 'c': return this.emit('sigint');
        case 'd': return this.buf ? undefined : this.emit('eof');
        case 'a': return this.#set(this.buf, this.#lineStart());
        case 'e': return this.#set(this.buf, this.#lineEnd());
        case 'u': return this.#set(this.buf.slice(this.cur), 0);
        case 'k': return this.#set(this.buf.slice(0, this.cur), this.cur);
        case 'w': { const i = this.#wordLeft(); return this.#set(this.buf.slice(0, i) + this.buf.slice(this.cur), i); }
        case 'left': return this.#set(this.buf, this.#wordLeft());
        case 'right': return this.#set(this.buf, this.#wordRight());
        case 'l': process.stdout.write('\x1b[2J\x1b[H'); this.drawn = false; this.row = 0; return this.render();
        case 'j': return this.#insert('\n');
      }
      return;
    }
    switch (k.name) {
      case 'return': case 'enter':
        if (this.paste || k.meta || k.shift) return this.#insert('\n');
        if (this.buf.endsWith('\\')) return this.#set(this.buf.slice(0, -1) + '\n', this.buf.length);
        return this.#submit();
      case 'tab': if (k.shift) this.emit('cycle'); return;
      case 'escape': return this.emit('escape');
      case 'backspace': return this.cur > 0 ? this.#set(this.buf.slice(0, this.cur - 1) + this.buf.slice(this.cur), this.cur - 1) : undefined;
      case 'delete': return this.cur < this.buf.length ? this.#set(this.buf.slice(0, this.cur) + this.buf.slice(this.cur + 1), this.cur) : undefined;
      case 'left': return k.meta ? this.#set(this.buf, this.#wordLeft()) : this.#set(this.buf, Math.max(0, this.cur - 1));
      case 'right': return k.meta ? this.#set(this.buf, this.#wordRight()) : this.#set(this.buf, Math.min(this.buf.length, this.cur + 1));
      case 'home': return this.#set(this.buf, this.#lineStart());
      case 'end': return this.#set(this.buf, this.#lineEnd());
      case 'up': case 'down': {
        const dir = k.name === 'up' ? -1 : 1;
        if (!this.buf.includes('\n')) return this.#history(dir);
        const col = this.cur - this.#lineStart();
        if (dir < 0) { const s0 = this.#lineStart(); if (s0 === 0) return; const ps = this.#lineStart(s0 - 1); return this.#set(this.buf, Math.min(ps + col, s0 - 1)); }
        const e = this.#lineEnd(); if (e >= this.buf.length) return; const ne = this.#lineEnd(e + 1);
        return this.#set(this.buf, Math.min(e + 1 + col, ne));
      }
    }
    if (s && !k.meta && /^[^\x00-\x08\x0b-\x1f\x7f]+$/.test(s) && !s.startsWith('\x1b')) this.#insert(s);
  }
}
