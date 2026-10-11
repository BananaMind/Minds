import { respond as codex } from './codex.js';
import { respond as compatible } from './openai.js';
export function respond(options) { return options.provider === 'openai' ? compatible(options) : codex(options); }
