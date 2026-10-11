import fs from 'node:fs/promises';
import { resolvePath } from './util.js';

export default {
  name: 'edit_file',
  description: 'Edit a file by replacing an exact string. `old_string` must match exactly once unless replace_all is true. Read the file first so the match is exact.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  summarize: (a) => a.path,
  async run(ctx, { path: p, old_string, new_string, replace_all = false }) {
    if (!old_string) throw new Error('old_string must not be empty');
    if (old_string === new_string) throw new Error('old_string and new_string are identical');
    const file = resolvePath(ctx, p);
    const text = await fs.readFile(file, 'utf8');
    const count = text.split(old_string).length - 1;
    if (count === 0) throw new Error('old_string not found in file');
    if (count > 1 && !replace_all) throw new Error(`old_string matches ${count} times; add context or set replace_all`);
    const next = replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string);
    await fs.writeFile(file, next);
    return `Edited ${file} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? 's' : ''})`;
  },
};
