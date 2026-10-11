import readline from 'node:readline';
import { c } from './render.js';

/** Arrow-key list picker. items: [{label, value}]. Resolves to value or null (Esc / Ctrl+C). */
export function pick(title, items, selected = 0) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return resolve(items[selected]?.value ?? null);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true); stdin.resume();
    let i = selected, drawn = 0;
    const draw = () => {
      if (drawn) readline.moveCursor(stdout, 0, -drawn);
      readline.cursorTo(stdout, 0); readline.clearScreenDown(stdout);
      const lines = [c.bold(title), ...items.map((it, k) => (k === i ? `${c.cyan('❯')} ${it.label}` : `  ${c.dim(it.plain ?? it.label)}`)), c.gray('↑/↓ move · enter select · esc cancel')];
      stdout.write(lines.join('\n') + '\n'); drawn = lines.length;
    };
    const done = (v) => { stdin.off('keypress', onKey); stdin.setRawMode(false); stdin.pause(); resolve(v); };
    const onKey = (_s, key = {}) => {
      if (key.name === 'up') { i = (i + items.length - 1) % items.length; draw(); }
      else if (key.name === 'down') { i = (i + 1) % items.length; draw(); }
      else if (key.name === 'return') done(items[i].value);
      else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) done(null);
    };
    stdin.on('keypress', onKey); draw();
  });
}
