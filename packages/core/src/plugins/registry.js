// Discover MCP apps and resolve their published setup fields without using a shell.
import { request, PluginError, clip } from './http.js';

const registry = () => process.env.MINDS_MCP_REGISTRY || 'https://registry.modelcontextprotocol.io';
const RUNTIMES = { npm: 'npx', pypi: 'uvx', oci: 'docker' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const titleOf = (name) => String(name).split('/').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const placeholders = (s) => [...String(s || '').matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
const argKey = (a, i, prefix) => `${prefix}:${a.name || a.valueHint || i}`;

function addField(fields, key, label, input) {
  const existing = fields.find((f) => f.key === key);
  if (existing) { existing.required ||= Boolean(input.isRequired); existing.secret ||= Boolean(input.isSecret); return; }
  fields.push({ key, label, description: input.description, placeholder: input.placeholder, secret: Boolean(input.isSecret), required: Boolean(input.isRequired), default: input.default, choices: input.choices });
}

function inputFields(fields, input, key, label) {
  const vars = placeholders(input.value).filter((v) => input.variables?.[v]);
  for (const v of vars) addField(fields, `var:${v}`, v, input.variables[v]);
  if (input.value === undefined) addField(fields, key, label, input);
}

/** Plain metadata for clients: no credentials or running code. */
export function normalize(item) {
  const s = item.server || item;
  const options = [];
  for (const p of s.packages || []) {
    const runtime = p.runtimeHint || RUNTIMES[p.registryType];
    if (!RUNTIMES[p.registryType] || !Object.values(RUNTIMES).includes(runtime) || (p.transport?.type && p.transport.type !== 'stdio')) continue;
    const fields = [];
    for (const e of p.environmentVariables || []) inputFields(fields, e, `env:${e.name}`, e.name);
    (p.runtimeArguments || []).forEach((a, i) => inputFields(fields, a, argKey(a, i, 'runtimeArg'), a.name || a.valueHint || 'runtime argument'));
    (p.packageArguments || []).forEach((a, i) => inputFields(fields, a, argKey(a, i, 'arg'), a.name || a.valueHint || 'argument'));
    options.push({ kind: 'package', label: `${p.registryType}: ${p.identifier}${p.version ? `@${p.version}` : ''}`, registryType: p.registryType, runtime, identifier: p.identifier, version: p.version, args: p.packageArguments || [], runtimeArgs: p.runtimeArguments || [], env: p.environmentVariables || [], fields });
  }
  for (const r of s.remotes || []) {
    if (!['streamable-http', 'sse'].includes(r.type)) continue;
    const fields = [];
    for (const v of placeholders(r.url)) if (r.variables?.[v]) addField(fields, `var:${v}`, v, r.variables[v]);
    for (const h of r.headers || []) {
      inputFields(fields, h, `header:${h.name}`, h.name);
      // Older entries publish header placeholders without a variables map.
      for (const v of placeholders(h.value)) if (!h.variables?.[v]) addField(fields, `var:${v}`, v, { ...h, isRequired: h.isRequired !== false });
    }
    options.push({ kind: 'remote', label: `Remote: ${r.url}`, transport: r.type === 'sse' ? 'sse' : 'http', url: r.url, variables: r.variables || {}, headers: r.headers || [], fields });
  }
  return { name: s.name, title: s.title || titleOf(s.name), description: clip(s.description || '', 400), repo: s.repository?.url, version: s.version, website: s.websiteUrl, options };
}

export async function search(q, { limit = 20 } = {}) {
  const query = new URLSearchParams({ search: String(q || ''), limit: String(limit), version: 'latest' });
  const r = await request(`${registry()}/v0.1/servers?${query}`, { timeoutMs: 20000 });
  const seen = new Set();
  return (r.servers || []).filter((item) => !item._meta?.['io.modelcontextprotocol.registry/official']?.isDeleted).map(normalize).filter((e) => e.options.length && !seen.has(e.name) && seen.add(e.name));
}

/** Resolve defaults, fixed values, variables, and secrets into a runnable MCP spec. */
export function buildSpec(entry, optionIndex, values = {}) {
  const o = entry.options[optionIndex];
  if (!o) throw new PluginError('Pick one of the install options.');
  const valueOf = (key) => values[key] ?? o.fields.find((f) => f.key === key)?.default ?? '';
  for (const f of o.fields) {
    const value = String(valueOf(f.key));
    if (f.required && !value.trim()) throw new PluginError(`${f.label} is required.`);
    if (value && f.choices?.length && !f.choices.includes(value)) throw new PluginError(`Choose a valid value for ${f.label}.`);
  }
  const substitute = (s, variables, legacy = false) => String(s).replace(/\{([A-Za-z0-9_]+)\}/g, (match, v) => variables?.[v] || legacy ? String(variables?.[v]?.value ?? valueOf(`var:${v}`)) : match);
  const resolve = (input, key, legacy = false) => input.value !== undefined ? substitute(input.value, input.variables, legacy) : valueOf(key);
  const isSecret = (input, key) => Boolean(input.isSecret || o.fields.find((f) => f.key === key)?.secret || placeholders(input.value).some((v) => o.fields.find((f) => f.key === `var:${v}`)?.secret));
  const id = `mcp-${slug(entry.name)}`;
  const secrets = {};
  if (o.kind === 'package') {
    const args = [];
    const push = (v, secret = false) => { if (secret) { secrets[`arg:${args.length}`] = String(v); args.push(''); } else args.push(String(v)); };
    const addArgs = (list, prefix) => list.forEach((a, i) => {
      const key = argKey(a, i, prefix), v = resolve(a, key);
      if (v === undefined || v === '') return;
      if (a.type === 'named') push(a.name.startsWith('-') ? a.name : `--${a.name}`);
      push(v, isSecret(a, key));
    });
    for (const e of o.env || []) {
      const v = resolve(e, `env:${e.name}`);
      if (v !== '') secrets[`env:${e.name}`] = String(v);
    }
    let ident = o.identifier;
    if (o.version && ['npm', 'pypi'].includes(o.registryType)) ident = `${ident}@${o.version}`;
    if (o.registryType === 'oci' && o.version && !ident.includes('@') && !ident.split('/').pop().includes(':')) ident = `${ident}:${o.version}`;
    if (o.runtime === 'docker') {
      push('run'); push('-i'); push('--rm');
      for (const key of Object.keys(secrets).filter((k) => k.startsWith('env:'))) { push('-e'); push(key.slice(4)); }
    } else if (o.runtime === 'npx') push('-y');
    addArgs(o.runtimeArgs || [], 'runtimeArg');
    push(ident);
    addArgs(o.args, 'arg');
    return { id, name: entry.title, description: entry.description, spec: { transport: 'stdio', command: o.runtime, args, registry: entry.name }, secrets };
  }
  for (const h of o.headers) {
    const value = resolve(h, `header:${h.name}`, true);
    if (value) secrets[`header:${h.name}`] = String(value);
  }
  const url = substitute(o.url, o.variables);
  let parsed;
  try { parsed = new URL(url); } catch { throw new PluginError('The plugin URL is invalid. Check its setup values.'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new PluginError('Use an https:// plugin URL (http is only allowed for localhost).');
  const secretUrl = placeholders(o.url).some((v) => o.fields.find((f) => f.key === `var:${v}`)?.secret);
  if (secretUrl) secrets.serverUrl = url;
  return { id, name: entry.title, description: entry.description, spec: { transport: o.transport, url: secretUrl ? o.url : url, registry: entry.name }, secrets };
}
