import { app, BrowserWindow, Tray, Menu, Notification, dialog, ipcMain, shell, nativeImage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHost } from '@minds/core/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiIndex = path.join(here, '../../packages/ui/dist/index.html');
let win = null, tray = null, quitting = false;

// Finder does not load shell profiles. Include the usual Node/Homebrew locations.
if (process.platform === 'darwin') process.env.PATH = [...new Set(['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':')])].join(':');

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 520,
    backgroundColor: '#090909', frame: process.platform === 'darwin', title: 'Minds', autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } } : {}),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  win.loadFile(uiIndex);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // Closing the window keeps the bots running: the host is its own background process.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('dev.minds.desktop');
  // Microphone only for our own UI.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));

  let info;
  try { info = await ensureHost(); } catch (e) { dialog.showErrorBox('Minds', e.message); app.quit(); return; }

  ipcMain.handle('host-info', async () => (await ensureHost().catch(() => info)));
  const loginOptions = process.platform === 'win32' ? { path: process.execPath, args: app.isPackaged ? [] : [here] } : {};
  ipcMain.handle('startup-status', () => ['win32', 'darwin'].includes(process.platform) ? app.getLoginItemSettings(loginOptions).openAtLogin : false);
  ipcMain.handle('startup-set', (_e, enabled) => {
    if (!['win32', 'darwin'].includes(process.platform)) throw new Error('This startup setting is available on Windows and macOS.');
    if (process.platform === 'darwin' && !app.isPackaged) throw new Error('Install Minds in Applications before enabling Mac startup.');
    app.setLoginItemSettings({ ...loginOptions, openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings(loginOptions).openAtLogin;
  });
  ipcMain.handle('pick-files', async () => (await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })).filePaths);
  ipcMain.on('win', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });
  ipcMain.on('notify', (_e, { title, body, botId }) => {
    const n = new Notification({ title, body: String(body).slice(0, 200), silent: false });
    n.on('click', () => { showWindow(); win?.webContents.send('open-bot', botId); });
    n.show();
  });

  tray = new Tray(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAbklEQVR4nGNgGAWjYBSMglEwCkbBKBgFwx0wMjAw/KeWYf8ZGBgYqGUY45ABSD6g1AAYF1BqAIxDsQGwQKbKADgHFJdgDMAagGoAagAGANUAXAMQGtAYQEoYUA1AiAGKDcA1AH0A+gB0YYgBAHnFFbH7a3XQAAAAAElFTkSuQmCC'));
  tray.setToolTip('Minds');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Minds', click: showWindow },
    { type: 'separator' },
    { label: 'Quit window (bots keep running)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  createWindow();
});

app.on('before-quit', () => { quitting = true; });
app.on('activate', () => { if (app.isReady()) showWindow(); });
app.on('window-all-closed', () => { /* stay alive in the tray */ });
