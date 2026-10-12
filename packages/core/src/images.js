// Images the user attaches to a message: full copies on disk for the model, small thumbnails in the chat log.
import fs from 'node:fs';
import path from 'node:path';
import { newId } from './store.js';

export const MAX_IMAGES = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_THUMB_CHARS = 200_000;
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Validate and store [{data: 'data:image/...;base64,...', thumb?}] -> [{path, thumb}]. */
export function saveImages(botDir, images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new Error('images must be a list');
  if (images.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images per message.`);
  const parsed = images.map((img) => {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+=*)$/.exec(String(img?.data ?? ''));
    if (!m || !TYPES[m[1]]) throw new Error('Unsupported image. Use JPEG, PNG, WebP or GIF.');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_BYTES) throw new Error('Each image must be under 10 MB.');
    const thumb = typeof img.thumb === 'string' && img.thumb.length <= MAX_THUMB_CHARS && THUMB.test(img.thumb) ? img.thumb : null;
    return { buf, ext: TYPES[m[1]], thumb };
  });
  const dir = path.join(botDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return parsed.map(({ buf, ext, thumb }) => {
    const file = path.join(dir, `${newId('img_')}${ext}`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    return { path: file, thumb };
  });
}

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

/** A stored image as a data URL for the model, or null if it is gone. */
export function imageUrl(file) {
  try { return `data:${MIME[path.extname(file)] || 'image/jpeg'};base64,${fs.readFileSync(file).toString('base64')}`; } catch { return null; }
}
