// macOS input: mouse through CoreGraphics events (JXA), keys and text through System Events.
// Needs Accessibility permission for the app running the Minds host.
import { run } from '../screen.js';
import { macKeyCode, MODIFIERS } from './keys.js';

const EVENTS = { left: [1, 2, 6], right: [3, 4, 7], middle: [25, 26, 27] }; // down, up, dragged
const BUTTON = { left: 0, right: 1, middle: 2 };
const USING = { ctrl: 'control down', alt: 'option down', shift: 'shift down', super: 'command down' };

const permissionHint = (e) => /not allowed|assistive|1002|-25211|-1719/i.test(String(e.stderr || e.message))
  ? new Error('macOS blocked computer control. Allow Minds (or your terminal) in System Settings → Privacy & Security → Accessibility, then try again.')
  : new Error(`macOS input failed: ${String(e.stderr || e.message).trim()}`);

const jxa = async (body, signal) => {
  try { return await run('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics');\n${body}`], signal); } catch (e) { throw permissionHint(e); }
};

export class MacInput {
  pressed = new Set(); held = new Set(); x = 0; y = 0;

  async open(signal) {
    const out = await jxa('const b = $.CGDisplayBounds($.CGMainDisplayID()); `${b.size.width} ${b.size.height}`', signal);
    [this.w, this.h] = out.trim().split(' ').map(Number);
  }
  #mouse(type, btn = 'left', clicks = 1) {
    return jxa(`const e = $.CGEventCreateMouseEvent(null, ${type}, $.CGPointMake(${this.x}, ${this.y}), ${BUTTON[btn]});
$.CGEventSetIntegerValueField(e, 1, ${clicks}); $.CGEventPost(0, e);`);
  }
  move(fx, fy) {
    this.x = Math.round(fx * (this.w - 1)); this.y = Math.round(fy * (this.h - 1));
    const drag = [...this.pressed][0];
    return this.#mouse(drag ? EVENTS[drag][2] : 5, drag || 'left');
  }
  button(btn, down, clicks = 1) {
    down ? this.pressed.add(btn) : this.pressed.delete(btn);
    return this.#mouse(EVENTS[btn][down ? 0 : 1], btn, clicks);
  }
  scroll(dx, dy) { return jxa(`$.CGEventPost(0, $.CGEventCreateScrollWheelEvent(null, 1, 2, ${-dy}, ${-dx}));`); }
  /** Modifiers are collected and applied to the next real key, as System Events expects. */
  async key(key, down) {
    if (MODIFIERS.includes(key)) {
      if (down) { this.held.add(key); this.pendingMods = true; return; }
      this.held.delete(key);
      if (this.pendingMods && !this.held.size) { this.pendingMods = false; await this.#press(macKeyCode(key), [key]); }
      return;
    }
    if (!down) return;
    this.pendingMods = false;
    await this.#press(macKeyCode(key), [...this.held], key);
  }
  async #press(code, mods, char) {
    const using = mods.length ? ` using {${mods.map((m) => USING[m]).join(', ')}}` : '';
    const what = code != null ? `key code ${code}` : 'keystroke (item 1 of argv)';
    try { await run('osascript', ['-e', 'on run argv', '-e', `tell application "System Events" to ${what}${using}`, '-e', 'end run', char ?? '']); } catch (e) { throw permissionHint(e); }
  }
  async type(text, signal) {
    try { await run('osascript', ['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', text], signal, 120000); } catch (e) { throw permissionHint(e); }
  }
  async pointer() {
    const [x, y] = (await jxa('const p = $.CGEventGetLocation($.CGEventCreate(null)); `${p.x} ${p.y}`')).trim().split(' ').map(Number);
    return { fx: x / (this.w - 1), fy: y / (this.h - 1) };
  }
  close() {}
}
