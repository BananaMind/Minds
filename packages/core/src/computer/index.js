// Picks the input backend for this computer. All take positions as fractions (0..1) of the captured screen area.
import { PortalInput } from './portal.js';
import { XdotoolInput } from './xdotool.js';
import { WindowsInput } from './windows.js';
import { MacInput } from './macos.js';

export function backendName({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland') return 'portal';
  if (env.DISPLAY) return 'xdotool';
  return null;
}

let current = null;
export function inputBackend() {
  if (current) return current;
  const name = backendName();
  if (!name) throw new Error('No graphical desktop found for computer control (no display).');
  current = new { windows: WindowsInput, macos: MacInput, portal: PortalInput, xdotool: XdotoolInput }[name]();
  return current;
}
export function closeInput() { current?.close(); current = null; }
