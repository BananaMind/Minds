// Live smoke test against the real Codex backend: node test/live.mjs  (uses MINDS_HOME)
import { MindsClient } from '../packages/core/src/client.js';
const c = await MindsClient.connect();
const state = await c.call('state');
console.log('auth', state.auth, 'bots', state.bots.length);
c.on((e, d) => {
  if (e === 'message.added') { const i = d.item; console.log('+', i.type, i.name || '', (i.text || i.question || i.summary || '').slice(0, 120).replace(/\n/g, ' '), i.status || ''); }
  if (e === 'message.updated' && d.patch.status) console.log('~', d.id.slice(-4), d.patch.status, (d.patch.result || '').slice(0, 100).replace(/\n/g, ' '));
});
const model = process.argv[2] || 'gpt-6-sol';
const bot = await c.call('bots.create', { name: 'Smoke', model });
console.log('bot', bot.id, bot.model, bot.effort);
await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 25000)));
const hist = await c.call('chat.history', { botId: bot.id });
console.log('status', hist.status);
c.close();
