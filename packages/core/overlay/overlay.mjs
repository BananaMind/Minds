// Bot cursor overlay: transparent, click-through, always-on-top windows (one per display) that draw where a bot
// is acting. Reads cursor updates as JSON lines on stdin from the Minds app. Never takes focus.
import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Wayland gives apps no way to stay on top; XWayland windows can.
if (process.platform === 'linux') { app.commandLine.appendSwitch('ozone-platform', 'x11'); app.commandLine.appendSwitch('enable-transparent-visuals'); }
app.dock?.hide();

const CURSOR_MS = 5000; // cursor fades after this long without bot input
const LOOK_MS = 3000;   // "looking" border stays this long after a screenshot
let wins = [], cursorTimer = null, lookTimer = null, last = null, looking = null;

function build() {
  for (const w of wins) w.win.destroy();
  wins = screen.getAllDisplays().map((d) => {
    const win = new BrowserWindow({
      ...d.bounds, transparent: true, frame: false, focusable: false, skipTaskbar: true, resizable: false, movable: false,
      hasShadow: false, show: false, alwaysOnTop: true, enableLargerThanScreen: true, backgroundColor: '#00000000',
      // X11 window managers squeeze normal windows out of panel areas; dock windows may cover the whole display.
      ...(process.platform === 'linux' ? { type: 'dock' } : {}),
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(here, 'overlay.html'));
    return { win, display: d, ready: new Promise((r) => win.webContents.once('did-finish-load', r)) };
  });
}

/** Fraction of the screenshot area -> global point (in Electron's display coordinates). */
function toPoint(fx, fy, area) {
  const ds = area === 'primary' ? [screen.getPrimaryDisplay()] : screen.getAllDisplays();
  const minX = Math.min(...ds.map((d) => d.bounds.x)), minY = Math.min(...ds.map((d) => d.bounds.y));
  const maxX = Math.max(...ds.map((d) => d.bounds.x + d.bounds.width)), maxY = Math.max(...ds.map((d) => d.bounds.y + d.bounds.height));
  return { x: minX + fx * (maxX - minX), y: minY + fy * (maxY - minY) };
}

const inside = (b, p) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;

/** Push current cursor/looking state to every display's window; show windows with something to draw. */
async function render() {
  const primary = screen.getPrimaryDisplay().id;
  for (const w of wins) {
    const b = w.display.bounds;
    const cursor = last && inside(b, last) ? { x: last.x - b.x, y: last.y - b.y, name: last.name, color: last.color, action: last.action } : null;
    const look = looking && (looking.area !== 'primary' || w.display.id === primary) ? { name: looking.name, color: looking.color, label: w.display.id === primary || looking.area === 'primary' } : null;
    await w.ready;
    w.win.webContents.executeJavaScript(`window.botCursor(${JSON.stringify(cursor)}); window.botLook(${JSON.stringify(look)})`).catch(() => {});
    if ((cursor || look) && !w.win.isVisible()) { w.win.showInactive(); w.win.setAlwaysOnTop(true, 'screen-saver'); w.win.setBounds(w.display.bounds); }
    if (!cursor && !look && w.win.isVisible()) setTimeout(() => { if (!last && !looking) w.win.hide(); }, 400); // after the fade
  }
}

function update(msg) {
  if (msg.kind === 'look') {
    looking = { name: msg.name, color: msg.color, area: msg.area };
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => { looking = null; render(); }, LOOK_MS);
  } else {
    if (msg.fx != null) last = { ...toPoint(msg.fx, msg.fy, msg.area) };
    if (!last) return;
    Object.assign(last, { name: msg.name, color: msg.color, action: msg.action });
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { last = null; render(); }, CURSOR_MS);
  }
  render();
}

app.whenReady().then(() => {
  build();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, build);
  readline.createInterface({ input: process.stdin }).on('line', (line) => { try { update(JSON.parse(line)); } catch {} });
  process.stdin.on('end', () => app.quit());
});
app.on('window-all-closed', () => {});
