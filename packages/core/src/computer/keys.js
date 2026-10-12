// Key names the model writes ("ctrl+shift+t", "Return", "cmd+space") -> each platform's codes.

const ALIASES = {
  return: 'enter', esc: 'escape', del: 'delete', control: 'ctrl', option: 'alt', opt: 'alt', altgr: 'alt',
  cmd: 'super', command: 'super', meta: 'super', win: 'super', windows: 'super', logo: 'super',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  pgup: 'pageup', page_up: 'pageup', prior: 'pageup', pgdn: 'pagedown', page_down: 'pagedown', next: 'pagedown',
  back_space: 'backspace', bksp: 'backspace', ins: 'insert', print: 'printscreen', prtsc: 'printscreen', caps_lock: 'capslock',
  plus: '+', minus: '-', spacebar: 'space', apps: 'menu',
};
export const MODIFIERS = ['ctrl', 'alt', 'shift', 'super'];
const NAMED = new Set([...MODIFIERS, 'enter', 'tab', 'escape', 'backspace', 'delete', 'space', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert', 'menu', 'printscreen', 'capslock', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);

export function normalizeKey(name) {
  const raw = String(name).trim();
  if ([...raw].length === 1) return raw.length === 1 && /[A-Z]/.test(raw) ? raw.toLowerCase() : raw;
  const k = raw.toLowerCase().replace(/[\s-]+/g, '_');
  const n = ALIASES[k] || ALIASES[k.replace(/_/g, '')] || k.replace(/_/g, '');
  if (NAMED.has(n)) return n;
  throw new Error(`Unknown key "${name}".`);
}

/** "ctrl+a Delete" -> [['ctrl','a'], ['delete']]: space-separated combos, keys joined by '+'. */
export function parseKeys(spec) {
  const split = (c) => (c === '+' ? ['+'] : c.endsWith('++') ? [...c.slice(0, -2).split('+'), '+'] : c.split('+'));
  const combos = String(spec ?? '').trim().split(/\s+/).filter(Boolean).map((c) => split(c).map(normalizeKey));
  if (!combos.length) throw new Error('keys is required, e.g. "ctrl+s" or "Return".');
  return combos;
}

// X11 keysyms (used by the Wayland portal and xdotool).
const KEYSYM = {
  enter: 0xff0d, tab: 0xff09, escape: 0xff1b, backspace: 0xff08, delete: 0xffff, home: 0xff50, left: 0xff51, up: 0xff52,
  right: 0xff53, down: 0xff54, pageup: 0xff55, pagedown: 0xff56, end: 0xff57, insert: 0xff63, menu: 0xff67,
  printscreen: 0xff61, capslock: 0xffe5, shift: 0xffe1, ctrl: 0xffe3, alt: 0xffe9, super: 0xffeb, space: 0x20,
};
for (let i = 1; i <= 12; i++) KEYSYM[`f${i}`] = 0xffbe + i - 1;
export function keysym(key) {
  if (KEYSYM[key] != null) return KEYSYM[key];
  if (key === '\n') return KEYSYM.enter;
  if (key === '\t') return KEYSYM.tab;
  const cp = key.codePointAt(0);
  return cp < 0x100 ? cp : 0x01000000 + cp;
}

// Windows virtual-key codes; other characters are looked up with VkKeyScan on the PC.
const VK = {
  enter: 0x0d, tab: 0x09, escape: 0x1b, backspace: 0x08, delete: 0x2e, home: 0x24, end: 0x23, left: 0x25, up: 0x26,
  right: 0x27, down: 0x28, pageup: 0x21, pagedown: 0x22, insert: 0x2d, menu: 0x5d, printscreen: 0x2c, capslock: 0x14,
  shift: 0x10, ctrl: 0x11, alt: 0x12, super: 0x5b, space: 0x20,
};
for (let i = 1; i <= 12; i++) VK[`f${i}`] = 0x6f + i;
/** -> {vk} or {char} (a UTF-16 code unit for VkKeyScan). */
export function windowsKey(key) {
  if (VK[key] != null) return { vk: VK[key] };
  if (/^[a-z0-9]$/.test(key)) return { vk: key.toUpperCase().charCodeAt(0) };
  return { char: key.charCodeAt(0) };
}

// macOS virtual key codes (ANSI layout).
const MAC = {
  enter: 36, tab: 48, space: 49, backspace: 51, escape: 53, super: 55, shift: 56, capslock: 57, alt: 58, ctrl: 59,
  delete: 117, home: 115, end: 119, pageup: 116, pagedown: 121, left: 123, right: 124, down: 125, up: 126, insert: 114,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32,
  '[': 33, i: 34, p: 35, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50,
};
export const macKeyCode = (key) => MAC[key];
