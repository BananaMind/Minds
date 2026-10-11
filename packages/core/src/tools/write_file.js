import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePath } from './util.js';

export default {
  name: 'write_file',
  description: 'Create or overwrite a file with the given content (parent directories are created). Relative paths resolve inside the bot workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  summarize: (a) => a.path,
  async run(ctx, { path: p, content }) {
    if (typeof content !== 'string') throw new Error('content must be a string');
    const file = resolvePath(ctx, p);
    let existed = true;
    try { await fs.access(file); } catch { existed = false; }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return `${existed ? 'Overwrote' : 'Created'} ${file} (${Buffer.byteLength(content)} bytes)`;
  },
};
