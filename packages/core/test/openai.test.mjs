import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-compatible-'));
process.env.MINDS_HOME = path.join(tmp, 'home');
process.env.MINDS_CODEX_AUTH = path.join(tmp, 'no-auth.json');
const { Host } = await import('../src/host.js');
const { Settings } = await import('../src/settings.js');
const { respond, normalizeConfig, listModels, chatMessages } = await import('../src/providers/openai.js');
let handler;
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  await handler(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const event = data => `data: ${JSON.stringify(data)}\r\n\r\n`;

test('compatible settings retain keys, redact secrets, normalize URLs and allow arbitrary local model IDs', () => {
  const settings = new Settings();
  settings.set({ defaultModel: 'local/model:latest', defaultProvider: 'openai', openai: { baseUrl, apiKey: 'private', models: ['local/model:latest'] } });
  settings.set({ openai: { models: ['other.gguf'] } });
  assert.equal(settings.get().openai.apiKey, 'private');
  assert.equal(settings.get().openai.baseUrl, baseUrl);
  assert.equal(settings.get().defaultModel, 'local/model:latest');
  assert.equal(JSON.stringify(settings.public()).includes('private'), false);
  assert.equal(normalizeConfig({ baseUrl: `${baseUrl}/chat/completions` }).baseUrl, baseUrl);
  assert.throws(() => normalizeConfig({ baseUrl: 'file:///tmp/test' }), /HTTP/);
  assert.equal(normalizeConfig({ baseUrl }).images, false);
  assert.equal(normalizeConfig({}, normalizeConfig({ baseUrl, images: true })).images, true);
  assert.throws(() => normalizeConfig({ baseUrl, apiKey: 'bad\nkey' }), /key/);
});

test('local bot runs a streamed tool call and replays its result without ChatGPT authentication', async () => {
  let requests = 0;
  handler = (req, res, body) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(body.model, 'local/model');
    assert.equal('reasoning' in body, false);
    assert.ok(body.tools.some(t => t.function.name === 'read_file'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (++requests === 1) {
      res.write(event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] } }] }));
      res.write(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"note.txt"}' } }] }, finish_reason: 'tool_calls' }] }));
    } else {
      assert.ok(body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_1' && m.content.includes('local works')));
      res.write(event({ choices: [{ delta: { content: 'Local ' } }] }));
      res.write(event({ choices: [{ delta: { content: 'works.' }, finish_reason: 'stop' }] }));
    }
    res.end('data: [DONE]\n\n');
  };
  const host = new Host();
  host.settings.set({ openai: { baseUrl, apiKey: '', models: ['local/model'] } });
  const bot = host.bots.create({ name: 'Local', model: 'local/model', effort: 'low' });
  bot.provider = 'openai'; host.bots.save(bot);
  fs.writeFileSync(path.join(host.bots.workspace(bot.id), 'note.txt'), 'local works');
  try {
    await host.call('chat.send', { botId: bot.id, text: 'Read note.txt' });
    for (let i = 0; i < 100 && host.runner(bot.id).running; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(host.runner(bot.id).running, false);
    assert.equal(requests, 2);
    assert.ok(host.bots.log(bot.id).items.some(m => m.type === 'assistant' && m.text === 'Local works.'));
    assert.ok(host.bots.log(bot.id).items.some(m => m.type === 'tool' && m.status === 'ok'));
    await assert.rejects(host.call('providers.models', {}, { role: 'mobile' }), /computer/);
  } finally { host.stop(); }
});

test('model discovery and non-streaming JSON replies support authenticated servers and chat-only models', async () => {
  handler = (req, res, body) => {
    assert.equal(req.headers.authorization, 'Bearer private');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] }));
    assert.equal('tools' in body, false);
    res.end(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }));
  };
  const config = { baseUrl, apiKey: 'private', tools: false };
  assert.deepEqual(await listModels(config), ['a', 'b']);
  const response = await respond({ model: 'a', config, instructions: 'Hi', input: [], tools: [{ name: 'read_file' }] });
  assert.equal(response.text, 'Hello');
});

test('truncated streams fail instead of executing incomplete tool calls', async () => {
  handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'write_file', arguments: '{' } }] } }] })); };
  await assert.rejects(respond({ model: 'a', config: { baseUrl }, instructions: '', input: [], tools: [] }), /ended early/);
});

test('compatible API: screenshots become image_url content parts', () => {
  const [, message] = chatMessages('sys', [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AA==' }] }]);
  assert.deepEqual(message.content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }]);
});
