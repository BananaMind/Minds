// Linux Wayland input through the desktop portal (RemoteDesktop + ScreenCast). Works on GNOME, KDE and
// other portal-backed desktops without root. The user approves once; a restore token skips the dialog later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MINDS_HOME } from '../paths.js';
import { keysym } from './keys.js';

const DEST = 'org.freedesktop.portal.Desktop';
const OBJ = '/org/freedesktop/portal/desktop';
const RD = 'org.freedesktop.portal.RemoteDesktop';
const SC = 'org.freedesktop.portal.ScreenCast';
const BTN = { left: 0x110, right: 0x111, middle: 0x112 }; // evdev BTN_LEFT/RIGHT/MIDDLE
const tokenFile = () => path.join(MINDS_HOME, 'computer-portal.json');

let dbus = null;
const load = async () => (dbus ??= await import('dbus-next').catch(() => { throw new Error('Wayland control needs the dbus-next package. Run npm install.'); }));

/** Desktop bounds and the stream holding a desktop point (streams are monitors in logical pixels). */
export function locate(streams, fx, fy) {
  const xs = streams.map((s) => s.x), ys = streams.map((s) => s.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...streams.map((s) => s.x + s.w)), maxY = Math.max(...streams.map((s) => s.y + s.h));
  const gx = minX + fx * (maxX - minX), gy = minY + fy * (maxY - minY);
  const s = streams.find((t) => gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h) || streams[0];
  return { stream: s.id, x: Math.min(Math.max(gx - s.x, 0), s.w - 1), y: Math.min(Math.max(gy - s.y, 0), s.h - 1) };
}

/** Global desktop point -> fraction of the area covered by the streams. */
export function toFraction(streams, x, y) {
  const minX = Math.min(...streams.map((s) => s.x)), minY = Math.min(...streams.map((s) => s.y));
  const w = Math.max(...streams.map((s) => s.x + s.w)) - minX, h = Math.max(...streams.map((s) => s.y + s.h)) - minY;
  return { fx: (x - minX) / w, fy: (y - minY) / h };
}

export class PortalInput {
  constructor() { this.session = null; this.streams = []; this.opening = null; }

