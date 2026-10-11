// Community plugins via the Model Context Protocol (MCP): any app with an MCP server works.
// Servers run as a local process (stdio) or are reached over HTTP; their tools appear to bots like built-in ones.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import crypto from 'node:crypto';
import { PluginError, clip } from './http.js';

const CONNECT_TIMEOUT_MS = 45_000;
const CALL_TIMEOUT_MS = 120_000;

/** Make a safe, short tool name: letters, digits, _ and -, at most 64 characters. */
export function toolName(prefix, name) {
  const base = `${prefix}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_');
  if (base.length <= 64) return base;
  return `${base.slice(0, 55)}_${crypto.createHash('sha1').update(base).digest('hex').slice(0, 8)}`;
}

/** MCP input schemas must become plain JSON-schema objects for the model API. */
export function normalizeSchema(schema) {
  const s = schema && typeof schema === 'object' ? { ...schema } : {};
  delete s.$schema;
  if (s.type !== 'object') return { type: 'object', properties: {} };
  s.properties ||= {};
  return s;
}

function textOf(result) {
  const parts = [];
  for (const c of result.content || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image') parts.push(`[image ${c.mimeType || ''} omitted]`);
    else if (c.type === 'audio') parts.push('[audio omitted]');
    else if (c.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri || ''}]`);
    else if (c.type === 'resource_link') parts.push(`[link ${c.uri}${c.name ? ` (${c.name})` : ''}]`);
  }
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join('\n');
}

export class McpConnection {
  /**
   * spec: {transport:'stdio'|'http'|'sse', command?, args?, url?}
   * secrets: {env:{NAME:value}, headers:{Name:value}}
   */
  constructor(spec, secrets = {}) {
    this.spec = spec; this.secrets = secrets;
    this.client = null; this.connecting = null; this.stderr = '';
    this.opening = null; this.closed = false;
  }

  get connected() { return Boolean(this.client); }

  async #open() {
    const open = async (transport) => {
      if (this.closed) throw new PluginError('The plugin connection was closed.');
      const client = new Client({ name: 'minds', version: '0.1.0' }, { capabilities: {} });
      this.opening = client;
      client.onclose = () => { if (this.client === client) this.client = null; };
      try {
        await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
        if (this.closed) throw new PluginError('The plugin connection was closed.');
        this.client = client;
      } catch (e) { await client.close().catch(() => {}); throw e; }
      finally { if (this.opening === client) this.opening = null; }
    };
    const { transport, command, args = [], url } = this.spec;
    const headers = { ...(this.secrets.headers || {}) };
    if (transport === 'stdio') {
      if (!command) throw new PluginError('This plugin has no command to run.');
      const t = new StdioClientTransport({ command, args, env: { ...getDefaultEnvironment(), ...(this.secrets.env || {}) }, stderr: 'pipe' });
      t.stderr?.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
      try { await open(t); }
      catch (e) {
        const hint = /ENOENT/.test(e.message) ? ` Is "${command}" installed and on your PATH?` : '';
        throw new PluginError(`Could not start the plugin: ${e.message}.${hint}${this.stderr ? `\n${clip(this.stderr, 500)}` : ''}`);
      }
    } else {
      const u = new URL(url);
      const opts = { requestInit: { headers } };
      try {
        await open(transport === 'sse' ? new SSEClientTransport(u, opts) : new StreamableHTTPClientTransport(u, opts));
      } catch (e) {
        if (transport !== 'sse' && !this.closed && !(e.code === 401 || e.code === 403)) {
          // Older servers speak SSE only.
          try { await open(new SSEClientTransport(u, opts)); return; } catch { /* report the first error */ }
        }
        throw new PluginError(`Could not connect to the plugin: ${e.message}`);
      }
    }
  }

  async connect() {
    if (this.closed) throw new PluginError('The plugin connection was closed.');
    if (this.client) return this.client;
    this.connecting ||= this.#open().finally(() => { this.connecting = null; });
    await this.connecting;
    return this.client;
  }

  async listTools() {
    const c = await this.connect();
    const out = [];
    let cursor;
    do {
      const r = await c.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT_MS });
      out.push(...r.tools);
      cursor = r.nextCursor;
    } while (cursor && out.length < 500);
    return out;
  }

  async call(name, args, signal) {
    const c = await this.connect();
    let r;
    try { r = await c.callTool({ name, arguments: args || {} }, undefined, { signal, timeout: CALL_TIMEOUT_MS }); }
    catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      throw new PluginError(e.message);
    }
    const text = textOf(r);
    if (r.isError) throw new PluginError(clip(text || 'The plugin reported an error.', 2000));
    return clip(text, 60000);
  }

  async close() {
    this.closed = true;
    const c = this.client; this.client = null;
    await Promise.allSettled([...new Set([c, this.opening].filter(Boolean))].map((client) => client.close()));
  }
}

/** Turn an MCP tool list into Minds tool objects (run() is bound by the manager). */
export function mapTools(shortName, mcpTools) {
  return mcpTools.map((t) => ({
    name: toolName(shortName, t.name),
    remoteName: t.name,
    title: t.annotations?.title || t.title || t.name,
    description: clip(t.description || t.title || t.name, 800),
    parameters: normalizeSchema(t.inputSchema),
    // Unknown means "might change things": only tools that declare themselves read-only skip the approval rules.
    access: t.annotations?.readOnlyHint === true ? 'read' : 'write',
    summarize: (a) => clip(Object.entries(a || {}).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' '), 160),
  }));
}
