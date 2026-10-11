import fs from 'node:fs/promises';
import { resolvePath, clip } from './util.js';

export default {
  name: 'read_file',
  description: 'Read a text file from the host PC. Returns numbered lines. Relative paths resolve inside the bot workspace; `~` is the home directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: '1-based first line (default 1).' },
      limit: { type: 'number', description: 'Max lines (default 2000).' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  summarize: (a) => a.path,
  async run(ctx, { path: p, offset = 1, limit = 2000 }) {
    const file = resolvePath(ctx, p);
    const st = await fs.stat(file);
    if (st.isDirectory()) {
      const names = await fs.readdir(file, { withFileTypes: true });
      return names.map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n') || '(empty directory)';
    }
    if (st.size > 5_000_000) throw new Error(`File is ${st.size} bytes; too large. Use exec_command (head/grep) instead.`);
    const buf = await fs.readFile(file);
    if (buf.subarray(0, 8000).includes(0)) throw new Error('File looks binary.');
    const lines = buf.toString('utf8').split('\n');
    const start = Math.max(1, Math.floor(offset)), end = Math.min(lines.length, start - 1 + Math.max(1, Math.floor(limit)));
    const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(6)}\t${l}`).join('\n');
    return clip(body + (end < lines.length ? `\n[… ${lines.length - end} more lines; use offset=${end + 1}]` : ''), 60000);
  },
};
