import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Preserve slashes in registry names and package commands; allow explicit sources for ambiguous paths. */
export function installRequest(target, flags = {}) {
  const pairs = (input, separator) => Object.fromEntries([].concat(input || []).map((line) => {
    const text = String(line), i = text.indexOf(separator);
    if (i < 1) throw new Error(`Expected KEY${separator}value.`);
    return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }));
  const expanded = path.resolve(target.replace(/^~(?=$|[\\/])/, os.homedir()));
  let source = flags.source;
  if (!source) {
    if (/^https:\/\/.*\.git(?:[?#].*)?$|^git@/.test(target)) source = 'git';
    else if (/^https?:\/\//.test(target)) source = 'url';
    else if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) source = 'folder';
    else if (/^[\w.-]+\/[\w.-]+$/.test(target)) source = 'registry';
    else if (/\s/.test(target)) source = 'command';
    else if (/^[~./]|^[A-Za-z]:[\\/]/.test(target) || target.includes(path.sep)) source = 'folder';
    else source = 'command';
  }
  switch (source) {
    case 'git': return { source, url: target };
    case 'url': return { source, url: target, headers: pairs(flags.header, ':'), name: flags.name, transport: flags.transport };
    case 'folder': return { source, path: target };
    case 'registry': return { source, name: target, values: {} };
    case 'command': return { source, command: target, env: pairs(flags.env, '='), name: flags.name };
    default: throw new Error('Use --source registry, command, url, folder or git.');
  }
}
