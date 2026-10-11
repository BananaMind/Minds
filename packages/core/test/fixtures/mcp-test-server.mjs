// A real MCP server (over stdio) used by the plugin tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'minds-test', version: '1.0.0' });
server.registerTool('echo', { description: 'Echo text back', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
server.registerTool('wipe', { description: 'Pretend to delete everything', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: 'wiped' }] }));
server.registerTool('fail', { description: 'Always fails', inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }));
server.registerTool('env', { description: 'Report environment', inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: 'text', text: JSON.stringify({ token: process.env.PLUGIN_TEST_TOKEN || null, leaked: process.env.MINDS_CODEX_AUTH ? 'yes' : 'no' }) }] }));
await server.connect(new StdioServerTransport());
