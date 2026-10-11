import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRunner } from '../src/agent.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const until = async (condition) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail('Runner did not reach the expected state');
};
const fixture = (request, tool) => {
  const items = [], events = [];
  const log = { items, add: (item) => items.push(item), patch: (id, patch) => { const item = items.find((it) => it.id === id); Object.assign(item, patch); return item; } };
  const host = {
    bots: { log: () => log, dir: () => '/tmp/bot', workspace: () => '/tmp/bot' },
    plugins: { promptSection: () => '', toolsFor: async () => [tool], find: () => tool },
    settings: { get: () => ({ userName: 'Test', defaultPermission: 'bypass' }) },
    emit: (name, data) => events.push({ name, data }), touchBot: () => {},
  };
  return { runner: new BotRunner(host, { id: 'test', name: 'Test', permission: 'bypass' }, { request }), items, events };
};
const calls = { text: '', toolCalls: [{ id: 'one', name: 'test_tool', arguments: '{}' }, { id: 'two', name: 'test_tool', arguments: '{}' }] };

test('new messages wait for the active tool, skip remaining calls and restart with its result', async () => {
  const gate = deferred();
  let toolRuns = 0, requests = 0, toolSignal, nextInput;
  const { runner, items } = fixture(async ({ input }) => {
    if (++requests === 1) return calls;
    nextInput = input;
    return { text: 'Updated answer', toolCalls: [] };
  }, { name: 'test_tool', run: async ({ signal }) => { toolRuns++; toolSignal = signal; await gate.promise; return 'Completed result'; } });
  runner.submit('Original');
  await until(() => toolRuns === 1);
  runner.submit('Change direction');
  runner.submit('One more detail');
  assert.equal(toolSignal.aborted, false);
  assert.equal(requests, 1);
  gate.resolve();
  await until(() => !runner.running);
  assert.equal(toolRuns, 1);
  assert.equal(requests, 2);
  assert.equal(items.find((it) => it.type === 'tool').status, 'ok');
  assert.ok(nextInput.some((it) => it.type === 'function_call_output' && it.output === 'Completed result'));
  assert.ok(nextInput.some((it) => it.content?.[0]?.text.endsWith('One more detail')));
  assert.equal(items.at(-1).text, 'Updated answer');
});

test('new messages abort streaming immediately and clear the old partial response', async () => {
  let requests = 0, firstSignal;
  const { runner, items, events } = fixture(async ({ signal, onText }) => {
    if (++requests === 1) {
      firstSignal = signal;
      onText('Old partial answer');
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    }
    return { text: 'New answer', toolCalls: [] };
  }, { name: 'test_tool' });
  runner.submit('Original');
  await until(() => firstSignal);
  runner.submit('Replacement');
  assert.equal(firstSignal.aborted, true);
  await until(() => !runner.running);
  assert.equal(requests, 2);
  assert.ok(events.some((event) => event.name === 'message.discard'));
  assert.equal(items.filter((it) => it.type === 'assistant').length, 1);
  assert.equal(items.at(-1).text, 'New answer');
});

test('explicit Stop cancels a queued replacement as well as the active tool', async () => {
  let requests = 0, toolSignal;
  const { runner, items } = fixture(async () => { requests++; return calls; }, {
    name: 'test_tool', run: ({ signal }) => {
      toolSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    },
  });
  runner.submit('Original');
  await until(() => toolSignal);
  runner.submit('Replacement');
  runner.stop();
  await until(() => !runner.running);
  assert.equal(toolSignal.aborted, true);
  assert.equal(requests, 1);
  assert.equal(items.at(-1).text, 'Stopped.');
});
