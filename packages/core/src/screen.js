// Screen capture shared by view_screen and computer: one PNG grab, shrunk for the model, with its geometry.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { powerShellArgs } from './windows.js';

const MAX_SIDE = 1600;
const KEEP_SHOTS = 20;

export const run = (cmd, args, signal, timeout = 20000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, signal: signal ?? undefined, windowsHide: true }, (e, stdout, stderr) => e ? reject(Object.assign(e, { stderr })) : resolve(stdout));
});
const exists = async (f) => { try { return (await fs.stat(f)).size > 0; } catch { return false; } };

/** Which part of the desktop a screenshot shows: macOS grabs the main display, the others every display. */
export const captureArea = (platform = process.platform) => (platform === 'darwin' ? 'primary' : 'all');

/** Capture commands to try in order; each writes a PNG to `file`. */
export function captureCommands(file, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') return [['screencapture', ['-x', '-m', '-t', 'png', file]]];
  if (platform === 'win32') return [['powershell.exe', powerShellArgs([
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
    // Physical pixels on scaled displays, matching the input coordinates.
    "Add-Type -Name Dpi -Namespace Minds -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();'",
    '[Minds.Dpi]::SetProcessDPIAware() | Out-Null',
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
    `$bmp.Save('${file.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join('\n'))]];
  const wayland = env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland';
  const desktop = String(env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  const cmds = [];
  if (desktop.includes('kde')) cmds.push(['spectacle', ['-b', '-n', '-f', '-o', file]]);
  if (desktop.includes('gnome')) cmds.push(['gnome-screenshot', ['-f', file]]);
  if (wayland) cmds.push(['grim', [file]]);
  if (env.DISPLAY) cmds.push(['import', ['-window', 'root', file]], ['scrot', ['-o', file]], ['maim', [file]]);
  cmds.push(['spectacle', ['-b', '-n', '-f', '-o', file]], ['gnome-screenshot', ['-f', file]]);
  return cmds.filter(([c], i) => cmds.findIndex(([d]) => d === c) === i);
}

/** Width/height from a PNG header. */
export async function pngSize(file) {
  const fh = await fs.open(file);
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('Screenshot is not a PNG.');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally { await fh.close(); }
}

/** Size of the image the model sees, given the captured size. */
export function shrunkSize({ width, height }, maxSide = MAX_SIDE) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Shrink to at most MAX_SIDE px as JPEG when a resizer is available; otherwise keep the PNG. */
async function shrink(png, signal) {
  const jpg = png.replace(/\.png$/, '.jpg');
  const tries = process.platform === 'darwin'
    ? [['sips', ['-Z', String(MAX_SIDE), '-s', 'format', 'jpeg', png, '--out', jpg]]]
    : [['magick', [png, '-resize', `${MAX_SIDE}x${MAX_SIDE}>`, '-quality', '80', jpg]], ['convert', [png, '-resize', `${MAX_SIDE}x${MAX_SIDE}>`, '-quality', '80', jpg]]];
  for (const [cmd, args] of tries) {
    try { await run(cmd, args, signal); if (await exists(jpg)) { await fs.rm(png, { force: true }); return jpg; } } catch {}
  }
  return png;
}

async function prune(dir) {
  const names = (await fs.readdir(dir)).filter((n) => /^screen-\d+\.(png|jpg)$/.test(n)).sort();
  await Promise.all(names.slice(0, Math.max(0, names.length - KEEP_SHOTS)).map((n) => fs.rm(path.join(dir, n), { force: true })));
}

/** The most recent capture's geometry: model coordinates are in its `image` size. */
export let lastCapture = null;

/** Grab the screen into `dir`. -> {image, image size the model sees, captured size}. */
export async function captureScreen(dir, signal) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const png = path.join(dir, `screen-${Date.now()}.png`);
  const errors = [];
  for (const [cmd, args] of captureCommands(png)) {
    try { await run(cmd, args, signal); } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`${cmd}: ${e.code === 'ENOENT' ? 'not installed' : String(e.stderr || e.message).trim().split('\n')[0]}`);
      continue;
    }
    if (await exists(png)) {
      const full = await pngSize(png);
      const image = await shrink(png, signal);
      await prune(dir).catch(() => {});
      lastCapture = { image, full, size: image.endsWith('.png') ? full : shrunkSize(full), area: captureArea(), ts: Date.now() };
      return lastCapture;
    }
    errors.push(`${cmd}: produced no image`);
  }
  throw new Error(`Could not capture the screen (no display, or no screenshot tool available). Tried: ${errors.join('; ')}`);
}
