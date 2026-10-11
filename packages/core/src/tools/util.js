import path from 'node:path';
import os from 'node:os';

export function resolvePath(ctx, p) {
  if (typeof p !== 'string' || !p) throw new Error('path is required');
  if (p === '~' || /^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(2));
  return path.resolve(ctx.workspace, p);
}

export function clip(s, max = 30000) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  const h = Math.floor(max * 0.6), t = max - h;
  return `${s.slice(0, h)}\n… [${s.length - max} characters omitted] …\n${s.slice(-t)}`;
}