  async #call(iface, member, signature, body) {
    const { Message } = await load();
    return (await this.bus.call(new Message({ destination: DEST, path: OBJ, interface: iface, member, signature, body }))).body;
  }

  /** Portal methods answer through a Request object's Response signal. */
  async #request(iface, member, signature, body, options, signal, timeoutMs = 30000) {
    const { Variant } = await load();
    const token = `minds${randomBytes(6).toString('hex')}`;
    const reqPath = `${OBJ}/request/${this.bus.name.slice(1).replaceAll('.', '_')}/${token}`;
    const reply = new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); this.bus.off('message', onMsg); signal?.removeEventListener('abort', onAbort); fn(v); };
      const onMsg = (m) => { if (m.path === reqPath && m.member === 'Response') done(resolve, m.body); };
      const onAbort = () => done(reject, Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const timer = setTimeout(() => done(reject, new Error('The screen control permission request timed out. Approve the “Remote desktop” dialog to let the bot control the computer.')), timeoutMs);
      this.bus.on('message', onMsg);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    await this.#call(iface, member, signature, [...body, { handle_token: new Variant('s', token), ...options }]);
    const [code, results] = await reply;
    if (code === 1) throw new Error('Screen control was declined. Ask the bot again and approve the “Remote desktop” dialog to allow it.');
    if (code !== 0) throw new Error(`The desktop portal refused screen control (${member}).`);
    return results;
  }

  async open(signal) {
    if (this.session) return;
    this.opening ??= this.#open(signal).finally(() => { this.opening = null; });
    return this.opening;
  }

  async #open(signal) {
    const { sessionBus, Variant } = await load();
    if (!this.bus) {
      this.bus = sessionBus();
      await new Promise((resolve, reject) => { this.bus.once('connect', resolve); this.bus.once('error', reject); });
      this.bus.on('error', () => this.#reset());
      const { Message } = dbus;
      await this.bus.call(new Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [`type='signal',sender='${DEST}'`] }));
      this.bus.on('message', (m) => { if (m.member === 'Closed' && m.path === this.session) this.#reset(); });
    }
    const created = await this.#request(RD, 'CreateSession', 'a{sv}', [], { session_handle_token: new Variant('s', `minds${randomBytes(6).toString('hex')}`) }, signal);
    const session = created.session_handle.value;
    let saved = null; try { saved = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).restoreToken; } catch {}
    await this.#request(RD, 'SelectDevices', 'oa{sv}', [session], {
      types: new Variant('u', 3), // keyboard | pointer
      persist_mode: new Variant('u', 2),
      ...(saved ? { restore_token: new Variant('s', saved) } : {}),
    }, signal);
    // Absolute pointer motion needs screen-cast streams to position against.
    await this.#request(SC, 'SelectSources', 'oa{sv}', [session], { types: new Variant('u', 1), multiple: new Variant('b', true) }, signal);
    const started = await this.#request(RD, 'Start', 'osa{sv}', [session, ''], {}, signal, 180000);
    const streams = (started.streams?.value || []).map(([id, props]) => {
      const pos = props.position?.value || [0, 0], size = props.size?.value;
      return { id, x: pos[0], y: pos[1], w: size?.[0], h: size?.[1] };
    }).filter((s) => s.w && s.h);
    if (!(started.devices?.value & 2) || !streams.length) {
      await this.#closeSession(session);
      throw new Error('Screen control was only partly granted. Allow pointer, keyboard and the whole screen in the “Remote desktop” dialog.');
    }
    if (started.restore_token?.value) {
      fs.mkdirSync(MINDS_HOME, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokenFile(), JSON.stringify({ restoreToken: started.restore_token.value }), { mode: 0o600 });
    }
    this.session = session; this.streams = streams;
  }

  async #closeSession(session) {
    const { Message } = await load();
    await this.bus.call(new Message({ destination: DEST, path: session, interface: 'org.freedesktop.portal.Session', member: 'Close' })).catch(() => {});
  }
  #reset() { this.session = null; this.streams = []; }

  async #notify(member, signature, args) {
    if (!this.session) throw new Error('Screen control session ended. Try again.');
    await this.#call(RD, member, signature, [this.session, {}, ...args]);
  }

  async move(fx, fy) {
    const p = locate(this.streams, fx, fy);
    await this.#notify('NotifyPointerMotionAbsolute', 'oa{sv}udd', [p.stream, p.x, p.y]);
  }
  button(btn, down) { return this.#notify('NotifyPointerButton', 'oa{sv}iu', [BTN[btn], down ? 1 : 0]); }
  async scroll(dx, dy) {
    if (dy) await this.#notify('NotifyPointerAxisDiscrete', 'oa{sv}ui', [0, dy]);
    if (dx) await this.#notify('NotifyPointerAxisDiscrete', 'oa{sv}ui', [1, dx]);
  }
  key(key, down) { return this.#notify('NotifyKeyboardKeysym', 'oa{sv}iu', [keysym(key), down ? 1 : 0]); }
  async type(text, signal) {
    for (const ch of text) {
      signal?.throwIfAborted();
      await this.key(ch, true); await this.key(ch, false);
      await new Promise((r) => setTimeout(r, 8));
    }
  }
  /** The user's pointer, so it can be put back after the bot acts. KDE only (via a one-shot KWin script). */
  async pointer() {
    if (!/kde/i.test(process.env.XDG_CURRENT_DESKTOP || '') || !this.bus) return null;
    const { Message } = await load();
    if (!this.service) {
      this.service = `org.minds.Computer.p${process.pid}`;
      await this.bus.requestName(this.service, 0);
      this.bus.addMethodHandler((m) => {
        if (m.interface !== 'org.minds.Computer' || m.member !== 'Pos') return false;
        this.bus.send(Message.newMethodReturn(m)); this.onPos?.(m.body); return true;
      });
      this.script = path.join(os.tmpdir(), `minds-pointer-${process.pid}.js`);
      fs.writeFileSync(this.script, `callDBus(${JSON.stringify(this.service)}, "/", "org.minds.Computer", "Pos", workspace.cursorPos.x, workspace.cursorPos.y);`);
    }
    const kwin = (p, iface, member, signature, body) => this.bus.call(new Message({ destination: 'org.kde.KWin', path: p, interface: iface, member, signature, body }));
    const plugin = `minds-pointer-${process.pid}`;
    const pos = new Promise((resolve) => { this.onPos = resolve; setTimeout(() => resolve(null), 1000); });
    try {
      const [id] = (await kwin('/Scripting', 'org.kde.kwin.Scripting', 'loadScript', 'ss', [this.script, plugin])).body;
      await kwin(`/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run', '', []);
      const xy = await pos;
      return xy ? toFraction(this.streams, Number(xy[0]), Number(xy[1])) : null;
    } catch { return null; } finally { await kwin('/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', [plugin]).catch(() => {}); }
  }
  close() { if (this.session) this.#closeSession(this.session); this.#reset(); this.bus?.disconnect(); this.bus = null; }
}
