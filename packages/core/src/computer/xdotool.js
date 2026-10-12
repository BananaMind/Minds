// Linux X11 input through xdotool.
import { run } from '../screen.js';
import { keysym } from './keys.js';

const BTN = { left: 1, middle: 2, right: 3 };
const NAMES = {
  enter: 'Return', tab: 'Tab', escape: 'Escape', backspace: 'BackSpace', delete: 'Delete', home: 'Home', end: 'End',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down', pageup: 'Page_Up', pagedown: 'Page_Down', insert: 'Insert',
  menu: 'Menu', printscreen: 'Print', capslock: 'Caps_Lock', shift: 'shift', ctrl: 'ctrl', alt: 'alt', super: 'super', space: 'space',
};
export const xdoKey = (key) => NAMES[key] || (/^f\d+$/.test(key) ? key.toUpperCase() : /^[a-z0-9]$/.test(key) ? key : `0x${keysym(key).toString(16)}`);

export class XdotoolInput {
  async #x(args, signal) {
    try { return await run('xdotool', args, signal); } catch (e) {
      if (e.code === 'ENOENT') throw new Error('Computer control on X11 needs xdotool. Install it (e.g. sudo apt install xdotool).');
      throw new Error(`xdotool: ${String(e.stderr || e.message).trim()}`);
    }
  }
  async open(signal) {
    const [w, h] = (await this.#x(['getdisplaygeometry'], signal)).trim().split(/\s+/).map(Number);
    this.w = w; this.h = h;
  }
  move(fx, fy) { return this.#x(['mousemove', '--sync', String(Math.round(fx * (this.w - 1))), String(Math.round(fy * (this.h - 1)))]); }
  button(btn, down) { return this.#x([down ? 'mousedown' : 'mouseup', String(BTN[btn])]); }
  async scroll(dx, dy) {
    if (dy) await this.#x(['click', '--repeat', String(Math.abs(dy)), dy > 0 ? '5' : '4']);
    if (dx) await this.#x(['click', '--repeat', String(Math.abs(dx)), dx > 0 ? '7' : '6']);
  }
  key(key, down) { return this.#x([down ? 'keydown' : 'keyup', xdoKey(key)]); }
  type(text, signal) { return this.#x(['type', '--delay', '12', '--', text], signal); }
  async pointer() {
    const out = await this.#x(['getmouselocation', '--shell']);
    const x = Number(/X=(\d+)/.exec(out)?.[1]), y = Number(/Y=(\d+)/.exec(out)?.[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { fx: x / (this.w - 1), fy: y / (this.h - 1) } : null;
  }
  close() {}
}
