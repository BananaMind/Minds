// Custom plugins: a folder with plugin.json + index.js (see docs/PLUGINS.md). Runs inside the host,
// so only install code you trust.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginError } from './http.js';

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function readManifest(dir) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')); } catch { throw new PluginError('No valid plugin.json found in that folder.'); }
  if (!ID.test(String(m.id || ''))) throw new PluginError('plugin.json "id" must be lowercase letters, digits and dashes (2-41 characters).');
  if (!m.name) throw new PluginError('plugin.json needs a "name".');
  const main = path.resolve(dir, m.main || 'index.js');
  const rel = path.relative(path.resolve(dir), main);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new PluginError('plugin.json "main" must stay inside the plugin folder.');
  return { ...m, main };
}

/** Load a plugin folder into the same definition shape the built-ins use. */
export async function loadNative(dir) {
  const m = readManifest(dir);
  const stamp = fs.statSync(m.main).mtimeMs;
  const mod = await import(`${pathToFileURL(m.main).href}?v=${stamp}`);
  const impl = typeof mod.default === 'function' ? { tools: mod.default } : (mod.default || mod);
  if (typeof impl.tools !== 'function') throw new PluginError('The plugin must export a tools(ctx) function.');
  return {
    id: m.id, name: m.name, description: m.description || '', icon: m.icon || 'plugin',
    setup: m.setup || { summary: '', steps: [], fields: [] },
    publicOk: m.publicOk !== false && !(m.setup?.fields || []).some((f) => f.required),
    connect: impl.connect, tools: impl.tools, version: m.version, author: m.author, homepage: m.homepage,
  };
}
