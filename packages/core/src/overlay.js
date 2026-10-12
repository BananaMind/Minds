// On-screen indicators drawn for the host, whether or not the Minds window is open: a bot's own cursor while it
// controls the computer, and a glowing screen border while it looks at the screen. Drawn by ../overlay/overlay.mjs,
// started here as a separate Electron process (the desktop app's binary, or the `electron` package if installed).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const OVERLAY = fileURLToPath(new URL('../overlay/overlay.mjs', import.meta.url));

/** -> [command, args] or null when no Electron is available (e.g. a CLI-only install). */
export function overlayCommand({ platform = process.platform } = {}) {
  let electron = process.versions.electron ? process.execPath : null; // host started by the app, at login, or via ELECTRON_RUN_AS_NODE
  if (!electron) { try { electron = createRequire(import.meta.url)('electron'); } catch {} }
  if (typeof electron !== 'string' || !fs.existsSync(electron)) return null;
  // A packaged Minds app ignores the script path and enters overlay mode from --minds-overlay (apps/desktop/main.mjs).
  return [electron, [OVERLAY, '--minds-overlay', ...(platform === 'linux' ? ['--ozone-platform=x11'] : [])]];
}

const SHOWN = new Set(['computer.cursor', 'screen.looking']);

export class ScreenOverlay {
  #child = null; #failed = false;

  /** Forward the host's cursor and looking events to the overlay process. */
  attach(host) { host.on('event', (event, data) => { if (SHOWN.has(event)) this.send({ ...data, kind: event === 'screen.looking' ? 'look' : 'cursor' }); }); }

  send(msg) {
    if (!this.#child && !this.#failed) this.#start();
    this.#child?.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  #start() {
    const cmd = overlayCommand();
    if (!cmd) { this.#failed = true; console.error('screen overlay unavailable: install the Minds desktop app or the electron package to see bot indicators'); return; }
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = this.#child = spawn(cmd[0], cmd[1], { env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.stdin.on('error', () => {});
    child.on('error', (e) => { console.error('screen overlay:', e.message); this.#failed = true; this.#child = null; });
    child.on('exit', () => { if (this.#child === child) this.#child = null; });
  }

  stop() { this.#child?.kill(); this.#child = null; }
}
