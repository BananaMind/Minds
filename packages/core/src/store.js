import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Atomic write (tmp + rename). `mode` lets secrets files be owner-only. */
export function writeJson(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file);
}

let seq = 0;
/** Time-sortable unique id. */
export function newId(prefix = '') {
  seq = (seq + 1) % 1296;
  return prefix + Date.now().toString(36).padStart(9, '0') + seq.toString(36).padStart(2, '0') + crypto.randomBytes(2).toString('hex');
}
