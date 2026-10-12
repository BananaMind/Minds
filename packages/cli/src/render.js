import { ICON_COLORS } from '@bananamind/minds-core';

const on = process.stdout.isTTY && !process.env.NO_COLOR;
const wrapSgr = (a, b) => (s) => (on ? `\x1b[${a}m${s}\x1b[${b}m` : String(s));
export const c = {
  bold: wrapSgr(1, 22), dim: wrapSgr(2, 22), italic: wrapSgr(3, 23), underline: wrapSgr(4, 24),
  red: wrapSgr(31, 39), green: wrapSgr(32, 39), yellow: wrapSgr(33, 39), blue: wrapSgr(34, 39), cyan: wrapSgr(36, 39), gray: wrapSgr(90, 39),
  rgb: (hex, s) => {
    if (!on) return String(s);
    const n = parseInt(hex.slice(1), 16);
    return `\x1b[38;2;${n >> 16};${(n >> 8) & 255};${n & 255}m${s}\x1b[39m`;
  },
};

const GLYPHS = ['●', '■', '◆', '▲', '★', '✚', '⬢', '◉', '▮', '❖'];
export const glyph = (icon) => c.rgb(ICON_COLORS[icon.color % ICON_COLORS.length], GLYPHS[icon.shape % GLYPHS.length]);

const ANSI = /\x1b\[[0-9;]*m/g;
export const visLen = (s) => s.replace(ANSI, '').length;
export const termWidth = () => Math.max(40, Math.min(process.stdout.columns || 100, 110));

/** Word-wrap a (possibly ANSI-styled) line to `width`, indenting continuation lines. */
export function wrap(line, width, indent = '') {
  if (visLen(line) <= width) return [line];
  const out = []; let cur = '';
  for (const word of line.split(/(?<= )/)) {
    if (visLen(cur) + visLen(word) > width && cur.trim()) { out.push(cur.trimEnd()); cur = indent; }
    cur += word;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

const inline = (t) => t
  .replace(/`([^`]+)`/g, (_, m) => c.cyan(m))
  .replace(/\*\*([^*]+)\*\*/g, (_, m) => c.bold(m))
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, (_, a, m) => a + c.italic(m))
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, t, u) => `${c.underline(t)} ${c.gray(`(${u})`)}`);

/** Small terminal markdown renderer: headings, lists, quotes, fenced code, inline styles. */
export function md(text, width = termWidth() - 4) {
  const out = []; let fence = false;
  for (const raw of String(text).split('\n')) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push(c.gray('│ ') + c.dim(raw)); continue; }
    let m;
    if ((m = raw.match(/^(#{1,6})\s+(.*)/))) out.push(c.bold(inline(m[2])));
    else if ((m = raw.match(/^(\s*)[-*]\s+(.*)/))) out.push(...wrap(`${m[1]}• ${inline(m[2])}`, width, `${m[1]}  `));
    else if ((m = raw.match(/^(\s*)(\d+)[.)]\s+(.*)/))) out.push(...wrap(`${m[1]}${m[2]}. ${inline(m[3])}`, width, `${m[1]}   `));
    else if ((m = raw.match(/^>\s?(.*)/))) out.push(c.gray('▎ ') + c.italic(inline(m[1])));
    else out.push(...wrap(inline(raw), width));
  }
  return out;
}

export function stampLabel(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return dayDiff === 0 ? `Today ${time}` : dayDiff === 1 ? `Yesterday ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export const botLine = (b) => `${glyph(b.icon)} ${c.bold(b.name)} ${c.gray(`${b.model} · ${b.effort}`)}`;
export const clipLine = (s, n = 90) => { s = String(s ?? '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
